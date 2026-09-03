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

---

## Navigation Rollout Completion

### 49. INTEGRATED LIST PANEL ROLLOUT — Phase 4 (cleanup) complete.
- **Decision:** Closes out `docs/integrated_list_panel_rollout_guide.md`'s Phase 4. Phases 1-3 (shared `IntegratedListPanel.tsx` component, rollout to `/records`, rollout to `/editor`) were previously completed and verified by grep (`IntegratedListPanel` wired into all four `/editor/(routed)/*` layouts, no legacy `*ListPanel.tsx` remaining under `/editor`). Phase 4's two remaining deletions - `frontend/components/EditorNavSidebar.tsx`, `frontend/components/RecordsTestSidebar.tsx` (both confirmed dead: zero importers outside self and docs), and the `frontend/app/records-test/` sandbox directory - are now deleted. `npx tsc --noEmit` and `npm run lint` both clean, matching the guide's stated exit criterion.
- **Rationale/process note:** Phase 4's first task - removing `EditorNavSidebar`'s import from the global layout - was done ahead of the other three as an undocumented "Phase 2.5 hotfix" (per the comment left in `frontend/app/editor/(routed)/layout.tsx`), crossing the rollout guide's own "strict phasing, do not proceed until developer confirms" rule. The remaining deletions and the sandbox-directory removal were done together as a single follow-up pass rather than being caught earlier, because neither file threw a build or lint error while orphaned - only a targeted `git grep` for importers surfaced that they were dead.
- **Status:** SETTLED/VERIFIED.

---

## Stage 3 Preparation

### 50. CLEAR LEGACY FIRESTORE COLLECTIONS — `nerd_products`, `nerd_candidates`.
- **Context:** The 43 documents in `nerd_products` were created via the old `POST /admin/products` path using a schema (`schemas.ListingData` / `schemas.CandidateRecord`) that has since been completely replaced. `nerd_candidates` was already empty. Both collections' schemas are incompatible with the current data model (`PublishedProductRecord` with `$schema_version` and `$meta` envelopes in `frontend/lib/*.json`).
- **Decision:** Delete all documents rather than migrate. The collections will be re-provisioned with the new schema during Stage 3 (Firestore persistence port).
- **Status:** Done.

## Cloud Republish (v2 architecture)

### 51. CLOUD ARCHITECTURE SPLIT — Next.js owns persistence and auth; Python becomes one stateless function service.

The three 08-27 analyses (`cloud-republish-difficulty-assessment`, `backend-rewrite-vs-refactor`, `live-infra-audit`) converged on this and it is adopted. Next.js on Cloud Run owns session authentication, all reads, all writes, and all rendering. The Python service keeps `POST /ingest/draft` — the Gem-markdown parse-and-validate chain — plus a scrape endpoint, and nothing else.

The decisive evidence was caller analysis rather than preference: exactly one live frontend component calls the FastAPI backend (`ImportDataModal.tsx` → `/ingest/draft`), and `POST /render` has no live caller at all. After constraints 3 and 4, the Python backend's entire remaining job in the live application is parsing one pasted draft.

Consequence: the browser no longer talks to Python. That one change removes CORS from the live path, removes the `FRONTEND_URL` patch-back fragility (finding F23), removes duplicated Firebase token verification from Python, and removes `NEXT_PUBLIC_API_BASE_URL` from the build — the build-time-inlining failure Decision #11 describes and which the 08-27 live audit found still shipping in the deployed frontend. The Python service also becomes `--no-allow-unauthenticated`, reached with an OIDC token from the frontend's runtime service account, which is strictly more locked down than its current public posture.

Supersedes the three-tier description in `docs/NERD_System_Architecture.md` for the editor/vendor surface. Decisions #4, #5, #12, #23, #28, and #30 resolve to "not applicable" once the research orchestration is removed.

### 52. PERSISTENCE SUBSTRATE — Firestore, whole-document, JSON stored as a string.

One Firestore document per logical document in collection `nerd_documents`, keyed by the same closed union of literals `local-write.ts` used as filenames. The JSON is stored as a **string** in a `bytes` field, not as a parsed Firestore map.

Storing it as a string is what preserves the ETag contract byte-for-byte: the ETag has always been SHA-256 over the exact serialized bytes, and round-tripping through a Firestore map would reorder keys, coerce types, and reject `undefined`, leaving a hash no client could reproduce. It also avoids creating a second schema authority — the record shapes are owned by `published-tables.ts` and `directory-schema.ts`, and modelling them in Firestore's type system would only create something that has to agree with them.

Two operational facts recorded because both are load-bearing and neither is obvious:

- **Firestore rejects any commit containing an indexed field value larger than 1,500 bytes.** Single-field indexes are automatic. The `bytes` field therefore requires a single-field index exemption on both `nerd_documents` and the `backups` collection group, applied **before the first write**, or every save of every document fails — including the migration. Declared in `firestore.indexes.json`.
- **`NERD_FIREBASE_PROJECT_ID` is required and `GOOGLE_CLOUD_PROJECT` is never consulted.** This machine exports `GOOGLE_CLOUD_PROJECT="acp-vertex-core"` globally for unrelated tooling; inheriting it would point every read and write at the wrong database while appearing to work. `lib/server/firebase-admin.ts` throws rather than defaulting.

