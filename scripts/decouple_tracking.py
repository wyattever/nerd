#!/usr/bin/env python3
"""One-off: lift editor workflow metadata (tracking_priority / tracking_status
/ tracking_gatherer / tracking_reviewer) out of the four main documents --
frontend/lib/{published,added,candidate,vendors}.json -- into its own side
file, frontend/lib/tracking.json, keyed by product_name.

Rationale (see frontend/lib/tracking.ts's header): tracking state is set by
a human in /editor and must survive a wholesale live-data refresh of the
content files (the scrape, and /records' "Update Stored Data" promote of a
*-live.json over its stored counterpart). Co-located, every such refresh has
to merge it back; separated, it is simply never touched. Same split
frontend/lib/passwords.json already applies to vendor-review passwords.

After this runs, the read path (lib/local-data.ts + the /api/local/* routes)
merges tracking.json back onto records by product_name, and the write path
(the same routes' POST) splits it back out -- so every /editor and /records
component still sees an unchanged record shape.

Idempotent: a second run finds no inline tracking_* keys left and only
rewrites tracking.json with the same content. Safe to re-run.

    python3 scripts/decouple_tracking.py
"""

from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
LIB = REPO_ROOT / "frontend" / "lib"
TRACKING_PATH = LIB / "tracking.json"

TRACKING_FIELDS = (
    "tracking_priority",
    "tracking_status",
    "tracking_gatherer",
    "tracking_reviewer",
)

# (filename, top-level array key). Order matters only for collision
# reporting: a product_name present in more than one file merges
# field-by-field, last non-null wins.
SOURCES = [
    ("published.json", "products"),
    ("added.json", "products"),
    ("candidate.json", "products"),
    ("vendors.json", "vendors"),
]

TRACKING_META = {
    "purpose": (
        "Editor-set workflow metadata (priority/status/gatherer/reviewer) for products and "
        "vendors, keyed by product_name. Decoupled from published/added/candidate/vendors.json "
        "so a live-data refresh of those files never disturbs it -- see lib/tracking.ts."
    ),
}


def non_blank(value: object) -> str | None:
    return value if isinstance(value, str) and value.strip() != "" else None


def main() -> None:
    rows: dict[str, dict] = {}

    for filename, key in SOURCES:
        path = LIB / filename
        doc = json.loads(path.read_text(encoding="utf-8"))
        records = doc.get(key, [])

        stripped_count = 0
        for record in records:
            name = record.get("product_name")
            values = {f: non_blank(record.pop(f, None)) for f in TRACKING_FIELDS}

            if not any(v is not None for v in values.values()):
                continue
            if not (isinstance(name, str) and name):
                print(f"  DROPPED tracking on a record with no product_name ({filename})")
                continue

            stripped_count += 1
            existing = rows.get(name)
            if existing is None:
                rows[name] = {"product_name": name, **values}
            else:
                for f, v in values.items():
                    if v is None:
                        continue
                    if existing[f] is not None and existing[f] != v:
                        print(f"  COLLISION {name!r}.{f}: {existing[f]!r} -> {v!r} ({filename})")
                    existing[f] = v

        # Rewrite the source file with the tracking_* keys removed.
        path.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"{filename}: stripped tracking from {stripped_count} record(s)")

    ordered = [rows[name] for name in sorted(rows)]
    payload = {"$schema_version": 1, "$meta": TRACKING_META, "tracking": ordered}
    TRACKING_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nWrote {len(ordered)} tracking row(s) to {TRACKING_PATH.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
