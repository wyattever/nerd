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

---

## Security

### 29. SECURITY POSTURE — Deferred until public deployment.
- **Decision:** N.E.R.D. is MVP-stage, running on a local server only. Feature-level security hardening — e.g. adding an auth gate to `/users`, closing access-control gaps on other net-new routes — is deferred until the app is published to the web.
- **Scope/exception:** Does not relax #27 (`LOCAL_MODE` / `NEXT_PUBLIC_DISABLE_AUTH` must never reach deployed environments) or #28 (worker auth via ADC only). Those guardrails exist specifically to stop local-dev conveniences from leaking into a deployed environment — see the 2026-07-08 incident logged under #27 — and remain in force regardless of this project's current stage.
- **Rationale:** No value in hardening auth/access-control for routes and features not yet exposed to the public internet. Revisit before any public launch.
- **Status:** SETTLED.

---

## Current Scope

### 30. GENERATE LISTING — Deferred; Import Data is the active path.
- **Decision:** Triggering a new live research run (`/research/initial`, `/research/deep-dive`, Cloud Tasks dispatch, the SSE streaming UI) is out of scope for now. Current MVP work is scoped to importing Gemini-Gem-generated drafts via Import Data (`POST /ingest/draft`).
- **Rationale:** Narrows active surface area to one path while it's being hardened. `nerd_core/pipeline.py` is shared code by design, so fixes to the Import Data path benefit Generate Listing whenever it's reinstated.
- **Status:** SETTLED. May be reinstated once the Import Data path is stable — this is a scope decision, not a removal.

### 31. CANDIDATE PERSISTENCE — `CandidateRecord` adopted on save/update; `raw_markdown` preserved.
- **Decision:** `POST`/`PUT /admin/candidates` now accept `schemas.CandidateRecord` instead of `schemas.ListingData`, so `raw_markdown` survives persistence instead of being silently dropped by Pydantic v2's default `extra="ignore"`. `POST /ingest/draft`'s response now also includes `raw_markdown`, closing the loss at its actual origin — the pasted Gem draft was being discarded before it ever reached the frontend, not just at the save step.
- **Rationale:** For the Import Data path, the pasted draft is the only record of that research. Two separate points in the chain were dropping it.
- **Status:** SETTLED/VERIFIED.

---

## Repo Organization

### 32. /TABLES NAMING — "Global", not "Products", to avoid confusion with the live NCADEMI directory.
- **Decision:** The AppSheet-recovered Products table, shown by default on the new `/tables` page, is labeled "Global" rather than "Products (AppSheet source)".
- **Rationale:** NCADEMI's live product listings are also called "Products" elsewhere in the app; a second, differently-scoped table with the same name would be ambiguous.
- **Status:** SETTLED.

### 33. DOCS ORGANIZATION — Superseded docs live in `docs/superseded/`, not `docs/archive/`.
- **Decision:** Stale or superseded root-level and `docs/` files are consolidated under `docs/superseded/`.
- **Rationale:** `.gitignore` has a bare `archive/` pattern that silently matches any path ending in that name, including `docs/archive/` — files placed there are never tracked by git. Renamed to avoid the collision rather than editing the protected `.gitignore`.
- **Status:** SETTLED/VERIFIED.

### 34. LIVENESS VALIDATOR — Hardened against bot-protected sites.
- **Decision:** `nerd_core/tools/liveness_validator.py` sends a realistic `User-Agent` header on every request and resolves relative `Location` redirect headers via `urljoin` instead of treating them as absolute URLs.
- **Rationale:** The validator previously false-negatived on sites that block non-browser traffic and broke entirely on relative redirects (a bare path has no host, so DNS resolution failed and the link was wrongly reported dead). This ran inside `adaptive_validate`, so valid resources were being silently stripped from both the live research path and Import Data.
- **Status:** SETTLED/VERIFIED. Regression-tested in `tests/unit/test_liveness.py` (`test_liveness_redirect_resolution`, `test_liveness_too_many_redirects`).

