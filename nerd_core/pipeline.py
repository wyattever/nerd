"""
nerd_core/pipeline.py — Shared validate-and-build sequence.

Extracted from api/worker.py (_validate + _build_result_payload) so the same
logic can be called from the worker's research path and, in a later commit,
from a synchronous draft-ingest endpoint. Behavior is preserved exactly from
the pre-extraction version at commit 1e14ce9 — see
nerd-import-data-architecture-v4.md §4.1 and §11.2 for the rationale and the
ordering constraints that must not be "optimized" away here.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from nerd_core import generators as gen
from nerd_core.generators import parse_markdown_to_listing
from nerd_core.utils import resolve_and_validate_all, filter_broken_links
from nerd_core.adaptive_validation import adaptive_validate
from nerd_core.acr_validation import is_likely_vpat_acr

_URL_RE = re.compile(r'https?://[^\s<>"\')\]]+')
MAX_DRAFT_URLS = 100


@dataclass
class DraftDiagnostics:
    parsed_vendor_count: int
    surviving_vendor_count: int
    parsed_other_count: int
    surviving_other_count: int
    dropped_urls: list[str]
    acr_reset: bool


@dataclass
class DraftValidationResult:
    listing: gen.ListingData
    rejections: list[str]
    url_cache: dict[str, str]
    diagnostics: DraftDiagnostics


async def validate_links(
    raw_urls: list[str],
    draft_markdown: str,
    url_cache: dict[str, str],
) -> tuple[str, list[str]]:
    """Behavioral equivalent of api/worker.py::_validate (pre-extraction).

    Mutates url_cache in place. Returns (validated_markdown, rejections).
    """
    await resolve_and_validate_all(raw_urls, url_cache)
    validated_markdown, rejections = await filter_broken_links(draft_markdown)
    return validated_markdown, rejections


async def build_listing(validated_markdown: str) -> tuple[gen.ListingData, DraftDiagnostics]:
    """Parse + adaptive_validate + ACR check.

    Equivalent to the parse/validate portion of api/worker.py::_build_result_payload
    (pre-extraction), minus JobResultPayload construction. No persistence, no HTTP,
    no job store. Sequence order is load-bearing — do not reorder.
    """
    listing_dc = parse_markdown_to_listing(validated_markdown)

    parsed_vendor_count = len(listing_dc.vendor_resources)
    parsed_other_count = len(listing_dc.other_resources)
    pre_vendor_urls = {r.url for r in listing_dc.vendor_resources}
    pre_other_urls = {r.url for r in listing_dc.other_resources}

    listing_dc.vendor_resources = await adaptive_validate(listing_dc.vendor_resources)
    listing_dc.other_resources = await adaptive_validate(listing_dc.other_resources)

    surviving_vendor_count = len(listing_dc.vendor_resources)
    surviving_other_count = len(listing_dc.other_resources)
    post_vendor_urls = {r.url for r in listing_dc.vendor_resources}
    post_other_urls = {r.url for r in listing_dc.other_resources}

    dropped_urls = sorted(
        (pre_vendor_urls - post_vendor_urls) | (pre_other_urls - post_other_urls)
    )

    acr_reset = False
    if listing_dc.acr_reports:
        is_valid, _ = await is_likely_vpat_acr(listing_dc.acr_reports[0].url)
        if not is_valid:
            listing_dc.acr_reports[0].url = "#"
            listing_dc.acr_reports[0].title = "None found"
            acr_reset = True

    diagnostics = DraftDiagnostics(
        parsed_vendor_count=parsed_vendor_count,
        surviving_vendor_count=surviving_vendor_count,
        parsed_other_count=parsed_other_count,
        surviving_other_count=surviving_other_count,
        dropped_urls=dropped_urls,
        acr_reset=acr_reset,
    )
    return listing_dc, diagnostics


async def validate_draft(
    draft_markdown: str,
    raw_urls: list[str] | None = None,
    url_cache: dict[str, str] | None = None,
) -> DraftValidationResult:
    """Convenience wrapper for the single-input case: import path and script.

    When raw_urls is None, extracts via _URL_RE and raises ValueError if the
    count exceeds MAX_DRAFT_URLS.
    """
    if url_cache is None:
        url_cache = {}
    if raw_urls is None:
        raw_urls = _URL_RE.findall(draft_markdown)
        if len(raw_urls) > MAX_DRAFT_URLS:
            raise ValueError(
                f"Draft contains {len(raw_urls)} URLs, exceeding the {MAX_DRAFT_URLS} limit."
            )

    validated_markdown, rejections = await validate_links(raw_urls, draft_markdown, url_cache)
    listing, diagnostics = await build_listing(validated_markdown)

    return DraftValidationResult(
        listing=listing,
        rejections=rejections,
        url_cache=url_cache,
        diagnostics=diagnostics,
    )
