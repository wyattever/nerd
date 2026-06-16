import pytest
import json
import asyncio
from httpx import AsyncClient, ASGITransport
from httpx_sse import aconnect_sse
from api.main import app
from api.job_store import emit_event, complete_job

@pytest.mark.anyio
async def test_sse_job_stream():
    # We need to simulate a job being updated in the background while we listen
    job_id = "test-sse-job"
    transport = ASGITransport(app=app)
    
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # We start the SSE connection
        # Note: In LOCAL_MODE, jobs_sse uses stream_job_events which reads from _local_jobs
        
        # Setup the job in the store first (manually since we are testing the stream)
        from api.job_store import create_job
        await create_job(job_id)
        
        # We'll run the background updates in a separate task
        async def background_updates():
            await asyncio.sleep(0.1)
            await emit_event(job_id, "searching_initial")
            await asyncio.sleep(0.1)
            await complete_job(job_id, {"listing": "done"})

        bg_task = asyncio.create_task(background_updates())
        
        events = []
        try:
            async with aconnect_sse(ac, "GET", f"/jobs/{job_id}") as event_source:
                async for event in event_source.aiter_sse():
                    events.append(event)
                    if event.event == "end":
                        break
        finally:
            await bg_task
            
        # Verify events
        # 1. Initial queued state (sometimes captured if job created before)
        # 2. searching_initial
        # 3. result (final payload)
        # 4. end
        
        event_types = [e.event for e in events]
        assert "status" in event_types
        assert "result" in event_types
        assert "end" in event_types
        
        # Check result data
        result_event = next(e for e in events if e.event == "result")
        assert json.loads(result_event.data) == {"listing": "done"}
