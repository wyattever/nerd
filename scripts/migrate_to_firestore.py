"""
scripts/migrate_to_firestore.py — Idempotent migration of JSON data to Firestore.

Requirements:
- Reads from eval/eval_data.json
- Validates against schemas.ListingData
- Skips test fixtures (name contains "test" or "e2e")
- Rejects grounding-api-redirect URLs
- Idempotent upserts to nerd_candidates
- Supports --dry-run
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
JSON_SOURCE = BASE_DIR / "eval" / "eval_data.json"

CANDIDATES_COLLECTION = "nerd_candidates"
REDIRECT_URL_PATTERN = re.compile(r"grounding-api-redirect")

async def migrate_from_json(collection_name: str, source_file: Path, dry_run: bool, db: Optional[AsyncClient]):
    if not source_file.exists():
        print(f"Source file {source_file} does not exist. Skipping.")
        return 0, 0, 0

    with open(source_file, "r") as jf:
        candidates = json.load(jf)
    
    migrated = 0
    skipped = 0
    failed = 0

    print(f"\nMigrating {len(candidates)} records from {source_file} to {collection_name}...")

    for raw_data in candidates:
        try:
            # 1. Skip test fixtures
            product_name = raw_data.get("product_name", "unknown")
            if "test" in product_name.lower() or "e2e" in product_name.lower():
                print(f"  [SKIP] {product_name} (test fixture)")
                skipped += 1
                continue

            # 2. Validate against schema
            try:
                data = schemas.ListingData(**raw_data)
            except Exception as e:
                print(f"  [FAIL] {product_name} (validation error): {e}")
                failed += 1
                continue

            # 3. Check for redirect URLs
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
                print(f"  [FAIL] {product_name} (contains grounding-api-redirect URL)")
                failed += 1
                continue

            # 4. Upsert
            slug = slugify(data.product_name)
            if dry_run:
                print(f"  [DRY-RUN] Would migrate {product_name} -> {slug}")
                migrated += 1
            else:
                doc_ref = db.collection(collection_name).document(slug)
                await doc_ref.set(dumped)
                print(f"  [OK] Migrated {product_name} -> {slug}")
                migrated += 1

        except Exception as e:
            print(f"  [ERROR] Failed to process {product_name}: {e}")
            failed += 1

    return migrated, skipped, failed

async def main():
    parser = argparse.ArgumentParser(description="Migrate eval_data.json to Firestore")
    parser.add_argument("--dry-run", action="store_true", help="Do not write to Firestore")
    args = parser.parse_args()

    project_id = os.getenv("GOOGLE_CLOUD_PROJECT")
    if not project_id and not args.dry_run:
        print("ERROR: GOOGLE_CLOUD_PROJECT env var must be set for live migration.")
        sys.exit(1)

    db = None
    if not args.dry_run:
        db = AsyncClient(project=project_id)

    migrated, skipped, failed = await migrate_from_json(CANDIDATES_COLLECTION, JSON_SOURCE, args.dry_run, db)

    print("\n" + "="*40)
    print("MIGRATION SUMMARY")
    print("="*40)
    print(f"Candidates: {migrated} migrated, {skipped} skipped, {failed} failed")
    print("="*40)

    if failed > 0:
        print("Migration completed with failures. See log above.")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())