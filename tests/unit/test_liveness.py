import pytest
import httpx
from nerd_core.tools.liveness_validator import validate_link

@pytest.mark.asyncio
async def test_liveness_validator_200(httpx_mock):
    url = "https://example.com/live"
    httpx_mock.add_response(url=url, status_code=200)
    
    result = await validate_link(url)
    assert result.is_live is True
    assert result.status_code == 200

@pytest.mark.asyncio
async def test_liveness_validator_404(httpx_mock):
    url = "https://example.com/missing"
    # Mocking the 404 response directly to bypass httpstat.us instability
    httpx_mock.add_response(url=url, status_code=404)
    
    result = await validate_link(url)
    assert result.is_live is False
    assert result.status_code == 404

@pytest.mark.asyncio
async def test_transport_failure(httpx_mock):
    url = "https://example.com/flakey"
    # Simulate a premature connection close
    httpx_mock.add_exception(
        httpx.RemoteProtocolError("Server closed connection"),
        url=url
    )
    
    result = await validate_link(url)
    assert result.is_live is False
    assert "connection" in result.reason.lower()