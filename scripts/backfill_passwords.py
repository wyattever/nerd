#!/usr/bin/env python3
"""One-off backfill: assigns a vendor-review password to every product in
frontend/lib/candidate.json and frontend/lib/added.json that doesn't
already have one in frontend/lib/passwords.json. Deliberately does NOT
touch published.json -- a password is vendor-review-only metadata for a
still-gated "Added to Site" page, meaningless (and actively cleaned up on
promotion, see app/api/local/passwords/route.ts's DELETE) once a product
is publicly live.

Only needed because passwords are normally generated once, at Import
Candidate time (see frontend/app/editor/(routed)/candidates/CandidateEditor.tsx's
handleImport) -- anything already in candidate.json/added.json before
that feature shipped has no password yet, and re-importing a candidate
isn't possible (handleImport blocks on a duplicate slug), nor does
viewing an Added record ever create one (AddedEditor.tsx's own password
lookup is read-only by design). This script is the one-off catch-up for
that pre-existing set; it is NOT meant to run on every deploy.

Generation pattern (must exactly match frontend/lib/passwords.ts's
getOrCreatePassword -- kept in sync manually, same as every other
TS/Python duplication in this repo, e.g. scrape_ncademi_live.py's own
migrate_vendors_to_unified.py counterpart): the first four characters of
the product name with spaces stripped and lowercased, plus the two-digit
current year, e.g. "MLC Number Chart" -> "mlcn-26". A second product
colliding on that same base (e.g. "MLC Number Pieces" -> also "mlcn") gets
a numeric suffix starting at 1 ("mlcn-26-1"), incrementing past any suffix
already taken. Idempotent: a product_name that already has a password in
passwords.json is left untouched and not counted as newly assigned --
safe to run again after this (e.g. once more candidates/added products
exist without passwords), it will only fill in the gap.

Candidate and Added are processed in that order, matching the order
either would naturally have picked up a password had the feature existed
when they were created -- matters only for which product "wins" an
unsuffixed base on a same-base collision.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CANDIDATE_PATH = REPO_ROOT / "frontend" / "lib" / "candidate.json"
ADDED_PATH = REPO_ROOT / "frontend" / "lib" / "added.json"
PASSWORDS_PATH = REPO_ROOT / "frontend" / "lib" / "passwords.json"

SOURCES = [
    ("candidate.json", CANDIDATE_PATH),
    ("added.json", ADDED_PATH),
]


def base_slug(product_name: str) -> str:
    """First four characters of the space-stripped, lowercased product
    name -- same "first four characters, not filtered to letters only"
    reading as passwords.ts's baseSlug (this repo's product names are
    plain words with no punctuation to disambiguate against)."""
    stripped = re.sub(r"\s+", "", product_name).lower()
    return stripped[:4]


def two_digit_year(now: datetime) -> str:
    return f"{now.year % 100:02d}"


def next_available_password(base: str, existing_passwords: set[str]) -> str:
    if base not in existing_passwords:
        return base
    suffix = 1
    while f"{base}-{suffix}" in existing_passwords:
        suffix += 1
    return f"{base}-{suffix}"


def main() -> None:
    now = datetime.now(timezone.utc)

    with open(PASSWORDS_PATH, "r", encoding="utf-8") as f:
        passwords_file = json.load(f)
    records: list[dict] = passwords_file.get("passwords", [])

    existing_by_product_name = {r["product_name"] for r in records}
    existing_passwords = {r["password"] for r in records}

    created = 0
    skipped = 0
    for label, source_path in SOURCES:
        with open(source_path, "r", encoding="utf-8") as f:
            products = json.load(f)["products"]

        print(f"-- {label} ({len(products)} product(s)) --")
        for product in products:
            product_name = product.get("product_name")
            if not product_name:
                continue
            if product_name in existing_by_product_name:
                skipped += 1
                continue

            base = f"{base_slug(product_name)}-{two_digit_year(now)}"
            password = next_available_password(base, existing_passwords)

            record = {
                "product_name": product_name,
                "vendor_name": product.get("vendor_name"),
                "password": password,
                # JS Date#toISOString() format (milliseconds, "Z" suffix),
                # to match the timestamp shape the live app itself writes.
                "timestamp": now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z",
            }
            records.append(record)
            existing_by_product_name.add(product_name)
            existing_passwords.add(password)
            created += 1
            print(f"  {product_name!r} -> {password}")

    passwords_file["passwords"] = records
    with open(PASSWORDS_PATH, "w", encoding="utf-8") as f:
        json.dump(passwords_file, f, indent=2)
        f.write("\n")

    print(f"\nCreated {created} new password(s), skipped {skipped} already-assigned product(s).")


if __name__ == "__main__":
    main()
