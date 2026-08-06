# System Design Document: N.E.R.D.

**NCADEMI EdTech Research for the Directory** *Last Updated: July 09, 2026*

## 1. Executive Summary

N.E.R.D. (Ncademi EdTech Research & Data) is a distributed, three-tier research platform designed to retrieve, validate, and format digital accessibility documentation for EdTech products. It automates the generation of NCADEMI-branded HTML fragments and JSON research artifacts using Google Vertex AI (Gemini 2.5 Flash) with Google Search Grounding.

## 2. Distributed Architecture

The system utilizes a scalable, asynchronous architecture on Google Cloud Run.

### A. Frontend (`frontend/`)

* **Next.js 16 (App Router)**: Manages research forms, real-time log streaming via SSE, and an editable data grid (TanStack Table v8).
* **Tailwind CSS 4**: Modern utility-first styling.
* **Firebase Auth**: Secure entry point for authenticated Ncademi researchers.
* **Accessibility**: WCAG 2.1 AA compliant, verified with `@axe-core/playwright`.

### B. API Orchestrator (`api/`)

* **FastAPI**: Validates OIDC/Bearer tokens, manages job state in **Cloud Firestore**, and enqueues research tasks via **Cloud Tasks**.
* **SSE (Server-Sent Events)**: Provides real-time progress logs to the frontend.
* **Admin CRUD**: REST endpoints for managing research candidates and finalized listings.
* **Deployment Constraint**: Pinned to `--max-instances 1` to preserve in-memory `validation_jobs` state.

### C. Processing Worker (`api/worker.py`)

* **Async Processing**: A separate Cloud Run service (Scale-to-Zero) handling crawling, LLM synthesis, and link resolution.
* **Isolation**: Callable only by Cloud Tasks via OIDC identity tokens.

### D. Core Business Logic (`nerd_core/`)

* **`services.py`**: Orchestrates Vertex AI GenAI SDK calls.
* **`link_validator_engine.py`**: A standalone, Playwright-based engine decoupled from the automated research path; reserved for on-demand administrative link checking to optimize cloud costs.
* **`generators.py`**: Contains core parsing logic and Jinja2-based HTML rendering.
* **`utils.py`**: General-purpose helpers and security utilities.

### E. Candidate/Product Data Storage — Local vs. Production (clarified 2026-07-09)

* **Production storage is exclusively Cloud Firestore**, collections `nerd_candidates`/`nerd_products` (`api/store.py`). There is no file-based storage in production; `upsert_candidate`/`upsert_product` never write to disk in either mode.
* **`LOCAL_MODE` uses an in-memory dict**, seeded **once at container startup** from JSON files in `CANDIDATES_DIR`/`PRODUCTS_DIR` (env-var configurable, default `~/nerd_data/candidates/` and `~/nerd_data/products/` — physically outside the repo per the FinOps directory-decoupling migration, to avoid triggering the Uvicorn reload watcher). Writes made during a local session (including via `save_as_candidate`) update this in-memory store only — they are **not** persisted back to the seed JSON files, and are lost on container restart.
* **As of 2026-07-09, production Firestore's `nerd_candidates` collection is empty (0 documents)**, confirmed via direct query. The 24 local seed files in `~/nerd_data/candidates/` are not a mirror or export of production data — their actual provenance/relationship to any past production state has not been established. Do not assume local seed data reflects, or has ever been pushed to, production.

## 3. Core Workflows

### A. Two-Stage Research

1. **Initial Research**: A broad sweep identifying core accessibility pages.
2. **Deep Dive**: Iterative extraction focusing on high-difficulty targets like `.edu` reviews or state-level registries.

### B. Link Resolution & Remediation

* **Mandatory Resolution**: All redirect URLs from Google Search Grounding are resolved to canonical destinations before storage.
* **On-Demand Validation**: High-fidelity browser validation is invoked **manually** by administrative users; it is no longer triggered by automated UI research workflows.
* **Known gap (flagged 2026-07-09, not yet fixed):** as of this date, 12 of 24 local seed candidate files were found to contain unresolved `grounding-api-redirect` markers, discovered only after fixing a stale test path that had silently prevented `tests/integrity/test_candidate_files.py::test_no_unresolved_redirects` from ever running against real data. Remediation via `scripts/rerun_redirect_candidates.py` (re-runs affected candidates through the live research pipeline) is in progress.

### C. Live Preview & Edit

Researchers can edit Pydantic-mapped listing data in real-time, triggering server-side Jinja2 re-renders for instant preview.

## 4. Multi-Layer Testing Strategy

Protected by a 4-layer validation suite (documented in `docs/TESTING.md`):

