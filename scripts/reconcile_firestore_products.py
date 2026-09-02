#!/usr/bin/env python3
"""
reconcile_firestore_products.py -- resolve the open question from the
2026-08-27 live infrastructure audit before anything is deleted.

BACKGROUND

The audit found 43 real documents in Firestore's `nerd_products` collection.
No project document had recorded their existence. They were written through
`POST /admin/products` (api/store.py, `schemas.ListingData` shape) at some
point before the editor suite existed, and the rewrite-vs-refactor plan
proposes deleting the code path that created them.

Three possibilities, and the plan branches on which one is true:

  (a) They duplicate what is already in frontend/lib/published.json and
      added.json. Delete freely.
  (b) They are a STALE duplicate -- same products, older content. Delete,
      but confirm nothing newer was ever written there.
  (c) They contain products or fields that exist nowhere else. They must be
      merged into the JSON documents BEFORE those documents are migrated to
      the new store, or the content is lost permanently.

This script answers that question and nothing else. IT IS STRICTLY
READ-ONLY. It opens no write path, and it is safe to run against production
at any time.

WHAT IT COMPARES

Match key is the slug, computed with the SAME `slugify` api/store.py used
to write these documents (product_name lowercased, non-alphanumerics
collapsed to hyphens, hyphens stripped from the ends). Product names are
compared as a secondary signal because a renamed product produces a
different slug while being the same record.

Field comparison is restricted to the fields both shapes actually share.
`schemas.ListingData` and `PublishedProductRecord` are not the same schema
-- the Firestore side has no `slug`, no `ncademi_product_url`, and no
`tracking_*`; the JSON side has no `html_override` or `section_overrides`.
Reporting those structural differences as per-record diffs would bury the
signal, so they are reported once, structurally, and excluded from the
per-record comparison.

OUTPUT

  .scratch/verification/nerd_products-reconcile-<UTC timestamp>.json
      Full machine-readable result: every bucket, every field-level diff.
  .scratch/verification/nerd_products-reconcile-<UTC timestamp>.md
      Human summary with a PASS/FAIL-style verdict naming which of (a),
      (b), (c) the data supports.

Filenames are timestamped and never overwritten, per the scratch-file
convention.

USAGE

    source venv312/bin/activate
    python3 scripts/reconcile_firestore_products.py

    # Against a specific project (default is read from the env var below):
    NERD_GCP_PROJECT=edtech-agent-2026 python3 scripts/reconcile_firestore_products.py

NOTE ON PROJECT ID: this script requires NERD_GCP_PROJECT explicitly and
does NOT fall back to GOOGLE_CLOUD_PROJECT. That shell global is set to
`acp-vertex-core` on this machine for unrelated tooling, and silently
reconciling against the wrong project would produce a confidently wrong
answer to the one question this script exists to answer.
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from google.cloud import firestore
except ImportError:  # pragma: no cover
    sys.exit(
        "google-cloud-firestore is not installed. Activate the project venv first:\n"
        "  source venv312/bin/activate"
    )

REPO_ROOT = Path(__file__).resolve().parent.parent
LIB_DIR = REPO_ROOT / "frontend" / "lib"
OUT_DIR = REPO_ROOT / ".scratch" / "verification"

PRODUCTS_COLLECTION = "nerd_products"

# Fields present in BOTH schemas.ListingData and PublishedProductRecord.
# Anything outside this set is a structural difference, reported separately.
COMPARABLE_FIELDS = [
    "product_name",
    "vendor_name",
    "vendor_directory_url",
    "product_description",
    "product_website_url",
    "vendor_resources",
    "other_resources",
    "support_contacts",
    "acr_reports",
    "last_updated",
]

# Sub-keys within the list-valued fields that carry meaning on both sides.
# Confidence scores and justifications are research-pipeline artifacts that
# the editor never displays or edits, so a difference in them is noise.
LIST_FIELD_KEYS = {
    "vendor_resources": ["url", "text"],
    "other_resources": ["url", "text"],
    "support_contacts": ["type", "value", "label"],
    "acr_reports": [
        "title",
        "url",
        "version",
        "date",
        "auditor_name",
        "auditor_url",
        "preparation_type",
    ],
}


def slugify(text: str) -> str:
    """Byte-for-byte the same derivation api/store.py used to key these
    documents. Reimplemented here rather than imported because this script
    must keep working after api/store.py is deleted."""
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")


def project_id() -> str:
    pid = os.getenv("NERD_GCP_PROJECT")
    if not pid:
        sys.exit(
            "NERD_GCP_PROJECT is not set. Set it explicitly -- this script "
            "deliberately does not fall back to GOOGLE_CLOUD_PROJECT.\n"
            "  NERD_GCP_PROJECT=edtech-agent-2026 python3 scripts/reconcile_firestore_products.py"
        )
    return pid


def load_firestore_products(pid: str) -> dict[str, dict[str, Any]]:
    client = firestore.Client(project=pid)
    out: dict[str, dict[str, Any]] = {}
    for doc in client.collection(PRODUCTS_COLLECTION).stream():
        out[doc.id] = doc.to_dict() or {}
    return out


def load_json_products() -> dict[str, dict[str, Any]]:
    """Every product record across published.json and added.json, keyed by
    the slug the Firestore side would have used. Both documents are read
    because a product's home moves between them over its lifecycle
    (candidate -> added -> published), and a Firestore record could
    correspond to either."""
    merged: dict[str, dict[str, Any]] = {}
    for name in ("published.json", "added.json"):
        path = LIB_DIR / name
        if not path.exists():
            print(f"[warn] {path} not found -- skipping", file=sys.stderr)
            continue
        body = json.loads(path.read_text(encoding="utf-8"))
        for record in body.get("products", []):
            key = slugify(record.get("product_name", ""))
            if not key:
                continue
            record = dict(record)
            record["__source_file"] = name
            merged[key] = record
    return merged


def normalize_list(field: str, value: Any) -> list[dict[str, Any]]:
    keys = LIST_FIELD_KEYS[field]
    rows = value if isinstance(value, list) else []
    normalized = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        normalized.append({k: (row.get(k) or "") for k in keys})
    # Order is not meaningful for comparison -- an editor reordering
    # resources is not a content difference.
    return sorted(normalized, key=lambda r: json.dumps(r, sort_keys=True))


def normalize_scalar(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def diff_record(fs: dict[str, Any], js: dict[str, Any]) -> dict[str, Any]:
    """Field-level differences between one Firestore record and its JSON
    counterpart, restricted to COMPARABLE_FIELDS."""
    differences: dict[str, Any] = {}
    for field in COMPARABLE_FIELDS:
        if field in LIST_FIELD_KEYS:
            a = normalize_list(field, fs.get(field))
            b = normalize_list(field, js.get(field))
        else:
            a = normalize_scalar(fs.get(field))
            b = normalize_scalar(js.get(field))
        if a != b:
            differences[field] = {"firestore": a, "json": b}
    return differences


def main() -> int:
    pid = project_id()
    print(f"[info] project: {pid}")
    print(f"[info] reading {PRODUCTS_COLLECTION} (read-only)...")

    fs_products = load_firestore_products(pid)
    js_products = load_json_products()

    print(f"[info] firestore: {len(fs_products)} documents")
    print(f"[info] json:      {len(js_products)} records (published.json + added.json)")

    fs_keys = set(fs_products)
    js_keys = set(js_products)

    only_firestore = sorted(fs_keys - js_keys)
    only_json = sorted(js_keys - fs_keys)
    in_both = sorted(fs_keys & js_keys)

    identical: list[str] = []
    differing: dict[str, dict[str, Any]] = {}
    for key in in_both:
        differences = diff_record(fs_products[key], js_products[key])
        if differences:
            differing[key] = differences
        else:
            identical.append(key)

    # Structural difference report, once rather than per record.
    fs_fields: set[str] = set()
    for doc in fs_products.values():
        fs_fields |= set(doc)
    js_fields: set[str] = set()
    for rec in js_products.values():
        js_fields |= set(rec)
    js_fields.discard("__source_file")

    # Which Firestore-only records carry content at all, as opposed to being
    # empty shells left by an aborted write. This is the number that decides
    # whether possibility (c) is live.
    def has_content(doc: dict[str, Any]) -> bool:
        for field in ("vendor_resources", "other_resources", "support_contacts", "acr_reports"):
            if doc.get(field):
                return True
        return bool(normalize_scalar(doc.get("product_description")))

    only_firestore_with_content = [k for k in only_firestore if has_content(fs_products[k])]

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "project": pid,
        "counts": {
            "firestore_documents": len(fs_products),
            "json_records": len(js_products),
            "only_in_firestore": len(only_firestore),
            "only_in_firestore_with_content": len(only_firestore_with_content),
            "only_in_json": len(only_json),
            "in_both": len(in_both),
            "in_both_identical": len(identical),
            "in_both_differing": len(differing),
        },
        "schema": {
            "firestore_only_fields": sorted(fs_fields - js_fields),
            "json_only_fields": sorted(js_fields - fs_fields),
            "shared_fields": sorted(fs_fields & js_fields),
            "compared_fields": COMPARABLE_FIELDS,
        },
        "only_in_firestore": only_firestore,
        "only_in_firestore_with_content": only_firestore_with_content,
        "only_in_json": only_json,
        "in_both_identical": identical,
        "in_both_differing": differing,
        "firestore_documents": fs_products,
    }

    json_path = OUT_DIR / f"nerd_products-reconcile-{stamp}.json"
    json_path.write_text(json.dumps(result, indent=2, default=str), encoding="utf-8")

    # Verdict. Deliberately conservative: anything that could be case (c)
    # is reported as (c), because the cost of a false (a) is permanent data
    # loss and the cost of a false (c) is one afternoon of manual review.
    if only_firestore_with_content:
        verdict = "C -- CONTENT EXISTS ONLY IN FIRESTORE. Do not delete nerd_products yet."
        action = (
            f"{len(only_firestore_with_content)} Firestore document(s) have no counterpart in "
            "published.json or added.json AND carry real content. Review each one and decide "
            "whether it belongs in the JSON documents before the migration runs."
        )
    elif differing:
        verdict = "B -- OVERLAPPING BUT DIVERGENT. Review the diffs before deleting."
        action = (
            f"{len(differing)} record(s) exist on both sides with differing content. Determine "
            "which side is authoritative for each. In most cases the JSON documents will be "
            "newer (they are where all editing has happened since the editor suite shipped), "
            "but that must be confirmed rather than assumed."
        )
    else:
        verdict = "A -- FULLY SUBSUMED. nerd_products can be deleted."
        action = (
            "Every Firestore document is matched by an identical JSON record. Nothing is lost "
            "by deleting the collection and api/store.py's product-side code."
        )

    lines = [
        "# nerd_products reconciliation",
        "",
        f"**Generated:** {result['generated_at']}",
        f"**Project:** `{pid}`",
        f"**Raw result:** `{json_path.relative_to(REPO_ROOT)}`",
        "",
        f"## Verdict: {verdict}",
        "",
        action,
        "",
        "## Counts",
        "",
        "| | |",
        "|---|---:|",
        f"| Firestore `nerd_products` documents | {len(fs_products)} |",
        f"| JSON records (published + added) | {len(js_products)} |",
        f"| Present on both sides | {len(in_both)} |",
        f"| &nbsp;&nbsp;-- identical on compared fields | {len(identical)} |",
        f"| &nbsp;&nbsp;-- differing | {len(differing)} |",
        f"| Only in Firestore | {len(only_firestore)} |",
        f"| &nbsp;&nbsp;-- and carrying real content | {len(only_firestore_with_content)} |",
        f"| Only in JSON | {len(only_json)} |",
        "",
        "## Schema differences (structural, expected)",
        "",
        f"- Fields only in Firestore: {', '.join(f'`{f}`' for f in sorted(fs_fields - js_fields)) or 'none'}",
        f"- Fields only in JSON: {', '.join(f'`{f}`' for f in sorted(js_fields - fs_fields)) or 'none'}",
        "",
        "These are excluded from the per-record comparison. `ListingData` and",
        "`PublishedProductRecord` were never the same schema; only the fields they share",
        "can be meaningfully diffed.",
        "",
    ]

    if only_firestore_with_content:
        lines += ["## Firestore-only documents with content", ""]
        for key in only_firestore_with_content:
            doc = fs_products[key]
            lines.append(f"- `{key}` -- {doc.get('product_name', '(no name)')}")
        lines.append("")

    if only_firestore and len(only_firestore) != len(only_firestore_with_content):
        empty = [k for k in only_firestore if k not in set(only_firestore_with_content)]
        lines += [
            "## Firestore-only documents with no content",
            "",
            "Likely aborted or placeholder writes. Listed for completeness; no action implied.",
            "",
        ]
        lines += [f"- `{k}`" for k in empty]
        lines.append("")

    if differing:
        lines += ["## Records differing between the two sides", ""]
        for key, differences in differing.items():
            lines.append(f"### `{key}`")
            lines.append("")
            for field, pair in differences.items():
                lines.append(f"- **{field}**")
                lines.append(f"  - Firestore: `{json.dumps(pair['firestore'])[:400]}`")
                lines.append(f"  - JSON: `{json.dumps(pair['json'])[:400]}`")
            lines.append("")

    md_path = OUT_DIR / f"nerd_products-reconcile-{stamp}.md"
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print()
    print(f"VERDICT: {verdict}")
    print()
    print(f"  summary: {md_path.relative_to(REPO_ROOT)}")
    print(f"  raw:     {json_path.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
