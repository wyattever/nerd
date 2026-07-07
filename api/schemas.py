from __future__ import annotations

from typing import Literal, Optional
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Contract models (mirror nerd_core.generators dataclasses 1:1)
# ---------------------------------------------------------------------------

class ResourceLink(BaseModel):
    url: str
    text: str
    confidence: float = 0.0
    justification: str = ""


class SupportContact(BaseModel):
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
    preparation_type: str = "Internal"


class SectionOverrides(BaseModel):
    header: Optional[str] = Field(default=None, max_length=102400)
    vendor_resources: Optional[str] = Field(default=None, max_length=102400)
    other_resources: Optional[str] = Field(default=None, max_length=102400)
    support: Optional[str] = Field(default=None, max_length=102400)
    acr: Optional[str] = Field(default=None, max_length=102400)

    model_config = {"extra": "forbid"}


class ListingData(BaseModel):
    product_name: str = "Unknown Product"
    vendor_name: str = ""
    vendor_directory_url: str = "#"
    product_description: str = ""
    product_website_url: str = "#"
    vendor_resources: list[ResourceLink] = Field(default_factory=list)
    other_resources: list[ResourceLink] = Field(default_factory=list)
    # AI_INSIGHTS REMOVED
    support_contacts: list[SupportContact] = Field(default_factory=list)
    acr_reports: list[ACRReport] = Field(default_factory=list)
    last_updated: Optional[str] = None
    html_override: Optional[str] = Field(default=None, max_length=102400)
    last_updated_at: Optional[str] = None
    section_overrides: Optional[SectionOverrides] = None


class CandidateRecord(ListingData):
    raw_markdown: Optional[str] = None


# ---------------------------------------------------------------------------
# Request models (Unchanged)
# ---------------------------------------------------------------------------

class InitialResearchRequest(BaseModel):
    product_url: str
    timeout_min: int = Field(default=4, ge=1, le=4)
    save_as_candidate: bool = False


class DeepDiveRequest(BaseModel):
    product_url: str
    product_name: str
    current_draft: str
    job_id: Optional[str] = None
    timeout_min: int = Field(default=4, ge=1, le=4)
    url_cache: dict[str, str] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Response models (Unchanged)
# ---------------------------------------------------------------------------

class EnqueueResponse(BaseModel):
    job_id: str


class JobResultPayload(BaseModel):
    raw_markdown: str
    parsed_listing: ListingData
    url_cache: dict[str, str]
    rejections: list[str] = Field(default_factory=list)


class RenderRequest(ListingData):
    pass


class RenderResponse(BaseModel):
    html: str


# ── Link Validation (Unchanged) ──────────────────────────────────────────
class LinkValidationRequest(BaseModel):
    urls: list[str]

class LinkValidationDetailedResult(BaseModel):
    url: str
    is_valid: bool
    status_code: Optional[int] = None
    reason: Optional[str] = None
    screenshot_path: Optional[str] = None
    timestamp: Optional[str] = None

class LinkValidationJobStatus(BaseModel):
    job_id: str
    status: Literal["queued", "processing", "complete", "error"]
    results: Optional[dict[str, LinkValidationDetailedResult]] = None
    error: Optional[str] = None

class LinkValidationResponse(BaseModel):
    unreachable_urls: list[str]


# ── Batch research (Unchanged) ───────────────────────────────────────────

class BatchResearchRequest(BaseModel):
    urls: list[str] = Field(min_length=1, max_length=50)


class BatchResearchJob(BaseModel):
    url: str
    job_id: str


class BatchResearchResponse(BaseModel):
    jobs: list[BatchResearchJob]