1. **Unit Tests**: `pytest` for parsers and schema validation.
2. **Integration Tests**: Validates API routes and SSE streaming.
3. **Data Integrity Tests**: Ensures 100% schema compliance and zero leaked proxy URLs.
4. **E2E Tests**: Automates the full UI lifecycle and WCAG compliance.

**Known test-suite issues (flagged 2026-07-09, partially fixed):** several tests contained stale references to functionality removed in earlier decisions (`ai_insights` synthesis, per Decision #18; the pre-relocation `link_validator_engine` import path, per the Phase 1 decoupling). `tests/integration/test_job_lifecycle.py` and `scripts/batch_processor.py` were fixed and verified this date. `tests/parser_robustness_test.py`, `tests/unit/test_generators.py` (2 tests), `tests/system_test.py`, and `tests/test_link_validator.py` still contain stale references as of this writing — see `fix_user_screwup.md` for full tracking.

## 5. Security Guardrails

### A. SSRF Mitigation

Hostnames are resolved to IP addresses before every request, blocking all traffic to internal GCP ranges or private networks.

### B. OIDC Handshake

Worker-to-API communication is authenticated via Google-signed OIDC tokens.

### C. Safe Parsing

Masking pattern protects long grounding tokens from LLM corruption during formatting.

**Known gap (flagged 2026-07-09, not yet fixed):** the lightweight httpx-based `liveness_validator.py` produces false-negative "dead link" results on sites that block non-browser traffic (confirmed on Zendesk help-center URLs and at least one nonprofit site, both returning `403` to real users but rejected by the validator as unreachable). Likely missing a realistic `User-Agent` header. Not yet fixed.

## 6. Telemetry & Analytics

Every event is logged to **BigQuery** (`edtech-agent-2026.telemetry.feedback_logs`). Administrative validation events are logged as distinct from automated research logs.

## 7. AI-Studio-Assisted Candidate Generation (added 2026-07-09)

To generate research drafts at zero GC Vertex AI cost, Google AI Studio's free tier can be used as a prompt-testing sandbox:

* `prompts/research_schema_prompt.txt` is a manually-maintained mirror of `prompts/system_prompt.j2`'s markdown output contract, meant for direct paste into AI Studio (model must be set to `gemini-2.5-flash` to match production; Google Search grounding tool required). **Not loaded by any code path** — manual reference only, will drift from `system_prompt.j2` if not updated together.
* `scripts/ingest_ai_studio_draft.py` validates an AI-Studio-generated markdown draft through the same `nerd_core` functions the real worker pipeline uses (`resolve_and_validate_all`, `filter_broken_links`, `parse_markdown_to_listing`, `adaptive_validate`, `is_likely_vpat_acr`), then submits via `POST /admin/candidates` on the running API — never writes to Firestore directly. Refuses to submit if both resource lists end up empty post-validation.
* **`scripts/migrate_to_firestore.py` is retired** (as of 2026-07-09) — it previously imported records from `eval/eval_data.json` (the eval Golden Set format) directly into `nerd_candidates`, but Golden Set records silently pass `ListingData` schema validation with empty resource lists (no `extra="forbid"` on the model), which would have overwritten real candidates with empty data. The script now hard-exits immediately with an explanatory error. Golden Set data belongs only in `eval/eval_data.json`, used by the `eval/` harness — never in the candidate pipeline.

Full incident history and remediation tracking: `fix_user_screwup.md` (not part of the committed repo — session working doc).

---

*N.E.R.D. System Architecture — Version 2.3 (post-AI-Studio-incident update)*

nerd/
├── api/                          # FastAPI orchestrator
│   ├── conversions.py
│   ├── job_store.py
│   ├── main.py
│   ├── schemas.py
│   ├── store.py
│   └── worker.py
├── nerd_core/                    # Shared business logic (api + worker)
│   ├── acr_validation.py
│   ├── adaptive_validation.py
│   ├── generators.py
│   ├── services.py
│   ├── telemetry.py
│   ├── utils.py
│   └── tools/
│       ├── liveness_validator.py    # known false-negative gap on bot-protected sites, see Section 5
│       └── administrative_validators/
│           └── link_validator_engine.py    # decoupled, on-demand only
├── frontend/                     # Next.js (App Router)
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── login/page.tsx
│   ├── components/
│   │   ├── InvalidLinksModal.tsx
│   │   ├── ListingCard.tsx
│   │   └── SectionEditor.tsx
│   ├── hooks/useResearch.ts
│   ├── lib/
│   │   ├── api.ts
│   │   ├── debugLog.ts
│   │   ├── firebase.ts
│   │   ├── ncademiPreview.ts
│   │   └── types.ts
│   ├── middleware.ts    # ⚠ Next.js flags this convention as deprecated in favor of "proxy" (2026-07-09) — not yet migrated
│   ├── tests/e2e/                # 5 Playwright specs: accessibility, animation_check, candidate_lifecycle, heartbeat_check, live_run
│   ├── AGENTS.md / CLAUDE.md    # ⚠ UNREVIEWED — same pattern as removed root-level claude.md; purpose/currency not yet confirmed
│   ├── Dockerfile
│   └── package.json
├── scripts/                      # Ops/migration scripts
│   ├── deploy.sh
│   ├── batch_processor.py
│   ├── crawler.py / scraper.py
│   ├── ingest_candidates.py / ingest_k12_urls.py    # URL-batch ingestion via /admin/candidates/batch
│   ├── ingest_ai_studio_draft.py    # NEW 2026-07-09 — validates + submits AI-Studio-generated drafts, see Section 7
│   ├── rerun_redirect_candidates.py    # NEW 2026-07-09 — re-runs candidates with unresolved redirects through the live pipeline
│   ├── migrate_archive_to_products.py / migrate_candidates.py
│   ├── migrate_to_firestore.py    # RETIRED 2026-07-09 — hard-exits immediately, see Section 7
│   ├── refresh_candidates.py / regenerate_candidates.py
│   ├── reprocess_redirects.py    # ⚠ resolves already-stored proxy tokens directly (often expired/fails); prefer rerun_redirect_candidates.py
│   ├── validate_migration.py / verify_gdocs.py / verify_production.py
│   ├── get_smoke_token.py
│   └── pull_from_drive.sh / sync_to_drive.sh
├── tests/
│   ├── unit/                     # api_utils, conversions, generators, liveness
│   ├── integration/               # admin_api, job_lifecycle, sse_api, worker_idempotency
│   ├── integrity/                 # inventory_candidates, candidate_files
│   ├── smoke/
│   ├── migration_verification.py
│   └── e2e_live_validation.py, system_test.py, parser_robustness_test.py, service_robustness_test.py, test_sse.py, test_link_validator.py    # ⚠ several contain stale references, see Section 4
├── templates/                    # Jinja2 (preview-only, not publishing artifacts)
│   ├── ncademi_listing.html
│   ├── ncademi_wp_fragment.html
│   ├── batch_report.html
│   ├── link_validator.html
│   └── nerd.css
├── prompts/                      # Gemini/LLM prompt templates
│   ├── system_prompt.j2 / delta_system_prompt.j2    # live, loaded by nerd_core/services.py
│   ├── research_schema_prompt.txt    # NEW — AI Studio sandbox mirror, see Section 7
│   ├── optimized_instructions.json / optimized_instructions_diff.txt    # eval/dspy optimization artifacts, not live-request path
│   └── (synthesis_prompt.j2 DELETED 2026-07-09 — orphaned, zero live callers)
├── eval/                         # promptfoo-based eval harness
│   ├── assertions.py / provider.py / optimize.py
│   ├── build_grounding_cache.py
│   ├── eval_data.json    # Golden Set ground-truth data — NEVER a source for the candidate pipeline, see Section 7
│   └── promptfooconfig.yaml
├── docs/
│   ├── NERD_System_Architecture.md
│   ├── architecture_evolution.md
│   ├── DECISION_LOG.md
│   ├── TESTING.md
│   ├── EDTECH_AGENT_LOGIC.md
│   ├── GOLDEN_SET.md
│   ├── SECTION_EDITOR_RESEARCH.md
│   └── decision-log-6-14-26.rtf / extensions.md / streamlit.md    # ⚠ UNREVIEWED — likely stale (streamlit.md especially, given Streamlit's full removal), not yet confirmed
├── ncademi-viewer/                # ⚠ UNREVIEWED — purpose not established, not referenced anywhere in this doc or Decision Log prior to 2026-07-09
├── archive/                      # superseded docs/handover files — NOT live reference
├── ncademi_archive/               # 44 scraped clean_content/ + 44 raw_html/ product HTML snapshots
├── artifacts/                    # 190 generated PNGs (test/screenshot output)
├── storage/                      # Crawlee request-queue/key-value state
├── constraints.txt
├── requirements.txt / requirements-worker.txt / requirements-eval.txt
├── Dockerfile.api / Dockerfile.worker
├── pytest.ini
└── README.md

**Root-level clutter not enumerated above** (stray logs, one-off report `.md`/`.txt` files, `.test_env/`, `new_folder_name`): tracked separately as a pending Tier 1 cleanup pass, not yet executed as of this update. See prior session logs for full inventory.