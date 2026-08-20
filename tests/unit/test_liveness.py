import pytest
import httpx
from nerd_core.tools.liveness_validator import validate_link
from nerd_core.utils import resolve_and_validate_url

@pytest.mark.asyncio
async def test_liveness_validator_200(httpx_mock):
    url = "https://example.com/live"
    httpx_mock.add_response(url=url, status_code=200)
    
    result = await validate_link(url)
    assert result.is_live is True
    assert result.status_code == 200
    assert result.resolved_url == url

@pytest.mark.asyncio
async def test_liveness_validator_404(httpx_mock):
    url = "https://example.com/missing"
    httpx_mock.add_response(url=url, status_code=404)
    
    result = await validate_link(url)
    assert result.is_live is False
    assert result.status_code == 404
    assert result.resolved_url == url

@pytest.mark.asyncio
async def test_transport_failure(httpx_mock):
    url = "https://example.com/flakey"
    httpx_mock.add_exception(
        httpx.RemoteProtocolError("Server closed connection"),
        url=url
    )
    
    result = await validate_link(url)
    assert result.is_live is False
    assert "connection" in result.reason.lower()

@pytest.mark.asyncio
async def test_liveness_redirect_resolution(httpx_mock):
    start_url = "https://example.com/start"
    hop_url = "https://example.com/hop"
    dest_url = "https://example.com/final-destination"

    for _ in range(2):
        httpx_mock.add_response(url=start_url, status_code=302, headers={"Location": hop_url})
        httpx_mock.add_response(url=hop_url, status_code=301, headers={"Location": dest_url})
        httpx_mock.add_response(url=dest_url, status_code=200)

    result = await validate_link(start_url)
    assert result.is_live is True
    assert result.status_code == 200
    assert result.resolved_url == dest_url

    resolved, is_live, reason = await resolve_and_validate_url(start_url)
    assert is_live is True
    assert resolved == dest_url
    assert reason == "Success"

@pytest.mark.asyncio
async def test_liveness_too_many_redirects(httpx_mock):
    url = "https://example.com/loop"
    for _ in range(3):
        httpx_mock.add_response(url=url, status_code=302, headers={"Location": url})

    result = await validate_link(url, max_redirects=2)
    assert result.is_live is False
    assert "Too many redirects" in result.reason
