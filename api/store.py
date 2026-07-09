"""
api/store.py — Persistence helpers for N.E.R.D.

Owns all storage state (in-memory for LOCAL_MODE, Firestore for production)
and exposes a clean async public API used by both api/main.py and api/worker.py.

Public API:
    slugify(text) -> str
    get_candidate(slug) -> dict | None
    get_product(slug) -> dict | None
    list_candidates() -> list[dict]
    list_products() -> list[dict]
    upsert_candidate(data) -> str          # returns slug
    upsert_product(data) -> str            # returns slug
    delete_candidate(slug) -> bool
    delete_product(slug) -> bool
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from pathlib import Path

LOCAL_MODE = os.getenv("LOCAL_MODE", "false").lower() == "true"

BASE_DIR = Path(__file__).parent.parent
CANDIDATES_DIR = Path(os.getenv("CANDIDATES_DIR", str(BASE_DIR / "NCADEMI_candidates")))
PRODUCTS_DIR = Path(os.getenv("PRODUCTS_DIR", str(BASE_DIR / "NCADEMI_products")))

CANDIDATES_COLLECTION = "nerd_candidates"
PRODUCTS_COLLECTION = "nerd_products"

# ── In-memory stores (LOCAL_MODE only) ────────────────────────────────────────
_local_candidates: dict[str, dict] = {}
_local_products: dict[str, dict] = {}

# Guards mutations only. Reads are single-key dict lookups with no
# read-modify-write risk across an await, so they are not locked.
_store_lock = asyncio.Lock()

if LOCAL_MODE:
    for _directory, _store in [
        (CANDIDATES_DIR, _local_candidates),
        (PRODUCTS_DIR, _local_products),
    ]:
        if _directory.exists():
            for _f in _directory.glob("*.json"):
                try:
                    with open(_f, "r", encoding="utf-8") as _json_file:
                        _data = json.load(_json_file)
                        _slug = re.sub(
                            r"[^a-z0-9]+", "-",
                            _data.get("product_name", _f.stem).lower(),
                        ).strip("-")
                        _store[_slug] = _data
                except Exception as _e:
                    print(f"[store] Failed to seed {_f}: {_e}")
    print(
        f"[LOCAL_MODE] Seeded {len(_local_candidates)} candidates "
        f"and {len(_local_products)} products."
    )

# ── Firestore client (production only) ────────────────────────────────────────
if not LOCAL_MODE:
    from .job_store import db
else:
    db = None


# ── Utilities ─────────────────────────────────────────────────────────────────

def slugify(text: str) -> str:
    """Creates a URL-friendly slug from a string."""
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


# ── Private helpers ───────────────────────────────────────────────────────────

async def _get_record(collection: str, slug: str, local_store: dict) -> dict | None:
    if LOCAL_MODE:
        return local_store.get(slug)
    doc_ref = db.collection(collection).document(slug)
    doc = await doc_ref.get()
    return doc.to_dict() if doc.exists else None


async def _list_records(collection: str, local_store: dict) -> list[dict]:
    if LOCAL_MODE:
        items = list(local_store.items())
    else:
        docs = db.collection(collection).stream()
        items = []
        async for doc in docs:
            items.append((doc.id, doc.to_dict()))

    results = []
    for slug, data in items:
        results.append({
            "name": data.get("product_name", slug),
            "slug": slug,
            "url": data.get("product_website_url", data.get("url", "")),
        })
    return sorted(results, key=lambda x: x["name"])


async def _upsert_record(
    collection: str, slug: str, data: dict, local_store: dict
) -> None:
    async with _store_lock:
        if LOCAL_MODE:
            local_store[slug] = data
        else:
            await db.collection(collection).document(slug).set(data)


async def _delete_record(
    collection: str, slug: str, local_store: dict
) -> bool:
    async with _store_lock:
        if LOCAL_MODE:
            if slug in local_store:
                del local_store[slug]
                return True
            return False
        doc_ref = db.collection(collection).document(slug)
        doc = await doc_ref.get()
        if not doc.exists:
            return False
        await doc_ref.delete()
        return True


# ── Public API ────────────────────────────────────────────────────────────────

async def get_candidate(slug: str) -> dict | None:
    return await _get_record(CANDIDATES_COLLECTION, slug, _local_candidates)


async def get_product(slug: str) -> dict | None:
    return await _get_record(PRODUCTS_COLLECTION, slug, _local_products)


async def list_candidates() -> list[dict]:
    return await _list_records(CANDIDATES_COLLECTION, _local_candidates)


async def list_products() -> list[dict]:
    return await _list_records(PRODUCTS_COLLECTION, _local_products)


async def upsert_candidate(data: dict) -> str:
    """Persists a candidate dict. Returns the slug."""
    slug = slugify(data.get("product_name", "unknown"))
    # Ensure AI insights are not stored in the record
    data.pop("ai_insights", None)
    await _upsert_record(CANDIDATES_COLLECTION, slug, data, _local_candidates)
    return slug


async def upsert_product(data: dict) -> str:
    """Persists a product dict. Returns the slug."""
    slug = slugify(data.get("product_name", "unknown"))
    # Ensure AI insights are not stored in the record
    data.pop("ai_insights", None)
    await _upsert_record(PRODUCTS_COLLECTION, slug, data, _local_products)
    return slug


async def delete_candidate(slug: str) -> bool:
    return await _delete_record(CANDIDATES_COLLECTION, slug, _local_candidates)


async def delete_product(slug: str) -> bool:
    return await _delete_record(PRODUCTS_COLLECTION, slug, _local_products)