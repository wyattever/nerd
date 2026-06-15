import pytest
import asyncio
import json
from unittest.mock import patch, AsyncMock

@pytest.mark.asyncio
async def test_initial_research_lifecycle(client):
    """Test the happy path from enqueuing to SSE completion."""
    
    # Mock the long-running research services to return instantly
    with patch("api.worker.run_initial_research") as mock_research, \
         patch("api.worker._validate", new_callable=AsyncMock) as mock_validate, \
         patch("api.worker.synthesize_insights") as mock_synth:
        
        mock_research.return_value = ("# Mock Draft", ["https://link1.com"])
        mock_validate.return_value = ("# Validated MD", [])
        mock_synth.return_value = "Mocked AI Insights"

        # 1. Enqueue job
        resp = await client.post(
            "/research/initial",
            json={"product_url": "https://example.com", "timeout_min": 1},
            headers={"Authorization": "Bearer mock-token"}
        )
        assert resp.status_code == 200
        job_id = resp.json()["job_id"]

        # 2. Stream SSE events
        # Note: In LOCAL_MODE, worker runs as a BackgroundTask.
        # We need to read the stream until 'event: end'.
        status_events = []
        result_payload = None
        
        async with client.stream("GET", f"/jobs/{job_id}", headers={"Authorization": "Bearer mock-token"}) as response:
            assert response.status_code == 200
            
            last_event = None
            async for line in response.aiter_lines():
                if line.startswith("event: "):
                    last_event = line[7:]
                elif line.startswith("data: "):
                    data = json.loads(line[6:])
                    if last_event == "status":
                        status_events.append(data)
                    elif last_event == "result":
                        result_payload = data
                elif line.startswith("event: end"):
                    break

        # 3. Assertions
        # Expect at least: searching_initial, validating_links, synthesizing
        statuses = [e["status"] for e in status_events]
        assert "searching_initial" in statuses
        assert "validating_links" in statuses
        assert "synthesizing" in statuses
        
        assert result_payload is not None
        assert result_payload["raw_markdown"] == "# Mock Draft"
        assert result_payload["parsed_listing"]["product_name"] == "Validated MD"
        assert result_payload["parsed_listing"]["ai_insights"] == "Mocked AI Insights"
