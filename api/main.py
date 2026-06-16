"""
api/main.py — FastAPI wrapper around nerd_core (Phase 4 Update).

Phase 4 changes:
- Cloud Tasks tasks now include OIDC token for authenticated worker invocation.
- TASKS_SA env var wires the service account for OIDC auth.
- CORS origins locked to FRONTEND_URL env var (no wildcard in production).
"""

from __future__ import annotations

import os
import re
import uuid
import json
import logging
import asyncio
from typing import Any

from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, HTMLResponse, FileResponse
from pathlib import Path
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from google.cloud import tasks_v2
import firebase_admin
from firebase_admin import auth as fb_auth

from nerd_core.generators import render_listing_html
from nerd_core.utils import resolve_and_validate_all
from nerd_core.link_validator_engine import LinkValidatorEngine

from . import schemas
from .conversions import pydantic_to_dataclass
from .job_store import create_job, stream_job_events

def slugify(text: str) -> str:
    """Creates a URL-friendly slug from a string."""
    text = text.lower()
    return re.sub(r'[^a-z0-9]+', '-', text).strip('-')

# ── Local Mode Config ─────────────────────────────────────────────────────────
LOCAL_MODE = os.getenv("LOCAL_MODE", "false").lower() == "true"
if LOCAL_MODE:
    from .worker import worker_initial, worker_deep_dive, WorkerInitialRequest, WorkerDeepDiveRequest
# ──────────────────────────────────────────────────────────────────────────────

# ── Storage Config ────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent.parent
# Deprecated filesystem paths (Phase 5)
CANDIDATES_DIR = BASE_DIR / "NCADEMI_candidates"
PRODUCTS_DIR = BASE_DIR / "NCADEMI_products"

# In-memory stores for LOCAL_MODE
_local_candidates: dict[str, dict] = {}
_local_products: dict[str, dict] = {}

if LOCAL_MODE:
    # Seed from filesystem for local testing
    for directory, store in [(CANDIDATES_DIR, _local_candidates), (PRODUCTS_DIR, _local_products)]:
        if directory.exists():
            for f in directory.glob("*.json"):
                try:
                    with open(f, "r") as json_file:
                        data = json.load(json_file)
                        slug = slugify(data.get("product_name", f.stem))
                        store[slug] = data
                except Exception as e:
                    print(f"Failed to seed {f}: {e}")
    print(f"[LOCAL_MODE] Seeded {len(_local_candidates)} candidates and {len(_local_products)} products.")

# Firestore collections (production)
CANDIDATES_COLLECTION = "nerd_candidates"
PRODUCTS_COLLECTION = "nerd_products"

# Use the existing db AsyncClient from job_store if available
if not LOCAL_MODE:
    from .job_store import db
else:
    db = None

async def _get_record(collection: str, slug: str, local_store: dict) -> dict | None:
    if LOCAL_MODE:
        return local_store.get(slug)
    doc_ref = db.collection(collection).document(slug)
    doc = await doc_ref.get()
    return doc.to_dict() if doc.exists else None

async def _list_records(collection: str, local_store: dict) -> list[dict]:
    if LOCAL_MODE:
        items = [(slug, data) for slug, data in local_store.items()]
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
            "url": data.get("product_website_url", data.get("url", ""))
        })
    return sorted(results, key=lambda x: x["name"])

async def _upsert_record(collection: str, slug: str, data: schemas.ListingData, local_store: dict):
    dumped = data.model_dump()
    if LOCAL_MODE:
        local_store[slug] = dumped
    else:
        await db.collection(collection).document(slug).set(dumped)

async def _delete_record(collection: str, slug: str, local_store: dict) -> bool:
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

# ──────────────────────────────────────────────────────────────────────────────

# ── Firebase Admin Init ───────────────────────────────────────────────────────
if not firebase_admin._apps:
    # On Cloud Run, it uses the default service account automatically.
    # Locally, it uses GOOGLE_APPLICATION_CREDENTIALS env var.
    firebase_admin.initialize_app()

logger = logging.getLogger("nerd.api")

app = FastAPI(title="N.E.R.D. API", version="0.4.0-bearer-auth")

# ── Link Validation Engine & Artifacts ────────────────────────────────────────
validator = LinkValidatorEngine()
validation_jobs: dict[str, dict] = {}

# Ensure artifacts directory exists and mount it
os.makedirs("artifacts", exist_ok=True)
app.mount("/artifacts", StaticFiles(directory="artifacts"), name="artifacts")

templates = Jinja2Templates(directory="templates")

# ── Auth Dependency ───────────────────────────────────────────────────────────
bearer_scheme = HTTPBearer(auto_error=False)

async def verify_token(cred: HTTPAuthorizationCredentials | None = Depends(bearer_scheme)) -> str:
    """Verifies the Firebase ID token. Returns the user UID."""
    if LOCAL_MODE:
        return "local-dev-user"
    
    if not cred:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    
    try:
        # verify_id_token is I/O light but can block; run in thread for safety.
        decoded_token = await asyncio.to_thread(fb_auth.verify_id_token, cred.credentials)
        return decoded_token["uid"]
    except Exception as e:
        logger.error(f"Token verification failed: {e}")
        raise HTTPException(status_code=401, detail="Invalid or expired token")

