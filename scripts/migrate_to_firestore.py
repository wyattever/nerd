"""
scripts/migrate_to_firestore.py — Idempotent migration of JSON files to Firestore.

Requirements:
- Reads from NCADEMI_candidates/ and NCADEMI_products/
- Validates against schemas.ListingData
- Skips test fixtures (name contains "test" or "e2e")
- Rejects grounding-api-redirect URLs
- Idempotent upserts to nerd_candidates and nerd_products
- Supports --dry-run and --collection [candidates|products]
"""

import os
import sys
import json
import asyncio
import argparse
import re
from pathlib import Path
from typing import Optional

# Ensure project root is in PYTHONPATH
sys.path.append(os.getcwd())

from api import schemas
from google.cloud.firestore_v1.async_client import AsyncClient

# Re-implement slugify to match api/main.py exactly
def slugify(text: str) -> str:
    """Creates a URL-friendly slug from a string."""
    text = text.lower()
    return re.sub(r'[^a-z0-9]+', '-', text).strip('-')

BASE_DIR = Path(__file__).parent.parent
CANDIDATES_DIR = Path(os.getenv("CANDIDATES_DIR", str(BASE_DIR / "NCADEMI_candidates")))
PRODUCTS_DIR = Path(os.getenv("PRODUCTS_DIR", str(BASE_DIR / "NCADEMI_products")))

CANDIDATES_COLLECTION = "nerd_candidates"
PRODUCTS_COLLECTION = "nerd_products"

REDIRECT_URL_PATTERN = re.compile(r"grounding-api-redirect")

async def migrate(collection_name: str, source_dir: Path, dry_run: bool, db: Optional[AsyncClient]):
    if not source_dir.exists():
        print(f"Source directory {source_dir} does not exist. Skipping.")
        return 0, 0, 0

    files = list(source_dir.glob("*.json"))
    migrated = 0
    skipped = 0
    failed = 0

    print(f"\nMigrating {len(files)} files to {collection_name}...")

    for f in files:
        try:
            with open(f, "r") as jf:
                raw_data = json.load(jf)
            
            # 1. Skip test fixtures
            product_name = raw_data.get("product_name", f.stem)
            if "test" in product_name.lower() or "e2e" in product_name.lower():
                print(f"  [SKIP] {f.name} (test fixture)")
                skipped += 1
                continue

            # 2. Validate against schema
            try:
                data = schemas.ListingData(**raw_data)
            except Exception as e:
                print(f"  [FAIL] {f.name} (validation error): {e}")
                failed += 1
                continue

            # 3. Check for redirect URLs
            found_redirect = False
            # Check all fields in model_dump
            dumped = data.model_dump()
            def check_redirects(val):
                if isinstance(val, str):
                    if REDIRECT_URL_PATTERN.search(val):
                        return True
                elif isinstance(val, list):
                    for item in val:
                        if check_redirects(item):
                            return True
                elif isinstance(val, dict):
                    for k, v in val.items():
                        if check_redirects(v):
                            return True
                return False

            if check_redirects(dumped):
                print(f"  [FAIL] {f.name} (contains grounding-api-redirect URL)")
                failed += 1
                continue

            # 4. Upsert
            slug = slugify(data.product_name)
            if dry_run:
                print(f"  [DRY-RUN] Would migrate {f.name} -> {slug}")
                migrated += 1
            else:
                doc_ref = db.collection(collection_name).document(slug)
                await doc_ref.set(dumped)
                print(f"  [OK] Migrated {f.name} -> {slug}")
                migrated += 1

        except Exception as e:
            print(f"  [ERROR] Failed to process {f.name}: {e}")
            failed += 1

    return migrated, skipped, failed

async def main():
    parser = argparse.ArgumentParser(description="Migrate NCADEMI data to Firestore")
    parser.add_argument("--dry-run", action="store_true", help="Do not write to Firestore")
    parser.add_argument("--collection", choices=["candidates", "products"], help="Specific collection to migrate")
    args = parser.parse_args()

    project_id = os.getenv("GOOGLE_CLOUD_PROJECT")
    if not project_id and not args.dry_run:
        print("ERROR: GOOGLE_CLOUD_PROJECT env var must be set for live migration.")
        sys.exit(1)

    db = None
    if not args.dry_run:
        db = AsyncClient(project=project_id)

    c_migrated, c_skipped, c_failed = 0, 0, 0
    p_migrated, p_skipped, p_failed = 0, 0, 0

    if not args.collection or args.collection == "candidates":
        c_migrated, c_skipped, c_failed = await migrate(CANDIDATES_COLLECTION, CANDIDATES_DIR, args.dry_run, db)

    if not args.collection or args.collection == "products":
        p_migrated, p_skipped, p_failed = await migrate(PRODUCTS_COLLECTION, PRODUCTS_DIR, args.dry_run, db)

    print("\n" + "="*40)
    print("MIGRATION SUMMARY")
    print("="*40)
    print(f"Candidates: {c_migrated} migrated, {c_skipped} skipped, {c_failed} failed")
    print(f"Products:   {p_migrated} migrated, {p_skipped} skipped, {p_failed} failed")
    print("="*40)

    if c_failed > 0 or p_failed > 0:
        print("Migration completed with failures. See log above.")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())