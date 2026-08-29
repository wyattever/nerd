from __future__ import annotations

import os
import logging

import asyncio
from dataclasses import asdict

from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pathlib import Path
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
import firebase_admin
from firebase_admin import auth as fb_auth

from nerd_core.generators import render_listing_html
from nerd_core.utils import resolve_and_validate_all
from nerd_core.pipeline import validate_draft

from . import schemas
from .conversions import pydantic_to_dataclass, dataclass_to_pydantic
from .store import (
    db as firestore_db,
    PRODUCTS_COLLECTION,
    slugify,
    get_candidate,
    get_product,
    list_candidates,
    list_products,
    upsert_candidate,
    upsert_product,
    delete_candidate,
    delete_product,
)

BASE_DIR = Path(__file__).parent.parent

# ── Local Mode Config ─────────────────────────────────────────────────────────
LOCAL_MODE = os.getenv("LOCAL_MODE", "false").lower() == "true"
# ──────────────────────────────────────────────────────────────────────────────

# ── Firebase Admin Init ───────────────────────────────────────────────────────
if not LOCAL_MODE:
    if not firebase_admin._apps:
        firebase_admin.initialize_app()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

logger = logging.getLogger("nerd.api")

app = FastAPI(title="N.E.R.D. API", version="0.4.0-bearer-auth")

# ── Artifacts ──────────────────────────────────────────────────────────────
# Ensure artifacts directory exists and mount it
os.makedirs("artifacts", exist_ok=True)
app.mount("/artifacts", StaticFiles(directory="artifacts"), name="artifacts")

# ── Auth Dependency ───────────────────────────────────────────────────────────
bearer_scheme = HTTPBearer(auto_error=False)

async def verify_token(cred: HTTPAuthorizationCredentials | None = Depends(bearer_scheme)) -> str:
    if LOCAL_MODE:
        return "local-dev-user"
    
    if not cred:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    
    try:
        decoded_token = await asyncio.to_thread(fb_auth.verify_id_token, cred.credentials)
        return decoded_token["uid"]
    except Exception as e:
        logger.error(f"Token verification failed: {e}")
        raise HTTPException(status_code=401, detail="Invalid or expired token")

# ── CORS ───────────────────────────────────────────────────────────────────────
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

def normalize_html_fragment(raw_html: str) -> str:
    if not raw_html:
        return ""
    soup = BeautifulSoup(raw_html, 'html.parser')
    if soup.body:
        return soup.body.decode_contents()
    return str(soup)

# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.post("/render", response_model=schemas.RenderResponse)
async def render(payload: schemas.RenderRequest, uid: str = Depends(verify_token)):
    if payload.html_override:
        normalized_html = normalize_html_fragment(payload.html_override)
        return schemas.RenderResponse(html=normalized_html)
    listing_dc = pydantic_to_dataclass(payload)
    html = render_listing_html(listing_dc)
    return schemas.RenderResponse(html=html)

# ── Link Validation ──────────────────────────────────────────────────────────

@app.post("/research/validate-links", response_model=schemas.LinkValidationResponse)
async def validate_links(request: schemas.LinkValidationRequest, uid: str = Depends(verify_token)):
    """
    Server-side link validation.
    Reuses resolve_and_validate_all to catch 404s and handle SSRF protection.
    """
    try:
        valid_links_dict = await resolve_and_validate_all(request.urls)

        def _is_reachable(u: str) -> bool:
            resolved = valid_links_dict.get(u)
            return resolved is not None and not str(resolved).startswith("ERROR:")

        unreachable = [url for url in request.urls if not _is_reachable(url)]

        return schemas.LinkValidationResponse(unreachable_urls=unreachable)
        
    except Exception as e:
        logger.exception("Link validation failed")
        raise HTTPException(status_code=500, detail=f"Link validation engine failed: {str(e)}")

# ── Draft Ingest (Import Data feature) ────────────────────────────────────────
# See nerd-import-data-architecture-v4.md §4.2. Not under /admin/ (does not
# touch the store) and not under /research/ (does not call Gemini).