# ── CORS ───────────────────────────────────────────────────────────────────────
# Lock to the deployed frontend URL in production.
# Falls back to localhost for local dev.
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

# ── Cloud Tasks ────────────────────────────────────────────────────────────────
PROJECT_ID = os.getenv("GOOGLE_CLOUD_PROJECT", "edtech-agent-2026")
LOCATION = os.getenv("GCP_LOCATION", "us-central1")
QUEUE_NAME = os.getenv("QUEUE_NAME", "nerd-research-queue")
WORKER_URL = os.getenv("WORKER_URL")
TASKS_SA = os.getenv("TASKS_SA")  # Service account for OIDC-authenticated worker calls

try:
    tasks_client = tasks_v2.CloudTasksClient()
    queue_path = tasks_client.queue_path(PROJECT_ID, LOCATION, QUEUE_NAME)
except Exception as e:
    logger.warning("Failed to initialize Cloud Tasks client: %s", e)


def _enqueue_task(endpoint_path: str, payload: dict) -> None:
    if not WORKER_URL:
        raise ValueError("WORKER_URL is not set.")

    task: dict[str, Any] = {
        "http_request": {
            "http_method": tasks_v2.HttpMethod.POST,
            "url": f"{WORKER_URL}{endpoint_path}",
            "headers": {"Content-type": "application/json"},
            "body": json.dumps(payload).encode(),
        }
    }

    # Phase 4: OIDC token for authenticated worker invocation
    # Worker is deployed with --no-allow-unauthenticated; Cloud Tasks
    # attaches an OIDC token so the worker accepts the request.
    if TASKS_SA:
        task["http_request"]["oidc_token"] = {
            "service_account_email": TASKS_SA,
            "audience": WORKER_URL,
        }

    tasks_client.create_task(request={"parent": queue_path, "task": task})


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.post("/research/initial", response_model=schemas.EnqueueResponse)
async def research_initial(
    req: schemas.InitialResearchRequest, 
    background_tasks: BackgroundTasks,
    uid: str = Depends(verify_token)
):
    job_id = str(uuid.uuid4())
    await create_job(job_id)
    payload = req.model_dump()
    payload["job_id"] = job_id

    if LOCAL_MODE:
        worker_req = WorkerInitialRequest(**payload)
        background_tasks.add_task(worker_initial, worker_req)
    else:
        _enqueue_task("/worker/initial", payload)

    return schemas.EnqueueResponse(job_id=job_id)


@app.post("/research/deep-dive", response_model=schemas.EnqueueResponse)
async def research_deep_dive(
    req: schemas.DeepDiveRequest, 
    background_tasks: BackgroundTasks,
    uid: str = Depends(verify_token)
):
    job_id = req.job_id or str(uuid.uuid4())
    await create_job(job_id)
    payload = req.model_dump()
    payload["job_id"] = job_id

    if LOCAL_MODE:
        worker_req = WorkerDeepDiveRequest(**payload)
        background_tasks.add_task(worker_deep_dive, worker_req)
    else:
        _enqueue_task("/worker/deep-dive", payload)

    return schemas.EnqueueResponse(job_id=job_id)


