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