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
_local_lock = asyncio.Lock()

# ── Firestore Store for Production ───────────────────────────────────────────
if not LOCAL_MODE:
    from google.cloud import firestore
    from google.cloud.firestore_v1.async_client import AsyncClient
    db = AsyncClient()
    COLLECTION = "nerd_research_jobs"

async def create_job(job_id: str) -> None:
    """Initialize a new job document."""
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=1)
    data = {
        "status": "queued",
        "events": [],
        "result": None,
        "done": False,
        "updated_at": now,
        "expires_at": expires_at,
        "worker_id": None
    }
    
    if LOCAL_MODE:
        _local_jobs[job_id] = data
    else:
        doc_ref = db.collection(COLLECTION).document(job_id)
        await doc_ref.set(data)

async def claim_job(job_id: str, worker_id: str = "unknown", stale_timeout_minutes: int = 10) -> bool:
    """
    Atomically attempt to claim a job for processing.
    Returns True if the claim was successful.
    """
    now = datetime.now(timezone.utc)
    stale_threshold = now - timedelta(minutes=stale_timeout_minutes)

    if LOCAL_MODE:
        async with _local_lock:
            job = _local_jobs.get(job_id)
            if not job:
                return False
            
            is_stale = (job["status"] == "processing" and 
                        job.get("updated_at") and 
                        job["updated_at"] < stale_threshold)
            
            if job["status"] == "queued" or is_stale:
                status = "searching_initial"
                event = {"status": status, "reclaimed": is_stale}
                job.update({
                    "status": status,
                    "updated_at": now,
                    "worker_id": worker_id
                })
                job["events"].append(event)
                return True
            return False
    else:
        doc_ref = db.collection(COLLECTION).document(job_id)
        
        @firestore.async_transactional
        async def _transactional_claim(transaction, doc_ref):
            snapshot = await doc_ref.get(transaction=transaction)
            if not snapshot.exists:
                return False
            data = snapshot.to_dict()
            
            current_status = data.get("status")
            last_updated = data.get("updated_at")
            
            is_stale = (current_status == "processing" and 
                        last_updated and 
                        last_updated < stale_threshold)

            if current_status == "queued" or is_stale:
                status = "searching_initial"
                event = {"status": status, "reclaimed": is_stale}
                transaction.update(doc_ref, {
                    "status": status,
                    "updated_at": now,
                    "worker_id": worker_id,
                    "events": firestore.ArrayUnion([event])
                })
                return True
            return False
        
        return await _transactional_claim(db.transaction(), doc_ref)

async def emit_event(job_id: str, status: str, **extra: Any) -> None:
    """Append a status event to the job's event array."""
    print(f"[JOB_STORE] Job {job_id} -> {status} {extra if extra else ''}")
    now = datetime.now(timezone.utc)
    event = {"status": status, **extra}
    
    if LOCAL_MODE:
        if job_id in _local_jobs:
            _local_jobs[job_id]["status"] = status
            _local_jobs[job_id]["updated_at"] = now
            _local_jobs[job_id]["events"].append(event)
    else:
        doc_ref = db.collection(COLLECTION).document(job_id)
        await doc_ref.update({
            "status": status,
            "updated_at": now,
            "events": firestore.ArrayUnion([event])
        })

async def complete_job(job_id: str, result: dict) -> None:
    """Mark the job as done and attach the final payload."""
    now = datetime.now(timezone.utc)
    
    # Ensure AI insights are stripped from persistence if present
    if isinstance(result, dict) and "parsed_listing" in result:
        result["parsed_listing"].pop("ai_insights", None)
        
    if LOCAL_MODE:
        if job_id in _local_jobs:
            _local_jobs[job_id]["status"] = "complete"
            _local_jobs[job_id]["updated_at"] = now
            _local_jobs[job_id]["result"] = result
            _local_jobs[job_id]["done"] = True
    else:
        doc_ref = db.collection(COLLECTION).document(job_id)
        await doc_ref.update({
            "status": "complete",
            "updated_at": now,
            "result": result,
            "done": True
        })

async def fail_job(job_id: str, error_msg: str, code: int = 500) -> None:
    """Fail the job gracefully."""
    now = datetime.now(timezone.utc)
    event = {"status": "error", "error": error_msg, "code": code}
    
    if LOCAL_MODE:
        if job_id in _local_jobs:
            _local_jobs[job_id]["status"] = "error"
            _local_jobs[job_id]["updated_at"] = now
            _local_jobs[job_id]["events"].append(event)
            _local_jobs[job_id]["done"] = True
    else:
        doc_ref = db.collection(COLLECTION).document(job_id)
        await doc_ref.update({
            "status": "error",
            "updated_at": now,
            "events": firestore.ArrayUnion([event]),
            "done": True
        })

async def stream_job_events(job_id: str, last_event_id: str | None = None) -> AsyncGenerator[str, None]:
    """Yield SSE formatted strings with heartbeats and resume support."""
    try:
        last_idx = int(last_event_id) if last_event_id else 0
    except (ValueError, TypeError):
        last_idx = 0

    last_heartbeat = datetime.now(timezone.utc)
    
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
        
        while last_idx < len(events):
            evt = events[last_idx]
            last_idx += 1
            yield f"id: {last_idx}\nevent: status\ndata: {json.dumps(evt)}\n\n"
            last_heartbeat = datetime.now(timezone.utc)
            
        if data.get("done"):
            if data.get("result") is not None:
                yield f"id: result\nevent: result\ndata: {json.dumps(data['result'])}\n\n"
            yield "event: end\ndata: {}\n\n"
            break
            
        if (datetime.now(timezone.utc) - last_heartbeat).total_seconds() > 20:
            yield ": heartbeat\n\n"
            last_heartbeat = datetime.now(timezone.utc)

        await asyncio.sleep(0.5)