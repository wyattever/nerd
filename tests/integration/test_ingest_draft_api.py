"""
Integration tests for POST /ingest/draft. See nerd-import-data-architecture-v4.md
§4.2, §8, and the addendum §12.1 (502 on unhandled exceptions).

NOTE on auth: this suite forces LOCAL_MODE=true (see conftest.py), under which
verify_token always short-circuits to "local-dev-user" regardless of headers.
A genuine no-auth-token -> 401 case cannot be exercised here, matching every
other endpoint tested in this file/directory -- it is not a gap specific to
this endpoint.
"""

import os
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient, ASGITransport

os.environ["LOCAL_MODE"] = "true"

from api.main import app
from nerd_core import generators as gen
from nerd_core.pipeline import DraftDiagnostics, DraftValidationResult


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.anyio
async def test_ingest_draft_success(client):
    fake_result = DraftValidationResult(
        listing=gen.ListingData(
            product_name="Test Product",
            vendor_resources=[gen.ResourceLink(url="https://v.com/a", text="A", confidence=0.99, justification="footer")],
        ),
        rejections=["https://v.com/flagged (Status: 403)"],
        url_cache={"https://v.com/a": "https://v.com/a"},
        diagnostics=DraftDiagnostics(
            parsed_vendor_count=1, surviving_vendor_count=1,
            parsed_other_count=0, surviving_other_count=0,
            dropped_urls=[], acr_reset=False,
        ),
    )

    with patch("api.main.validate_draft", new=AsyncMock(return_value=fake_result)) as mock_vd:
        response = await client.post("/ingest/draft", json={"draft_markdown": "# Test Product\n- https://v.com/a"})

        mock_vd.assert_awaited_once_with("# Test Product\n- https://v.com/a")
        assert response.status_code == 200
        body = response.json()
        assert body["parsed_listing"]["product_name"] == "Test Product"
        assert body["parsed_listing"]["vendor_resources"][0]["confidence"] == 0.99
        assert body["rejections"] == ["https://v.com/flagged (Status: 403)"]
        assert body["diagnostics"]["parsed_vendor_count"] == 1
        assert body["diagnostics"]["acr_reset"] is False


@pytest.mark.anyio
async def test_ingest_draft_empty_body_422(client):
    response = await client.post("/ingest/draft", json={"draft_markdown": ""})
    assert response.status_code == 422


@pytest.mark.anyio
async def test_ingest_draft_oversize_422(client):
    response = await client.post("/ingest/draft", json={"draft_markdown": "x" * 102401})
    assert response.status_code == 422


@pytest.mark.anyio
async def test_ingest_draft_extra_field_forbidden_422(client):
    response = await client.post("/ingest/draft", json={"draft_markdown": "# ok", "unexpected_field": "nope"})
    assert response.status_code == 422


@pytest.mark.anyio
async def test_ingest_draft_over_url_cap_422(client):
    # Real (unmocked) validate_draft -- ValueError is raised before any
    # network call, on URL count alone, so this needs no mocking.
    draft = "\n".join(f"https://example.com/{i}" for i in range(101))
    response = await client.post("/ingest/draft", json={"draft_markdown": draft})
    assert response.status_code == 422
    assert "101" in response.json()["detail"]


@pytest.mark.anyio
async def test_ingest_draft_unhandled_exception_502(client):
    """Addendum §12.1: network/timeout failures inside validate_draft must
    surface as a controlled 502, not an unformatted 500."""
    with patch("api.main.validate_draft", new=AsyncMock(side_effect=RuntimeError("connection reset"))):
        response = await client.post("/ingest/draft", json={"draft_markdown": "# Test\n- https://v.com/a"})
        assert response.status_code == 502
        assert "server logs" in response.json()["detail"].lower()