Compare-and-swap is folded into a single Firestore transaction (`saveGuarded`). The HTTP contract is unchanged — `If-Match` still yields 412 — but the read/compare/write/re-read sequence the filesystem version used was safe only because one local disk had one writer. On Cloud Run two instances can both pass the check and both write, and the second silently destroys the first while the UI reports success. Every write also stores the previous bytes at `backups/latest`, replacing what git was doing for these files.

Full rationale: `docs/nerd-persistence-tier-design-08-28-26.md`.

**Status update (2026-09-02):** Empirically tested against live Firestore
(project edtech-agent-2026, scratch collection nerd_scratch_1500_test) —
writes of 5,000 bytes and 130,000 bytes to the indexed `bytes` field both
succeeded with the full value intact on read-back; no truncation observed
on the document itself, no INVALID_ARGUMENT rejection at either size.
This contradicts the "hard rejection" reading of the Firestore Native-mode
error-codes documentation and is consistent with the "silent index
truncation" reading instead. Gemini Web research (not independently
citation-verified) suggests the truncation-vs-rejection split may depend
on Standard vs. Enterprise edition and a ~7.5 KiB index entry limit, but
that mechanism is not confirmed — treat as unverified.

Practical consequence: the single-field index exemption on `bytes` is no
longer a hard precondition blocking the first write — writes succeed
without it. The exemption is still worth applying, but for a different
reason: every unexempted write generates wasted ascending/descending
index entries on a field that is never queried, at ongoing storage and
write cost. Sequencing the exemption before or after the first write no
longer gates Phase 2.

---

### 53. *(PROPOSED — Phase 2)* SINGLE PERSISTENCE IMPLEMENTATION — no filesystem fallback; local development uses the Firestore emulator.

There is deliberately no `if (local) useFs()` branch. A dual-path persistence layer selected by an environment variable is the exact shape of the 2026-07-08 incident recorded in Decision #27, and it is the opposite of DRY.

Local development runs against the Firestore emulator, seeded by `scripts/nerd_documents.py push` — the same script that performs the production migration, so the riskiest step of the migration is exercised on every local setup rather than run once, in anger, against real data.

Honest cost: local development now requires the emulator running and a seed step where it previously required editing a file. Accepted because it eliminates the class of bug that produced Decision #11, Decision #46, and the `.next/standalone/lib/` divergence documented in `local-write.ts`'s `libDir()` comment, where a deleted product reappeared after a restart because the delete only ever reached a build-time copy.

### 54. *(PROPOSED — Phase 3)* AUTH — Firebase session cookie; the Node runtime is the enforcement point; `proxy.ts` is UX only.

`proxy.ts` runs on the Edge runtime, where `firebase-admin` cannot run. It **cannot** verify a session cookie; it can only observe that one is present, which a forged cookie also satisfies. Recording this explicitly because a naive "just verify the cookie in middleware" fix would inherit the exact flaw it was meant to remove.

Enforcement therefore lives in the Node runtime, co-located with the data access it protects: `assertSession()` in every Route Handler, `requireSessionUser()` in every Server Component. `proxy.ts` keeps a presence-only check, documented in the file as UX and not security.

Also in this decision: `NEXT_PUBLIC_DISABLE_AUTH` is **deleted from the codebase**, not merely unset — a "skip all auth" branch existing anywhere in the tree is a standing invitation. `isLocalOnlyAllowed()` and `lib/local-only.ts` go with it. Access is an email allowlist in `NERD_ALLOWED_EMAILS`, checked both at session mint and on every request, **failing closed on an empty list**. Resolves Decision #29's deferral, whose stated condition ("until the app is published to the web") is now met.

### 55. *(PROPOSED — Phase 1)* GENERATE LISTING AND APPSHEET REMOVED.

Constraint 3 (no Generate Listing, ever) and constraint 4 (AppSheet data is static and does not ship) remove ~1,950 lines and the infrastructure behind them: the `nerd-worker` Cloud Run service, the `nerd-research-queue` Cloud Tasks queue, the `nerd-tasks-invoker` service account and its OIDC handshake, the `gemini-api-key` secret, Vertex AI IAM, and the BigQuery `telemetry.feedback_logs` dataset.

This is subtraction, not migration. The import graph makes the cut clean: `nerd_core/pipeline.py` does not import `services.py`, Vertex AI enters through exactly one door (`api/worker.py`), and `telemetry.log_event` has exactly one caller.

Planned as irreversible. Supersedes Decision #30's "deferred" framing.

**Status update (this session, 2026-09-02):** executed. See Decision #59 for the completion of the last three items left over from this decision's initial commit series.

### 56. *(PROPOSED — Phase 1b)* `nerd_products` RECONCILED BEFORE TEARDOWN.

The 08-27 live audit found 43 real documents in Firestore's `nerd_products`, written through the `POST /admin/products` path this plan deletes, and recorded in no project document. `scripts/reconcile_firestore_products.py` (read-only) diffs them against `published.json` and `added.json` and returns one of three verdicts. Deleting `api/store.py`'s product-side code is blocked on that verdict being A, or on B/C having been resolved and any Firestore-only content merged into the JSON documents first.