@app.post("/ingest/draft", response_model=schemas.IngestDraftResponse)
async def ingest_draft(req: schemas.IngestDraftRequest, uid: str = Depends(verify_token)):
    try:
        result = await validate_draft(req.draft_markdown)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.exception("Draft ingest failed")
        raise HTTPException(status_code=502, detail="Draft validation failed -- see server logs.")

    return schemas.IngestDraftResponse(
        parsed_listing=dataclass_to_pydantic(result.listing),
        raw_markdown=req.draft_markdown,
        rejections=result.rejections,
        diagnostics=schemas.DraftDiagnostics(**asdict(result.diagnostics)),
    )

# ── Administrative Endpoints ──────────────────────────────────────────────────

@app.get("/admin/batch-report")
async def get_batch_report(uid: str = Depends(verify_token)):
    report_path = BASE_DIR / "NCADEMI_candidates_summary.html"
    if not report_path.exists():
        raise HTTPException(
            status_code=404, 
            detail="Batch report not found. Please run a batch process first."
        )
    return FileResponse(report_path)

@app.get("/admin/candidates")
async def list_candidates_endpoint(uid: str = Depends(verify_token)):
    return await list_candidates()

@app.get("/admin/candidates/{slug}")
async def get_candidate_data(slug: str, uid: str = Depends(verify_token)):
    data = await get_candidate(slug)
    if not data:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return data

@app.get("/admin/products")
async def list_products_endpoint(uid: str = Depends(verify_token)):
    return await list_products()

@app.get("/admin/products/{slug}")
async def get_product_data(slug: str, uid: str = Depends(verify_token)):
    data = await get_product(slug)
    if not data:
        raise HTTPException(status_code=404, detail="Product not found")
    return data

@app.post("/admin/candidates")
async def save_candidate(data: schemas.CandidateRecord, uid: str = Depends(verify_token)):
    # AI insights are stripped on ingestion/persistence
    model_data = data.model_dump()
    model_data.pop("ai_insights", None)
    slug = await upsert_candidate(model_data)
    return {"message": "Candidate saved successfully", "slug": slug}

@app.post("/admin/products")
async def save_product(data: schemas.ListingData, uid: str = Depends(verify_token)):
    # AI insights are stripped on ingestion/persistence
    model_data = data.model_dump()
    model_data.pop("ai_insights", None)
    slug = await upsert_product(model_data)
    return {"message": "Product saved successfully", "slug": slug}

@app.delete("/admin/candidates/{slug}")
async def delete_candidate_endpoint(slug: str, uid: str = Depends(verify_token)):
    success = await delete_candidate(slug)
    if not success:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return {"message": "Candidate deleted successfully"}

@app.put("/admin/candidates/{slug}")
async def update_candidate(slug: str, data: schemas.CandidateRecord, uid: str = Depends(verify_token)):
    existing = await get_candidate(slug)
    if not existing:
        raise HTTPException(status_code=404, detail="Candidate not found")
    # AI insights are stripped on update
    model_data = data.model_dump()
    model_data.pop("ai_insights", None)
    await upsert_candidate(model_data)
    return {"message": "Candidate updated successfully", "slug": slug}

@app.get("/healthz")
async def healthz():
    from datetime import datetime, timezone

    if LOCAL_MODE:
        return {
            "status": "ok",
            "checks": {"firestore": "ok (local_mode)"},
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "note": "local_mode: true",
        }

    checks = {"firestore": "pending"}
    try:
        doc_ref = firestore_db.collection(PRODUCTS_COLLECTION).document("health-check-non-existent")
        await asyncio.wait_for(doc_ref.get(), timeout=3.0)
        checks["firestore"] = "ok"
    except asyncio.TimeoutError:
        checks["firestore"] = "error: timeout (3s)"
    except Exception as e:
        checks["firestore"] = f"error: {str(e)}"

    status = "ok" if checks["firestore"] == "ok" else "error"
    return {
        "status": status,
        "checks": checks,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }