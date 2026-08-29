from __future__ import annotations

import os
import logging

import asyncio
from dataclasses import asdict

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
import firebase_admin
from firebase_admin import auth as fb_auth

from nerd_core.pipeline import validate_draft

from . import schemas
from .conversions import dataclass_to_pydantic
from .store import db as firestore_db, PRODUCTS_COLLECTION, slugify  # noqa: F401  (re-exported; used by tests/unit/test_api_utils.py)

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

# ── Endpoints ─────────────────────────────────────────────────────────────────

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