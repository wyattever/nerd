# System Design Document: N.E.R.D.

**NCADEMI EdTech Research & Documentation** *Last Updated: August 20, 2026*

## 1. Executive Summary

N.E.R.D. is a distributed, three-tier research platform designed to retrieve, validate, and format digital accessibility documentation for EdTech products. It automates the generation of NCADEMI-branded HTML fragments and JSON research artifacts using Google Vertex AI (Gemini 2.5 Flash) with Google Search Grounding.

**Current scope:** active development is limited to the **Import Data** path — validating and parsing an externally-generated (Gemini Gem) Markdown draft through the shared pipeline, not triggering new live research runs. See §3.A and [Decision #30](DECISION_LOG.md#30-generate-listing--deferred-import-data-is-the-active-path).

## 2. Distributed Architecture

The system utilizes a scalable, asynchronous architecture on Google Cloud Run.

### A. Frontend (`frontend/`)

* **Next.js 16 (App Router)**: research/import forms, real-time log streaming via SSE, and per-section HTML override editing.
* **Tailwind CSS 4**: utility-first styling.
* **Firebase Auth**: entry point for authenticated NCADEMI researchers.
* **Accessibility**: WCAG 2.2 AA is a hard requirement, built in from the start — not bolted on. Verified with `@axe-core/playwright`.
* **Routes**: `/` (Generate Listing / Import Data editor — see §3.A), `/researcher` (seeded product-tracking table), `/tables` (read-only AppSheet recovery tables), `/users` (user directory, no auth gate yet — MVP-stage, see [Decision #29](DECISION_LOG.md#29-security-posture--deferred-until-public-deployment)), `/login`.
* **Data grids**: hand-rolled sortable tables (`ResearcherTable.tsx`, the generic pattern reused across `/researcher` and `/tables`), not a third-party grid library. An earlier TanStack Table-based `ResourceGrids` component caused the SSE re-render performance issue documented in `docs/superseded/UI_DIAGNOSTICS.md` and is no longer present in the codebase.

### B. API Orchestrator (`api/`)

* **FastAPI**: validates Bearer tokens (Firebase ID tokens in production, short-circuited in `LOCAL_MODE`), manages job state in **Cloud Firestore**, enqueues research tasks via **Cloud Tasks**, and serves `POST /ingest/draft` — the Import Data endpoint, synchronous, no job/Cloud Tasks involvement.
* **SSE (Server-Sent Events)**: real-time progress logs to the frontend, for the (currently deferred) live research path.
* **Admin CRUD**: REST endpoints for candidates and finalized listings. `POST`/`PUT /admin/candidates` accept `schemas.CandidateRecord` (not `schemas.ListingData`), so `raw_markdown` survives persistence — see [Decision #31](DECISION_LOG.md#31-candidate-persistence--candidaterecord-adopted-on-saveupdate-raw_markdown-preserved).
* **Deployment constraint**: pinned to `--max-instances 1` to preserve in-memory `validation_jobs` state.

### C. Processing Worker (`api/worker.py`)

* **Async processing**: a separate Cloud Run service (scale-to-zero) handling crawling, LLM synthesis, and link resolution for live research runs.
* **Isolation**: callable only by Cloud Tasks via OIDC identity tokens. Authenticates to Vertex AI/Gemini and Firestore via Application Default Credentials — never a `GEMINI_API_KEY` secret, which differs intentionally from `nerd-api`. See [Decision #28](DECISION_LOG.md#28-worker-auth--adc-only-no-gemini_api_key-on-nerd-worker).

### D. Core Business Logic (`nerd_core/`)

* **`pipeline.py`**: the shared validate-and-build sequence (`validate_links()`, `build_listing()`, `validate_draft()`) extracted from what was previously duplicated between `api/worker.py` and `scripts/ingest_ai_studio_draft.py`. Both the live worker path and `POST /ingest/draft` call through this module — a fix to one benefits the other. Full extraction rationale and build sequencing: `docs/nerd-import-data-architecture-v4.md` §4.1, §11.
* **`services.py`**: orchestrates the Vertex AI GenAI SDK calls (live research path only).
* **`generators.py`**: parsing logic and Jinja2-based HTML rendering.
* **`acr_validation.py` / `adaptive_validation.py`**: ACR/VPAT plausibility checks and per-resource liveness validation.
* **`utils.py`**: general-purpose helpers and security utilities (SSRF-safe URL resolution, redirect handling).
* **`tools/liveness_validator.py`**: known false-negative gap on bot-protected sites, see §5.
* **`tools/administrative_validators/link_validator_engine.py`**: a standalone, Playwright-based engine. **Currently dead code carrying real build cost** — `crawlee[playwright]` sits in `requirements.txt` for this alone, and `playwright install` is never run in `Dockerfile.api`, so the "Playwright support" the Dockerfile claims doesn't actually exist. Pending an archive/delete decision.

### E. Candidate/Product Data Storage — Local vs. Production

* **Production storage is exclusively Cloud Firestore**, collections `nerd_candidates`/`nerd_products` (`api/store.py`). There is no file-based storage in production; `upsert_candidate`/`upsert_product` never write to disk in either mode.
* **`LOCAL_MODE` uses an in-memory dict**, seeded once at container startup from JSON files in `CANDIDATES_DIR`/`PRODUCTS_DIR` (env-var configurable, default `~/nerd_data/candidates/` and `~/nerd_data/products/` — physically outside the repo, to avoid triggering the Uvicorn reload watcher). Writes made during a local session update this in-memory store only — not persisted back to the seed JSON files, lost on container restart.
* Production Firestore's `nerd_candidates` collection was confirmed empty as of 2026-07-09. Local seed files are not established to be a mirror of any past production state — do not assume otherwise.

## 3. Core Workflows

### A. Import Data (current, active)

Paste a Gemini-Gem-generated Markdown research draft into the UI; `POST /ingest/draft` runs it through `nerd_core/pipeline.py`'s `validate_draft()` (link validation → parse → adaptive resource validation → ACR plausibility check) and returns a `ListingData` plus diagnostics. The result loads into the same editor surface a live research run would use — `ImportDataModal.tsx` is the only new UI surface; everything downstream (section editors, Copy/Download HTML, Save Candidate) is shared. Full spec: `docs/nerd-import-data-architecture-v4.md`.

### B. Generate Listing — Two-Stage Research (deferred)

1. **Initial Research**: a broad sweep identifying core accessibility pages.
2. **Deep Dive**: iterative extraction focusing on high-difficulty targets like `.edu` reviews or state-level registries.

Triggering a *new* run via this path (`/research/initial`, `/research/deep-dive`, the SSE streaming UI, Cloud Tasks dispatch) is out of scope for now — see [Decision #30](DECISION_LOG.md#30-generate-listing--deferred-import-data-is-the-active-path). The code is intact and shares `nerd_core/pipeline.py` with the Import Data path, so nothing here needs to be re-architected to bring it back — the deep-dive frontend caller is currently absent, which is the actual blocker.

### C. Link Resolution & Remediation

* **Mandatory resolution intent, not yet real**: `resolve_and_validate_url` currently always returns the *input* URL rather than the resolved destination — redirect resolution is effectively a no-op at the implementation level, despite the design intent. `grounding-api-redirect` URLs from Google Search Grounding persist verbatim into stored listings as a result. This affects both the live research path and, at lower volume, Import Data (a pasted Gem draft can itself contain grounding-redirect URLs if the Gem session used Search grounding).
* **On-demand validation**: high-fidelity browser validation (`link_validator_engine.py`) is not currently wired into any live path — see §2.D.
* 12 of the local seed candidate files are known to carry unresolved `grounding-api-redirect` markers; remediation via `scripts/rerun_redirect_candidates.py` is tracked separately, not urgent under current scope.

### D. Live Preview & Edit

Researchers edit Pydantic-mapped listing data in real time, either via per-section HTML overrides or by re-importing a corrected draft; `POST /render` re-renders server-side via Jinja2 for preview.

## 4. Multi-Layer Testing Strategy

Protected by a 4-layer validation suite (documented in `docs/TESTING.md`):

1. **Unit Tests**: `pytest` for parsers, schema validation, and pipeline equivalence (`tests/unit/test_pipeline_equivalence.py` — asserts `nerd_core.pipeline.validate_draft` matches the pre-extraction worker behavior field-for-field, unmocked).
2. **Integration Tests**: API routes, SSE streaming, and `POST /ingest/draft` (`tests/integration/test_ingest_draft_api.py`).
3. **Data Integrity Tests**: schema compliance and unresolved-redirect scanning.
4. **E2E Tests**: full UI lifecycle and WCAG compliance via Playwright.

**Known test-suite issues:** several older tests still contain stale references to functionality removed in earlier decisions (`ai_insights`, per Decision #18; a pre-relocation `link_validator_engine` import path). Not yet fully swept — see `tests/parser_robustness_test.py`, `tests/system_test.py`, `tests/test_link_validator.py`.

## 5. Security Guardrails

### A. SSRF Mitigation

Hostnames are resolved to IP addresses before every request, blocking traffic to internal GCP ranges or private networks.

### B. OIDC Handshake

Worker-to-API communication is authenticated via Google-signed OIDC tokens.

### C. Safe Parsing

Masking pattern protects long grounding tokens from LLM corruption during formatting.

**Known gap, not yet fixed:** the lightweight httpx-based `liveness_validator.py` produces false-negative "dead link" results on sites that block non-browser traffic — no `Location` header `urljoin` for relative redirects, and no realistic `User-Agent`. Both fixes are scoped and pending (Tier 0, Import Data path — `adaptive_validate` calls this validator, so a pasted Gem draft can have valid resources silently stripped today).

## 6. Telemetry & Analytics

Every event is logged to **BigQuery** (`edtech-agent-2026.telemetry.feedback_logs`). Administrative validation events are logged as distinct from automated research logs.

## 7. AI-Studio-Assisted Candidate Generation

To generate research drafts at zero Vertex AI cost, Google AI Studio's free tier can be used as a prompt-testing sandbox:

* `prompts/research_schema_prompt.txt` is a manually-maintained mirror of `prompts/system_prompt.j2`'s markdown output contract, meant for direct paste into AI Studio (model must be set to `gemini-2.5-flash`; Google Search grounding tool required). **Not loaded by any code path** — manual reference only, will drift from `system_prompt.j2` if not updated together.
* `scripts/ingest_ai_studio_draft.py` validates an AI-Studio-generated draft through the same `nerd_core.pipeline.validate_draft` the API's `/ingest/draft` endpoint now also calls, then submits via `POST /admin/candidates`. Refuses to submit if both resource lists end up empty post-validation.
* `scripts/migrate_to_firestore.py` is **retired** — it previously imported Golden Set records (`eval/eval_data.json`) directly into `nerd_candidates`, which silently passed schema validation with empty resource lists and would have overwritten real candidates. It now hard-exits immediately. Golden Set data belongs only in `eval/` — never in the candidate pipeline.

## 8. Repository Layout

```
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
│   ├── pipeline.py                # shared validate-and-build sequence, see §2.D
│   ├── services.py
│   ├── telemetry.py
│   ├── utils.py
│   └── tools/
│       ├── liveness_validator.py    # known false-negative gap, see §5
│       └── administrative_validators/
│           └── link_validator_engine.py    # dead code, pending archive/delete decision
├── frontend/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                  # Generate Listing / Import Data editor
│   │   ├── login/page.tsx
│   │   ├── researcher/page.tsx        # /researcher
│   │   ├── tables/page.tsx            # /tables
│   │   └── users/                     # /users (page.tsx + layout.tsx)
│   ├── components/
│   │   ├── ImportDataModal.tsx
│   │   ├── InvalidLinksModal.tsx      # dormant, tied to removed link-validation UI
│   │   ├── ListingCard.tsx
│   │   ├── ResearcherTable.tsx
│   │   └── SectionEditor.tsx
│   ├── hooks/useResearch.ts
│   ├── lib/
│   │   ├── appsheet-tables.json / appsheet-tables.ts   # /tables data layer
│   │   ├── api.ts                    # dead code, flagged for deletion — see v4 arch doc §7.3
│   │   ├── debugLog.ts
│   │   ├── firebase.ts
│   │   ├── ncademiPreview.ts
│   │   ├── researcher-records.json / researcher-records.ts   # /researcher data layer
│   │   ├── types.ts
│   │   └── users.ts
│   ├── tests/e2e/                 # 5 Playwright specs
│   ├── middleware.ts              # ⚠ Next.js deprecation warning — "proxy" convention not yet migrated
│   ├── Dockerfile
│   └── package.json
├── scripts/                      # Ops/migration scripts
│   ├── deploy.sh
│   ├── batch_processor.py
│   ├── crawler.py / scraper.py
│   ├── ingest_candidates.py / ingest_k12_urls.py
│   ├── ingest_ai_studio_draft.py   # see §7
│   ├── rerun_redirect_candidates.py
│   ├── migrate_archive_to_products.py / migrate_candidates.py
│   ├── migrate_to_firestore.py     # RETIRED, see §7
│   ├── refresh_candidates.py / regenerate_candidates.py
│   ├── reprocess_redirects.py      # prefer rerun_redirect_candidates.py
│   ├── validate_migration.py / verify_gdocs.py / verify_production.py
│   ├── get_smoke_token.py
│   └── pull_from_drive.sh / sync_to_drive.sh
├── tests/
│   ├── unit/                       # api_utils, conversions, generators, liveness, pipeline_equivalence
│   ├── integration/                 # admin_api, ingest_draft_api, job_lifecycle, sse_api, worker_idempotency
│   ├── integrity/                   # inventory_candidates, candidate_files
│   ├── smoke/
│   └── e2e_live_validation.py, system_test.py, parser_robustness_test.py, service_robustness_test.py, test_sse.py, test_link_validator.py   # some contain stale references, see §4
├── templates/                    # Jinja2 (preview only, not a publishing artifact)
│   ├── ncademi_listing.html
│   ├── ncademi_wp_fragment.html
│   ├── batch_report.html
│   ├── link_validator.html
│   └── nerd.css
├── prompts/
│   ├── system_prompt.j2 / delta_system_prompt.j2
│   ├── research_schema_prompt.txt   # AI Studio sandbox mirror, see §7
│   └── optimized_instructions.json / optimized_instructions_diff.txt
├── eval/                         # promptfoo-based eval harness
│   ├── assertions.py / provider.py / optimize.py
│   ├── build_grounding_cache.py
│   ├── eval_data.json            # Golden Set — never a source for the candidate pipeline
│   └── promptfooconfig.yaml
├── docs/
│   ├── NERD_System_Architecture.md
│   ├── DECISION_LOG.md
│   ├── nerd-import-data-architecture-v4.md   # Import Data feature spec, cited throughout the codebase
│   ├── TESTING.md
│   ├── architecture_evolution.md
│   ├── extensions.md
│   ├── GOLDEN_SET.md
│   ├── SECTION_EDITOR_RESEARCH.md
│   ├── appsheet-export/           # raw AppSheet JSON recovery data, provenance for /tables
│   ├── appsheet-source-html/      # hand-built HTML the /tables fragments were extracted from
│   └── superseded/                # historical docs, spent dispatch prompts, and reports that no
│                                    # longer reflect the codebase — not `docs/archive/`, see Decision #33
├── constraints.txt
├── requirements.txt / requirements-worker.txt / requirements-eval.txt
├── Dockerfile.api / Dockerfile.worker
├── pytest.ini
└── README.md
```

Directories present locally but not reflected above (gitignored, not part of the tracked repo): `ncademi_archive/` (scraped product HTML snapshots), `artifacts/` (generated screenshot output), `storage/` (Crawlee request-queue state), `~/nerd_data/` (local-mode Firestore seed data).

---

*N.E.R.D. System Architecture — Version 3.0*