import pytest
import asyncio
from unittest.mock import patch, AsyncMock

@pytest.mark.asyncio
async def test_worker_idempotency(client):
    """
    Test that multiple worker calls for the same job_id do not trigger 
    multiple research executions.
    """
    
    # We'll use the worker endpoint directly (/worker/initial)
    # Note: In a real app, this endpoint is on the Worker service, 
    # but here we test the worker logic imported into the API for LOCAL_MODE.
    
    # We'll mock run_initial_research and count how many times it's called.
    with patch("api.worker.run_initial_research") as mock_research, \
         patch("api.worker._validate", new_callable=AsyncMock) as mock_validate:
        
        mock_research.return_value = ("# Draft", [])
        mock_validate.return_value = ("# Validated", [])

        from api.worker import WorkerInitialRequest, worker_initial
        from api.job_store import create_job
        
        job_id = "test-idempotency"
        await create_job(job_id) # Initialize the job in 'queued' status
        
        req = WorkerInitialRequest(product_url="https://test.com", job_id=job_id)

        # Fire two worker calls concurrently
        # In a real scenario, this might happen via Cloud Tasks retries.
        await asyncio.gather(
            worker_initial(req),
            worker_initial(req)
        )

        # If idempotent, research should only be called ONCE.
        # Current implementation will fail this (it will be 2).
        assert mock_research.call_count == 1