**Status update (this session, 2026-09-02):** `scripts/reconcile_firestore_products.py` run against live Firestore. Result: 0 documents in `nerd_products` (already cleared per Decision #50), 77 records in `published.json`/`added.json`. Verdict A — fully subsumed. Note the verdict reflects an empty collection rather than a genuine merge check; per the developer, the original 43 documents were legacy-schema artifacts from a mothballed version and their removal (Decision #50) lost nothing relevant to the current schema. Phase 1b is unblocked.

### 57. *(PROPOSED — Phase 4)* SINGLE RENDERER — TypeScript `ncademiPreview.ts` is authoritative; the Python renderer is deleted.

`POST /render` has no live frontend caller. The WordPress HTML that ships is built client-side by `frontend/lib/ncademiPreview.ts`. The two renderers have already diverged — the empty-ACR link is `https://example.com` in Python output versus `#` in the preview — so this is a decision being made rather than a bug being fixed.

TypeScript wins on caller evidence. Deleting `nerd_core/generators.py`'s render half also drops `jinja2` and `markupsafe` and most of `templates/`. Done in Phase 4 with test coverage, deliberately **not** inside the Phase 1 teardown commit series: `generators.py`'s parser half is the single most valuable asset in the repo and must not be edited inside a 1,950-line deletion diff.

### 58. GCP PROJECT — reuse `edtech-agent-2026`; deploy alongside; teardown decoupled.

The new stack is deployed into the existing project as **new** Cloud Run services (`nerd-web`, `nerd-parser`) beside the stale ones, rather than into a fresh project or over the existing services.

Recorded because the opposite was recommended first, and the reversal is the useful part. The case for a new project rested entirely on teardown risk — Phase 1 removes a Cloud Tasks queue, a service account and its OIDC handshake, an `actAs` grant, a secret, Vertex AI IAM, and a BigQuery dataset, and doing that by omission in a clean project is safer than doing it by deletion in a project with unaudited residents. That reasoning is sound. What it missed is that **the teardown does not have to happen during the migration.** Nothing in the new architecture requires deleting anything: Cloud Run scales to zero, `nerd_documents` is a new collection that never touches `nerd_products`, and the single-field index exemption is scoped per collection group. Decoupling the teardown into Phase 8 buys the same safety property at none of the cost.

What reuse saves is larger than first credited, and it is not Firestore or billing. `authDomain` and the App ID are hardcoded in `frontend/lib/firebase.ts`, so a new project means a new web app registration, a new API key, OAuth consent configuration, authorized domains re-added, and three users re-consenting. Domain verification is also per-project, and `idbygeorge.com` is already verified here — pointing it at `nerd-web` is a domain mapping rather than a DNS round trip and a propagation wait.

Immediate action taken independently of the phase order: `nerd-api` routed to zero traffic. It was seven weeks stale, publicly reachable, and its deploy history runs through the 2026-07-08 LOCAL_MODE incident. Deleting or draining a Cloud Run service is a bounded operation in a way that unwinding IAM bindings is not.

**Two findings would reopen this**, both answered by the Phase 0.3 service-account audit: a broadly-scoped user-managed key on `nerd-cli-admin` that has been distributed anywhere, or confirmation that the undocumented `billing_data` BigQuery dataset belongs to a different workload — which would mean `edtech-agent-2026` is a shared project rather than N.E.R.D.'s, and a project the team does not solely own is the wrong home for a system about to hold all of the directory's data.

**Status update (this session, 2026-09-02):** Phase 0.3 run. `nerd-cli-admin` and `ais-gemini-key-84fb...` both hold zero project-level IAM roles (confirmed via full policy dump, not just filtered query). A user-managed, non-expiring key does exist on `nerd-cli-admin` (created 2026-07-01) — finding #1 partially confirmed (key exists) but not fully (no broad roles found at project level; possible resource-level grants unchecked, and whether the key has been "distributed anywhere" is not answerable from IAM alone). Finding #2 (`billing_data` ownership) not yet checked. Neither finding is conclusive enough to reopen this decision as of this status update.

Supersedes the deferred project-choice question carried from the migration planning phase. Full reasoning: `docs/nerd-cloud-execution-plan-08-28-26.md` §0.4.

---

### 59. PHASE 1a CLEANUP COMPLETED — dead research schemas, Cloud Tasks deploy plumbing, and AppSheet exports removed.

**Commit:** 4474f74090d1771ab6438dce8f3c3bd7a3fb0d6f (branch `cloud-migration-phase-2`)

Decision #55's initial commit series (Group A–E, merged at `7e80ebb`) completed most of the Phase 1a deletion but left three items:

1. `api/schemas.py` still carried 10 dead Pydantic models tied to the removed `/research/*`, `/jobs/*`, and batch-research endpoints.
2. `scripts/deploy.sh` still provisioned a Cloud Tasks queue and the `nerd-tasks-invoker` service account, with associated IAM bindings and env-var wiring, despite the worker/Cloud Tasks path being deleted.
3. `data/appsheet-export/` and `data/appsheet-source-html/` (14 tracked files, ~1MB of legacy AppSheet exports and scraped source HTML) remained in the repo.

All three are now removed. Zero-reference grep confirmed no live code depended on any of the deleted schemas or deploy.sh variables. `pytest` and the frontend build are unchanged from baseline (one pre-existing, unrelated failure: `test_candidates_directory_not_empty`).

**Deferred to Phase 4 (not touched by this commit):** the Firestore TTL policy on `nerd_research_jobs` in `scripts/deploy.sh`, which references the already-deleted `api/job_store.py`. Left in place because it's Firestore scope, not Cloud Tasks, and out of bounds for this dispatch.

**Status:** Done.

### 60. PHASE 2 BUG — editor/records pages read from stale filesystem module post-migration.

**Date:** 2026-09-02
**Status:** Fixed
**Commit:** 5b46330 (branch cloud-migration-phase-2)

Decision #59's Phase 2 install (commit 17b728d) wired the write path
(route handlers -> `documents.ts` -> Firestore) but missed the read path:
all 27 editor and records page components still imported their document
readers from `lib/local-data.ts` (the pre-migration filesystem module),
not `lib/server/documents-read.ts` (the Firestore module installed the
same session). Both modules export identically-named, identically-shaped
functions, so the mismatch compiled cleanly and the pages rendered
correctly-looking data — it just rendered stale, filesystem-era ETags
alongside a write path now pointed at Firestore.

Effect: every save failed with a false 412. The client always sent the
original migration-era ETag (the filesystem JSON's hash at the time of
the `nerd_documents.py push` migration), which could never match
Firestore's current value once anything had been written through the app.
Confirmed live: a fully fresh, hard-reloaded page load of
`/editor/candidates/anton` still produced the stale ETag and a 412 on the
very first save attempt, with no other tabs or writers involved — ruling
out browser cache, Next.js Router cache, and double-submit as causes
before the actual root cause (wrong import source) was found by tracing
the component's prop chain back to the page-level Server Component.

Fix: swapped the import source on all 27 call sites from
`@/lib/local-data` to `@/lib/server/documents-read`. No symbol renames —
`documents-read.ts` was built as a drop-in replacement and its return
shapes are structurally identical (`tsc --noEmit` confirmed clean, no
cast or signature changes needed anywhere).

Also folded into this fix:
- Reworded the 412 error message across all 5 editor components
  (Candidate/Added/Published/VendorEditor, `editor/page.tsx`) from "the
  file on disk changed" (filesystem-era phrasing, no longer accurate) to
  "the data was changed on a different tab or by another user" — matches
  the new persistence model and the actual, verified cause of a 412 in
  normal use (confirmed live: two tabs open on the same candidate, second
  save correctly rejected with a 412, not a silent overwrite).
- `frontend/.env.local.example`: added `NEXT_PUBLIC_FIREBASE_API_KEY` and
  `NEXT_PUBLIC_FIREBASE_APP_ID`. `/login` prerenders at build time
  regardless of `NEXT_PUBLIC_DISABLE_AUTH` and calls `getAuth(app)`,
  which throws without these. Values are non-secret Firebase web SDK
  config, retrieved via `firebase apps:sdkconfig WEB --project prod`.

**Verification:** `tsc --noEmit`, `npm run build`, and `npm run lint` all
clean. Manually verified end-to-end against the Firestore emulator:
single-tab save succeeds and persists (confirmed via the emulator UI's
`backups/latest` subcollection showing the correct `replaced_by` actor
and updated `etag`); a second tab holding a stale ETag correctly receives
a 412 rather than silently overwriting — the concurrency guarantee
Decision #52 described as "now real rather than nominal" is confirmed
working in practice, not just by inspection.

**Lesson:** a Phase-scoped code delivery (session-handoff files) can be
internally consistent and still leave a real integration gap at the
boundary between what was delivered and what already existed in the
repo — `documents-read.ts` was installed and correct, but nothing forced
the 27 pre-existing page components consuming the *old* reader to be
updated in the same pass, and `tsc`/build/lint all stayed green
throughout because the type shapes genuinely matched. This class of bug
is only caught by exercising the actual write path live, not by static
verification — worth treating "builds and typechecks" as necessary but
not sufficient evidence a persistence-layer migration is complete going
forward.

### 61. PHASE 3 COMPLETE — real Firebase session-cookie auth replaces the local-only gate.

**Date:** 2026-09-02
**Status:** Done, verified live
**Commits:** e1851b6 (implementation), b173c13 (supporting research doc)
**Branch:** cloud-migration-phase-3

Decision #54's proposed Phase 3 is now implemented. The enforcement point
moves into the Node runtime, co-located with the data access it protects.

**What replaced what.** The previous design set an unsigned
`document.cookie = "__session=true"` client-side and checked for its presence
in the proxy. That cookie was script-readable, settable by any visitor from
devtools, and checked nowhere else — the gate was decorative. It is replaced
by a session cookie minted server-side by `firebase-admin` from a Firebase ID
token, HttpOnly, and verified on every request. `lib/server/session.ts`
provides `mintSessionCookie` / `getSessionUser` / `assertSession` (Route
Handlers, returns 401) / `requireSessionUser` (Server Components, redirects to
/login). `app/api/auth/session/route.ts` is the exchange endpoint.

**Why the proxy is not the boundary.** `proxy.ts` runs on the Edge runtime,
where `firebase-admin` cannot run — no Node crypto, no gRPC. It therefore
*cannot* verify a session cookie, only observe that one is present, which a
forged cookie also satisfies. The file documents this in its own header and
keeps a presence-only check as UX (redirect an obviously-signed-out visitor to
/login rather than into a page that 401s its own data fetch). A request that
slips past it still cannot read or write anything. Recording this explicitly
because a naive "just verify the cookie in middleware" change would reintroduce
exactly the flaw being removed.

**Access control.** An `NERD_ALLOWED_EMAILS` comma-separated allowlist, checked
both at session mint and on every subsequent request — re-checking per request
is what makes removing someone take effect immediately rather than at session
expiry. **Fails closed:** an empty or unset list denies everyone. Verified live
with an unlisted Google account, which was correctly rejected with "This
account is not authorized for N.E.R.D."

`NEXT_PUBLIC_DISABLE_AUTH` is deleted from the codebase, not merely unset — a
"skip all auth" branch existing anywhere in the tree is a standing invitation,
and its `LOCAL_MODE` sibling is what reached production in the 2026-07-08
incident (Decision #27).

**Deliberately NOT removed, contrary to the original Phase 3 plan:**
`lib/local-only.ts` and `lib/local-write.ts`'s `assertLocalOnly`. The plan
assumed both would be dead after the guard swap. They are not:
`lib/local-data.ts` still carries five live `isLocalOnlyAllowed()` guards on
the vendors and candidates editor read path, and `app/api/local/scrape/route.ts`
(Phase 5) still calls `assertLocalOnly`. Deleting the module would have broken
the build. Migrating `local-data.ts` off the local-only gate is deferred to its
own scoped pass — bolting it onto a security-boundary change would have been
the same mistake Decision #60 documents, in the opposite direction.

**Local development model** (per `docs/nerd-local-dev-08-28-26.md`): emulate
Firestore, use **real** Firebase Auth. Firestore is where local work is
dangerous — a stray write corrupts real directory data. Auth has nothing local
to corrupt, and signing in for real exercises the exact code path production
uses while sidestepping the Auth emulator's documented `no "kid" claim`
friction.

**Verification.** `tsc --noEmit`, build, and lint all clean. Exercised live
against the Firestore emulator with real Google sign-in: sign-in succeeds for
an allowlisted account, data loads through `requireSessionUser()`, edits save
through `assertSession()` with the ETag path intact, and an unlisted account is
denied. Two anticipated failure modes did not materialize — `localhost` was
already an authorized domain on this project, and `createSessionCookie`
succeeded without an explicit `roles/iam.serviceAccountTokenCreator` grant to
the ADC user identity. Both remain plausible on a fresh environment; see
`docs/firebase-nextjs-auth-configuration-09-02-26.md`.

---

### 62. `lib/local-data.ts` MIGRATION RECLASSIFIED — Phase 5 dead-code deletion, not an urgent production fix.

**Date:** 2026-09-02
**Status:** Decided
**Corrects the reasoning in:** Decision #61 ("Deliberately NOT removed" paragraph)
**Evidence:** `.scratch/verification/local-data-audit-20260902-2117-raw.md`, audited at `71f1de5`
**Superseded on phase attribution by:** Decision #63 — the scrape rehome and
the module-group deletion are Phase 4, not Phase 5. #62's findings stand
unchanged.

Decision #61 deferred removing `lib/local-only.ts` and `lib/local-write.ts`'s
`assertLocalOnly` on the stated grounds that `lib/local-data.ts` "still carries
five live `isLocalOnlyAllowed()` guards on the vendors and candidates editor
read path." **The guards are real; the read path is not.** A fresh importer
census at `71f1de5` establishes:

- `lib/local-data.ts` has exactly **one** importer in the entire tree:
  `app/api/local/scrape/route.ts` (lines 52-59). No module re-exports it.
- The six files previously believed to consume it —
  `app/editor/(routed)/vendors/page.tsx`,
  `app/editor/(routed)/vendors/layout.tsx`,
  `app/editor/(routed)/vendors/[slug]/page.tsx`,
  `app/editor/(routed)/candidates/[slug]/page.tsx`, `lib/published-tables.ts`,
  and `lib/directory-schema.ts` — do not. The four editor routes import
  `getVendors` / `getCandidates` from `@/lib/server/documents-read`; the two
  `lib/` files import no reader module at all. They were migrated by commit
  `5b46330` ([Decision #60](#60-phase-2-bug--editorrecords-pages-read-from-stale-filesystem-module-post-migration)).
  The earlier belief came from a substring search on the token `local-data`,
  which matches their **comments**.

**Consequence 1 — there is no production 404 risk, latent or otherwise.** No
page or layout reads through `lib/local-data.ts`. Its only importer is a Route
Handler whose own `assertLocalOnly()` is the first statement of `POST`
(`app/api/local/scrape/route.ts:229-230`) and returns 404 before any
`local-data.ts` function is reached — those calls sit inside
`sendPostRetrievalComparisons()`, invoked at line 304, within the response
stream. In any deployed environment the route 404s at its own gate and the five
`isLocalOnlyAllowed()` guards inside `local-data.ts` are unreachable.

**Consequence 2 — the module group shares a single root and is deleted
together, not migrated separately.** `app/api/local/scrape/route.ts` is the sole
root of the whole subgraph (`scrape → local-data → {local-only, local-write}`,
and `local-write → local-only`). Migrating that one route in Phase 5 makes
`lib/local-data.ts`, `lib/local-only.ts`, and `lib/local-write.ts` unreachable
simultaneously; they come out in one commit. No intermediate migration of
`local-data.ts` buys anything, because no other consumer exists to benefit from
it.

**Consequence 3 — Phase 4 moves ahead of this work in sequence.** The
`local-data.ts` migration was being treated as the next item on the strength of
the production-bug reading. With that removed it carries no urgency and folds
into Phase 5. Phase 4 (slim the Python service) becomes the next work.

**Surface parity is already complete, so the eventual deletion is mechanical.**
`lib/server/documents-read.ts` exports 12 symbols to `lib/local-data.ts`'s 12,
name-for-name, with identical signatures and return shapes. Document-kind
coverage is 7 of 7 (`published`, `added`, `candidate`, `vendors`, and the three
`*-live` snapshots) plus `tracking`; `lib/server/documents.ts` additionally
reaches `passwords`. Verified by reading both implementations, not by matching
names.

**Open, UNVERIFIED.** Swapping the scrape route's readers to
`documents-read.ts` would replace `notFound()` with `requireSessionUser()`,
which calls `redirect("/login")`. In that route the readers are invoked from
inside a `ReadableStream` `start()` callback (line ~304), after response headers
are committed, where a thrown `NEXT_REDIRECT` may not produce a usable response.
This has **not** been tested. The candidate fix — hoist the session check to the
top of `POST`, where `assertLocalOnly()` sits at line ~229 — is likewise
**UNVERIFIED**. Phase 5's design must settle it before the swap.

**Not changed by this entry.**
[Decision #27](#27-production-guardrails--local_mode-and-next_public_disable_auth-must-never-reach-deployed-environments)
stands unaffected: `NEXT_PUBLIC_DISABLE_AUTH` and `NERD_CLOUD_DEMO_LOCAL_WRITE`
must never reach a deployed environment. Decision #54's intent — that the flag
and `isLocalOnlyAllowed()` are deleted from the codebase rather than merely
unset — also stands; this entry fixes *when* (Phase 5, with the module group)
and *why* (dead code, not a live gate), not *whether*. `frontend/README.md` was
amended in the same pass to describe the flag's remaining scope accurately.

---

### 63. PHASE TARGETING CORRECTED — the scrape rehome and the local-only deletion are Phase 4, not Phase 5.

**Date:** 2026-09-02
**Status:** Decided
**Corrects:** Decision #62, which targeted Phase 5 throughout. #62's findings
stand; only its phase attribution was wrong. Append-only log — #62 is corrected
by this entry, not edited.

Decision #62 concluded that `lib/local-data.ts`, `lib/local-only.ts`, and
`lib/local-write.ts` share a single root (`app/api/local/scrape/route.ts`) and
must be deleted together when that route is migrated. That conclusion is
unchanged. It assigned the work to **Phase 5**. That was wrong, and the error
originated in the dispatch language rather than in the code audit.

**The plan of record puts the scrape rehome in Phase 4.** Five independent
statements, all predating #62:

- `docs/nerd-cloud-migration.md:124` — canonical phase map. Phase 4 is "Slim
  the Python service; **rehome the scrape as a polled Job**; bound the ingest
  path." Phase 5 is "Build, deploy, wire Firebase Hosting, attach the domain."
- `docs/nerd-cloud-migration.md:785` — Phase 4 CLI prompt, "Part C — Rehome the
  scrape as a polled job," which rewrites
  `frontend/app/api/local/scrape/route.ts`.
- `docs/nerd-cloud-migration.md:878` — Phase 4 exit criterion (correction C6):
  `grep -rn "node:fs\|NERD_REPO_ROOT\|libDir" frontend/` returns **zero** hits.
  `lib/local-write.ts` is the sole definer of `libDir()`; that criterion already
  forces the module group out in Phase 4, independent of this entry.
- `docs/nerd-stage3-architecture-spec-08-28-26.md:120` — "Phase 4: Python
  service slim + scrape rehome."
- `docs/nerd-stage3-architecture-spec-08-28-26.md:104` — "`grep -rn "node:fs"
  frontend/` returns only `app/api/local/scrape/route.ts` (**rehomed in Phase
  4**)."

Phase 5 also has no exit-criteria block at all, so there was no slot the
deferred Phase 3 criteria could have been moved into. **No phase is renumbered.**
Phase 4 and Phase 5 keep the meanings defined at `nerd-cloud-migration.md:124`.

**Documents corrected in this pass:**

- `docs/nerd-cloud-migration.md` — the two deferred Phase 3 exit criteria (the
  `NEXT_PUBLIC_DISABLE_AUTH` / `NERD_CLOUD_DEMO_LOCAL_WRITE` /
  `isLocalOnlyAllowed` zero-hit grep, and deleting `lib/local-only.ts`) moved
  into the Phase 4 exit criteria unchanged, with a note left at the Phase 3
  location recording the deferral and citing Decision #61. A third criterion was
  added there making the `local-data.ts` / `local-write.ts` deletion explicit.
- `docs/nerd-stage3-architecture-spec-08-28-26.md` — the Phase 3 "What it does"
  paragraph and two "Key changes" bullets annotated to show the local-only
  removal moved to Phase 4. Items relocated, not deleted.
- `frontend/README.md` — two "Phase 5" references corrected to Phase 4.
- `docs/reports/session-handoff-from-claude-09-02-26.md` — its three "Phase 5"
  sections merged into one Phase 4 entry; "Immediate next work" renumbered to
  two items.

**One finding worth recording separately.** `NERD_CLOUD_DEMO_LOCAL_WRITE` was
checked directly rather than assumed: it is **still live**, at
`frontend/lib/local-only.ts:24`, alongside `isLocalOnlyAllowed()` (line 21) and
`NEXT_PUBLIC_DISABLE_AUTH` (line 25). None of the three was removed in Phase 3.
All three come out together in Phase 4. Decision #46, which introduced
`NERD_CLOUD_DEMO_LOCAL_WRITE` for the tunneled-demo workflow, is retired at that
point — the workflow it existed for is replaced by a real deployed URL in Phase
5.

---

### 64. PHASE 4 RECON RESOLVED — renderer-deletion scoping, published.json dead import, stale line counts.

**Date:** 2026-09-03
**Status:** Decided
**Source:** `.scratch/verification/phase4-recon-20260903-1133-raw.md`, audited at `71f1de5`
**Corrects:** the "Done in Phase 4" subtitle of Decision #57 (append-only — #57 is
not edited); the stale `api/main.py` figure in
`docs/reports/session-handoff-from-claude-09-02-26.md`; the "1,950-line" phrase
carried in #57's own body.

#### (a) The `nerd_core/generators.py` render-half deletion is a standalone commit, not Phase 4 work.

Decision #57 is tagged **_(PROPOSED — Phase 4)_** and its subtitle says "Done in
Phase 4." That subtitle is wrong and is corrected here, not by editing #57: the
render-half deletion is **not** part of the Phase 4 execution dispatch. It is a
separate, test-covered commit gated on its own review.

The migration plan already says so, and both gates stand:

- `docs/nerd-cloud-migration.md:786` (Phase 4, Part A): "DECISION REQUIRED - stop
  and report, do not act ... Do not delete either renderer."
- `docs/nerd-cloud-migration.md:1115`: the dual renderer "is diagnosed in Phase 4
  but not resolved ... should happen with test coverage, as its own commit, not
  folded into a migration phase."

Phase 4's renderer task is diagnosis-and-report only. The recon has already done
that diagnosis and it holds: nothing reachable from `/ingest/draft` calls the
render half, and `frontend/lib/ncademiPreview.ts` (18,807 bytes) is the shipping
renderer per #57.

Why a standalone commit — recon evidence:

- The render half has callers outside `generators.py`:
  `scripts/migrate_archive_to_products.py` and `scripts/reprocess_redirects.py`
  both import `render_listing_html`, and `tests/unit/test_generators.py:2` imports
  parser and render symbols on one line — two render tests
  (`test_render_with_section_override`, `test_render_without_overrides_regression`)
  come out with it; the five parser tests in that file do not.
- The halves **are** cleanly separable: parser `77-209`, render `212-286`, shared
  dataclasses `30-74`, one bridge line (`generate_ncademi_html`, `285-286`). No
  shared helpers, no shared state.
- `jinja2` and `markupsafe` are render-only, and `generators.py` is their sole
  importer repo-wide — the deletion frees both dependencies and most of
  `templates/`.

#### (b) The `published.json` static import is dead code (Phase 2 residue), and is deleted.

`frontend/lib/published-tables.ts:16` does `import data from "./published.json"`
at build time. This is **not** a deliberate editorial freeze — it is left over
from before the Phase 2 Firestore port.

Evidence (recon):

- The module's runtime accessors (`getAllPublishedProducts`, `getPublishedProduct`,
  `getPublishedVendorResources`, and the rest) have **zero call sites** anywhere in
  `frontend/`.
- All 26 importers of `published-tables.ts` use `import type` — they consume the
  interfaces, not the data.
- All six editor/records "published" route files read Firestore via
  `getPublishedProducts()` from `lib/server/documents-read.ts:99`.
- Both a Firestore **read** path (`documents-read.ts:99`) and a Firestore **write**
  path (`documents.ts` — `DataKind` includes `"published"`) exist for the
  `published` kind.

**Decision:** delete the static import and the module's now-unreachable runtime
half (the `data` import, `PUBLISHED_DATA`, `BY_SLUG`, and the uncalled accessors).
Keep the **type** exports — 26 files depend on them.

`frontend/lib/published.json` the file is **retained for now** as the
pre-migration snapshot. It is removed in the **same commit as the local-only
module group** (`local-data.ts` / `local-only.ts` / `local-write.ts`, per
Decision #62), and only **after the Firestore copy of the `published` document is
confirmed complete and byte-verified**. Until that commit it stays in git as the
rollback artifact, alongside the other `frontend/lib/*.json` snapshots Phase 6
migrates.

This closes the UNVERIFIED question raised in the 2026-09-02 handoff ("UNVERIFIED
whether this is deliberate ... or an integration gap left by Phase 2").

#### (c) Stale line counts, corrected against the recon.

`.scratch/verification/phase4-recon-20260903-1133-raw.md` (at `71f1de5`)
establishes:

- `api/main.py` is **121 lines**, not 373 — Phase 1a already cut it. The
  "373 → ~40" framing is in
  `docs/reports/session-handoff-from-claude-09-02-26.md:60` (corrected in that
  file in this pass). `docs/nerd-cloud-migration.md` states no `main.py` line
  count.
- `nerd_core/generators.py` is **285 lines**, not "1,950"; the render half is
  ~75 lines. The "1,950-line deletion diff" phrase is in Decision #57's body
  (append-only — not edited; corrected here). The handoff says "large deletion
  diff" with no figure; `docs/nerd-cloud-migration.md` states no figure.
- The **~40-line target** for the Python slim is a goal, not a measurement, and is
  unchanged. From 121 it is closer than the plan assumes.

**The `store.py` / `job_store.py` import trap is already resolved — no edit is
pending.** `api/job_store.py` does not exist. `api/store.py:66-73` already carries
the relocated Firestore client init (`db = AsyncClient()` at line 71, guarded by
`if not LOCAL_MODE:`), with an explanatory comment ("Relocated from
api/job_store.py (deleted in the cloud-migration cleanup)"). The only importer of
`store` is `api/main.py:20`; nothing imports `job_store`. The "three-line move"
flagged as pending in `docs/nerd-cloud-migration.md` (Phase 1 constraints) and the
handoff was already done. `api/worker.py`, named in `store.py`'s docstring, is
also gone.

---

### 65. SCRAPE CREDENTIAL SOURCE DECIDED — the rehomed scrape reads passwords from Firestore, not Secret Manager, not at invocation.

**Date:** 2026-09-03
**Status:** Decided
**Source:** `.scratch/verification/passwords-recon-20260903-1209-raw.md`, audited at `20bb3ee`

**DECISION.** The rehomed scrape (Phase 4 Part C, run as a Cloud Run Job) obtains
vendor-review passwords by reading the Firestore `passwords` document
(`nerd_documents/passwords`) directly, using the Job's own runtime service
account. It does **not** read them from Secret Manager, and they are **not**
passed to the Job at invocation time (no `containerOverrides`, no env var, no
argument).

**This closes the open item** previously described in the 2026-09-02 handoff as
*"the scrape script reads password files from disk, so after the filesystem
removal the Next.js route must build and transmit a password index to the Python
service … a conscious credential exposure requiring an explicit decision."*
Nothing is transmitted. The Next.js route builds no index. The Job reads its own
credential source under its own identity.

**Rationale, in order.**

1. **Invocation-time passing is ruled out on documented grounds.** Per
   `docs/cloud-run-jobs-secrets-09-03-26.md`: execution overrides are recorded
   permanently in the immutable Execution resource in plain text, readable by
   anyone who can run `gcloud run jobs executions describe`; the `RunJob` API
   call is audit-classified as **Data Write**, so an override payload may be
   captured in Cloud Logging outside the container's isolated environment; and
   Google's own environment-variable documentation explicitly cautions against
   putting secrets in env vars. Passing the passwords per-execution would be the
   worst of the three options on exposure.

2. **Secret Manager is ruled out on source-of-truth grounds, not security
   grounds.** `passwords` is a live Firestore document kind (`AuxKind` in
   `frontend/lib/server/documents.ts:130`) that the editor writes to through
   `frontend/app/api/local/passwords/route.ts` — created on Candidate import
   (`POST`), removed on promote-to-published (`DELETE`). A Secret Manager copy
   would be a second store with no writer keeping it in sync: an operator
   importing a Candidate would update Firestore while the Secret Manager blob
   silently went stale. One authority is correct here; Secret Manager would
   manufacture a divergence.

3. **Firestore is already a Job dependency.** Phase 4 Part C has the Job writing
   progress to `nerd_scrape_jobs` in Firestore. Reading `nerd_documents/passwords`
   adds no new infrastructure, no new client library, and no new API surface.

**Latent bug this fixes.** `scripts/scrape_ncademi_live.py:186-212`
(`load_added_passwords()`) reads `frontend/lib/passwords.json`. That file has had
no writer since the Phase 2 Firestore port — it is frozen at its 2026-08-27
state, 31 records. Passwords are created once at Candidate import and never
edited or regenerated (`frontend/lib/passwords.ts`), so the Firestore document is
a strict superset of the file: any Candidate imported after 2026-08-27 has a
password that exists in Firestore and **not** in `passwords.json`, and the
current scrape cannot see it. Repointing the Job to Firestore fixes this
independently of the credential-source question.

**IAM consequence.** Because no overrides are passed, the frontend service
account needs only `roles/run.invoker` on the Job, not `roles/run.developer` /
`run.jobs.runWithOverrides`. The Job's **runtime** service account needs a
Firestore read role (`roles/datastore.viewer`, or `roles/datastore.user`)
scoped to the project — deny-all `firestore.rules` does not apply to Admin/SA
access. Neither service account is pinned today — `scripts/deploy.sh` passes no
`--service-account`, so both `nerd-frontend` and `nerd-api` run as the project
default Compute Engine SA. The intended bindings are described in
`docs/nerd-cloud-migration.md:970-982` but are not yet concrete.

**UNVERIFIED — Firestore Data Access audit logging.** Whether Data Access audit
logs are enabled for Firestore in this project is **not determinable from the
repo** (no `auditConfig` or IAM policy is version-controlled here). This matters
because Secret Manager's `AccessSecretVersion` Data Access log is the documented
strong-audit path for credential retrieval, whereas a Firestore `get` on
`nerd_documents/passwords` is only audited if project Data Access logs are on.
This was judged **not** to outweigh the source-of-truth argument in (2), given
the credential value recorded next. If a strong per-access audit trail on these
passwords is later required, enabling Firestore Data Access logs is the
mitigation, not switching stores.

**Credential value — observation, not a decision.** These passwords are generated
deterministically as `<first-four-letters-of-the-product-name><two-digit-year>`
(`frontend/lib/passwords.ts`), lowercased and space-stripped, with a numeric
suffix only on collision. They are created once at import, never regenerated, and
deleted at promote-to-published. Anyone who knows the scheme can derive a
product's password from its public product name. This is recorded here as
context for why the audit-logging tradeoff above is acceptable. Whether a
guessable, low-value, single-purpose preview password is itself an acceptable
design is **not decided by this entry** — it is raised as a separate open
question for a later review.

