"""
api/main.py — FastAPI wrapper around nerd_core (Phase 4 Update).

Phase 4 changes:
- Cloud Tasks tasks now include OIDC token for authenticated worker invocation.
- TASKS_SA env var wires the service account for OIDC auth.
- CORS origins locked to FRONTEND_URL env var (no wildcard in production).
"""

from __future__ import annotations

import os
import uuid
import json
import logging
import asyncio
from typing import Any

from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from google.cloud import tasks_v2
import firebase_admin
from firebase_admin import auth as fb_auth

from nerd_core.generators import render_listing_html

from . import schemas
from .conversions import pydantic_to_dataclass
from .job_store import create_job, stream_job_events

# ── Local Mode Config ─────────────────────────────────────────────────────────
LOCAL_MODE = os.getenv("LOCAL_MODE", "false").lower() == "true"
if LOCAL_MODE:
    from .worker import worker_initial, worker_deep_dive, WorkerInitialRequest, WorkerDeepDiveRequest
# ──────────────────────────────────────────────────────────────────────────────

# ── Firebase Admin Init ───────────────────────────────────────────────────────
if not firebase_admin._apps:
    # On Cloud Run, it uses the default service account automatically.
    # Locally, it uses GOOGLE_APPLICATION_CREDENTIALS env var.
    firebase_admin.initialize_app()

logger = logging.getLogger("nerd.api")

app = FastAPI(title="N.E.R.D. API", version="0.4.0-bearer-auth")

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
    allow_methods=["GET", "POST"],
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


@app.get("/healthz")
async def healthz():
    return {
        "status": "ok",
        "worker_url_configured": bool(WORKER_URL),
        "tasks_sa_configured": bool(TASKS_SA),
    }