@app.get("/jobs/{job_id}")
async def jobs_sse(request: Request, job_id: str, uid: str = Depends(verify_token)):
    # SSE auth strategy (Phase 4): Bearer token + Last-Event-ID resume support.
    last_event_id = request.headers.get("Last-Event-ID")
    return StreamingResponse(
        stream_job_events(job_id, last_event_id=last_event_id), 
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@app.post("/render", response_model=schemas.RenderResponse)
async def render(payload: schemas.RenderRequest):
    listing_dc = pydantic_to_dataclass(payload)
    html = render_listing_html(listing_dc)
    return schemas.RenderResponse(html=html)


# ── Advanced Link Validation ──────────────────────────────────────────────────

async def run_link_validation_background(job_id: str, urls: list[str]):
    try:
        validation_jobs[job_id]["status"] = "processing"
        results = await validator.run(urls)
        # Convert datetime objects to strings for JSON serialization
        serialized_results = {}
        for url, res in results.items():
            serialized_results[url] = {
                "url": res.url,
                "is_valid": res.is_valid,
                "status_code": res.status_code,
                "reason": res.reason,
                "screenshot_path": res.screenshot_path,
                "timestamp": res.timestamp.isoformat()
            }
        validation_jobs[job_id]["results"] = serialized_results
        validation_jobs[job_id]["status"] = "complete"
    except Exception as e:
        logger.error(f"Background validation failed for {job_id}: {e}")
        validation_jobs[job_id]["status"] = "error"
        validation_jobs[job_id]["error"] = str(e)

@app.post("/research/validate-links-async", response_model=schemas.LinkValidationJobStatus)
async def validate_links_async(
    request: schemas.LinkValidationRequest, 
    background_tasks: BackgroundTasks,
    uid: str = Depends(verify_token)
):
    job_id = str(uuid.uuid4())
    validation_jobs[job_id] = {"status": "queued", "results": None}
    background_tasks.add_task(run_link_validation_background, job_id, request.urls)
    return schemas.LinkValidationJobStatus(job_id=job_id, status="queued")

@app.get("/research/validate-links/{job_id}", response_model=schemas.LinkValidationJobStatus)
async def get_validation_status(job_id: str, uid: str = Depends(verify_token)):
    if job_id not in validation_jobs:
        raise HTTPException(status_code=404, detail="Validation job not found")
    return schemas.LinkValidationJobStatus(job_id=job_id, **validation_jobs[job_id])

@app.get("/admin/link-reviewer", response_class=HTMLResponse)
async def link_reviewer_ui(request: Request):
    """Simple UI for reviewing invalid links across all completed jobs."""
    invalid_links = []
    for job_id, data in validation_jobs.items():
        if data["status"] == "complete" and data["results"]:
            for url, res in data["results"].items():
                if not res["is_valid"]:
                    invalid_links.append({
                        "job_id": job_id,
                        **res
                    })
    
    return templates.TemplateResponse("link_validator.html", {
        "request": request, 
        "invalid_links": invalid_links
    })


@app.post("/research/validate-links", response_model=schemas.LinkValidationResponse)
async def validate_links(request: schemas.LinkValidationRequest, uid: str = Depends(verify_token)):
    """
    Server-side link validation.
    Reuses resolve_and_validate_all to catch 404s and handle SSRF protection.
    """
    try:
        # 1. Call the internal utility (FIXED: added await)
        valid_links_dict = await resolve_and_validate_all(request.urls)
        
        # 2. Extract successfully validated URLs
        valid_urls_set = set(valid_links_dict.keys())
        
        # 3. Identify unreachable URLs
        unreachable = [url for url in request.urls if url not in valid_urls_set]
        
        return schemas.LinkValidationResponse(unreachable_urls=unreachable)
        
    except Exception as e:
        logger.exception("Link validation failed")
        raise HTTPException(status_code=500, detail=f"Link validation engine failed: {str(e)}")


@app.get("/admin/batch-report")
async def get_batch_report():
    """Serves the NCADEMI Candidates batch summary report."""
    report_path = BASE_DIR / "NCADEMI_candidates_summary.html"
    if not report_path.exists():
        raise HTTPException(
            status_code=404, 
            detail="Batch report not found. Please run a batch process first."
        )
    return FileResponse(report_path)


@app.get("/admin/candidates")
async def list_candidates():
    """Returns a list of all processed candidates."""
    return await _list_records(CANDIDATES_COLLECTION, _local_candidates)


@app.get("/admin/candidates/{slug}")
async def get_candidate_data(slug: str):
    """Retrieves the full JSON data for a specific candidate."""
    data = await _get_record(CANDIDATES_COLLECTION, slug, _local_candidates)
    if not data:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return data


@app.get("/admin/products")
async def list_products():
    """Returns a list of all transformed products."""
    return await _list_records(PRODUCTS_COLLECTION, _local_products)


@app.get("/admin/products/{slug}")
async def get_product_data(slug: str):
    """Retrieves the full JSON data for a specific published product."""
    data = await _get_record(PRODUCTS_COLLECTION, slug, _local_products)
    if not data:
        raise HTTPException(status_code=404, detail="Product not found")
    return data


@app.post("/admin/candidates")
async def save_candidate(data: schemas.ListingData):
    """Saves or updates a candidate."""
    slug = slugify(data.product_name)
    await _upsert_record(CANDIDATES_COLLECTION, slug, data, _local_candidates)
    return {"message": "Candidate saved successfully", "slug": slug}


@app.post("/admin/products")
async def save_product(data: schemas.ListingData):
    """Saves or updates a product."""
    slug = slugify(data.product_name)
    await _upsert_record(PRODUCTS_COLLECTION, slug, data, _local_products)
    return {"message": "Product saved successfully", "slug": slug}


@app.delete("/admin/candidates/{slug}")
async def delete_candidate(slug: str):
    """Deletes a candidate."""
    success = await _delete_record(CANDIDATES_COLLECTION, slug, _local_candidates)
    if not success:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return {"message": "Candidate deleted successfully"}


@app.put("/admin/candidates/{slug}")
async def update_candidate(slug: str, data: schemas.ListingData):
    """Explicitly overwrites an existing candidate."""
    # Check if exists first to maintain 404 behavior
    existing = await _get_record(CANDIDATES_COLLECTION, slug, _local_candidates)
    if not existing:
        raise HTTPException(status_code=404, detail="Candidate not found")
    
    await _upsert_record(CANDIDATES_COLLECTION, slug, data, _local_candidates)
    return {"message": "Candidate updated successfully", "slug": slug}


@app.get("/healthz")
async def healthz():
    return {
        "status": "ok",
        "worker_url_configured": bool(WORKER_URL),
        "tasks_sa_configured": bool(TASKS_SA),
    }
