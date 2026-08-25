#!/usr/bin/env python3
"""
dedupe_vendor_resources.py — Strip a product's own `vendor_resources`
entries that are exact URL duplicates of resources already captured in the
global vendors registry (frontend/lib/vendors.json).

Each of the three product-list files (candidate/added/published) can carry
its own vendor_resources per product, migrated independently over time from
AppSheet/scrapes -- so the same vendor accessibility-statement URL can end
up listed on both a product record AND the vendor's own VendorResource
entry in vendors.json. This script removes the product-level copy once
vendors.json already has that exact URL for that vendor, so the frontend
doesn't need to de-dupe at render time.

Matching is by (vendor_name, url) -- a URL is only stripped from a
product's vendor_resources if that product's OWN vendor_name has that exact
URL somewhere in vendors.json's global resource set for that vendor. A
resource under a different vendor's global set does not affect this
product, even if the URL happens to match (not expected in practice, but
the vendor_name key keeps a same-URL-different-vendor coincidence from
being misattributed).

This mutates candidate.json / added.json / published.json
in place. All three are tracked in git, so any change made here is a
`git diff` / `git checkout -- <file>` away from being reverted.

Usage:
    python3 scripts/dedupe_vendor_resources.py
"""

from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
VENDORS_FILE = REPO_ROOT / "frontend" / "lib" / "vendors.json"
PRODUCT_FILES = [
    REPO_ROOT / "frontend" / "lib" / "candidate.json",
    REPO_ROOT / "frontend" / "lib" / "added.json",
    REPO_ROOT / "frontend" / "lib" / "published.json",
]


def load_vendor_url_index(vendors_file: Path) -> dict[str, set[str]]:
    """{vendor_name: {resource url, ...}} from vendors.json's `resources`."""
    with open(vendors_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    index: dict[str, set[str]] = {}
    for vendor in data.get("vendors", []):
        name = vendor.get("vendor_name")
        if not name:
            continue
        urls = {r["url"] for r in vendor.get("resources", []) if r.get("url")}
        index[name] = urls
    return index


def dedupe_file(path: Path, vendor_url_index: dict[str, set[str]]) -> int:
    """Filter each product's vendor_resources against the global index in
    place; returns the number of duplicate URLs removed from this file."""
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    removed = 0
    for product in data.get("products", []):
        vendor_name = product.get("vendor_name")
        global_urls = vendor_url_index.get(vendor_name)
        if not global_urls:
            continue

        resources = product.get("vendor_resources")
        if not resources:
            continue

        kept = [r for r in resources if r.get("url") not in global_urls]
        removed += len(resources) - len(kept)
        product["vendor_resources"] = kept

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")

    return removed


def main() -> None:
    print(f"Loading global vendor resource URLs from {VENDORS_FILE} ...")
    vendor_url_index = load_vendor_url_index(VENDORS_FILE)
    total_global_urls = sum(len(urls) for urls in vendor_url_index.values())
    print(f"Loaded {len(vendor_url_index)} vendor(s), {total_global_urls} global resource URL(s).\n")

    summary: list[tuple[str, int]] = []
    for path in PRODUCT_FILES:
        if not path.exists():
            print(f"{path.relative_to(REPO_ROOT)}: SKIPPED (file not found)")
            continue
        removed = dedupe_file(path, vendor_url_index)
        summary.append((str(path.relative_to(REPO_ROOT)), removed))
        print(f"{path.relative_to(REPO_ROOT)}: removed {removed} duplicate URL(s)")

    print("\nSummary:")
    total = 0
    for name, removed in summary:
        print(f"  {name}: {removed}")
        total += removed
    print(f"  TOTAL: {total} duplicate URL(s) removed")


if __name__ == "__main__":
    main()
