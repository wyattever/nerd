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

    model_config = {"extra": "forbid"}


class CandidateRecord(ListingData):
    raw_markdown: Optional[str] = None


# ---------------------------------------------------------------------------
# Response models (Unchanged)
# ---------------------------------------------------------------------------

class RenderRequest(ListingData):
    pass


class RenderResponse(BaseModel):
    html: str


# ── Draft ingest (Import Data feature) ────────────────────────────────────
# See nerd-import-data-architecture-v4.md §4.2

class IngestDraftRequest(BaseModel):
    draft_markdown: str = Field(min_length=1, max_length=102400)

    model_config = {"extra": "forbid"}


class DraftDiagnostics(BaseModel):
    parsed_vendor_count: int
    surviving_vendor_count: int
    parsed_other_count: int
    surviving_other_count: int
    dropped_urls: list[str] = Field(default_factory=list)
    acr_reset: bool = False


class IngestDraftResponse(BaseModel):
    parsed_listing: ListingData
    raw_markdown: str
    rejections: list[str] = Field(default_factory=list)
    diagnostics: DraftDiagnostics
