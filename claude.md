# Section 1
# N.E.R.D. Decision Log

Present-tense record of SETTLED decisions and their rationale. Update only when the underlying decision changes.

---

## Architecture & Scope

### 1. OUTPUT FORMAT — HTML only, DOCX removed.
- **Decision:** The app generates WordPress-compatible HTML (mirroring `wp-block` classes). DOCX generation and the `lxml` dependency are removed entirely.
- **Rationale:** Legacy `altChunk` DOCX was an XSS vector and non-portable. Product focus is now 100% on the WordPress-native workflow.
- **Status:** SETTLED/VERIFIED.

### 2. MOBILE — Completely out of scope.
- **Decision:** N.E.R.D. is a desktop-only research tool.
- **Rationale:** Explicit product constraint to simplify transport (SSE) and auth (Firebase) logic.
- **Status:** SETTLED.

### 3. WCAG COMPLIANCE — Mandatory streaming UI features.
- **Decision:** Streaming status changes must be announced via ARIA live regions; errors via `role="alert"`.
- **Rationale:** Ensure research progress is accessible to screen readers.
- **Status:** SETTLED/VERIFIED. Applied in `ResearchForm.tsx` and recently audited via `axe-core/playwright`.

---

## SSE / Auth (Cross-Origin)

### 4. SSE TRANSPORT — Fetch-based with Bearer token.
- **Decision:** SSE consumed via `@microsoft/fetch-event-source` sending `Authorization: Bearer <ID token>`.
- **Rationale:** Bypasses cookie-blocking on `run.app` domains. Handles 1-hour token expiry via `onopen` refresh logic.
- **Status:** SETTLED/VERIFIED.

### 5. BACKEND SSE — Standard streaming headers.
- **Decision:** Endpoint yields `text/event-stream` with `Cache-Control: no-cache` and `X-Accel-Buffering: no`.
- **Status:** SETTLED/VERIFIED. Implemented in `api/main.py` and `api/job_store.py`.

---

## Local Development & Testing

### 6. LOCAL AUTH BYPASS — Env-gated.
- **Decision:** Local dev bypasses login via `NEXT_PUBLIC_DISABLE_AUTH=true` in `middleware.ts`.
- **CRITICAL:** Must never reach production.
- **Status:** SETTLED.

### 7. LOCAL MODE — GCP dependency stubbing.
- **Decision:** `LOCAL_MODE=true` stubs Cloud Tasks (uses `BackgroundTasks`) and Firestore (uses in-memory dict).
- **Status:** SETTLED/VERIFIED. Implemented in `api/job_store.py`.

### 8. MULTI-LAYER TESTING — Unit to E2E.
- **Decision:** Mandatory 4-layer testing (Unit, Integration, Integrity, E2E) using `pytest` and `playwright`.
- **Rationale:** Ensures architectural integrity and regression safety during the stack migration.
- **Status:** SETTLED/VERIFIED. Documented in `docs/TESTING.md`.

---

## Data Management

### 9. PROJECT RENAME — `edtech-agent` to `nerd`.
- **Decision:** Renamed working directory and remote sync targets from `edtech-agent` to `nerd`.
- **Rationale:** Aligns codebase with the tool's core identity.
- **Status:** SETTLED/VERIFIED.

### 10. DATA REMEDIATION — Proxy URL Resolution.
- **Decision:** All `grounding-api-redirect` URLs must be resolved to canonical destinations before artifact storage.
- **Rationale:** Google Search proxy tokens are short-lived and fragile.
- **Status:** SETTLED/VERIFIED. Batch processor refactored to handle async resolution.

---

## Cloud Deployment

### 11. FRONTEND BUILD — Build-time env inlining.
- **Decision:** `NEXT_PUBLIC_API_BASE_URL` must be passed as a Docker `--build-arg`.
- **Status:** SETTLED/VERIFIED.

### 12. WORKER — OIDC Auth & Retry Suppression.
- **Decision:** Worker is private and invoked via OIDC. Returns `200 OK` on research failure to prevent expensive Cloud Tasks retries.
- **Status:** SETTLED/VERIFIED.

---

## WordPress Publishing (ACF)

### 13. PUBLISHING SURFACE — ACF fields, not HTML.
- **Decision:** NCADEMI product pages are template-rendered (PHP `single-product.php`) from ACF fields. The publishing path is manual entry into ACF form fields, NOT pasted HTML.
- **Rationale:** Verified against the live Canvas LMS page: content uses Bootstrap grid (`row g-4 g-lg-5`, `col-lg-8/4`), not authored `wp-block` markup. Vendor renders as a linked post (`product_related_vendor`), resources are an ACF repeater grouped by `resource_source` (vendor/thirdparty), support email is `antispambot()`-obfuscated by the template — all signatures of template rendering from fields.
- **Status:** SETTLED/VERIFIED (single live page; broader product sample not yet checked).

### 14. HTML GENERATOR — Preview-only, not a publishing artifact.
- **Decision:** `nerd_core/generators.py` HTML output is retained solely as a researcher preview of how a listing will look on the live site. It is NOT used to publish.
- **Rationale:** Publishing is ACF-field entry (see #13). The generated HTML had drifted from production (emits `wp-block-columns`; production uses Bootstrap grid).
- **Open fidelity gaps (preview must be fixed to not mislead):** (a) grid system mismatch; (b) ACR sub-fields (version/date/completed-by) render empty; (c) vendor emits dead `href="#"` vs real permalink; (d) duplicate support email (phantom link); (e) may still emit `ai-insights` block absent from live page.
- **Status:** SETTLED (role). Fidelity fixes PENDING. NOTE: per Decision #21, `nerd_core/generators.py` itself has since been migrated to emit `wp-block-*` markup matching the real NCADEMI theme (resolving gap (a) for the generator output, separate from the live-page grid-system question raised in #13) — but the frontend preview path required a separate parity fix (#21) since it does not consume `generators.py` directly.

### 15. ACR DATA — Separate post type + manual field entry.
- **Decision:** ACRs are a distinct ACF post type (`acr`) linked back to products via `acr_related_product`. ACR sub-fields (`acr_version`, `acr_published_date`, `preparation_type`, `completed_by`, `completed_by_url`, `acr_information`) are entered MANUALLY at transcription time, not scraped.
- **Rationale:** ACR sources are frequently PDFs; the research parser captured only title+URL and misfiled the auditor. Manual entry while viewing the VPAT is more reliable than flaky re-extraction, and avoids non-deterministic rescrape regressing clean data. `acr_version` is a closed vocabulary (2.5 Rev / 2.5 / 2.4 / 2.4 Rev / 2.0) and must be normalized on entry. `preparation_type` (Internal/External) is not in the current dataclass and needs adding.
- **Status:** SETTLED (data source). Schema add for `preparation_type` PENDING.

### 16. RESCRAPE — Not warranted; fix parser instead.
- **Decision:** Do not rescrape products to improve fidelity. The gaps are parser/schema issues, not data-availability issues.
- **Rationale:** Stored artifacts already contain the data, mis-slotted: e.g. Canvas JSON has WebAIM in `other_resources` when it is the ACR auditor, and the support email is duplicated into `other_resources`. Rescraping (Gemini + Search grounding) is non-deterministic and risks regressing good data. Fix the parser (auditor miscategorization, duplicate-email double-capture) so the data already in hand is correctly sorted, and so future research stops repeating the errors.
- **Status:** SETTLED (rationale), PENDING (fix). An initial inventory pass (`tests/integrity/inventory_candidates.py`) reported zero instances of these issues, but that result was invalid on two independent grounds: (1) the script only scanned `NCADEMI_candidates/`, while the cited Canvas example lives in `NCADEMI_products/`; (2) the script read a `listing_data` wrapper key that does not exist in the candidate JSON shape (fields are top-level), so it was silently checking an empty dict on every file regardless of directory. A corrected inline scan of `NCADEMI_products/` (43 files) found: 5 files with a misfiled auditor in `other_resources`, 29 files with a duplicate support email captured in `other_resources`, 41 files with `vendor_directory_url` still at placeholder (`"#"`). The parser fix described in this decision's rationale has not yet been implemented and remains the next step. `inventory_candidates.py` itself needs a fix (correct key access, correct directory scope, or both) before it can be trusted as a regression check.

---

## Cloud Deployment (continued)

### 17. HEALTH CHECK — `/healthz` is edge-intercepted; check repointed.
- **Decision:** Do not rely on `/healthz` for post-deploy verification. The `deploy.sh` post-deploy check is repointed to `curl ${API_URL}/admin/candidates`.
- **Rationale:** Verified that `/healthz` IS registered in the deployed image (present in live `openapi.json`; serving image digest matches current source 1:1 — stale-image theory disproven). The 404 is a Google edge/load-balancer interception of the path (HTML 404 with Google robot imagery), returned before the request reaches FastAPI. `/admin/candidates` reaches the app and proves both app-up and Firestore connectivity — a stronger liveness signal. The `/healthz` route itself is left in place (harmless); only the verification check moved.
- **Status:** SETTLED/VERIFIED.

### 18. AI INSIGHTS — Built but gated OFF pending team approval.
- **Decision:** `ENABLE_AI_INSIGHTS` stays `false` in production. The feature is fully built and instantly restorable via the env var once the team approves.
- **Rationale:** The serving worker had drifted to `ENABLE_AI_INSIGHTS=true` (ad-hoc `gcloud run services update`), contradicting `deploy.sh` (=false). Insights are not team-approved. Generating-and-hiding is not free: it would persist unapproved AI content into the `ai_insights` artifact field and add LLM cost/latency/failure surface on an unapproved path. Reset to `false` (runtime env update, no rebuild); image untouched so restoring is a one-line flip back to `true`.
- **Status:** SETTLED. (`deploy.sh` already specifies `false`; only the live worker required reset.)

### 19. HTML_OVERRIDE / LAST_UPDATED_AT — Backend support is core infrastructure, not parked.
- **Decision:** The `html_override` and `last_updated_at` fields on `ListingData`, along with their handling in `api/conversions.py` and the `/render` endpoint's override-rendering logic in `api/main.py`, are core backend infrastructure on `main` — not part of the parked frontend editing feature.
- **Rationale:** During a documentation-alignment and refactor sprint, the frontend half of an in-progress HTML-override editing UI (a textarea-based editor in `ListingCard.tsx`/`page.tsx`, plus the schema field declarations in `schemas.py`/`generators.py`) was deliberately moved to a separate `editable-viewer` branch and removed from `main`, since that UI feature was being deferred. However, `api/conversions.py` (the Pydantic↔dataclass bridge) and `/render`'s override-handling in `api/main.py` already depended on these same two field names as pre-existing, working backend functionality, predating that session's work. Removing the fields from `main`'s `schemas.py`/`generators.py` broke this real backend path (`api/worker.py`'s `dataclass_to_pydantic` call), causing `tests/integration/test_job_lifecycle.py::test_initial_research_lifecycle` to fail with an `AttributeError`. The fields were restored to `main` (commits `a8a975e`, `e61e7da`) with typing aligned to `editable-viewer`'s stricter version (`max_length` constraint, non-Optional `str` typing) to minimize future merge friction.
- **Status:** SUPERSEDED by #20/#21 — the frontend editing UI has since shipped as the per-section override editor (see #20), so the "frontend half remains parked on `editable-viewer`" framing below no longer applies. Original text retained for history: ~~Only the frontend editing UI (textarea, modal/inline editor, the buttons that invoke it) remains parked on `editable-viewer`. Any future work resuming the editable-viewer UI feature should target re-adding ONLY the frontend components — the backend half never left `main` and needs no changes.~~

