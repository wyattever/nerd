"""
api/job_store.py — State management for N.E.R.D. async jobs.
Supports Firestore (Production) and In-Memory (Local Mode).
"""

import os
import json
import asyncio
from datetime import datetime, timedelta, timezone
from typing import AsyncGenerator, Any, Dict

LOCAL_MODE = os.getenv("LOCAL_MODE", "false").lower() == "true"

# ── In-Memory Store for Local Mode ───────────────────────────────────────────
_local_jobs: Dict[str, dict] = {}

# ── Firestore Store for Production ───────────────────────────────────────────
if not LOCAL_MODE:
    from google.cloud import firestore
    from google.cloud.firestore_v1.async_client import AsyncClient
    db = AsyncClient()
    COLLECTION = "nerd_research_jobs"

async def create_job(job_id: str) -> None:
    """Initialize a new job document."""
    expires_at = datetime.now(timezone.utc) + timedelta(days=1)
    data = {
        "status": "queued",
        "events": [],
        "result": None,
        "done": False,
        "expires_at": expires_at
    }
    
    if LOCAL_MODE:
        _local_jobs[job_id] = data
    else:
        doc_ref = db.collection(COLLECTION).document(job_id)
        await doc_ref.set(data)

async def emit_event(job_id: str, status: str, **extra: Any) -> None:
    """Append a status event to the job's event array."""
    print(f"[JOB_STORE] Job {job_id} -> {status} {extra if extra else ''}")
    event = {"status": status, **extra}
    
    if LOCAL_MODE:
        if job_id in _local_jobs:
            _local_jobs[job_id]["status"] = status
            _local_jobs[job_id]["events"].append(event)
    else:
        doc_ref = db.collection(COLLECTION).document(job_id)
        await doc_ref.update({
            "status": status,
            "events": firestore.ArrayUnion([event])
        })

async def complete_job(job_id: str, result: dict) -> None:
    """Mark the job as done and attach the final payload."""
    if LOCAL_MODE:
        if job_id in _local_jobs:
            _local_jobs[job_id]["status"] = "complete"
            _local_jobs[job_id]["result"] = result
            _local_jobs[job_id]["done"] = True
    else:
        doc_ref = db.collection(COLLECTION).document(job_id)
        await doc_ref.update({
            "status": "complete",
            "result": result,
            "done": True
        })

async def fail_job(job_id: str, error_msg: str, code: int = 500) -> None:
    """Fail the job gracefully."""
    event = {"status": "error", "error": error_msg, "code": code}
    
    if LOCAL_MODE:
        if job_id in _local_jobs:
            _local_jobs[job_id]["status"] = "error"
            _local_jobs[job_id]["events"].append(event)
            _local_jobs[job_id]["done"] = True
    else:
        doc_ref = db.collection(COLLECTION).document(job_id)
        await doc_ref.update({
            "status": "error",
            "events": firestore.ArrayUnion([event]),
            "done": True
        })

async def stream_job_events(job_id: str) -> AsyncGenerator[str, None]:
    """Yield SSE formatted strings."""
    last_idx = 0
    
    while True:
        if LOCAL_MODE:
            data = _local_jobs.get(job_id)
        else:
            doc_ref = db.collection(COLLECTION).document(job_id)
            doc = await doc_ref.get()
            data = doc.to_dict() if doc.exists else None

        if not data:
            break
            
        events = data.get("events", [])
        
        # Yield any new events
        while last_idx < len(events):
            evt = events[last_idx]
            last_idx += 1
            yield f"event: status\ndata: {json.dumps(evt)}\n\n"
            
        # If the job is done, yield the payload and close the stream
        if data.get("done"):
            if data.get("result") is not None:
                yield f"event: result\ndata: {json.dumps(data['result'])}\n\n"
            yield "event: end\ndata: {}\n\n"
            break
            
        await asyncio.sleep(0.5)
