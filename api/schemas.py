"""
api/schemas.py — Pydantic models for the N.E.R.D. FastAPI layer.

These MIRROR the dataclasses in nerd_core/generators.py exactly. They are the
API-side half of the Pydantic <-> Zod contract. They must NOT drift from the
dataclass field names, types, or defaults, because /render converts an
incoming payload straight into a nerd_core.generators.ListingData instance.

Reference (nerd_core/generators.py):
    ResourceLink(url, text)
    SupportContact(type, value, label="")
    ACRReport(title, url, version="", date="", auditor_name="", auditor_url="")
    ListingData(product_name="Unknown Product", vendor_name="", ...,
                ai_insights="", ..., last_updated="")
"""

from __future__ import annotations

from typing import Literal, Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Contract models (mirror nerd_core.generators dataclasses 1:1)
# ---------------------------------------------------------------------------

class ResourceLink(BaseModel):
    url: str
    text: str


class SupportContact(BaseModel):
    # Mirrors the dataclass comment: "email" | "url" | "text"
    type: Literal["email", "url", "text"]
    value: str
    label: str = ""


class ACRReport(BaseModel):
    title: str
    url: str
    version: str = ""
    date: str = ""
    auditor_name: str = ""
    auditor_url: str = ""


class ListingData(BaseModel):
    product_name: str = "Unknown Product"
    vendor_name: str = ""
    vendor_directory_url: str = "#"
    product_description: str = ""
    product_website_url: str = "#"
    vendor_resources: list[ResourceLink] = Field(default_factory=list)
    other_resources: list[ResourceLink] = Field(default_factory=list)
    ai_insights: str = ""
    support_contacts: list[SupportContact] = Field(default_factory=list)
    acr_reports: list[ACRReport] = Field(default_factory=list)
    # last_updated is intentionally Optional at the API boundary.
    #   - If the client sends a value, /render uses it verbatim.
    #   - If omitted/None, the server fills datetime.now() at render time,
    #     matching the legacy parser's non-deterministic behavior.
    # This is the documented escape hatch for Phase 5 byte-fidelity (mock the
    # clock or pass an explicit date).
    last_updated: Optional[str] = None


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class InitialResearchRequest(BaseModel):
    product_url: str
    # Legacy slider: min 1, max 4, default 4 (minutes). run_initial_research
    # signature is run_initial_research(product_url, timeout_min=4).
    timeout_min: int = Field(default=4, ge=1, le=4)


class DeepDiveRequest(BaseModel):
    product_url: str
    product_name: str
    current_draft: str            # raw markdown from the initial job
    job_id: Optional[str] = None  # correlates the SSE stream
    # Legacy app hardcodes 4 for deep-dive; exposed but defaulted to match.
    timeout_min: int = Field(default=4, ge=1, le=4)
    # url_cache carried back from the initial job so resolve_and_validate_all
    # reuses prior resolutions (redirect_url -> canonical_url).
    url_cache: dict[str, str] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class EnqueueResponse(BaseModel):
    job_id: str


class JobResultPayload(BaseModel):
    """Final JSON yielded by the SSE stream on completion."""
    raw_markdown: str             # pass back to /research/deep-dive
    parsed_listing: ListingData   # populate the React Hook Form
    url_cache: dict[str, str]     # carry forward to deep-dive
    rejections: list[str] = Field(default_factory=list)  # flagged/broken links


class RenderRequest(ListingData):
    """/render accepts a full ListingData payload."""
    pass


class RenderResponse(BaseModel):
    html: str