# System Design Document: N.E.R.D.

**NCADEMI EdTech Research & Documentation** *Last Updated: August 25, 2026*

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
* **Routes**: `/` (redirects to `/editor` as of the v1.0 hygiene pass — see [Decision #38](DECISION_LOG.md#38-directory-hygiene-pass-v10)), `/editor` (canonical visual editor for published/added/candidate product data — see §3.F), `/vendors` (visual editor for the global vendor registry — see §3.F), `/researcher` (seeded product-tracking table), `/tables` (read-only AppSheet recovery tables; its `/tables/published` raw-JSON-editor child route is retired, archived to `docs/superseded/legacy_published_json_page.tsx` — see §3.F), `/users` (user directory, no auth gate yet — MVP-stage, see [Decision #29](DECISION_LOG.md#29-security-posture--deferred-until-public-deployment)), `/login`.
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
* **`tools/liveness_validator.py`**: hardened against bot-protected sites (realistic User-Agent header, `urljoin`-based relative-redirect resolution). Regression-tested in `tests/unit/test_liveness.py`.
* **`tools/administrative_validators/link_validator_engine.py`**: **deleted** as of the v1.0 hygiene pass ([Decision #38](DECISION_LOG.md#38-directory-hygiene-pass-v10)) — it was dead code carrying real build cost (`crawlee[playwright]` in `requirements.txt` for this alone, with `playwright install` never actually run in `Dockerfile.api`, so the "Playwright support" the Dockerfile used to claim never existed). Both the dependency and the Dockerfile claim were removed in the same pass. `tests/test_link_validator.py` still imports this module by its old path and will now fail with `ModuleNotFoundError` rather than the pre-existing stale-path failure noted in §4 — it was not updated as part of this hygiene pass.

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

* **Redirect resolution is real**: `resolve_and_validate_url` returns `ValidationResult.resolved_url` — the terminal destination after following redirects — not the input URL. `grounding-api-redirect` URLs from Google Search Grounding are resolved to their real destination before persisting into stored listings, on both the live research path and Import Data.
* **On-demand validation**: the high-fidelity browser validation engine (`link_validator_engine.py`) that would have provided this was never wired into any live path and has since been deleted — see §2.D.
* 12 of the local seed candidate files were written before the redirect-resolution fix and still carry unresolved `grounding-api-redirect` markers from that earlier state. This is now a data-remediation task, not a mechanism bug — `scripts/rerun_redirect_candidates.py` backfills them; tracked separately, not urgent under current scope.

### D. Live Preview & Edit

Researchers edit Pydantic-mapped listing data in real time, either via per-section HTML overrides or by re-importing a corrected draft; `POST /render` re-renders server-side via Jinja2 for preview.

### E. NCADEMI Products Viewer (retired prototype)

A distinct workstream from Import Data / Generate Listing, previously tracked independently of the Generate Listing deferral (Decision #30). Fully superseded by the `/editor` + `/vendors` suite described in §3.F; archived in the v1.0 hygiene pass ([Decision #38](DECISION_LOG.md#38-directory-hygiene-pass-v10)) as a redundant prototype. Planning artifacts now live under `docs/superseded/ncademi-viewer/` (moved from the repo-root `ncademi-viewer/`) — see `docs/superseded/ncademi-viewer/NCADEMI Full Architecture & Codebase.md` for the retired design.

### F. Local Editor Suite (`/editor`, `/vendors`) & Vendor Registry (current, v1.0)

Introduced to replace three separate, inconsistent surfaces — the 1000+ line legacy `/` page (Generate Listing/Import Data editor mixed with AppSheet-recovery browsing), the raw-JSON `/tables/published` editor, and the abandoned `ncademi-viewer/` prototype (§3.E) — with one consistent visual-editing pattern. See [Decision #37](DECISION_LOG.md#37-editor-consolidation--vendor-registry).

* **`/editor`** (`frontend/app/editor/page.tsx`): visual editor over three parallel documents — `published.json`, `added.json`, and `candidate.json` — fetched concurrently client-side via `Promise.allSettled` so one document's fetch failure degrades only that tab. A single `activeTab` value (shared type with `EditorSidebar.tsx`) drives which `/api/local/*` endpoint, in-memory array, and ETag a save targets.
* **`/vendors`** (`frontend/app/vendors/page.tsx`): visual editor over the single global vendor registry document, `frontend/lib/vendors.json`. Structurally simpler than `/editor` (one document, no tab routing). As of this pass, "Save vendor" and "Delete vendor" are fully implemented; the four structured field-editor stubs (Header, Global Resources, Product/s, Support) are not yet built — vendor records are still edited as raw fields, not through `PublishedProductRecord`-style per-section editors.
* **Local-write API** (`frontend/app/api/local/{published,added,candidate,vendors}/route.ts`, backed by `frontend/lib/local-write.ts`): the server-side persistence layer both pages share.
  * **Gated to local development only** — `assertLocalOnly()` requires `NODE_ENV !== "production"` AND `NEXT_PUBLIC_DISABLE_AUTH === "true"`, both must hold. Returns a bare 404 (not 403) when blocked, so the route is indistinguishable from nonexistent in any environment where it shouldn't run.
  * **ETag concurrency pattern**: `GET` reads the target JSON file fresh from disk on every call (never the frozen static import used elsewhere in the app) and returns it with a strong ETag — the SHA-256 hash of the exact bytes on disk. `POST` requires an `If-Match` header equal to that ETag; a mismatch (the file changed on disk since the client's last read — an IDE edit, a git checkout, a concurrent save) is rejected with `412 Precondition Failed` rather than silently overwriting. A successful `POST` returns the new ETag so the client can continue editing without a re-fetch.
  * **Atomic, durable writes**: `writePublishedAtomic()` writes to a sibling temp file, `fsync`s it, `rename()`s it over the target (atomic on the same filesystem), then `fsync`s the parent directory too — so a crash mid-write can never leave a truncated file, and a crash between rename and directory-flush can't resurrect the old file on an unclean reboot.
  * **No path-traversal surface by construction**: every handler takes a closed-union `DataKind` (`"published" | "added" | "candidate" | "vendors"`) mapped to a fixed filename, never a filename built from request input — there is no string to sanitize because no request-controlled string ever reaches the filesystem path.
  * A fifth route, `/api/local/migrate-appsheet`, is a one-off bootstrap (POST-only, no ETag check by design — it's a deliberate overwrite, not the concurrent-edit path) that seeds `added.json`/`candidate.json` from the legacy AppSheet global table.
* **`vendors.json`** (`frontend/lib/vendors.json`): the global vendor registry, schema defined in `frontend/lib/vendor-schema.ts` (`VendorRecord`/`VendorResource`/`VendorsFile`). Populated by `scripts/scrape_vendors.py`, which crawls each vendor's own NCADEMI directory page starting from the deduplicated `vendor_directory_url`s in a products JSON file. `scripts/dedupe_vendor_resources.py` then strips a product's own `vendor_resources` entries that exactly duplicate a URL already captured under that same vendor in `vendors.json` (matched by `(vendor_name, url)`), so the frontend doesn't have to de-duplicate at render time.

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

**Fixed:** the lightweight httpx-based `liveness_validator.py` previously produced false-negative "dead link" results on sites that block non-browser traffic (no `Location` header `urljoin` for relative redirects, no realistic `User-Agent`). Both are fixed — a realistic `User-Agent` header and `urljoin`-based relative-redirect resolution are in place, with regression coverage in `tests/unit/test_liveness.py`. `adaptive_validate` (Import Data path) and the live research path both benefit.

## 6. Telemetry & Analytics

Every event is logged to **BigQuery** (`edtech-agent-2026.telemetry.feedback_logs`). Administrative validation events are logged as distinct from automated research logs.

## 7. AI-Studio-Assisted Candidate Generation

To generate research drafts at zero Vertex AI cost, Google AI Studio's free tier can be used as a prompt-testing sandbox:

* `prompts/GEM-instructions.txt` (moved from the repo root in the v1.0 hygiene pass, [Decision #38](DECISION_LOG.md#38-directory-hygiene-pass-v10)) is the full role/formatting-rules prompt for the Gemini Gem referenced in §3.A — the "digital accessibility documentation researcher" persona that takes a single product URL and returns one Markdown candidate profile for a human researcher to review.
* `prompts/research_schema_prompt.txt` is a manually-maintained mirror of `prompts/system_prompt.j2`'s markdown output contract, meant for direct paste into AI Studio (model must be set to `gemini-2.5-flash`; Google Search grounding tool required). **Not loaded by any code path** — manual reference only, will drift from `system_prompt.j2` if not updated together.
* `scripts/ingest_ai_studio_draft.py` validates an AI-Studio-generated draft through the same `nerd_core.pipeline.validate_draft` the API's `/ingest/draft` endpoint now also calls, then submits via `POST /admin/candidates`. Refuses to submit if both resource lists end up empty post-validation.
* `docs/superseded/migrate_to_firestore.py` (archived from `scripts/` in the v1.0 hygiene pass, [Decision #38](DECISION_LOG.md#38-directory-hygiene-pass-v10)) is **retired** — it previously imported Golden Set records (`eval/eval_data.json`) directly into `nerd_candidates`, which silently passed schema validation with empty resource lists and would have overwritten real candidates. Its `main()` hard-exits immediately with an error message before doing anything else. Golden Set data belongs only in `eval/` — never in the candidate pipeline. Kept as reference for if/when this migration path needs to be rebuilt for the cloud, not deleted outright.

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
│       ├── liveness_validator.py    # hardened (User-Agent + redirect resolution), see §5
│       └── administrative_validators/   # link_validator_engine.py deleted, see §2.D
├── frontend/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                  # redirects to /editor, see §3.F
│   │   ├── editor/page.tsx            # /editor — canonical visual editor, see §3.F
│   │   ├── vendors/page.tsx           # /vendors — vendor registry editor, see §3.F
│   │   ├── api/local/                 # local-write API, see §3.F
│   │   │   ├── published/route.ts
│   │   │   ├── added/route.ts
│   │   │   ├── candidate/route.ts
│   │   │   ├── vendors/route.ts
│   │   │   └── migrate-appsheet/route.ts
│   │   ├── login/page.tsx
│   │   ├── researcher/page.tsx        # /researcher
│   │   ├── tables/page.tsx            # /tables (its /tables/published child route is retired, see §3.E/§3.F)
│   │   └── users/                     # /users (page.tsx + layout.tsx)
│   ├── components/
│   │   ├── ImportDataModal.tsx / ImportJsonModal.tsx
│   │   ├── ListingCard.tsx
│   │   ├── ResearcherTable.tsx / AppsheetSortableTable.tsx
│   │   ├── SectionEditor.tsx
│   │   ├── EditorSidebar.tsx          # /editor tab routing, see §3.F
│   │   ├── VendorSidebar.tsx / VendorPreview.tsx   # /vendors, see §3.F
│   │   ├── PublishedHeaderEditor.tsx / PublishedAcrEditor.tsx / PublishedOtherResourcesEditor.tsx / PublishedSupportEditor.tsx / PublishedVendorResourcesEditor.tsx   # per-section field editors, /editor's published tab
│   │   └── Delete{Added,Candidate,Published}Modal.tsx
│   ├── hooks/useResearch.ts
│   ├── lib/
│   │   ├── appsheet-tables.json / appsheet-tables.ts   # /tables data layer
│   │   ├── published.json / published-tables.ts / added.json / candidate.json   # /editor's three documents, see §3.F
│   │   ├── vendors.json / vendor-schema.ts             # /vendors registry + schema, see §3.F
│   │   ├── local-write.ts             # ETag/atomic-write local persistence layer, see §3.F
│   │   ├── published-validate.ts      # field-by-field validation for the published tab's save path
│   │   ├── editor-preview.ts
│   │   ├── debugLog.ts
│   │   ├── firebase.ts
│   │   ├── ncademiPreview.ts
│   │   ├── researcher-records.json / researcher-records.ts   # /researcher data layer
│   │   ├── types.ts
│   │   └── users.ts
│   ├── tests/e2e/                 # 5 Playwright specs
│   ├── proxy.ts                   # renamed from middleware.ts, Next.js 16 deprecation fix
│   ├── Dockerfile
│   └── package.json
├── scripts/                      # Ops/migration scripts
│   ├── deploy.sh
│   ├── batch_processor.py
│   ├── crawler.py / scraper.py
│   ├── ingest_candidates.py / ingest_k12_urls.py
│   ├── ingest_ai_studio_draft.py   # see §7
│   ├── scrape_vendors.py           # builds vendors.json, see §3.F
│   ├── dedupe_vendor_resources.py  # see §3.F
│   ├── fix_appsheet_candidate_vendor.py
│   ├── rerun_redirect_candidates.py
│   ├── migrate_archive_to_products.py / migrate_candidates.py
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
│   └── e2e_live_validation.py, system_test.py, parser_robustness_test.py, service_robustness_test.py, test_sse.py, test_link_validator.py   # some contain stale references, see §4 — test_link_validator.py's import target no longer exists at all
├── templates/                    # Jinja2 (preview only, not a publishing artifact)
│   ├── ncademi_listing.html
│   ├── ncademi_wp_fragment.html
│   ├── batch_report.html
│   ├── link_validator.html       # orphaned — its only consumer, link_validator_engine.py, was deleted (§2.D); not yet removed
│   └── nerd.css
├── prompts/
│   ├── system_prompt.j2 / delta_system_prompt.j2
│   ├── research_schema_prompt.txt   # AI Studio sandbox mirror, see §7
│   ├── GEM-instructions.txt         # Gemini Gem researcher persona, see §7
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
│   └── superseded/                # historical docs, spent dispatch prompts, reports, and retired code
│                                    # (e.g. ncademi-viewer/, legacy_root_page.tsx, legacy_published_json_page.tsx,
│                                    # migrate_to_firestore.py, vendor_schema_proposal.ts) that no longer reflect
│                                    # the codebase — not `docs/archive/`, see Decision #33
├── constraints.txt
├── requirements.txt / requirements-worker.txt / requirements-eval.txt
├── Dockerfile.api / Dockerfile.worker
├── pytest.ini
└── README.md
```

Directories present locally but not reflected above (gitignored, not part of the tracked repo): `ncademi_archive/` (scraped product HTML snapshots), `artifacts/` (generated screenshot output), `storage/` (Crawlee request-queue state), `~/nerd_data/` (local-mode Firestore seed data).

---

*N.E.R.D. System Architecture — Version 4.0*
> **Provenance:** Field-level schema recovered from `NCADEMI-Agent-Design-Document.md` (archived 2026-06-11 design doc for a since-abandoned conversational-agent concept; the design doc itself is not retained — see `docs/DECISION_LOG.md`). Only this schema section survives, since it documents the live ncademi.org directory's actual field structure, which N.E.R.D. generates content for, and no equivalent schema documentation existed elsewhere in this doc prior to this addition.

## 9. Domain Model: NCADEMI Directory Product Schema

The NCADEMI EdTech Directory at ncademi.org publishes each product listing against a consistent schema. N.E.R.D. researches, validates, and generates content against these same fields, so this schema is the ground truth for what a complete listing requires.

### 9.1 Exemplar: Canvas LMS

The Canvas LMS listing is the reference exemplar for this schema. It demonstrates a fully-populated entry and is used throughout this document to illustrate expected data fields.

| Product name | Canvas LMS |
| :---- | :---- |
| Vendor | Instructure (linked to vendor profile page within the directory) |
| Description | Canvas is a learning management system (LMS) developed by Instructure that provides educators and students with tools for course management, online learning, and collaboration. |
| Product website | https://www.instructure.com/canvas |

### 9.2 Complete Field Schema

### Field 1: Product Identification

| Product name | Page title; no subtitle or tagline. |
| :---- | :---- |
| Vendor | Optional. Linked reference to a separate vendor profile page. Not present on all listings. |
| Description | One to three sentences. Neutral, encyclopedic. No accessibility content. |
| Product website | Single URL to the vendor’s official product homepage. |

### Field 2: Accessibility Documentation & Resources

This section is divided into two sub-sections:

| From [Vendor] | Official resources published by the vendor. Each entry includes link text, URL, and optional media type indicator (e.g., "Video"). When no vendor resources are found, the listing states this explicitly. |
| :---- | :---- |
| From Other Sources | Third-party resources such as university accessibility guides, disability organization tutorials, blog posts, and webinar recordings. Each entry includes link text and URL. |

Resource types observed across the directory include:

* Accessibility statements and commitment pages

* Help articles and knowledge base entries (FAQ, how-to)

* Video tutorials and demos (typically YouTube-hosted)

* Community forum threads and category hubs

* Infographics and blog posts

* University and institutional accessibility guides

* K-12 district blog posts and tutorials

* Screen reader-specific guides (JAWS, NVDA, VoiceOver)

* Low vision and braille-specific resources

### Field 3: Support

| Support contacts | One or more of: accessibility-specific email address, help center URL, support request form link. The Canvas LMS exemplar provides a dedicated accessibility support email: support_a11y@instructure.com. |
| :---- | :---- |

### Field 4: Accessibility Conformance Reports (ACRs / VPATs)

This is the most structured field in the schema. Each ACR entry includes:

| Report title | Linked to the ACR document (PDF, web page, or trust portal). |
| :---- | :---- |
| VPAT version | e.g., 2.4, 2.5, 2.5 Rev |
| Date completed | Month and year of the evaluation. |
| Evaluating organization | Optional. Named and linked when disclosed (e.g., WebAIM for Canvas LMS, Deque Systems for Adobe Acrobat). |

Variation patterns observed across the directory:

* Some products have multiple ACRs covering different platforms (e.g., iOS, Android, web, mobile app, desktop)

* Some products have no ACR on file. In these cases the listing states: “No Accessibility Conformance Report information found, contact vendor for more information.”

* Some ACR links require access to a vendor trust portal (e.g., ChatGPT), which is noted in the listing

* The evaluating organization field is not consistently populated

### Field 5: Metadata

| Last updated | Plain-text date stamp at the bottom of the content area indicating the last editorial review. Format: “Product information last updated [Month Day, Year].” |
| :---- | :---- |