### 35. REDIRECT RESOLUTION — `resolve_and_validate_url` now returns the resolved destination.
- **Decision:** `ValidationResult` carries a `resolved_url` field populated with the terminal URL after following redirects; `nerd_core/utils.py`'s `resolve_and_validate_url` returns `result.resolved_url` instead of the original input URL.
- **Rationale:** Closes the redirect backlog at its root. `grounding-api-redirect` URLs from Google Search Grounding now resolve to their real destination before persisting into stored listings, on both the live research path and Import Data. Supersedes the partial fix in Decision #10, which only covered the batch processor — the core validator used by the shared pipeline was still returning the input URL unchanged until this fix.
- **Status:** SETTLED/VERIFIED. Regression-tested in `tests/unit/test_liveness.py`. 12 local seed candidate files predate this fix and still carry unresolved markers from that earlier state — tracked as a data-remediation task via `scripts/rerun_redirect_candidates.py`, not a mechanism bug.

### 36. ACR METADATA PARSING — Version/Date/Auditor/Auditor URL/Preparation Type restored.
- **Decision:** `nerd_core/generators.py`'s `parse_markdown_to_listing()` again parses the five ACR metadata lines (`Version:`, `Date:`, `Auditor:`, `Auditor URL:`, `Preparation Type:`) into `ACRReport`, mirroring the existing `Link:` line's guard against an empty `acr_reports` list. `Preparation Type` maps case-insensitively to "Internal" or "External", defaulting to "Internal" on malformed or missing input rather than raising.
- **Rationale:** This had been a deliberate prior cut (the dataclass carried a comment noting the fields were "retained for structure, but no longer parsed"), not an oversight — but it meant real content loss on every imported draft, since the NCADEMI directory has a Version column. Restored after confirming via git history that the original cut carried no blocking rationale against reinstating it.
- **Status:** SETTLED/VERIFIED. Tested in `tests/unit/test_generators.py` — one case with all 5 metadata lines present, one with them omitted per the "omit if not stated" spec (parses cleanly to dataclass defaults, not an error).

---

## Editor & Vendor Registry (v1.0)

### 37. EDITOR CONSOLIDATION & VENDOR REGISTRY.
- **Decision:** Introduced `/editor` (visual editor over `published-tables.json`/`added-tables.json`/`candidate-tables.json`) and `/vendors` (visual editor over the new global vendor registry, `frontend/lib/vendors.json`) as the canonical local editing surfaces, replacing the legacy `/` page and the raw-JSON `/tables/published` editor (see [Decision #38](#38-directory-hygiene-pass-v10)). Both pages are backed by a shared local-write API (`frontend/app/api/local/{published,added,candidate,vendors}/route.ts`, `frontend/lib/local-write.ts`) that is gated to local development only (`NODE_ENV !== "production"` AND `NEXT_PUBLIC_DISABLE_AUTH === "true"`, returning a bare 404 rather than 403 when blocked) and uses a whole-file SHA-256 ETag with `If-Match`/`412` to catch a save racing an out-of-band edit, plus a hand-rolled temp-file + fsync + rename + directory-fsync sequence for atomic, durable writes. The vendor registry itself is populated by `scripts/scrape_vendors.py` (crawls each vendor's own NCADEMI directory page) and cleaned up by `scripts/dedupe_vendor_resources.py` (strips a product's own `vendor_resources` entries that duplicate a URL already captured under that vendor in `vendors.json`).
- **Rationale:** The legacy `/` page mixed the Generate Listing/Import Data editor with AppSheet-recovery browsing in one 1000+ line file; the raw-JSON `/tables/published` editor required hand-editing JSON with no structured field validation; the `ncademi-viewer/` prototype duplicated rendering logic in a third, never-finished surface. One consistent visual-editing pattern, one persistence layer, replaces all three.
- **Status:** PARTIAL. `/editor` is fully built out with per-section field editors (`Published{Header,Acr,OtherResources,Support,VendorResources}Editor.tsx`). `/vendors`' four structured field-editor stubs (Header, Global Resources, Product/s, Support) are not yet implemented — vendor records are currently edited as raw fields. "Save vendor" and "Delete vendor" are real and fully wired through the same ETag/atomic-write path.

---

## Directory Hygiene Pass (v1.0)

### 38. DIRECTORY HYGIENE PASS (v1.0).
- **Decision:** As part of preparing the repo for a v1.0 state, the following were retired or relocated:
  - `nerd_core/tools/administrative_validators/link_validator_engine.py` deleted outright (dead code — never wired into a live path, and the `crawlee[playwright]` dependency and Dockerfile "Playwright support" claim it alone justified were both removed in the same pass). `tests/test_link_validator.py` still imports it by its old path and is now broken with a `ModuleNotFoundError`; not fixed as part of this pass.
  - `scripts/migrate_to_firestore.py` archived to `docs/superseded/migrate_to_firestore.py` — already retired/hard-exiting (see §7 of the architecture doc), kept as a reference for if/when this migration path is rebuilt for the cloud.
  - The legacy `/` page (`frontend/app/page.tsx`, the 1000+ line Generate Listing/Import Data editor) and the raw-JSON `/tables/published` editor (`frontend/app/tables/published/page.tsx`) archived to `docs/superseded/legacy_root_page.tsx` and `docs/superseded/legacy_published_json_page.tsx` respectively. `frontend/app/page.tsx` is now a 5-line redirect to `/editor`, the canonical replacement (see Decision #37).
  - `ncademi-viewer/` (a fully redundant prototype, see architecture doc §3.E) archived whole to `docs/superseded/ncademi-viewer/`.
  - `GEM-instructions.txt` moved from the repo root to `prompts/GEM-instructions.txt`, alongside the project's other prompt-management files.
- **Rationale:** Consolidate around the `/editor`/`/vendors` suite (Decision #37) as the single current editing surface, and stop carrying dead code, a superseded prototype, and a misplaced root-level file into the v1.0 state.
- **Status:** SETTLED/VERIFIED.

### 39. ARCHIVE CONTENT TRIAGE — accessibility research sources promoted, abandoned agent design doc and superseded code review removed from archive/.
- **Decision:** Reviewed archive_copy.zip (an uploaded copy of the repo's local archive/ directory) file by file rather than bulk deleting. Promoted the only two pieces of still-relevant, code-independent content: the K-12 EdTech accessibility research source list (-> docs/accessibility-research-sources.md) and the NCADEMI live-directory field schema (-> NERD_System_Architecture.md Section 9), the latter recovered from an otherwise-abandoned conversational-agent design doc. Everything else in the archive (pre-migration Streamlit code review, phase-4 deployment debug logs, a k-12 URL seed list confirmed already fully ingested into eval/eval_data.json, and misc test/scratch files) was confirmed superseded or already consumed and discarded without extraction.
- **Rationale:** archive/ predates this project's docs/superseded/ convention and was gitignored going forward, but three files inside it were committed before that gitignore rule existed and remained tracked regardless -- discovered via `git status` flagging an unstaged deletion after a manual `rm` of one file, then confirmed via `git ls-files archive/`. A bare gitignore pattern does not retroactively untrack already-committed paths; this is the same class of landmine as Decision #33, encountered from the opposite direction (files unexpectedly still tracked, rather than files unexpectedly never tracked).
- **Status:** SETTLED/VERIFIED. See commits 6f931a2 (doc additions) and 6c6700c (archive/ tracked-file removal). archive/ no longer exists on disk; `git ls-files archive/` returns empty.

### 40. `PublishedJsonWorkbench.tsx` ARCHIVAL — follow-up to Decision #38.
- **Decision:** Archived the remaining piece of the legacy raw-JSON `/tables/published` editor that Decision #38 left behind: `frontend/components/PublishedJsonWorkbench.tsx` -> `docs/superseded/legacy_published_json_workbench.tsx`, and its e2e test `frontend/tests/e2e/published_json.spec.ts` -> `docs/superseded/legacy_published_json.spec.ts.bak`. Both were dead weight once `frontend/app/tables/published/page.tsx` (the page that rendered this component) was itself archived in Decision #38 — nothing in the live render tree imports the component. The only live dependency left behind was a type-only import: `frontend/app/editor/page.tsx` imported the `SnapshotMeta` interface from this file for its `FileMeta.meta` field. Rather than importing from `docs/superseded/` (which would defeat the purpose of the archive), the `SnapshotMeta` interface was copied — not moved — into `editor/page.tsx` directly, next to its other local type definitions; the archived file is left untouched as a frozen historical snapshot. `editor/page.tsx`'s file-header comment, which referenced `PublishedJsonWorkbench.tsx`'s save flow by name, was reworded to describe the save flow directly and point to the archived file's new path for historical context instead of naming a component that no longer exists in the live tree. `docs/NERD_System_Architecture.md`'s component tree listing (§ frontend directory tree) was also corrected to drop `PublishedJsonWorkbench.tsx` from the `/editor` components row, keeping `RawJsonEditor.tsx`/`JsonDisclosure.tsx`, which are still live.
- **Rationale:** Same as Decision #38 — stop carrying dead code forward into the v1.0 state — plus keeping live code from depending on `docs/superseded/`, which is meant to be a read-only historical reference, not an active import source. `npx tsc --noEmit` passes clean from `frontend/` after the change.
- **Status:** SETTLED/VERIFIED.

### 41. `RawJsonEditor.tsx`/`JsonDisclosure.tsx`/`json-position.ts` ARCHIVAL — correction to Decision #40.
- **Decision:** Decision #40 stated `RawJsonEditor.tsx`/`JsonDisclosure.tsx` were "still live" and kept them in `frontend/components/`. A full-tree import trace (every `.ts`/`.tsx` importer of every `frontend/lib/` file, not just within `app/`/`components/`) found that claim to already be stale: neither component has any importer left in the live render tree — `frontend/app/editor/page.tsx` does not wire in a raw-JSON escape hatch, and the only remaining importer of either was `docs/superseded/legacy_published_json_workbench.tsx` itself, already archived. Archived all three: `frontend/components/RawJsonEditor.tsx` -> `docs/superseded/legacy_raw_json_editor.tsx`, `frontend/components/JsonDisclosure.tsx` -> `docs/superseded/legacy_json_disclosure.tsx`, and `frontend/lib/json-position.ts` (RawJsonEditor's sole dependency, `formatJsonError`/`parseJsonWithPosition`, itself dead once RawJsonEditor had no live caller) -> `docs/superseded/legacy_json_position.ts`. All three moved via `git mv` (history preserved), left untouched otherwise — same frozen-historical-snapshot treatment as Decision #40, including unmodified `@/` import paths that no longer resolve outside `frontend/`. `docs/NERD_System_Architecture.md`'s component tree listing was corrected to drop all three from the `/editor`/`lib` rows.
- **Rationale:** Same as Decision #40 — stop carrying dead code forward, keep the frontend tree's contents matching what Decision #40 already intended to enforce. This is specifically a correction of that decision's now-inaccurate liveness claim, not a new policy.
- **Status:** SETTLED/VERIFIED. `npx tsc --noEmit` and `npm run lint` pass clean from `frontend/` after the move.

### 42. `*-tables.json` RENAMED to `*.json` in `frontend/lib/`.
- **Decision:** Dropped the redundant `-tables` suffix from the three `/editor` data files: `frontend/lib/published-tables.json` -> `published.json`, `added-tables.json` -> `added.json`, `candidate-tables.json` -> `candidate.json` (via `git mv`, history preserved). `frontend/lib/published-tables.ts` (the TypeScript module, distinct from the `.json` data file) keeps its name — only its static `import data from "./published-tables.json"` was updated to `"./published.json"`. `frontend/lib/local-write.ts`'s `FILE_NAMES` map is the single source of truth for these filenames (the three `/api/local/*` routes call `readPublishedRaw`/`writePublishedAtomic` with a closed-union `DataKind`, never a filename string — see Decision #37), so the entire read/write path updated by changing three map values. All other doc-comment and user-facing-string references to the old names (API route headers, `editor/page.tsx`'s header comment and its "could not load"/"cannot save" error strings — including one that built the filename dynamically as `` `${tab}-tables.json` `` — `published-validate.ts`, `vendor-schema.ts`, `scripts/dedupe_vendor_resources.py`, `docs/NERD_System_Architecture.md`, `frontend/README.md`) were updated to match. `docs/superseded/**` (frozen historical snapshots, including `vendor_audit.md` and the legacy archived `.tsx`/`.ts` files) intentionally left referencing the old names, per the same convention as Decisions #38/#40/#41.
- **Rationale:** The suffix disambiguated nothing (each base name — `published`, `added`, `candidate` — is otherwise unique in `frontend/lib/`), and the sibling document `vendors.json` already omits it; `*-tables.json` was simply inconsistent with the established pattern.
- **Status:** SETTLED/VERIFIED. `npx tsc --noEmit` and `npm run lint` pass clean from `frontend/` after the rename.

---

## Post-v1.0 Editor, Records & Data Refresh

### 43. TRACKING METADATA DECOUPLED — moved to `tracking.json`.
- **Decision:** The four editor-workflow fields (`tracking_priority`, `tracking_status`, `tracking_gatherer`, `tracking_reviewer`) no longer live inline in `published.json` / `added.json` / `candidate.json` / `vendors.json`. They move to `frontend/lib/tracking.json`, keyed by `product_name` (a vendor record's `product_name` is its vendor name), outside the `DataKind`/ETag concurrency system — the same split `frontend/lib/passwords.json` already uses (see [Decision #45](#45-vendor-review-passwords--passwordsjson-and-protected-page-scraping)), and for the same reason: tracking is editor-owned state that must survive a wholesale live-data refresh of the content files. `frontend/lib/tracking.ts` (pure: `splitTracking` / `mergeTracking` / `TrackingRecord`) plus `readTrackingRecords` / `writeTrackingRecords` in `local-write.ts` do a server-side split-on-write / merge-on-read, so every `/editor` and `/records` component's record shape is unchanged; the `tracking_*` fields became optional on `PublishedProductRecord` / `DirectoryRecord` (absent when a record has no `tracking.json` row). `scripts/decouple_tracking.py` was the one-off idempotent migration (lifted 15 existing rows — 1 published, 13 candidate, 1 vendor — and stripped the inline keys); `scripts/scrape_ncademi_live.py` stopped emitting `tracking_*` on scraped records.
- **Rationale:** The `/records` "Update Stored Data" promote (see [Decision #44](#44-records-route-and-update-stored-data--live-snapshot-promotion)) and the live scrape both overwrite whole content documents; keeping workflow metadata inline meant every refresh clobbered it. A lost `tracking.json` edit is trivially re-entered by a single local operator, so a plain read / merge / atomic-write is sufficient — no ETag guard needed.
- **Status:** SETTLED/VERIFIED. Commit `bc46181` (manual-QA follow-up in `1966999`).

### 44. `/records` ROUTE AND "UPDATE STORED DATA" — live-snapshot promotion.
- **Decision:** The live-data widget (scrape trigger + "Retrieve Live Data") moved off `/editor` to a dedicated `/records` route (commit `5c1623b`); `/editor` and `/records` were then both split into routed leaves with record-selection URLs — `app/{editor,records}/(routed)/{added,candidates,published,vendors}/[slug]` — served by Server Components that read through `frontend/lib/local-data.ts` (commit `3b2dacf`). The "Update Stored Data" button (commit `0a7849f`) POSTs `{ category }` to the new `frontend/app/api/local/promote-live/route.ts`, which: backs up the stored file to a single rolling `.bak`; **merges** the matching `*-live.json` snapshot in (a live record updates its stored counterpart matched by `ncademi_product_url` / `vendor_directory_url`, a stored record with no live counterpart is kept, a live-only record is appended — conservative on purpose, since some `added` products' pages are not yet unlocked); re-shapes live records to the stored schema on the way in (derive `slug`, backfill `ai_insights`, keep the stored envelope, refresh provenance); then backs up and deletes the live snapshot. `tracking.json` is never touched — `local-data.ts` merges tracking back on read. `local-write.ts` gained `documentPath` / `liveSnapshotPath` / `backupThenWrite` / `backupThenDelete`; `frontend/.gitignore` ignores `lib/*.bak` and `lib/*.tmp`.
- **Rationale:** Separating the destructive whole-document refresh from the per-field editor keeps the two workflows from sharing accident surface, and a merge (rather than a replace) means an incomplete scrape can't silently drop stored records.
- **Status:** SETTLED/VERIFIED. Commits `5c1623b`, `3b2dacf`, `0a7849f`.

### 45. VENDOR-REVIEW PASSWORDS — `passwords.json` and protected-page scraping.
- **Decision:** Added product pages in the "Added to Site" (pending vendor review) state are password-protected on ncademi.org. `frontend/lib/passwords.json` (schema in `frontend/lib/passwords.ts`) stores one temporary vendor-review password per product, keyed by `product_name`, generated by a fixed pattern (first four letters of the name, spaces stripped and lowercased, + two-digit year, with a numeric suffix on collision) and served through `frontend/app/api/local/passwords/route.ts` (GET / POST / DELETE). It is deliberately outside the `DataKind`/ETag system — a password, once assigned, is only read or created, never edited. A vendor-review Password field was added to the Candidate/Added editors (commit `3cf6efa`). `scripts/scrape_ncademi_live.py --target added` joins `added.json` against `passwords.json` on `product_name`, unlocks each protected page via WordPress's `postpass` endpoint, parses it with the same parser used for public pages, and writes `frontend/lib/added-live.json`; `--target published` skips protected pages entirely. `frontend/lib/local-data.ts` gained `getAddedLiveProducts()` mirroring `getPublishedLiveProducts()` (commit `6fbe2dc`).
- **Rationale:** Without the passwords the live scrape could only see public pages, so newly-added products under review never appeared in a live snapshot and could not be diffed against or promoted.
- **Status:** SETTLED/VERIFIED. Commits `3cf6efa`, `6fbe2dc`.

### 46. TUNNELED DEMO WORKFLOW — `NERD_CLOUD_DEMO_LOCAL_WRITE` and `nerd_cloud.sh`.
- **Decision:** An ad hoc local workflow exposes the running local stack to a colleague over two account-less Cloudflare quick tunnels (`cloudflared`), driven by an untracked developer-machine script (`~/nerd_cloud.sh`, aliased `nerd_cloud` in the shell profile) — not a checked-in artifact. Because the script serves a production `next build` standalone server (Turbopack HMR does not survive a free quick tunnel), a plain production build would 404 the `/api/local/*` routes. `NERD_CLOUD_DEMO_LOCAL_WRITE=true` is a server-only runtime env var, set nowhere but that script, that widens only the `NODE_ENV` half of `isLocalOnlyAllowed()` (`frontend/lib/local-only.ts`) for that one server process; the `NEXT_PUBLIC_DISABLE_AUTH === "true"` half remains independently required. `NERD_REPO_ROOT` (also set by the script) is the explicit repo-root override the standalone build needs because `.next/standalone/server.js` calls `process.chdir(__dirname)` at startup, which breaks `process.cwd()`-relative path resolution in `local-write.ts`'s `libDir()` and `app/api/local/scrape/route.ts`. The editor components additionally echo the ETag in the response body, because the tunnel proxy can strip custom response headers.
- **Rationale:** Lets a colleague exercise the full editor against local data for a short demo without a cloud deploy. Scoped to one-off sessions with no uptime guarantee.
- **Scope/exception:** `NERD_CLOUD_DEMO_LOCAL_WRITE` and `NEXT_PUBLIC_DISABLE_AUTH` must never be added to any Dockerfile, `cloudbuild.yaml`, or deploy configuration — [Decision #27](#27-production-guardrails--local_mode-and-next_public_disable_auth-must-never-reach-deployed-environments) is unaffected by this entry.
- **Status:** SETTLED. Commit `ca5207e`.

### 47. VENDOR SCHEMA UNIFICATION — `vendor-schema.ts` superseded by `directory-schema.ts`.
- **Decision:** The vendors registry (`frontend/lib/vendors.json`) and the vendors editor stack were migrated from the bespoke `VendorRecord` / `VendorResource` / `VendorsFile` types in `frontend/lib/vendor-schema.ts` to a unified `frontend/lib/directory-schema.ts` (`DirectoryRecord` / `DirectoryFile` / `DirectoryRecordKind`), which mirrors `PublishedProductRecord` field-for-field plus a `kind` discriminant ("vendor" branch vs. "product" leaf) and a `products` child-link array. `scripts/migrate_vendors_to_unified.py` regenerated `vendors.json` in the new shape (backup at `frontend/lib/vendors.json.bak`) and fixed the `vendor_name: null` and `contact_type`/`type` bugs flagged in the schema file's earlier revisions. The vendors editor stack (`VendorEditor.tsx`, `VendorGlobalResourcesEditor.tsx`, `VendorProductsEditor.tsx`, `VendorSupportEditor.tsx`, `VendorCreateModal.tsx`, `DirectoryHeaderEditor.tsx`, `DirectoryPreview.tsx`) now consumes `DirectoryRecord` natively; the `toLegacyVendorRecord` bridge was removed. `vendor-schema.ts` still exists and is still imported for its type shape by `components/VendorSidebar.tsx` and `lib/ncademiPreview.ts`, but no longer by the editor stack.
- **Rationale:** One schema for both branch (vendor) and leaf (product) directory records removes a parallel type hierarchy and lets the same field editors serve both.
- **Status:** SETTLED/VERIFIED. Commit `c228ef6`.

---

## Documentation Corrections

### 48. DOCUMENTATION CORRECTION — entries #6 and #37.
- **Purpose:** Pointer entry, not a rewrite. Entries [#6](#6-local-auth-bypass--env-gated) and [#37](#37-editor-consolidation--vendor-registry) are preserved verbatim as historical record; the following has changed since they were written.
- **Re #6:** The auth bypass no longer lives in `middleware.ts`. Next.js 16 renamed `middleware.ts` to `proxy.ts`, so the login-redirect bypass is now in `frontend/proxy.ts`; the local-write / local-read boundary condition was separately extracted into `frontend/lib/local-only.ts` as `isLocalOnlyAllowed()`, consumed by `local-write.ts` (`assertLocalOnly()`) and `local-data.ts`.
- **Re #37:** The three `/editor` data files were renamed `published-tables.json` → `published.json`, `added-tables.json` → `added.json`, `candidate-tables.json` → `candidate.json` ([Decision #42](#42--tablesjson-renamed-to-json-in-frontendlib)). The shared local-write API is no longer four routes: `frontend/app/api/local/` now also holds `published-live`, `vendors-live`, `promote-live`, `passwords`, and `scrape`, and `frontend/lib/local-data.ts` is the Server Component read path. The `/vendors` structured field editors (Header, Global Resources, Product/s, Support), listed as "not yet implemented" in #37's PARTIAL status, now exist (`DirectoryHeaderEditor.tsx`, `VendorGlobalResourcesEditor.tsx`, `VendorProductsEditor.tsx`, `VendorSupportEditor.tsx`). The vendor registry schema moved from `vendor-schema.ts` to the unified `directory-schema.ts` — see [Decision #47](#47-vendor-schema-unification--vendor-schemats-superseded-by-directory-schemats).
- **Status:** SETTLED/VERIFIED (documentation only).
