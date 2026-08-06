"""
Equivalence tests for nerd_core/pipeline.py against the pre-extraction
behavior of api/worker.py::_validate and _build_result_payload
(commit 1e14ce9). See nerd-import-data-architecture-v4.md §8, §11.1.

Network-touching functions (resolve_and_validate_all, filter_broken_links,
adaptive_validate, is_likely_vpat_acr) are mocked at the nerd_core.pipeline
import site so this test is deterministic and offline. It is intentionally
NOT in tests/integration/test_job_lifecycle.py, which mocks api.worker._validate
itself and therefore cannot exercise the code under test here.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from nerd_core import generators as gen
from nerd_core.pipeline import validate_links, build_listing, validate_draft, DraftDiagnostics


@pytest.mark.asyncio
async def test_validate_links_preserves_legacy_contract():
    """validate_links must mutate url_cache in place and return
    filter_broken_links's output unchanged, matching the pre-extraction
    _validate function body exactly."""
    url_cache: dict[str, str] = {}
    raw_urls = ["https://example.com/a", "https://example.com/b"]
    draft = "# Draft\n- https://example.com/a"

    async def fake_resolve(urls, cache):
        cache["https://example.com/a"] = "https://example.com/a"

    with patch("nerd_core.pipeline.resolve_and_validate_all", new=AsyncMock(side_effect=fake_resolve)) as mock_resolve, \
         patch("nerd_core.pipeline.filter_broken_links", new=AsyncMock(return_value=("# Draft\n- https://example.com/a", ["some rejection"]))) as mock_filter:

        validated_markdown, rejections = await validate_links(raw_urls, draft, url_cache)

        mock_resolve.assert_awaited_once_with(raw_urls, url_cache)
        mock_filter.assert_awaited_once_with(draft)
        assert validated_markdown == "# Draft\n- https://example.com/a"
        assert rejections == ["some rejection"]
        assert url_cache == {"https://example.com/a": "https://example.com/a"}


@pytest.mark.asyncio
async def test_build_listing_preserves_legacy_sequence_and_acr_reset():
    """build_listing must run parse -> adaptive_validate(vendor) ->
    adaptive_validate(other) -> is_likely_vpat_acr in that order, and
    reset the first ACR to url='#' / title='None found' on failure --
    matching _build_result_payload exactly."""
    markdown = "# irrelevant, parse_markdown_to_listing is mocked"

    surviving_vendor = [gen.ResourceLink(url="https://v.com/keep", text="Keep")]
    surviving_other = [gen.ResourceLink(url="https://o.com/keep", text="Keep")]

    parsed_listing = gen.ListingData(
        product_name="Test Product",
        vendor_resources=[
            gen.ResourceLink(url="https://v.com/keep", text="Keep"),
            gen.ResourceLink(url="https://v.com/drop", text="Drop"),
        ],
        other_resources=[
            gen.ResourceLink(url="https://o.com/keep", text="Keep"),
        ],
        acr_reports=[gen.ACRReport(title="Some ACR", url="https://v.com/acr.pdf")],
    )

    with patch("nerd_core.pipeline.parse_markdown_to_listing", return_value=parsed_listing), \
         patch("nerd_core.pipeline.adaptive_validate", new=AsyncMock(side_effect=[surviving_vendor, surviving_other])) as mock_adaptive, \
         patch("nerd_core.pipeline.is_likely_vpat_acr", new=AsyncMock(return_value=(False, None))) as mock_acr:

        listing, diagnostics = await build_listing(markdown)

        assert mock_adaptive.await_count == 2
        mock_acr.assert_awaited_once_with("https://v.com/acr.pdf")

        assert listing.acr_reports[0].url == "#"
        assert listing.acr_reports[0].title == "None found"

        assert diagnostics == DraftDiagnostics(
            parsed_vendor_count=2,
            surviving_vendor_count=1,
            parsed_other_count=1,
            surviving_other_count=1,
            dropped_urls=["https://v.com/drop"],
            acr_reset=True,
        )


@pytest.mark.asyncio
async def test_build_listing_no_acr_reset_when_valid():
    markdown = "# irrelevant"
    parsed_listing = gen.ListingData(
        product_name="Test Product",
        acr_reports=[gen.ACRReport(title="Some ACR", url="https://v.com/acr.pdf")],
    )

    with patch("nerd_core.pipeline.parse_markdown_to_listing", return_value=parsed_listing), \
         patch("nerd_core.pipeline.adaptive_validate", new=AsyncMock(side_effect=[[], []])), \
         patch("nerd_core.pipeline.is_likely_vpat_acr", new=AsyncMock(return_value=(True, None))):

        listing, diagnostics = await build_listing(markdown)

        assert listing.acr_reports[0].url == "https://v.com/acr.pdf"
        assert listing.acr_reports[0].title == "Some ACR"
        assert diagnostics.acr_reset is False


@pytest.mark.asyncio
async def test_validate_draft_extracts_urls_and_enforces_cap():
    over_cap_draft = "\n".join(f"https://example.com/{i}" for i in range(101))
    with pytest.raises(ValueError, match="101"):
        await validate_draft(over_cap_draft)


@pytest.mark.asyncio
async def test_worker_validate_and_build_delegate_to_pipeline():
    """api.worker._validate and _build_result_payload must now be thin
    wrappers around nerd_core.pipeline -- this is the regression guard
    for the extraction itself (§11, Commit 1)."""
    import api.worker as worker

    with patch("api.worker.validate_links", new=AsyncMock(return_value=("validated md", ["rej"]))) as mock_vl:
        result = await worker._validate(["https://x.com"], "raw md", {})
        mock_vl.assert_awaited_once_with(["https://x.com"], "raw md", {})
        assert result == ("validated md", ["rej"])

    listing = gen.ListingData(product_name="Delegated Product")
    diagnostics = DraftDiagnostics(
        parsed_vendor_count=0, surviving_vendor_count=0,
        parsed_other_count=0, surviving_other_count=0,
        dropped_urls=[], acr_reset=False,
    )
    with patch("api.worker.build_listing", new=AsyncMock(return_value=(listing, diagnostics))) as mock_bl:
        payload = await worker._build_result_payload("raw", "validated", {}, [], 5)
        mock_bl.assert_awaited_once_with("validated")
        assert payload["parsed_listing"]["product_name"] == "Delegated Product"
        assert payload["raw_markdown"] == "raw"
        assert payload["rejections"] == []
