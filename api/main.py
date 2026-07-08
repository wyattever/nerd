from __future__ import annotations

import os
import uuid
import json
import logging
import asyncio
from typing import Any

from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from pathlib import Path
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from google.cloud import tasks_v2
import firebase_admin
from firebase_admin import auth as fb_auth

from nerd_core.generators import render_listing_html
from nerd_core.utils import resolve_and_validate_all

from . import schemas
from .conversions import pydantic_to_dataclass
from .job_store import create_job, stream_job_events
from .store import (
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
if LOCAL_MODE:
    from .worker import worker_initial, worker_deep_dive, WorkerInitialRequest, WorkerDeepDiveRequest
# ──────────────────────────────────────────────────────────────────────────────

# ── Firebase Admin Init ───────────────────────────────────────────────────────
if not LOCAL_MODE:
    if not firebase_admin._apps:
        firebase_admin.initialize_app()

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

# ── Cloud Tasks ────────────────────────────────────────────────────────────────
PROJECT_ID = os.getenv("GOOGLE_CLOUD_PROJECT", "edtech-agent-2026")
LOCATION = os.getenv("GCP_LOCATION", "us-central1")
QUEUE_NAME = os.getenv("QUEUE_NAME", "nerd-research-queue")
WORKER_URL = os.getenv("WORKER_URL")
TASKS_SA = os.getenv("TASKS_SA")

tasks_client = None
queue_path = None
if not LOCAL_MODE:
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

    if TASKS_SA:
        task["http_request"]["oidc_token"] = {
            "service_account_email": TASKS_SA,
            "audience": WORKER_URL,
        }

    tasks_client.create_task(request={"parent": queue_path, "task": task})

def normalize_html_fragment(raw_html: str) -> str:
    if not raw_html:
        return ""
    soup = BeautifulSoup(raw_html, 'html.parser')
    if soup.body:
        return soup.body.decode_contents()
    return str(soup)

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

# ── Administrative Endpoints ──────────────────────────────────────────────────

@app.get("/admin/batch-report")
async def get_batch_report():
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
async def save_candidate(data: schemas.ListingData, uid: str = Depends(verify_token)):
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
async def update_candidate(slug: str, data: schemas.ListingData, uid: str = Depends(verify_token)):
    existing = await get_candidate(slug)
    if not existing:
        raise HTTPException(status_code=404, detail="Candidate not found")
    # AI insights are stripped on update
    model_data = data.model_dump()
    model_data.pop("ai_insights", None)
    await upsert_candidate(model_data)
    return {"message": "Candidate updated successfully", "slug": slug}

@app.post("/admin/candidates/batch", response_model=schemas.BatchResearchResponse)
async def batch_research_candidates(
    req: schemas.BatchResearchRequest,
    background_tasks: BackgroundTasks,
    uid: str = Depends(verify_token),
):
    jobs = []
    for url in req.urls:
        job_id = str(uuid.uuid4())
        await create_job(job_id)
        payload = {
            "job_id": job_id,
            "product_url": url,
            "timeout_min": 4,
            "save_as_candidate": True,
        }
        if LOCAL_MODE:
            worker_req = WorkerInitialRequest(**payload)
            background_tasks.add_task(worker_initial, worker_req)
        else:
            _enqueue_task("/worker/initial", payload)
        jobs.append(schemas.BatchResearchJob(url=url, job_id=job_id))
    return schemas.BatchResearchResponse(jobs=jobs)

@app.get("/healthz")
async def healthz():
    from datetime import datetime, timezone
    
    checks = {
        "worker_url_configured": bool(WORKER_URL),
        "tasks_sa_configured": bool(TASKS_SA),
        "firestore": "pending",
        "cloud_tasks_queue": "pending"
    }
    
    if LOCAL_MODE:
        return {
            "status": "ok",
            "checks": {**checks, "firestore": "ok (local_mode)", "cloud_tasks_queue": "ok (local_mode)"},
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "note": "local_mode: true"
        }

    try:
        from .job_store import db, COLLECTION
        doc_ref = db.collection(COLLECTION).document("health-check-non-existent")
        await asyncio.wait_for(doc_ref.get(), timeout=3.0)
        checks["firestore"] = "ok"
    except asyncio.TimeoutError:
        checks["firestore"] = "error: timeout (3s)"
    except Exception as e:
        checks["firestore"] = f"error: {str(e)}"

    try:
        await asyncio.wait_for(
            asyncio.to_thread(tasks_client.get_queue, name=queue_path), 
            timeout=3.0
        )
        checks["cloud_tasks_queue"] = "ok"
    except asyncio.TimeoutError:
        checks["cloud_tasks_queue"] = "error: timeout (3s)"
    except Exception as e:
        checks["cloud_tasks_queue"] = f"error: {str(e)}"

    all_ok = all(v == "ok" for k, v in checks.items() if k in ["firestore", "cloud_tasks_queue"])
    any_error = any(v.startswith("error") for v in checks.values())
    
    status = "ok"
    if any_error:
        status = "error" if (checks["firestore"].startswith("error") or checks["cloud_tasks_queue"].startswith("error")) else "degraded"
    elif not all_ok:
        status = "degraded"

    return {
        "status": status,
        "checks": checks,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }