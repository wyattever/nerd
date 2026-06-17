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
- **Status:** SETTLED (role). Fidelity fixes PENDING.

### 15. ACR DATA — Separate post type + manual field entry.
- **Decision:** ACRs are a distinct ACF post type (`acr`) linked back to products via `acr_related_product`. ACR sub-fields (`acr_version`, `acr_published_date`, `preparation_type`, `completed_by`, `completed_by_url`, `acr_information`) are entered MANUALLY at transcription time, not scraped.
- **Rationale:** ACR sources are frequently PDFs; the research parser captured only title+URL and misfiled the auditor. Manual entry while viewing the VPAT is more reliable than flaky re-extraction, and avoids non-deterministic rescrape regressing clean data. `acr_version` is a closed vocabulary (2.5 Rev / 2.5 / 2.4 / 2.4 Rev / 2.0) and must be normalized on entry. `preparation_type` (Internal/External) is not in the current dataclass and needs adding.
- **Status:** SETTLED (data source). Schema add for `preparation_type` PENDING.

### 16. RESCRAPE — Not warranted; fix parser instead.
- **Decision:** Do not rescrape products to improve fidelity. The gaps are parser/schema issues, not data-availability issues.
- **Rationale:** Stored artifacts already contain the data, mis-slotted: e.g. Canvas JSON has WebAIM in `other_resources` when it is the ACR auditor, and the support email is duplicated into `other_resources`. Rescraping (Gemini + Search grounding) is non-deterministic and risks regressing good data. Fix the parser (auditor miscategorization, duplicate-email double-capture) so the data already in hand is correctly sorted, and so future research stops repeating the errors.
- **Status:** SETTLED. Parser fixes PENDING. An inventory pass across all `NCADEMI_candidates/*.json` (which files have empty ACR sub-fields / misfiled auditor / `vendor_directory_url: "#"`) is the next evidence step.

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