### 20. PER-SECTION HTML OVERRIDE EDITOR — Shipped; supersedes single-blob `html_override` as the editing UI.
- **Decision:** The product listing is split into five independently overridable sections (`header`, `vendor_resources`, `other_resources`, `support`, `acr`), each with its own optional HTML override stored in a new `section_overrides` field on `ListingData` (frontend `types.ts`, backend `schemas.py`/`generators.py`). A given section renders its override if present, else falls back to auto-generated markup — implemented identically as `getSectionHtml` (`frontend/lib/ncademiPreview.ts`) and `get_section_html` (`nerd_core/generators.py`), which share a documented contract requiring byte-identical override-or-generate behavior between the two.
- **Rationale:** Per-section overrides let an admin hand-fix one broken section (e.g. a mis-rendered ACR block) without discarding auto-generated content for the rest of the listing — more granular and less destructive than the single whole-listing `html_override` field from Decision #19, which remains in place as separate, lower-level infrastructure but is not the editing UI surface.
- **Implementation:** `SectionEditor.tsx` (modal editor, one per section, native `<dialog>`-based with focus restoration; no manual focus trap — see in-file note citing W3C APA Working Group guidance that `showModal()`'s native behavior is not a WCAG violation), wired into `page.tsx` via `handleSaveSection`/`handleResetSection`. `useResearch.ts`'s `updateListing` was extended to accept either a value or a `(prev) => next` updater function to support the read-modify-write pattern these handlers need. `InvalidLinksModal.tsx` gates deletion of links inside an overridden section (shows "Edit this section to remove" instead of a delete checkbox), since deleting a link from auto-generated data has no effect once that section is overridden. Persistence: `section_overrides` round-trips through `api/conversions.py` (`pydantic_to_dataclass`/`dataclass_to_pydantic`) and is stored verbatim via `model_dump()` in `_upsert_record` (Firestore in prod, in-memory dict in `LOCAL_MODE`) — no special-casing needed since it's a first-class Pydantic field.
- **Status:** SETTLED/VERIFIED. Build-blocking and persistence gaps from an incomplete first pass (missing `getSectionHtml` export, `updateListing` signature mismatch, missing backend `section_overrides` field, `/render` not consulting overrides) were all found and fixed; reverified against current file state.

### 21. PREVIEW/COPY-HTML MARKUP PARITY — `ncademiPreview.ts` ported to match `generators.py`.
- **Decision:** `frontend/lib/ncademiPreview.ts`'s five section-markup functions (`genHeaderHtml`, `genVendorResourcesHtml`, `genOtherResourcesHtml`, `genSupportHtml`, `genAcrHtml`) and `buildNcademiListingHtml`'s outer grid skeleton were rewritten to match `nerd_core/generators.py`'s `_gen_*_html` functions and `templates/ncademi_listing.html` structurally and class-for-class (e.g. `entry-header alignwide`/`entry-title` instead of legacy `page-header`/`page-title`; `wp-block-list resource-list` on resource `<ul>`s; `acr-report` wrapper per ACR entry; `wp-block-columns`/`wp-block-column` grid instead of legacy Bootstrap `row`/`col-lg-8`; `fa-solid` instead of `fa-regular` icon variant).
- **Rationale:** `generators.py` had previously been updated to mirror the real NCADEMI WordPress theme markup (see Decision #14 note); `ncademiPreview.ts` was never updated to match, so the in-app live preview (`ListingCard` → `buildNcademiListingHtml`) showed visibly different markup than `/render`'s output (Copy HTML / Download HTML) and the real WordPress page for every non-overridden section — undermining the what-you-see-is-what-you-edit premise of the section editor (#20).
- **Verification:** Parity confirmed by direct comparison of generated output (not just code review) across a populated fixture and an empty fixture, for all five sections, between old TS, new TS, and Python — outputs pasted and independently re-derived rather than taken on report alone, after an initial verification pass mischaracterized the empty-fixture case as fully matching when it was not (see below).
- **Bug found and fixed during this work (unrelated to the porting task itself, but uncovered by it):** `_gen_header_html` checked `if listing.product_website_url:` rather than `if listing.product_website_url and listing.product_website_url != "#"`, so it rendered a website link pointing at `"#"` (the dataclass's "no value" sentinel — same default used by `vendor_directory_url`) instead of suppressing it, unlike the equivalent (correct) check already present in `ncademiPreview.ts`. Fixed in `generators.py` to add the `!= "#"` guard, aligning with the TS behavior and the sentinel convention used elsewhere.
- **Known related issue, explicitly NOT fixed (flagged, not actioned):** `_gen_header_html`'s vendor-link branch checks `if listing.vendor_directory_url else escape(listing.vendor_name)` — truthiness only, no `!= "#"` exclusion. When `vendor_name` is set and `vendor_directory_url` is left at its `"#"` default, this renders `<a href="#">Vendor Name</a>` — a self-referencing anchor. Assessed as cosmetically odd but not broken (unlike the website-link case, this doesn't produce a misleading "visit site" CTA); left as-is pending an explicit decision on whether to apply the same `!= "#"` guard here too. Same underlying `"#"`-sentinel-truthiness pattern as the bug above and as Decision #16's inventory finding (41 products with `vendor_directory_url` still at placeholder `"#"`) — if a third instance of this pattern surfaces, treat it as one decision (fix the convention everywhere a `"#"`-sentinel field is truthiness-checked) rather than another one-off patch.
- **Status:** SETTLED/VERIFIED.

### 22. RESOURCELINK SCHEMA DRIFT — confidence and justification added to Pydantic model.
- **Decision:** Added `confidence: float = 0.0` and `justification: str = ""` to `schemas.ResourceLink` to match the `ResourceLink` dataclass in `nerd_core/generators.py`.
- **Rationale:** The generate-listing overhaul (Phase 1) added `confidence` and `justification` to the dataclass for relevance filtering and ranking. These fields were never mirrored to the Pydantic model, causing them to be silently dropped at `dataclass_to_pydantic()` — not persisted to Firestore, not included in the SSE payload. They are not used for rendering but are needed for auditability and future debugging of ranking behavior.
- **Status:** SETTLED/VERIFIED.

### 23. VALIDATION_JOBS ARCHITECTURE — Pin --max-instances 1 on nerd-api; no Firestore migration.
- **Decision:** `validation_jobs` remains an in-memory dict in `api/main.py`. `nerd-api` is pinned to `--max-instances 1` in `deploy.sh` to prevent state loss on scale-out. Firestore migration is not warranted.
- **Rationale:** `validation_jobs` tracks async link-validation jobs (admin tool, not the main research pipeline). Migrating to Firestore adds meaningful complexity for a feature that loses state harmlessly on restart. The in-memory approach is correct given single-instance pinning; the pin is a deliberate, documented exception to the default auto-scaling behavior and must not be removed without revisiting this decision.
- **Status:** SETTLED. `deploy.sh` updated with `--max-instances 1` and this explanatory comment.

### 24. HTML_OVERRIDE SANITIZATION — Frontend DOMPurify only; no backend allowlist.
- **Decision:** `dangerouslySetInnerHTML` in `ListingCard.tsx` is guarded by `DOMPurify.sanitize` (frontend only). No backend allowlist sanitization is added.
- **Rationale:** `html_override` and `section_overrides` are written only by authenticated researchers (Firebase Auth gate). The attack surface is narrow and the trust model supports frontend-only sanitization. Backend allowlist would add complexity and a maintenance burden without meaningful security benefit in this context.
- **Status:** SETTLED. DOMPurify already wired; this closes the open question from the section editor sprint.

# Section 2
File not found: generate-listing-overhaul-plan.md or generate-listing-implementation-handoff.md

# Section 3
9479e97 (HEAD -> main, origin/main, origin/HEAD) chore: fix ResourceLink schema drift, pin nerd-api max-instances, document decisions 22-24
081a498 chore: add plain-text candidate URL list for ingest script
f8c2fb9 merge(feat/candidate-regeneration): SSE regen script, store.py, CandidateRecord, batch endpoint, ingest script
2640a3c (feat/candidate-regeneration) feat(candidate-regen): add store.py, CandidateRecord, batch endpoint, ingest script
cfe36e0 merge(feat/ui-ai-insights-toggle): AI insights toggle UI
380b4f9 (feat/ui-ai-insights-toggle) fix(ui): correct showAiInsights default to false (hidden by default)
b953397 feat(ui): add showAiInsights param to buildNcademiListingHtml
4505b89 (misc-ui-updates) feat(ui): conditionally render save/update buttons
931db18 feat(ui): add toggle for AI insights section
34335e4 (feat/generate-listing-overhaul-phase3) feat: complete Phase 3 adaptive validation and worker orchestration
adde944 (feat/generate-listing-overhaul-phase2) feat: complete Phase 2 parser, ranking, and ACR structural gate
b65f13e Merge feat/generate-listing-overhaul-phase1: Phase 1 prompt rewrite, verified
2713484 (feat/generate-listing-overhaul-phase1) feat(prompts): Phase 1 generate-listing overhaul - relevance filter, confidence annotation, 4-sentence AI Insights cap with Insufficient-data fallback
ccf1447 Merge feat/section-editor: per-section HTML override editor
da81516 (feat/section-editor) fix(test): add missing link-selection step before delete in candidate_lifecycle.spec.ts
4182f6d fix(test): add id="product-name" to h1 in both header generators
e04ec21 feat(frontend): add Stop button to cancel in-flight research
bebe861 fix(research): add missing timeout to synthesize_insights
3a1767e fix(frontend): clear unsaved-section badge on persist, not on override-presence
17f74d0 docs: log decisions #20 (section editor) and #21 (markup parity)

# Section 4
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


class SectionOverrides(BaseModel):
    """Per-section raw-HTML overrides. Each value, if present, replaces
    the auto-generated HTML for that section in BOTH the live viewer and
    /render. Closed key set — these are the only editable sections
    (footer excluded)."""
    header: Optional[str] = Field(default=None, max_length=102400)
    vendor_resources: Optional[str] = Field(default=None, max_length=102400)
    other_resources: Optional[str] = Field(default=None, max_length=102400)
    support: Optional[str] = Field(default=None, max_length=102400)
    acr: Optional[str] = Field(default=None, max_length=102400)

    model_config = {"extra": "forbid"}  # reject unknown section keys


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
    html_override: Optional[str] = Field(default=None, max_length=102400)
    last_updated_at: Optional[str] = None
    section_overrides: Optional[SectionOverrides] = None


class CandidateRecord(ListingData):
    """ListingData + storage-only raw_markdown field.

    raw_markdown is silently ignored by /render — pydantic_to_dataclass does
    not map it to any dataclass field, so it is stripped at conversion time.
    It is stored alongside the parsed listing so that deep-dive jobs can
    carry the raw text forward without a separate Firestore read.
    """
    raw_markdown: Optional[str] = None


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class InitialResearchRequest(BaseModel):
    product_url: str
    # Legacy slider: min 1, max 4, default 4 (minutes). run_initial_research
    # signature is run_initial_research(product_url, timeout_min=4).
    timeout_min: int = Field(default=4, ge=1, le=4)
    # When True, worker auto-persists the parsed listing to nerd_candidates
    # after job completion. Non-fatal: failure logs a warning only.
    save_as_candidate: bool = False


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


# ── Link Validation ──────────────────────────────────────────────────────────
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


# ── Batch research ───────────────────────────────────────────────────────────

class BatchResearchRequest(BaseModel):
    """Enqueue up to 50 product URLs for research in a single call."""
    urls: list[str] = Field(min_length=1, max_length=50)


class BatchResearchJob(BaseModel):
    url: str
    job_id: str


class BatchResearchResponse(BaseModel):
    jobs: list[BatchResearchJob]

# Section 5
https://bookcreator.com/
https://gizmos.explorelearning.com/
https://newsela.com/
https://reflex.explorelearning.com/
https://soraapp.com/
https://www.brainpop.com/classroom-solutions/products/brainpop
https://www.brainpop.com/classroom-solutions/products/brainpop-ell
https://www.brainpop.com/classroom-solutions/products/brainpop-jr
https://www.brainpop.com/science-solutions/brainpop-science
https://www.ck12.org/
https://www.commonlit.org/
https://www.deltamath.com/
https://www.dreambox.com/
https://www.explorelearning.com/our-products/science4us
https://www.formative.com/
https://www.hmhco.com/
https://www.instructure.com/canvas
https://www.lexialearning.com/core5
https://www.lexialearning.com/lexia-english
https://www.mathway.com/
https://www.noredink.com/
https://www.peardeck.com/
https://www.readworks.org/
https://www.sparknotes.com/

# Section 6
"""
nerd_core/generators.py — Artifact Engine for N.E.R.D.
=================================================
Converts a parsed NCADEMI listing (from the GEPA-optimized agent) into:
  - A standalone HTML preview (rendered in Streamlit)

Both outputs exactly match the NCADEMI directory page structure.
"""

from __future__ import annotations

import re
import io
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional, Literal, Callable

from jinja2 import Environment, FileSystemLoader, select_autoescape
from markupsafe import escape

# ---------------------------------------------------------------------------
# Setup Jinja2
# ---------------------------------------------------------------------------
# Corrected path to root 'templates' directory
_TEMPLATES_DIR = Path(__file__).parent.parent / "templates"
_jinja = Environment(
    loader=FileSystemLoader(str(_TEMPLATES_DIR)),
    autoescape=select_autoescape(["html"]),
    trim_blocks=True,
    lstrip_blocks=True,
)

# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class ResourceLink:
    url: str
    text: str
    confidence: float = 0.0
    justification: str = ""


@dataclass
class SupportContact:
    type: str       # "email" | "url" | "text"
    value: str
    label: str = ""


@dataclass
class ACRReport:
    title: str
    url: str
    version: str = ""
    date: str = ""
    auditor_name: str = ""
    auditor_url: str = ""


@dataclass
class ListingData:
    product_name: str = "Unknown Product"
    vendor_name: str = ""
    vendor_directory_url: str = "#"
    product_description: str = ""
    product_website_url: str = "#"
    vendor_resources: list[ResourceLink] = field(default_factory=list)
    other_resources: list[ResourceLink] = field(default_factory=list)
    ai_insights: str = ""
    support_contacts: list[SupportContact] = field(default_factory=list)
    acr_reports: list[ACRReport] = field(default_factory=list)
    last_updated: str = ""
    html_override: str = ""
    last_updated_at: str = ""
    section_overrides: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Markdown → ListingData parser
# ---------------------------------------------------------------------------

# Robust link regex: matches [Text](URL), [Text] (URL), Text (URL), or just URL
_LINK_RE = re.compile(
    r'^\s*-\s*(?:'
    r'\[(?P<text1>.+?)\]\s?\((?P<url1>https?://[^\)\s]+)\)'  # [Text](URL) or [Text] (URL)
    r'|'
    r'(?P<text2>.+?)\s*\((?P<url2>https?://[^\)\s]+)\)'  # Text (URL)
    r'|'
    r'(?P<url3>https?://\S+)'                          # Raw URL
    r')'
)

# Regex to capture confidence annotations like {confidence: 0.89, why: "..."}
_ANNOTATED_LINK_RE = re.compile(
    r'^\s*-\s*'
    r'\[(?P<text>.+?)\]\((?P<url>https?://[^\)]+)\)'  # Markdown link [Text](URL)
    r'(?:\s*\{\s*confidence:\s*(?P<confidence>0\.\d+),?\s*why:\s*"(?P<why>[^"]*)"\s*\})?' # Optional annotation
)

_HEADER_RE = re.compile(r'^(#{1,6})\s+(.+)')

def _parse_confidence_annotation(line: str) -> tuple[float, str]:
    """Parses a confidence annotation, returning (0.0, "") on failure."""
    try:
        match = re.search(r'confidence:\s*(?P<confidence>0\.\d+)', line)
        confidence = float(match.group('confidence')) if match else 0.0
        
        match = re.search(r'why:\s*"(?P<why>[^"]*)"|'why':\s*'(?P<why2>[^']*)'', line)
        why = match.group('why') or match.group('why2') if match else ""
        
        return confidence, why
    except (AttributeError, ValueError):
        return 0.0, ""

def _rank_and_cap_resources(resources: list[ResourceLink], cap: int = 5) -> list[ResourceLink]:
    """Sorts resources by confidence (desc) and caps the list."""
    return sorted(resources, key=lambda r: r.confidence, reverse=True)[:cap]

def parse_markdown_to_listing(markdown: str) -> ListingData:
    """
    Convert the GEPA-optimized Markdown draft into a ListingData object.
    """
    lines = markdown.splitlines()
    data = ListingData()
    current_section: Optional[str] = None
    ai_lines: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped: continue
        
        # Section detection
        m = _HEADER_RE.match(stripped)
        if m:
            level, heading = len(m.group(1)), m.group(2).strip()
            heading_lower = heading.lower()
            
            if level == 1:
                data.product_name = heading
            elif "vendor" in heading_lower:
                current_section = "vendor"
            elif "third-party" in heading_lower or "other sources" in heading_lower:
                current_section = "other"
            elif "insights" in heading_lower:
                current_section = "insights"
            elif "support" in heading_lower:
                current_section = "support"
            elif "acr" in heading_lower or "conformance" in heading_lower:
                current_section = "acr"
            continue

        # Header detection fallback
        if current_section is None:
            metadata_match = re.match(r'^(\*\*|)(Product Name|Vendor|Product Website|Description):(\*\*|)\s*(.*)', stripped, re.I)
            if metadata_match:
                key = metadata_match.group(2).lower()
                val = metadata_match.group(4).strip()
                if key == "product name": data.product_name = val
                elif key == "vendor": data.vendor_name = val
                elif key == "product website": data.product_website_url = val
                elif key == "description": data.product_description = val
                continue
            
            if not stripped.startswith("#") and not stripped.startswith("-"):
                if not data.product_description:
                    data.product_description = stripped
                else:
                    data.product_description += " " + stripped
                    
        elif current_section in ("vendor", "other"):
            # Try the new annotated regex first
            annotated_match = _ANNOTATED_LINK_RE.match(stripped)
            if annotated_match:
                text = annotated_match.group('text').strip()
                url = annotated_match.group('url').strip()
                confidence, why = _parse_confidence_annotation(stripped)
                link = ResourceLink(text=text, url=url, confidence=confidence, justification=why)
            else:
                # Fallback to the old, non-annotated regex
                lm = _LINK_RE.match(stripped)
                if lm:
                    text = lm.group('text1') or lm.group('text2') or lm.group('url3')
                    url = lm.group('url1') or lm.group('url2') or lm.group('url3')
                    
                    if lm.group('url3') and not lm.group('text1') and not lm.group('text2'):
                        raw_text = stripped[2:].replace(url, '').strip(' ()[]:-')
                        if raw_text: text = raw_text
                    
                    link = ResourceLink(text=text.strip(), url=url.strip()) # Confidence defaults to 0.0
                elif stripped.startswith("- ") and "http" in stripped:
                    # Last resort fallback if all regexes missed it
                    url_match = re.search(r'https?://\S+', stripped)
                    if url_match:
                        url = url_match.group(0).rstrip(').')
                        text = stripped[2:].replace(url, '').strip(' ()[]:-')
                        if not text: text = url
                        link = ResourceLink(text=text, url=url) # Confidence defaults to 0.0
                    else:
                        continue # Skip malformed line
                else:
                    continue # Skip non-link line

            if current_section == "vendor":
                data.vendor_resources.append(link)
            else:
                data.other_resources.append(link)

        elif current_section == "support":
            if "Support Contact:" in stripped:
                val = stripped.replace("Support Contact:", "").strip()
                if "@" in val:
                    data.support_contacts.append(SupportContact(type="email", value=val))
                elif "http" in val:
                    # Attempt to extract markdown link if present
                    lm = _LINK_RE.match("- " + val)
                    if lm:
                        text = lm.group('text1') or lm.group('text2') or lm.group('url3')
                        url = lm.group('url1') or lm.group('url2') or lm.group('url3')
                        data.support_contacts.append(SupportContact(type="url", value=url.strip(), label=text.strip()))
                    else:
                        data.support_contacts.append(SupportContact(type="url", value=val))
                else:
                    data.support_contacts.append(SupportContact(type="text", value=val))
                    
        elif current_section == "acr":
            if "Report Title:" in stripped:
                data.acr_reports.append(ACRReport(title=stripped.replace("Report Title:", "").strip(), url="#"))
            elif data.acr_reports:
                curr = data.acr_reports[-1]
                if "VPAT Version:" in stripped: curr.version = stripped.replace("VPAT Version:", "").strip()
                elif "Date Completed:" in stripped: curr.date = stripped.replace("Date Completed:", "").strip()
                elif "Evaluating Organization:" in stripped: curr.auditor_name = stripped.replace("Evaluating Organization:", "").strip()
                elif "Link:" in stripped:
                    # Parse the link using the robust regex
                    lm = _LINK_RE.match("- " + stripped.replace("Link:", "").strip())
                    if lm:
                        url = lm.group('url1') or lm.group('url2') or lm.group('url3')
                        curr.url = url.strip()
                    else:
                        # Fallback raw url grab
                        url_match = re.search(r'https?://\S+', stripped)
                        if url_match: curr.url = url_match.group(0).rstrip(').')

        elif current_section == "insights":
            if not stripped.startswith("#"):
                # Handle "Description:" prefix if present
                if stripped.startswith("Description:"):
                    stripped = stripped.replace("Description:", "").strip()
                if stripped:
                    ai_lines.append(stripped)

    data.ai_insights = " ".join(ai_lines).strip()
    data.last_updated = datetime.now().strftime('%B %d, %Y')
    
    # Rank and cap the resource lists before returning
    data.vendor_resources = _rank_and_cap_resources(data.vendor_resources)
    data.other_resources = _rank_and_cap_resources(data.other_resources)
    
    return data


# ---------------------------------------------------------------------------
# HTML preview builder
# ---------------------------------------------------------------------------

def render_listing_html(listing: ListingData) -> str:
    """
    Render a ListingData object as a standalone NCADEMI-structured HTML string.
    Utilizes Jinja2 and nerd.css.
    """
    css_path = _TEMPLATES_DIR / "nerd.css"
    css_content = css_path.read_text() if css_path.exists() else ""

    template = _jinja.get_template("ncademi_listing.html")
    return template.render(
        product_name=listing.product_name,
        
        # Pre-rendered sections
        header_html=get_section_html(listing, "header"),
        vendor_resources_html=get_section_html(listing, "vendor_resources"),
        other_resources_html=get_section_html(listing, "other_resources"),
        support_html=get_section_html(listing, "support"),
        acr_html=get_section_html(listing, "acr"),

        # Unchanged pass-through data
        ai_insights=listing.ai_insights,
        last_updated=listing.last_updated,
        css_content=css_content
    )


def _gen_header_html(listing: ListingData) -> str:
    """Reproduces the page-header/h1, vendor line, description, and website link block."""
    parts = []
    
    # Entry Header
    parts.append('<header class="entry-header alignwide">')
    parts.append(f'<h1 id="product-name" class="entry-title">{escape(listing.product_name)}</h1>')
    parts.append('</header>')
    
    # Product Header
    parts.append('<header class="product-header">')
    if listing.vendor_name:
        vendor_link = f'<a href="{escape(listing.vendor_directory_url)}">{escape(listing.vendor_name)}</a>' if listing.vendor_directory_url else escape(listing.vendor_name)
        parts.append(f'<p class="vendor-line"><strong>Vendor:</strong> {vendor_link}</p>')

    if listing.product_description:
        parts.append(f'<p class="product-desc">{escape(listing.product_description)}</p>')

    if listing.product_website_url and listing.product_website_url != "#":
        parts.append(
            '<p class="product-website">'
            f'<a href="{escape(listing.product_website_url)}" target="_blank" rel="noopener noreferrer">'
            f'<i class="fa-solid fa-globe" aria-hidden="true"></i> {escape(listing.product_name)} Website'
            '</a></p>'
        )
    parts.append('</header>')
    
    return "
".join(parts)

def _gen_vendor_resources_html(listing: ListingData) -> str:
    """Reproduces the "From {Vendor}" resource list block."""
    if not listing.vendor_resources:
        return ""
    
    parts = []
    vendor_display_name = escape(listing.vendor_name or "Vendor")
    parts.append(f'<h3 class="section-heading">From {vendor_display_name}</h3>')
    parts.append('<ul class="wp-block-list resource-list">')
    for item in listing.vendor_resources:
        parts.append(f'<li><a href="{escape(item.url)}" target="_blank" rel="noopener noreferrer">{escape(item.text)}</a></li>')
    parts.append('</ul>')
    return "
".join(parts)

def _gen_other_resources_html(listing: ListingData) -> str:
    """Reproduces the "From Other Sources" resource list block."""
    if not listing.other_resources:
        return ""
        
    parts = []
    parts.append('<h3 class="section-heading">From Other Sources</h3>')
    parts.append('<ul class="wp-block-list resource-list">')
    for item in listing.other_resources:
        parts.append(f'<li><a href="{escape(item.url)}" target="_blank" rel="noopener noreferrer">{escape(item.text)}</a></li>')
    parts.append('</ul>')
    return "
".join(parts)

def _gen_support_html(listing: ListingData) -> str:
    """Reproduces the Support contacts block."""
    if not listing.support_contacts:
        return ""

    parts = []
    parts.append('<div class="product-support">')
    parts.append('<h3 class="section-heading">Support</h3>')
    parts.append('<ul class="wp-block-list resource-list">')
    for contact in listing.support_contacts:
        parts.append('<li>')
        if contact.type == "email":
            parts.append(f'<a href="mailto:{escape(contact.value)}">{escape(contact.value)}</a>')
        elif contact.type == "url":
            label = escape(contact.label or contact.value)
            parts.append(f'<a href="{escape(contact.value)}" target="_blank" rel="noopener noreferrer">{label}</a>')
        else:
            parts.append(escape(contact.value))
        parts.append('</li>')
    parts.append('</ul></div>')
    return "
".join(parts)

def _gen_acr_html(listing: ListingData) -> str:
    """Reproduces the Accessibility Conformance Reports block."""
    parts = []
    parts.append('<div class="edtech-acr">')
    parts.append('<h3 class="section-heading">Accessibility Conformance Reports</h3>')

    if not listing.acr_reports:
        parts.append('<div class="acr-report">')
        parts.append('<h4><a href="#" rel="noopener noreferrer">None found</a></h4>')
        parts.append('<ul>')
        parts.append('<li><strong>Version:</strong> </li>')
        parts.append('<li><strong>Date:</strong> </li>')
        parts.append('<li><strong>Completed by:</strong> </li>')
        parts.append('</ul></div>')
    else:
        for acr in listing.acr_reports:
            parts.append('<div class="acr-report">')
            
            has_valid_url = acr.url and acr.url != "#"
            title_element = escape(acr.title)
            if has_valid_url:
                title_element = f'<a href="{escape(acr.url)}" target="_blank" rel="noopener noreferrer">{title_element}</a>'
            
            parts.append(f'<h4>{title_element}</h4>')
            parts.append('<ul>')
            parts.append('<li><strong>Version:</strong> </li>')
            parts.append('<li><strong>Date:</strong> </li>')
            parts.append('<li><strong>Completed by:</strong> </li>')
            parts.append('</ul></div>')

    parts.append('</div>')
    return "
".join(parts)

def _gen_ai_insights_html(listing: ListingData) -> str:
    """Reproduces the AI Generated Insights block."""
    if not listing.ai_insights or listing.ai_insights == "Insufficient data":
        return ""
    
    parts = []
    parts.append('<div class="ai-insights">')
    parts.append('<h3>AI Generated Insights</h3>')
    parts.append(f'<p>{escape(listing.ai_insights)}</p>')
    parts.append('</div>')
    return "
".join(parts)

SectionKey = Literal["header", "vendor_resources", "other_resources", "support", "acr", "ai_insights"]

def get_section_html(listing: ListingData, section_key: SectionKey) -> str:
    """Returns the HTML a section should render: the override if
    present in listing.section_overrides, else the auto-generated HTML.
    Mirrors frontend/lib/ncademiPreview.ts's getSectionHtml (Step 3) —
    this function and that one MUST implement the identical override-
    or-generate rule, or Copy HTML will diverge from the live viewer
    for overridden sections (see plan §3, §8 R1)."""
    override = listing.section_overrides.get(section_key)
    if override is not None:  # empty string IS a valid override - see R6
        return override
    generators: dict[SectionKey, Callable[[ListingData], str]] = {
        "header": _gen_header_html,
        "vendor_resources": _gen_vendor_resources_html,
        "other_resources": _gen_other_resources_html,
        "support": _gen_support_html,
        "acr": _gen_acr_html,
        "ai_insights": _gen_ai_insights_html,
    }
    return generators[section_key](listing)

def generate_ncademi_html(markdown: str) -> str:
    """
    Render the Markdown draft as a standalone NCADEMI-structured HTML string.
    """
    listing = parse_markdown_to_listing(markdown)
    return render_listing_html(listing)

# Section 7
from __future__ import annotations

import os
import logging
import asyncio
import uuid
from fastapi import FastAPI
from typing import Dict, Any

from nerd_core.generators import parse_markdown_to_listing
from nerd_core.services import (
    run_initial_research,
    run_deep_dive,
    synthesize_insights,
    QuotaExhaustedError,
)
from nerd_core.utils import resolve_and_validate_all, filter_broken_links
from nerd_core.adaptive_validation import adaptive_validate
from nerd_core.acr_validation import is_likely_vpat_acr
from . import schemas
from . import store
from .conversions import dataclass_to_pydantic
from .job_store import emit_event, complete_job, fail_job, claim_job

logger = logging.getLogger("nerd.worker")
ENABLE_AI_INSIGHTS = os.getenv("ENABLE_AI_INSIGHTS", "true").lower() == "true"

app = FastAPI(title="N.E.R.D. Worker API")


class WorkerInitialRequest(schemas.InitialResearchRequest):
    job_id: str


class WorkerDeepDiveRequest(schemas.DeepDiveRequest):
    job_id: str


async def _validate(raw_urls: list[str], draft_markdown: str, url_cache: dict[str, str]):
    await resolve_and_validate_all(raw_urls, url_cache)
    validated_markdown, rejections = await filter_broken_links(draft_markdown)
    return validated_markdown, rejections


async def _build_result_payload(
    raw_markdown: str,
    validated_markdown: str,
    url_cache: dict[str, str],
    rejections: list[str],
    timeout_min: int,
) -> dict:
    listing_dc = parse_markdown_to_listing(validated_markdown)

    listing_dc.vendor_resources = await adaptive_validate(listing_dc.vendor_resources)
    listing_dc.other_resources = await adaptive_validate(listing_dc.other_resources)

    if listing_dc.acr_reports:
        is_valid, _ = await is_likely_vpat_acr(listing_dc.acr_reports[0].url)
        if not is_valid:
            listing_dc.acr_reports[0].url = "#"
            listing_dc.acr_reports[0].title = "None found"

    if ENABLE_AI_INSIGHTS:
        try:
            listing_dc.ai_insights = await asyncio.to_thread(
                synthesize_insights, validated_markdown, timeout_min=timeout_min
            )
        except Exception as e:
            logger.warning("synthesize_insights failed, leaving ai_insights empty: %s", e)
    else:
        listing_dc.ai_insights = ""

    parsed = dataclass_to_pydantic(listing_dc)
    payload = schemas.JobResultPayload(
        raw_markdown=raw_markdown,
        parsed_listing=parsed,
        url_cache=url_cache,
        rejections=rejections,
    )
    return payload.model_dump(mode="json")


@app.post("/worker/initial")
async def worker_initial(req: WorkerInitialRequest):
    job_id = req.job_id
    worker_id = str(uuid.uuid4())

    if not await claim_job(job_id, worker_id=worker_id):
        print(f"[WORKER] Job {job_id} already claimed or missing. Skipping.")
        return {"status": "already_processed"}

    url_cache: Dict[str, str] = {}
    print(f"[WORKER] Starting initial research for job {job_id} | URL: {req.product_url}")

    try:
        draft, raw_urls = await asyncio.to_thread(
            run_initial_research, req.product_url, req.timeout_min
        )
        print(f"[WORKER] Research step 1 done for {job_id}. Found {len(raw_urls)} URLs.")

        await emit_event(job_id, "validating_links")
        validated_md, rejections = await _validate(raw_urls, draft, url_cache)
        print(f"[WORKER] Validation done for {job_id}. Rejections: {len(rejections)}")

        if ENABLE_AI_INSIGHTS:
            print(f"[WORKER] Synthesizing AI insights for {job_id}...")
            await emit_event(job_id, "synthesizing")

        result = await _build_result_payload(draft, validated_md, url_cache, rejections, req.timeout_min)
        await complete_job(job_id, result)
        print(f"[WORKER] Job {job_id} COMPLETED successfully.")

        if req.save_as_candidate:
            try:
                candidate_data = dict(result["parsed_listing"])
                candidate_data["raw_markdown"] = result["raw_markdown"]
                slug = await store.upsert_candidate(candidate_data)
                print(f"[WORKER] Auto-persisted candidate '{slug}' for job {job_id}.")
            except Exception as _persist_err:
                logger.warning(
                    "Auto-persist failed for job %s (non-fatal): %s",
                    job_id,
                    _persist_err,
                )

    except QuotaExhaustedError:
        await fail_job(job_id, "quota_exhausted", 429)
    except Exception as e:
        logger.exception("Initial research job failed")
        await fail_job(job_id, type(e).__name__)

    return {"status": "processed"}


@app.post("/worker/deep-dive")
async def worker_deep_dive(req: WorkerDeepDiveRequest):
    job_id = req.job_id
    worker_id = str(uuid.uuid4())

    if not await claim_job(job_id, worker_id=worker_id):
        print(f"[WORKER] Job {job_id} already claimed or missing. Skipping.")
        return {"status": "already_processed"}

    url_cache = dict(req.url_cache)

    try:
        await emit_event(job_id, "deep_dive")
        new_draft, raw_urls = await asyncio.to_thread(
            run_deep_dive, req.product_url, req.product_name, req.current_draft, req.timeout_min
        )

        await emit_event(job_id, "validating_links")
        validated_delta, rejections = await _validate(raw_urls, new_draft, url_cache)

        full_raw_markdown = req.current_draft + "

" + new_draft
        full_validated_markdown = req.current_draft + "

" + validated_delta

        result = await _build_result_payload(
            full_raw_markdown, full_validated_markdown, url_cache, rejections, req.timeout_min
        )
        await complete_job(job_id, result)

    except QuotaExhaustedError:
        await fail_job(job_id, "quota_exhausted", 429)
    except Exception as e:
        logger.exception("Deep-dive job failed")
        await fail_job(job_id, type(e).__name__)

    return {"status": "processed"}

# Section 8
--- prompts/system_prompt.j2 ---
You are an expert accessibility researcher for the NCADEMI EdTech Directory. Your task is to process the following EdTech product and format ONLY its confirmed accessibility documentation into a structured Markdown report.

Product URL: {{ product_url }}

### OUTPUT FORMAT
Your output MUST start immediately with the product name and follow the strict schema below.
**DO NOT include any preamble, introduction, or acknowledgement (e.g., "I understand my role...").**
**Return ONLY the Markdown content.**

# [Product Name]
**Vendor:** [Vendor Name]
**Description:** [Neutral, one to three sentence description of the product's general function.]
**Product Website:** {{ product_url }}

### Vendor Resources
- [Link Text](URL) {confidence: 0.NN, why: "short quoted or closely-paraphrased justification"}

### Third-Party Insights
- [Link Text (Source Name)](URL) {confidence: 0.NN, why: "short quoted or closely-paraphrased justification"}

### Support
Support Contact: [Email, URL, or Phone Number]

### ACR / VPAT
Report Title: [Title of the ACR/VPAT document]
Link: [Link Text](URL) {confidence: 0.NN, why: "short quoted or closely-paraphrased justification"}

---

### The Golden Rule: Handling Mismatched Inputs
The URLs discovered via research are your absolute and **ONLY** source of truth for the product you will report on. The `product_name` is merely a starting point.

-   **If the research results are about a different product than the one specified**, you **MUST IGNORE** the original product name entirely.
-   In this scenario, you will generate the entire output for the product you actually found in the research results.
-   **DO NOT** state that resources for the original product could not be found. Your entire output must be based solely on the content of the discovered resources.

### Critical Relevance Rule — Read This Before the URL Rules Below
You are NOT trying to find everything related to this product. You are trying to find ONLY documentation related to its accessibility for people with disabilities, as defined by WCAG 2.2. WCAG 2.2 covers content that is Perceivable, Operable, Understandable, and Robust (the "POUR" principles), for users who are blind or have low vision, are deaf or have hearing loss, have limited movement, have speech disabilities, have photosensitivity, or have certain cognitive or learning disabilities.

**A URL belongs in this report only if it does ONE of the following:**

- States or documents the product's conformance to an accessibility standard (VPAT, ACR, Section 508, EN 301 549, WCAG).
- Describes specific accessibility features (screen reader support, keyboard navigation, captioning, color contrast, alternative text, etc.).
- Is a third-party accessibility audit, review, or guide specifically about this product's accessibility.

**You MUST aggressively exclude URLs that are merely about the product in general, even if highly relevant to the product otherwise, including:**

- General marketing, pricing, or "what is this product" pages with no accessibility-specific content.
- Generic software review or comparison sites (e.g., Capterra, G2, TechRadar) unless the specific review content is about accessibility.
- General encyclopedia entries (e.g., Wikipedia) unless the specific section cited is about accessibility.
- Forum posts, individual support threads, or social media posts.
- Duplicate links or regional/localized variants of a URL already included.
- The `product_url` for the NCADEMI directory itself.

If, after applying this filter, no genuinely relevant URLs were found for a section, leave that section's bullet list empty. Do not pad it with marginal or unrelated links to satisfy the appearance of completeness.

### Critical URL Processing Rules
These rules apply ONLY to URLs that already passed the relevance filter above.

1.  **EVERY BULLET MUST CONTAIN A REAL URL — NO EXCEPTIONS:** Every single bullet, with no exceptions, MUST be a complete markdown hyperlink in the form `[Text](URL)` followed by its `{confidence, why}` annotation. A bullet with descriptive text and an annotation but NO `(URL)` immediately after the closing bracket is INVALID and UNUSABLE — it will be silently discarded by the system that parses this output. Double-check every bullet before finalizing your output: does it contain `](https://` or `](http://`? If not, fix it before responding.
2.  **Maintain URL Integrity:** You **MUST** use the exact, full URL provided. Do not alter, shorten, or truncate them in any way. This is strictly forbidden.
3.  **No Hallucinated URLs:** Do not include any URLs that were not discovered via research.
4.  **Confidence and Justification Are Mandatory:** Every bullet MUST include both a confidence score (0.00–1.00) and a `why` field. This annotation is ADDITIONAL to the required `[Text](URL)` structure, never a replacement for it.

### Output Specification
You must generate a complete Markdown listing with these two exact section headers, in this order. Both sections are mandatory (they may be empty per the relevance rule above, but the headers must still appear). AI Generated Insights is not part of this prompt's output — see the note below.

---

### Vendor Resources
-   **Purpose:** Official accessibility-specific documentation from the product's own vendor/creator.
-   **Format:** A bulleted list of `[Link Text](URL) {confidence: 0.NN, why: "..."}` entries only.

### Third-Party Insights
-   **Purpose:** External, independent, non-vendor accessibility-specific documentation, audits, or reviews.
-   **Format:** A bulleted list of `[Link Text](URL) {confidence: 0.NN, why: "..."}` entries only.

### EXAMPLE OF CORRECT FORMATTING
### Vendor Resources
- [Accessibility Statement](https://example.com/accessibility) {confidence: 0.95, why: "page is titled 'Accessibility Statement' and lists keyboard navigation and screen reader support"}
- [VPAT for Product X](https://example.com/vpat) {confidence: 0.98, why: "page title contains 'Accessibility Conformance Report' and 'VPAT 2.4Rev508'"}

### Third-Party Insights
- [WebAIM Review of Product X (WebAIM)](https://webaim.org/reviews/product-x) {confidence: 0.9, why: "WebAIM review specifically evaluates screen reader compatibility"}

**WRONG (missing URL — this will be discarded):**
- Accessibility Review of Product X (WebAIM) {confidence: 0.9, why: "..."}

**RIGHT:**
- [Accessibility Review of Product X (WebAIM)](https://webaim.org/reviews/product-x) {confidence: 0.9, why: "..."}

**Note: AI Generated Insights is intentionally NOT specified in this prompt.** It is produced by a separate, later pipeline stage (`synthesize_insights`, using `prompts/synthesis_prompt.j2`) which takes this prompt's output draft as its input — not by `system_prompt.j2` itself.

### Final Instructions on Link Text
-   Generate concise, descriptive link text based on the web page's title or main heading.
-   For **Third-Party Insights** specifically: name the source organization INSIDE the link brackets, immediately after the descriptive text, in the format `[Descriptive Text (Source Name)](URL)` — e.g., `[Accessibility Review of Product X (WebAIM)](https://webaim.org/...)`, `[Guide to Accessible Presentations (Utah State University)](https://...)`. The source name goes inside the brackets as part of the link text — it is NOT a substitute for the `(URL)` that must immediately follow the closing bracket.
-   For **Vendor Resources**, source-naming is unnecessary (the vendor is already established by context) — use a concise description of the page's content instead (e.g., "Accessibility Conformance Report (VPAT)").
-   Do not simply use the domain name as link text unless it is the most appropriate description.
--- prompts/synthesis_prompt.j2 ---
You are an expert AI editor for NCADEMI.

TASK:
Synthesize the provided research draft into a single, cohesive "AI Generated Insights" paragraph.

CONSTRAINTS:
1. MAXIMUM of four (4) sentences.
2. STRIP ALL source information. Do not mention where the data came from (e.g., remove "According to...", "On the website...", etc.).
3. DO NOT include any parenthetical comments, citations, or status tags.
4. Use only standard alphanumeric text characters.
5. Focus on providing a pure narrative summary of the product's accessibility posture.
6. NO-HALLUCINATION GUARANTEE: If the INPUT DRAFT contains no substantive accessibility-specific content to synthesize -- for example, both the Vendor Resources and Third-Party Insights sections are empty, or contain only links with no extractable accessibility-relevant detail -- do not force a narrative paragraph from a thin or empty draft. In this case, output ONLY the literal text: Insufficient data
   Do not pad, speculate, or infer accessibility-posture claims that go beyond what the draft explicitly contains. Accuracy takes priority over always producing a paragraph.

INPUT DRAFT:
{{ masked_draft }}

OUTPUT:
Provide ONLY the paragraph. No headers or preamble.

--- prompts/delta_system_prompt.j2 ---
You are an expert accessibility research agent for the NCADEMI EdTech Directory.
Your task is a DEEP DIVE continuation for: {{ product_url }}

## ALREADY KNOWN SOURCES — DO NOT INCLUDE THESE
The following URLs have already been retrieved. You MUST ignore them entirely
and focus exclusively on finding NEW sources not in this list:
{% for url in already_known_urls %}
- {{ url }}
{% endfor %}

## YOUR MISSION
Find NEW accessibility documentation not yet in the list above by focusing on:
1. **Institutional audits** — Search: `site:.edu "{{ product_url | replace('https://', '') }}" accessibility`
2. **PDF VPATs/ACRs** — Search: `"{{ product_name }}" filetype:pdf VPAT accessibility conformance`
3. **Technical blogs** — Search: `webaim.org OR "deque.com" OR "level access" "{{ product_name }}" accessibility`
4. **Government/standards bodies** — Search: `site:.gov "{{ product_name }}" accessibility`

## OUTPUT FORMAT
Return ONLY new findings. Use the same strict Markdown schema:

### Vendor Resources
- [Link text](URL)
**MANDATORY:** Every bullet point MUST contain a valid URL in parentheses.

### Third-Party Insights
- [Link text](URL)
**MANDATORY:** Every bullet point MUST contain a valid URL in parentheses.

### AI Generated Insights
Description: [Single paragraph, max 6 sentences, no source citations]

# Section 9
total 136
-rw-r--r--@  1 a00288946  staff      0 Jun 12 14:35 __init__.py
drwxr-xr-x@ 12 a00288946  staff    384 Jun 30 13:13 __pycache__
drwxr-xr-x@ 12 a00288946  staff    384 Jun 30 13:13 .
drwxr-xr-x@ 63 a00288946  staff   2016 Jun 30 21:24 ..
-rw-r--r--@  1 a00288946  staff   6148 Jun 14 10:46 .DS_Store
-rw-r--r--@  1 a00288946  staff   2520 Jun 30 12:50 acr_validation.py
-rw-r--r--@  1 a00288946  staff   2471 Jun 30 13:13 adaptive_validation.py
-rw-r--r--@  1 a00288946  staff  18865 Jun 30 12:50 generators.py
-rw-r--r--@  1 a00288946  staff   7707 Jun 22 18:24 link_validator_engine.py
-rw-r--r--@  1 a00288946  staff   5157 Jun 29 16:24 services.py
-rw-r--r--@  1 a00288946  staff   2032 Jun 22 18:26 telemetry.py
-rw-r--r--@  1 a00288946  staff  10191 Jun 30 13:13 utils.py
total 128
-rw-r--r--@  1 a00288946  staff     14 Jun 13 13:57 __init__.py
drwxr-xr-x@ 11 a00288946  staff    352 Jun 30 21:15 __pycache__
drwxr-xr-x@ 10 a00288946  staff    320 Jun 30 20:59 .
drwxr-xr-x@ 63 a00288946  staff   2016 Jun 30 21:24 ..
-rw-r--r--@  1 a00288946  staff   4137 Jun 29 16:24 conversions.py
-rw-r--r--@  1 a00288946  staff   7576 Jun 14 20:44 job_store.py
-rw-r--r--@  1 a00288946  staff  18647 Jun 30 20:59 main.py
-rw-r--r--@  1 a00288946  staff   6231 Jun 30 21:15 schemas.py
-rw-r--r--@  1 a00288946  staff   6081 Jun 30 20:59 store.py
-rw-r--r--@  1 a00288946  staff   5966 Jun 30 20:59 worker.py
total 224
drwxr-xr-x@  5 a00288946  staff   160 Jun 30 21:23 __pycache__
drwxr-xr-x@ 21 a00288946  staff   672 Jun 30 20:59 .
drwxr-xr-x@ 63 a00288946  staff  2016 Jun 30 21:24 ..
-rw-r--r--@  1 a00288946  staff  9035 Jun 15 21:35 batch_processor.py
-rw-r--r--@  1 a00288946  staff  6279 Jun 14 02:32 crawler.py
-rwxr-xr-x@  1 a00288946  staff  9599 Jun 30 21:16 deploy.sh
-rw-r--r--@  1 a00288946  staff   915 Jun 26 13:19 get_smoke_token.py
-rw-r--r--@  1 a00288946  staff  3464 Jun 30 20:59 ingest_candidates.py
-rw-r--r--@  1 a00288946  staff  2795 Jun 13 14:57 ingest_k12_urls.py
-rw-r--r--@  1 a00288946  staff  6205 Jun 15 17:03 migrate_archive_to_products.py
-rw-r--r--@  1 a00288946  staff  1156 Jun 15 09:49 migrate_candidates.py
-rw-r--r--@  1 a00288946  staff  5252 Jun 16 10:13 migrate_to_firestore.py
-rwxr-xr-x@  1 a00288946  staff   223 Jun 13 11:00 pull_from_drive.sh
-rw-r--r--@  1 a00288946  staff  5004 Jun 30 20:59 regenerate_candidates.py
-rw-r--r--@  1 a00288946  staff  3764 Jun 15 21:36 reprocess_redirects.py
-rwxr-xr-x@  1 a00288946  staff  3349 Jun 14 21:16 run_nerd.sh
-rw-r--r--@  1 a00288946  staff  9583 Jun 13 00:12 scraper.py
-rwxr-xr-x@  1 a00288946  staff   520 Jun 15 20:39 sync_to_drive.sh
-rw-r--r--@  1 a00288946  staff  1969 Jun 15 09:49 validate_migration.py
-rw-r--r--@  1 a00288946  staff  2497 Jun 13 12:28 verify_gdocs.py
-rw-r--r--@  1 a00288946  staff  2438 Jun 26 13:26 verify_production.py
total 32
drwxr-xr-x@  5 a00288946  staff   160 Jun 30 17:13 .
drwxr-xr-x@ 29 a00288946  staff   928 Jun 30 14:00 ..
-rw-r--r--@  1 a00288946  staff  1021 Jun 16 10:18 firebase.ts
-rw-r--r--@  1 a00288946  staff  7450 Jun 30 17:13 ncademiPreview.ts
-rw-r--r--@  1 a00288946  staff  1166 Jun 30 12:50 types.ts
total 48
drwxr-xr-x@  5 a00288946  staff    160 Jun 30 13:44 .
drwxr-xr-x@ 29 a00288946  staff    928 Jun 30 14:00 ..
-rw-r--r--@  1 a00288946  staff  10637 Jun 29 16:24 InvalidLinksModal.tsx
-rw-r--r--@  1 a00288946  staff    541 Jun 30 13:44 ListingCard.tsx
-rw-r--r--@  1 a00288946  staff   4629 Jun 29 16:24 SectionEditor.tsx

# Section 10
import os
import re
import logging
from google import genai
from google.genai import types
from google.genai.errors import APIError
from jinja2 import Environment, FileSystemLoader
from nerd_core.utils import URLMask
from nerd_core.telemetry import log_event

logger = logging.getLogger(__name__)

# --- Environment Configuration ---
PROJECT_ID = os.getenv("GOOGLE_CLOUD_PROJECT", "edtech-agent-2026")
LOCATION = os.getenv("GCP_LOCATION", "us-central1")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# --- Client (singleton) ---
if GEMINI_API_KEY:
    # Use API Key (External/Developer mode)
    _client = genai.Client(api_key=GEMINI_API_KEY)
else:
    # Use Vertex AI (Enterprise/Production mode on GCP)
    _client = genai.Client(
        vertexai=True,
        project=PROJECT_ID,
        location=LOCATION,
    )

MODEL = "gemini-2.5-flash"

_jinja = Environment(
    loader=FileSystemLoader("prompts/"),
    trim_blocks=True,
    lstrip_blocks=True,
)

_GROUNDING_CONFIG = types.GenerateContentConfig(
    tools=[types.Tool(google_search=types.GoogleSearch())],
    temperature=1.0,
)

class QuotaExhaustedError(Exception):
    """Raised on 429 so the UI layer can handle gracefully."""

# --- Grounding metadata extraction ---
def extract_grounding_urls(response) -> list[str]:
    """Pull the raw redirect URIs from grounding metadata."""
    urls = []
    try:
        # Navigate safely through the response structure
        candidate = response.candidates[0]
        if not hasattr(candidate, "grounding_metadata") or not candidate.grounding_metadata:
            return []
            
        metadata = candidate.grounding_metadata
        chunks = getattr(metadata, "grounding_chunks", []) or []
        
        for chunk in chunks:
            web = getattr(chunk, "web", None)
            if web:
                uri = getattr(web, "uri", None)
                if uri:
                    urls.append(uri)
    except (AttributeError, IndexError) as e:
        logger.warning("Error extracting grounding metadata: %s", e)
    return urls


# --- Phase 1: Initial broad research ---
def run_initial_research(product_url: str, timeout_min: int = 4) -> tuple[str, list[str]]:
    """Return (markdown_draft, raw_redirect_urls)."""
    template = _jinja.get_template("system_prompt.j2")
    prompt = template.render(product_url=product_url)
    
    try:
        response = _client.models.generate_content(
            model=MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                tools=[types.Tool(google_search=types.GoogleSearch())],
                temperature=1.0,
                http_options=types.HttpOptions(timeout=timeout_min * 60 * 1000),
            ),
        )
    except APIError as e:
        if getattr(e, "code", None) == 429:
            raise QuotaExhaustedError("Gemini quota exhausted.") from e
        raise

    raw_urls = extract_grounding_urls(response)
    log_event("generate", product_url, "", response.text)
    return response.text, raw_urls


# --- Phase 2: Deep-dive continuation ---
_URL_RE = re.compile(r'https?://[^\s<>"')\]]+')

def run_deep_dive(product_url: str, product_name: str, current_draft: str, timeout_min: int = 4) -> tuple[str, list[str]]:
    """Extract known URLs from draft, instruct agent to find NEW ones only."""
    already_known = list(set(_URL_RE.findall(current_draft)))

    template = _jinja.get_template("delta_system_prompt.j2")
    prompt = template.render(
        product_url=product_url,
        product_name=product_name,
        already_known_urls=already_known,
    )
    
    try:
        response = _client.models.generate_content(
            model=MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                tools=[types.Tool(google_search=types.GoogleSearch())],
                temperature=1.0,
                http_options=types.HttpOptions(timeout=timeout_min * 60 * 1000),
            ),
        )
    except APIError as e:
        if getattr(e, "code", None) == 429:
            raise QuotaExhaustedError("Gemini quota exhausted.") from e
        raise

    raw_urls = extract_grounding_urls(response)
    log_event("deep_dive", product_url, current_draft, response.text)
    return response.text, raw_urls


# --- Phase 3: AI Insights synthesis (with URL masking) ---
def synthesize_insights(draft_markdown: str, timeout_min: int = 2) -> str:
    """Synthesize the AI Generated Insights paragraph with URL masking."""
    masker = URLMask()
    masked = masker.mask(draft_markdown)

    template = _jinja.get_template("synthesis_prompt.j2")
    prompt = template.render(masked_draft=masked)
    
    response = _client.models.generate_content(
        model=MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=0.2,
            http_options=types.HttpOptions(timeout=timeout_min * 60 * 1000),
        ),
    )

    audit = masker.audit(response.text)
    if audit["leaked_raw_urls"]:
        logger.error("Model leaked raw URLs during synthesis: %s", audit["leaked_raw_urls"])

    return masker.unmask(response.text, strict=False)

# Section 11
import firebase_admin
from firebase_admin import auth
import requests
import os

# Initialize firebase-admin (uses ADC)
if not firebase_admin._apps:
    firebase_admin.initialize_app()

def get_id_token(api_key):
    # 1. Create a custom token for a smoke-test user
    custom_token = auth.create_custom_token("smoke-test-user")
    
    # 2. Exchange custom token for ID token
    url = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key={api_key}"
    data = {
        "token": custom_token.decode("utf-8"),
        "returnSecureToken": True
    }
    
    response = requests.post(url, json=data)
    response.raise_for_status()
    return response.json()["idToken"]

if __name__ == "__main__":
    api_key = os.environ.get("FIREBASE_API_KEY")
    if not api_key:
        print("ERROR: FIREBASE_API_KEY environment variable not set.")
        exit(1)
    print(get_id_token(api_key))

# Section 12
import httpx
import re
from typing import Optional, Tuple, List

# A selection of common markers found in VPAT/ACR documents.
# This is not exhaustive, but covers the most frequent indicators.
VPAT_MARKERS = {
    "vpat": re.compile(r'vpat', re.I),
    "accessibility conformance report": re.compile(r'accessibility conformance report', re.I),
    "wcag": re.compile(r'wcag\s*2', re.I),
    "section 508": re.compile(r'section\s*508', re.I),
    "en 301 549": re.compile(r'en\s*301\s*549', re.I),
    "level a": re.compile(r'level\s*a\s*(conformance|supports|does not support)', re.I),
    "level aa": re.compile(r'level\s*aa\s*(conformance|supports|does not support)', re.I),
    "level aaa": re.compile(r'level\s*aaa\s*(conformance|supports|does not support)', re.I),
    "iti": re.compile(r'information technology industry council', re.I),
}

async def is_likely_vpat_acr(url: str, page_text: Optional[str] = None) -> Tuple[bool, List[str]]:
    """
    Evaluates a URL or its text content to determine if it's likely a VPAT/ACR.

    It checks for the presence of at least two distinct structural markers
    indicative of an ITI (Information Technology Industry Council) VPAT document.

    Args:
        url: The URL of the page to check.
        page_text: Optional. If provided, this text is analyzed directly
                   instead of fetching the URL.

    Returns:
        A tuple containing:
        - bool: True if 2 or more distinct markers are found, False otherwise.
        - list[str]: A list of the distinct marker keys that were found.
    """
    if page_text is None:
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
                headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'}
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                # Use a sample of the text to avoid overwhelming memory with huge PDFs
                page_text = response.text[:100000] 
        except (httpx.RequestError, httpx.HTTPStatusError) as e:
            # If the page can't be fetched, we can't validate it.
            return False, [f"HTTP Error: {e}"]

    found_markers = set()
    for key, pattern in VPAT_MARKERS.items():
        if pattern.search(page_text):
            found_markers.add(key)

    is_likely = len(found_markers) >= 2
    return is_likely, sorted(list(found_markers))

# Section 13
import asyncio
from typing import List, Dict

from nerd_core.utils import resolve_and_validate_url
from nerd_core.link_validator_engine import LinkValidatorEngine
from nerd_core.generators import ResourceLink


async def _fast_pass(urls: List[str]) -> Dict[str, bool]:
    """
    Runs a fast, concurrent HEAD-based check on a list of URLs.
    Returns a dictionary mapping each original URL to its validity.
    """
    if not urls:
        return {}
        
    tasks = [resolve_and_validate_url(url) for url in urls]
    results = await asyncio.gather(*tasks)
    
    validity_map = {}
    for i, url in enumerate(urls):
        _, is_valid, _ = results[i]
        validity_map[url] = is_valid
        
    return validity_map


async def adaptive_validate(resources: List[ResourceLink], cap: int = 5) -> List[ResourceLink]:
    """
    Performs a two-pass validation on a list of resources, ensuring the
    final list contains at most `cap` valid links, preserving the highest
    confidence resources.

    Pass 1 uses fast HEAD requests. If more than `cap` resources survive,
    Pass 2 uses a full browser validation on the lowest-confidence survivors
    to intelligently trim the list.
    """
    if not resources:
        return []

    # Pass 1: Fast, concurrent HEAD requests on all candidates.
    all_urls = [res.url for res in resources]
    fast_pass_results = await _fast_pass(all_urls)
    
    survivors = [res for res in resources if fast_pass_results.get(res.url, False)]
    
    # If we are already at or below the cap, we're done.
    if len(survivors) <= cap:
        return survivors
        
    # Pass 2: Full browser validation for the excess, lowest-confidence links.
    # The `resources` list is assumed to be sorted by confidence descending,
    # so the excess items are at the tail of the `survivors` list.
    excess_survivors = survivors[cap:]
    urls_for_pass_2 = [res.url for res in excess_survivors]
    
    engine = LinkValidatorEngine()
    pass_2_results = await engine.run(urls_for_pass_2)
    
    failed_urls_pass_2 = {url for url, result in pass_2_results.items() if not result.is_valid}
    
    # Filter the survivors list, removing any that failed the deep validation.
    # Since `resources` was sorted, `survivors` is also sorted.
    final_list = [res for res in survivors if res.url not in failed_urls_pass_2]
    
    # Return the top `cap` resources from the final validated list.
    return final_list[:cap]

# Section 14
import logging
import os
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from google.cloud import bigquery

# --- Local File Logging ---
# File logging is best-effort: on read-only filesystems (e.g. Cloud Run) the
# FileHandler cannot be created. Failure here must never crash module import.
LOG_FILE = Path(__file__).parent.parent / "nerd_debug.log"

logger = logging.getLogger("nerd")  # Root project logger
logger.setLevel(logging.DEBUG)

try:
    file_handler = logging.FileHandler(LOG_FILE)
    file_handler.setFormatter(logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    ))
    logger.addHandler(file_handler)
except OSError:
    logging.getLogger(__name__).warning(
        "File logging disabled (read-only filesystem): %s", LOG_FILE
    )

PROJECT_ID = os.getenv("GOOGLE_CLOUD_PROJECT", "edtech-agent-2026")
_TABLE = f"{PROJECT_ID}.telemetry.feedback_logs"

try:
    _BQ = bigquery.Client()
except Exception:
    _BQ = None
    logger.warning("BigQuery client unavailable — telemetry disabled.")


def log_event(
    event_type: str,
    product_url: str,
    original_markdown: str,
    refined_markdown: str,
    user_feedback: str = "",
    error_code: Optional[str] = None,
) -> None:
    """Fire-and-forget telemetry. Never raises — cannot crash the app."""
    if _BQ is None:
        return
    row = {
        "timestamp":         datetime.now(timezone.utc).isoformat(),
        "event_type":        event_type,
        "product_url":       product_url,
        "original_markdown": original_markdown[:50_000],  # BQ cell size guard
        "user_feedback":     user_feedback,
        "refined_markdown":  refined_markdown[:50_000],
        "error_code":        error_code,
    }
    try:
        errors = _BQ.insert_rows_json(_TABLE, [row])
        if errors:
            logger.warning("BigQuery insert error: %s", errors)
    except Exception as e:
        logger.warning("BigQuery insert failed silently: %s", e)

# Section 15
"""
api/conversions.py — Bridge between API Pydantic models and nerd_core dataclasses.

The single source of truth for HTML is nerd_core.generators.render_listing_html,
which takes a nerd_core.generators.ListingData *dataclass*. The API speaks
Pydantic. This module is the only place that translation happens, so drift has
exactly one place to be caught.
"""

from __future__ import annotations

from datetime import datetime

from nerd_core import generators as gen
from . import schemas


def pydantic_to_dataclass(payload: schemas.ListingData) -> gen.ListingData:
    """Convert an API ListingData (Pydantic) into a nerd_core ListingData (dataclass).

    last_updated handling:
      - explicit value from client  -> used verbatim
      - None / omitted              -> server fills datetime.now() at render time,
                                       matching the legacy parser (parse_markdown_to_listing
                                       sets datetime.now().strftime('%B %d, %Y'))
    """
    last_updated = payload.last_updated
    if last_updated is None:
        last_updated = datetime.now().strftime("%B %d, %Y")

    section_overrides = {}
    if payload.section_overrides is not None:
        # model_dump(exclude_none=True) -> only populated sections become keys
        section_overrides = payload.section_overrides.model_dump(exclude_none=True)

    return gen.ListingData(
        product_name=payload.product_name,
        vendor_name=payload.vendor_name,
        vendor_directory_url=payload.vendor_directory_url,
        product_description=payload.product_description,
        product_website_url=payload.product_website_url,
        vendor_resources=[gen.ResourceLink(url=r.url, text=r.text) for r in payload.vendor_resources],
        other_resources=[gen.ResourceLink(url=r.url, text=r.text) for r in payload.other_resources],
        ai_insights=payload.ai_insights,
        support_contacts=[
            gen.SupportContact(type=c.type, value=c.value, label=c.label)
            for c in payload.support_contacts
        ],
        acr_reports=[
            gen.ACRReport(
                title=a.title, url=a.url, version=a.version, date=a.date,
                auditor_name=a.auditor_name, auditor_url=a.auditor_url,
            )
            for a in payload.acr_reports
        ],
        last_updated=last_updated,
        html_override=payload.html_override or "",
        last_updated_at=payload.last_updated_at or "",
        section_overrides=section_overrides,
    )


def dataclass_to_pydantic(listing: gen.ListingData) -> schemas.ListingData:
    """Convert a nerd_core ListingData (dataclass) into an API ListingData (Pydantic).

    Used to package parse_markdown_to_listing() output for the SSE result payload
    so Next.js can hydrate the React Hook Form.
    """
    section_overrides = (
        schemas.SectionOverrides(**listing.section_overrides)
        if listing.section_overrides else None
    )
    return schemas.ListingData(
        product_name=listing.product_name,
        vendor_name=listing.vendor_name,
        vendor_directory_url=listing.vendor_directory_url,
        product_description=listing.product_description,
        product_website_url=listing.product_website_url,
        vendor_resources=[schemas.ResourceLink(url=r.url, text=r.text) for r in listing.vendor_resources],
        other_resources=[schemas.ResourceLink(url=r.url, text=r.text) for r in listing.other_resources],
        ai_insights=listing.ai_insights,
        support_contacts=[
            schemas.SupportContact(type=c.type, value=c.value, label=c.label)
            for c in listing.support_contacts
        ],
        acr_reports=[
            schemas.ACRReport(
                title=a.title, url=a.url, version=a.version, date=a.date,
                auditor_name=a.auditor_name, auditor_url=a.auditor_url,
            )
            for a in listing.acr_reports
        ],
        last_updated=listing.last_updated or None,
        html_override=listing.html_override or None,
        last_updated_at=listing.last_updated_at or None,
        section_overrides=section_overrides,
    )

# Section 16
#!/usr/bin/env python3
"""
scripts/batch_processor.py — Robust batch research for NCADEMI candidates.

Features:
- Checkpointing: Skips already processed URLs.
- High Fidelity: Initial Research + Deep Dive + AI Synthesis.
- Multi-Artifact Storage: Saves MD, JSON, and WP-ready HTML fragments.
- Error Recovery: Continues processing if a single URL fails.
- Validation: Flags entries with missing key fields.
"""

import os
import sys
import json
import time
import hashlib
import logging
import asyncio
import re
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any
from dataclasses import asdict

# Path Bootstrap
PROJECT_ROOT = Path(__file__).parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from nerd_core.services import run_initial_research, run_deep_dive, synthesize_insights
from nerd_core.generators import parse_markdown_to_listing, render_listing_html
from nerd_core.utils import resolve_and_validate_all
from jinja2 import Environment, FileSystemLoader

# Configure Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler("batch_processor.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("nerd.batch")

# Directory Setup
OUTPUT_DIR = PROJECT_ROOT / "NCADEMI_candidates"
TEMPLATES_DIR = PROJECT_ROOT / "templates"
OUTPUT_DIR.mkdir(exist_ok=True)

_jinja = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)))

def get_slug(url: str) -> str:
    """Generate a stable, safe filename slug from a URL."""
    clean_url = url.split("?")[0].split("#")[0].strip("/")
    # Hash the URL to ensure uniqueness even if names collide
    url_hash = hashlib.md5(url.encode()).hexdigest()[:8]
    slug = re.sub(r'[^a-z0-9]', '-', clean_url.lower())
    slug = re.sub(r'-+', '-', slug).strip('-')

# Section 17
"use client";
import { useState, useCallback, useRef } from "react";
import { ListingData } from "@/lib/types";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { getIdToken } from "@/lib/firebase";

export type ResearchStatus = "idle" | "streaming" | "complete" | "error";

export interface ResearchState {
  status: ResearchStatus;
  log: string[];
  listing: ListingData | null;
  error: string | null;
}

const INITIAL_STATE: ResearchState = {
  status: "idle",
  log: [],
  listing: null,
  error: null,
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export function useResearch() {
  const [state, setState] = useState<ResearchState>(INITIAL_STATE);
  const abortControllerRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortControllerRef.current?.abort();
    setState(INITIAL_STATE);
  }, []);

  const stopResearch = useCallback(() => {
    abortControllerRef.current?.abort();
    setState(prev => ({
      ...prev,
      status: "idle",
      log: [...prev.log, "Research stopped by user."],
    }));
  }, []);

  const updateListing = useCallback(
    (update: ListingData | ((prev: ListingData | null) => ListingData)) => {
      setState(prev => ({
        ...prev,
        listing: typeof update === "function" ? update(prev.listing) : update,
      }));
    },
    []
  );

  const injectListing = useCallback((data: ListingData, message?: string) => {
    setState({
      status: "complete",
      log: [message ?? "Injected data from saved candidate."],
      listing: data,
      error: null
    });
  }, []);

  const startResearch = useCallback(async (productUrl: string) => {
    setState({ 
      status: "streaming", 
      log: [`--- Research Started for ${productUrl} ---`, "Queuing research job..."], 
      listing: null, 
      error: null 
    });

    try {
      // Get the token (handles local bypass via getIdToken)
      const token = await getIdToken();
      if (!token && process.env.NEXT_PUBLIC_DISABLE_AUTH !== "true") {
        window.location.href = `/login?from=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      
      const authHeader = `Bearer ${token ?? "local-bypass"}`;

      // Step 1: enqueue the job
      const enqueueRes = await fetch(`${API_BASE}/research/initial`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": authHeader
        },
        body: JSON.stringify({ product_url: productUrl, timeout_min: 4 }),
      });

      if (!enqueueRes.ok) throw new Error(`Enqueue failed: ${enqueueRes.status}`);
      const { job_id } = await enqueueRes.json();
      
      setState(prev => ({ 
        ...prev, 
        log: [...prev.log, `Job queued: ${job_id}. Opening SSE stream...`] 
      }));

      // Step 2: open SSE stream for this job using fetchEventSource
      const ctrl = new AbortController();
      abortControllerRef.current = ctrl;

      await fetchEventSource(`${API_BASE}/jobs/${job_id}`, {
        headers: { 'Authorization': authHeader },
        signal: ctrl.signal,
        onopen: async (res) => {
          if (res.status >= 400 && res.status < 500 && res.status !== 429) {
            if (res.status === 401) {
               // Token might be expired, though getIdToken(true) above should prevent this.
               // We could attempt a retry loop here if needed.
            }
            throw new Error(`Fatal error from SSE: ${res.status}`);
          }
        },
        onmessage: (msg) => {
          if (msg.event === "status") {
            const data = JSON.parse(msg.data);
            setState((prev) => ({
              ...prev,
              log: [...prev.log, data.message ?? data.status],
            }));
          } else if (msg.event === "result") {
            const data = JSON.parse(msg.data);
            ctrl.abort(); // Close the stream
            setState((prev) => ({
              ...prev,
              status: "complete",
              log: [...prev.log, "Research complete. Hydrating results..."],
              listing: data.parsed_listing,
            }));
          }
        },
        onerror: (err) => {
          // fetch-event-source retries by default.
          if (ctrl.signal.aborted) return; // ignore if we closed it
          console.error("SSE Error:", err);
          setState((prev) => ({
            ...prev,
            status: "error",
            error: "Research stream failed. Check API logs.",
          }));
          throw err; // rethrow to stop or allow retry
        }
      });

    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : "Unknown error";
      setState((prev) => ({ ...prev, status: "error", error: message }));
    }
  }, []);

  return { state, startResearch, reset, stopResearch, updateListing, injectListing };
}

# Section 18
tests/__init__.py
tests/e2e_live_validation.py
tests/integration/conftest.py
tests/integration/test_admin_api.py
tests/integration/test_job_lifecycle.py
tests/integration/test_sse_api.py
tests/integration/test_worker_idempotency.py
tests/integrity/inventory_candidates.py
tests/integrity/test_candidate_files.py
tests/migration_verification.py
tests/parser_robustness_test.py
tests/service_robustness_test.py
tests/smoke/conftest.py
tests/smoke/test_smoke.py
tests/system_test.py
tests/test_link_validator.py
tests/test_sse.py
tests/unit/test_api_utils.py
tests/unit/test_conversions.py
tests/unit/test_generators.py
---
import pytest
import asyncio
import json
from unittest.mock import patch, AsyncMock

@pytest.mark.asyncio
async def test_initial_research_lifecycle(client):
    """Test the happy path from enqueuing to SSE completion."""
    
    # Mock the long-running research services to return instantly
    with patch("api.worker.run_initial_research") as mock_research, 
         patch("api.worker._validate", new_callable=AsyncMock) as mock_validate, 
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

# Section 19
(no output)

# Section 20
Candidates: 28
  book-creator
  brainpop
  brainpop-ell
  brainpop-jr
  brainpop-science
  ck-12
  canvas
  commonlit
  deltamath
  dreambox
  formative
  gizmos
  google-forms
  hmh-houghton-mifflin-harcourt
  lexia-english
  lexia-core5-reading
  mathway
  newsela
  noredink
  pear-deck
  pebblego
  pebblego-create
  pebblego-next
  readworks
  reflex
  science4us
  sora
  sparknotes

# Section 21
Products: 43
  99math
  abcya
  aleks
  adobe-acrobat
  adobe-express
  blooket
  canva
  canvas-lms
  canvas-studio
  chatgpt
  code-org
  coolmathgames
  desmos
  edpuzzle
  encyclopedia-britannica
  epic
  excel
  gimkit
  google-classroom
  google-docs
  google-sheets
  google-slides
  history-com
  ixl
  kahoot
  kami
  khan-academy
  mastery-connect
  math-playground
  notebook-lm
  pbs
  phet-interactive-simulations
  powerpoint
  prodigy
  quizlet
  scratch
  study-com
  wayground
  weebly
  word
  youtube
  i-ready
  i-ready-classroom-mathematics
