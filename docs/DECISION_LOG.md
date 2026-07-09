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
- **Decision:** NCADEMI product pages are template-rendered (PHP `single-product.php`) from ACF fields.
- **Status:** SETTLED/VERIFIED.

### 14. HTML GENERATOR — Preview-only, not a publishing artifact.
- **Decision:** `nerd_core/generators.py` HTML output is retained solely as a researcher preview.
- **Status:** SETTLED.

### 15. ACR DATA — Separate post type + manual field entry.
- **Decision:** ACRs are a distinct ACF post type (`acr`) linked back to products via `acr_related_product`.
- **Status:** SETTLED.

### 16. RESCRAPE — Not warranted; fix parser instead.
- **Decision:** Do not rescrape products to improve fidelity. Fix the parser instead.
- **Status:** SETTLED.

---

## Cloud Deployment (continued)

### 17. HEALTH CHECK — `/healthz` is edge-intercepted; check repointed.
- **Decision:** Do not rely on `/healthz` for post-deploy verification. Repointed to `curl ${API_URL}/admin/candidates`.
- **Status:** SETTLED/VERIFIED.

### 18. AI INSIGHTS — Feature deprecated and removed.
- **Decision:** The AI Insights feature is deprecated. The `ENABLE_AI_INSIGHTS` environment variable has been removed from all deployment configs, Dockerfiles, and test configs (2026-07-08). The `ai_insights` data field remains in the schema/frontend as inert dead weight (not currently removed) but is no longer synthesized or gated by any flag.
- **Status:** SETTLED/VERIFIED.

### 19. HTML_OVERRIDE / LAST_UPDATED_AT — Backend support is core infrastructure.
- **Decision:** `html_override` and `last_updated_at` are core backend infrastructure on `main`.
- **Status:** SETTLED.

### 20. PER-SECTION HTML OVERRIDE EDITOR — Shipped.
- **Decision:** The product listing is split into five independently overridable sections, each with its own optional HTML override.
- **Status:** SETTLED/VERIFIED.

### 21. PREVIEW/COPY-HTML MARKUP PARITY — `ncademiPreview.ts` ported.
- **Decision:** Frontend preview functions rewritten to match `generators.py` and theme markup structurally.
- **Status:** SETTLED/VERIFIED.

### 22. RESOURCELINK SCHEMA DRIFT — Confidence and justification added.
- **Decision:** Added `confidence` and `justification` to `schemas.ResourceLink`.
- **Status:** SETTLED/VERIFIED.

### 23. VALIDATION_JOBS ARCHITECTURE — Pin --max-instances 1 on nerd-api.
- **Decision:** `validation_jobs` remains in-memory; `nerd-api` pinned to `--max-instances 1` to prevent state loss.
- **Status:** SETTLED.

### 24. HTML_OVERRIDE SANITIZATION — Frontend DOMPurify only.
- **Decision:** `dangerouslySetInnerHTML` guarded by frontend `DOMPurify`.
- **Status:** SETTLED.

### 25. LINK VALIDATION UI — Deprecated; removed.
- **Decision:** Removed "Validate Links" button and logic from frontend.
- **Status:** SETTLED/VERIFIED.

### 26. DOCKER BUILD — Virtualenv removed.
- **Decision:** Removed `python -m venv` and `ENV VIRTUAL_ENV` steps from `Dockerfile.api`.
- **Rationale:** Containers provide native filesystem isolation; an internal `venv` was redundant and caused build failures due to missing dependencies.
- **Status:** SETTLED/VERIFIED.

### 27. PRODUCTION GUARDRAILS — LOCAL_MODE and NEXT_PUBLIC_DISABLE_AUTH must never reach deployed environments.
- **Decision:** Never set `LOCAL_MODE=true` or `NEXT_PUBLIC_DISABLE_AUTH=true` in any Dockerfile, cloudbuild.yaml, or deploy configuration. These bypass Firebase auth entirely and route research jobs in-process instead of through Cloud Tasks/nerd-worker.
- **Rationale:** `LOCAL_MODE=true` was found live on production `nerd-api` on 2026-07-08, fully bypassing auth on every endpoint (confirmed via unauthenticated curl returning 200 instead of 401). Fixed via `--update-env-vars` removal and atomic traffic promotion to a verified revision. Root cause: believed to have been set during an attempt to get a local Google Cloud Code/emulator workflow running, then not reverted before a subsequent deploy.
- **Status:** SETTLED/VERIFIED (production confirmed clean post-fix).

### 28. WORKER AUTH — ADC only, no GEMINI_API_KEY on nerd-worker.
- **Decision:** `nerd-worker` authenticates to Vertex AI/Gemini via Application Default Credentials (`roles/aiplatform.user` on the compute service account) and to Firestore via `roles/datastore.user`. Never add a `GEMINI_API_KEY` secret reference to the worker's deploy config — this differs intentionally from `nerd-api`, which does use `--set-secrets="GEMINI_API_KEY=..."`.
- **Status:** SETTLED.