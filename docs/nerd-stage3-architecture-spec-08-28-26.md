# N.E.R.D. Stage 3 Architecture Spec — Firestore Persistence Port

**Date:** 2026-08-28
**Preconditions met this session:** Stage 1 (backend redeploy), Stage 2 (frontend redeploy), Firestore legacy data cleared (Decision #50).
**Basis:** `repomix-output.xml`, `docs/nerd-cloud-migration-phases-1-6.md` (Phases 1–6), `docs/cloud-republish-difficulty-assessment-08-27-26.md`, `docs/backend-rewrite-vs-refactor-08-27-26.md`, live-infra audit findings.

---

## What Stage 3 actually is

Stage 3 is not one task — it's the migration doc's Phases 1 through 4, in sequence. Each phase has a detailed CLI prompt already written in `docs/nerd-cloud-migration-phases-1-6.md`. This document maps those phases to what remains after today's session, identifies what's changed or already done, flags decisions that need to be made before execution, and provides the sequencing constraints.

---

## Current state after today

| Item | Status |
|---|---|
| `nerd-api` on current `main` | ✅ Live, `nerd-api-00042-g25`, 100% traffic |
| `nerd-worker` on current `main` | ✅ Live, `nerd-worker-00003-p9k`, 100% traffic |
| `nerd-frontend` on current `main` | ✅ Live, `nerd-frontend-00014-kup`, 100% traffic |
| `deploy.sh` fixes (F23, F24, F27) | ✅ Merged to `main` |
| Firestore `nerd_products` (43 docs) | ✅ Cleared (Decision #50) |
| Firestore `nerd_candidates` | ✅ Confirmed empty |
| GCP project | ✅ `edtech-agent-2026`, all auth verified |
| `/editor` in cloud | ⛔ Correctly blocked — local-only gate active |
| `/records` in cloud | ⛔ Same — no persistence layer |
| AppSheet retirement Phase 1 | 🔲 Not started — hard gate on data migration |

---

## Phase map — migration doc phases → Stage 3 work

### Phase 1: Subtraction (~1 session)

**What it does:** Deletes ~1,950 lines — the research orchestration, worker, AppSheet layer, and dead admin routes. Pure deletion, reducing the surface before persistence work begins.

**What's changed since the migration doc was written:**
- `nerd-worker` was just redeployed. Phase 1 deletes `Dockerfile.worker`, `requirements-worker.txt`, and the worker code. The deployed `nerd-worker` Cloud Run service becomes orphaned — it should be deleted from Cloud Run after Phase 1 commits, as a separate step.
- `/admin/batch-report` now has `Depends(verify_token)` (today's fix). Phase 1's Group D deletes this route entirely, so the fix is moot but not harmful.
- Decision #50 cleared Firestore, so `store.py`'s product/candidate CRUD paths are now provably dead (no data to serve, no caller to serve it to).

**Pre-decision needed:** The migration doc's Phase 1 says "delete the AppSheet layer" outright. The `docs/appsheet-retirement-plan.md` says "archive, don't delete" and has an unexecuted Phase 1 (verification) as a hard gate. These two documents conflict. Options:
1. Run AppSheet retirement verification first, then archive per that plan, then proceed with migration Phase 1.
2. Accept that AppSheet data is frozen in git history (`frontend/lib/appsheet-tables.json` is committed) and delete outright per the migration doc.
3. Move the AppSheet files to `docs/superseded/` (the project's archival convention) rather than deleting, then proceed.

**Recommendation:** Option 3 — archive to `docs/superseded/`, consistent with the project's convention and satisfying both documents' intent. The diff script from the retirement plan can still be built later against the archived snapshot if needed.

**Files deleted (from migration doc, verified against repomix):**

| Group | Files | Lines |
|---|---|---|
| A | `frontend/hooks/useResearch.ts` + call sites | ~205 |
| B | `api/worker.py`, `api/job_store.py`, `nerd_core/services.py`, `nerd_core/telemetry.py`, `Dockerfile.worker`, `requirements-worker.txt`, `prompts/system_prompt.j2`, `prompts/delta_system_prompt.j2` | ~690 |
| C | `api/appsheet_parser.py`, `frontend/lib/appsheet-tables.ts`, `frontend/lib/appsheet-tables.json`, `frontend/app/api/local/migrate-appsheet/route.ts`, `frontend/app/tables/`, `AppsheetSortableTable.tsx` | ~1,060 |
| D | Routes in `api/main.py`: `/research/initial`, `/jobs/{job_id}`, `/render`, `/research/validate-links`, all `/admin/candidates*`, all `/admin/products*`. **Keep:** `/ingest/draft`, `/healthz` | varies |
| E | From `requirements.txt`: `google-genai`, `google-cloud-tasks`, `google-cloud-bigquery` | — |

**Constraint from migration doc:** `api/store.py` imports `from .job_store import db`. Deleting `job_store.py` breaks that. Relocate the Firestore client init into `store.py` itself — a move, not a rewrite.

### Phase 2: Firestore persistence port (~2–3 sessions, the bulk of the work)

**What it does:** Replaces all filesystem persistence with Firestore. The public interface of every function stays identical — same name, same signature, same return shape.

**Data model** (from migration doc §9, confirmed still correct):

Collection: `nerd_documents`. One document per logical file.

| Document ID | Source file | Tier |
|---|---|---|
| `published` | `published.json` (107 KB) | 1 — ETag guarded |
| `added` | `added.json` (28 KB) | 1 — ETag guarded |
| `candidate` | `candidate.json` (9 KB) | 1 — ETag guarded |
| `vendors` | `vendors.json` (22 KB) | 1 — ETag guarded |
| `published-live` | `published-live.json` (128 KB) | 2 — read-only snapshots |
| `added-live` | `added-live.json` | 2 — read-only snapshots |
| `vendors-live` | `vendors-live.json` (25 KB) | 2 — read-only snapshots |
| `tracking` | `tracking.json` | 3 — unguarded read-modify-write |
| `passwords` | `passwords.json` | 3 — unguarded read-modify-write |

All documents store raw JSON as a string (not a native Firestore map). Three reasons, in order of weight:
1. ETag contract is SHA-256 of exact bytes — any parse/reserialize risks key reordering.
2. Documents use `$schema_version` and `$meta` as top-level keys — avoids Firestore field-name questions.
3. Nothing queries into these documents — every reader loads the whole array and filters in memory.

All documents fit well within Firestore's 1 MiB limit (largest is `published-live.json` at 128 KB = 12%).

Backups: sibling documents with `__bak` suffix, same shape.

**Concurrency model change:** Today's flow has a TOCTOU window between read and write. Firestore transaction that re-reads `sha256` inside the transaction closes that window. Client contract (`If-Match` header, 412 on mismatch) stays byte-identical.

**New files created:**
- `frontend/lib/firestore-admin.ts` — singleton Admin SDK init, server-only
- `frontend/lib/doc-store.ts` — `readDocument`, `writeDocument`, `deleteDocument`, `backupThenWrite`, `backupThenDelete`

**Files rewritten (interface preserved):**
- `frontend/lib/local-write.ts` — delete `libDir()`, `pathFor()`, `atomicWrite()`, `refreshBackup()`, all `node:fs`/`node:path` imports. Rename `documentPath()` → `documentId()`, `liveSnapshotPath()` → `liveSnapshotId()`.
- `frontend/lib/local-data.ts` — port `getPublishedLiveProducts`, `getAddedLiveProducts`, `getLiveVendors` to read from Firestore.
- Four route handlers: `published-live/route.ts`, `vendors-live/route.ts`, `passwords/route.ts`, `promote-live/route.ts`.

**Dependency exception:** `firebase-admin` added to `frontend/package.json`. This is a deliberate exception to the no-new-dependencies rule, requiring a DECISION_LOG entry.

**Exit criterion from migration doc:** `grep -rn "node:fs" frontend/` returns only `app/api/local/scrape/route.ts` (rehomed in Phase 4).

### Phase 3: Authentication (~1 session)

**What it does:** Replaces the forgeable `__session=true` cookie with real Firebase session cookies. Removes `isLocalOnlyAllowed()`, `NEXT_PUBLIC_DISABLE_AUTH`, and `NERD_CLOUD_DEMO_LOCAL_WRITE`.

**Key changes:**
- New `POST /api/auth/session` route — mints real Firebase session cookie
- `proxy.ts` — remove DISABLE_AUTH bypass, remove blanket `/api` exemption
- New `frontend/lib/session.ts` — `requireSession()` helper
- Replace `assertLocalOnly()` at every call site with session verification (returns 401, not 404)
- Create `firestore.rules` (deny-all for now — Admin SDK bypasses rules)
- Delete `frontend/lib/local-only.ts`

**The test that proves the fix:** A forged `__session=true` cookie must be rejected with 401.

### Phase 4: Python service slim + scrape rehome (~1–2 sessions)

**What it does:** Four parts.

**Part A — Slim Python.** After Phase 1, `api/main.py` should have only `/ingest/draft` and `/healthz`. Remove `verify_token`, bearer scheme, `Depends(verify_token)`, CORS middleware. Service deployed `--no-allow-unauthenticated`; Cloud Run IAM replaces app-level auth.

**Part B — Next.js server-side client.** New `frontend/lib/ingest-client.ts` calls Python service with OIDC identity token from the metadata server. No new dependency — tokens come from `http://metadata.google.internal/...`. `ImportDataModal.tsx` calls through a Next.js Route Handler instead of directly to the Python service.

**Part C — Scrape as Cloud Run Job.** Replace SSE streaming with polled job. Job state in Firestore collection `nerd_scrape_jobs`. Cloud Run Job (not a service endpoint) for execution. ARIA live region wiring preserved (WCAG 4.1.3).

**Part D — Measure and bound ingest.** Per-link HTTP timeout ≤5s, overall budget 50s, partial results with "not verified" marker rather than 504.

---

## Sequencing constraints

```
Phase 0 (already done — edtech-agent-2026 has all infrastructure)
    │
    ├── Phase 1 (Subtraction) ─── can start immediately
    │       │
    │       ▼
    │   Phase 2 (Firestore port) ─── requires Phase 0 + Phase 1
    │       │
    │       ▼
    │   Phase 3 (Auth) ─── requires Phase 2
    │       │
    │       ▼
    │   Phase 4 (Python slim + scrape) ─── requires Phase 3
    │       │
    │       ▼
    │   Phase 5 (Deploy) ─── requires all above
    │       │
    │       ▼
    │   Phase 6 (Data migration) ─── requires Phase 5
    │
    └── AppSheet retirement ─── independent, can run in parallel
```

Phase 0 is effectively done — `edtech-agent-2026` already has Firestore Native, Artifact Registry, Cloud Tasks, the service accounts, and all APIs enabled. The migration doc's Phase 0 was written assuming a new project; since we're reusing the existing one, the only Phase 0 items potentially missing are: an Artifact Registry cleanup policy (nice-to-have) and the $5/month budget alert.

---

## Decisions needed before Phase 1 can start

1. **AppSheet: delete vs. archive** — recommendation is archive to `docs/superseded/` (Option 3 above).
2. **`/tables` route — delete or keep?** Phase 1 Group C deletes `frontend/app/tables/` (the AppSheet table viewer). But `/tables` currently works in cloud and shows data. If users expect it to keep working, it needs to be excluded from Phase 1's deletion scope. Judgment call: is `/tables` useful to the three users, or was it only ever a diagnostic tool?
3. **`nerd-worker` Cloud Run service cleanup** — after Phase 1 deletes the worker code, should the deployed `nerd-worker` service be deleted from Cloud Run, or left dormant at scale-to-zero? Recommendation: delete — it costs nothing at zero instances, but leaving orphaned services is confusing.
4. **Migration doc correction** — `docs/nerd-cloud-migration-phases-1-6.md` Phase 1 conflicts with `docs/appsheet-retirement-plan.md`. Whichever AppSheet approach is chosen (#1 above), the migration doc needs a one-line correction before Phase 1 is executed. This is the "reconcile before anyone runs Phase 1" item flagged earlier.

---

## Effort estimate

| Phase | Effort | Risk | Notes |
|---|---|---|---|
| Phase 1 (Subtraction) | 1 session | Low | Pure deletion, well-specified |
| Phase 2 (Firestore port) | 2–3 sessions | Medium | Largest phase, but interfaces preserved |
| Phase 3 (Auth) | 1 session | Medium | Session cookie + proxy rewrite |
| Phase 4 (Python + scrape) | 1–2 sessions | Medium-High | Cloud Run Job is new infrastructure |
| Phase 5 (Deploy) | 1 session | Medium | First irreversible step |
| Phase 6 (Data migration) | 0.5 session | Low | Seed Firestore from committed JSON |
| **Total** | **~7–9 sessions** | | |

These are judgment calls anchored to the migration doc's file counts and code shapes, not measured velocity.

---

## What the migration doc gets right vs. what needs updating

**Gets right:**
- The Firestore data model (raw JSON as string, SHA-256 ETag, transaction-based concurrency)
- The persistence tier classification (Tiers 1–4)
- The phase sequencing and exit criteria
- The CLI prompt structure (read-only inventory → approval gate → execution → verification)
- The "no new frontend dependencies except firebase-admin" constraint
- The Cloud Run Job approach for the scrape (vs. trying to stream through Firebase Hosting's 60s ceiling)

**Needs updating:**
- Phase 0 assumes a new GCP project — we're reusing `edtech-agent-2026`
- Phase 1's AppSheet deletion conflicts with the retirement plan
- The `nerd-worker` deploy we just did means Phase 1 needs a Cloud Run service deletion step
- Phase 5's deploy instructions partially overlap with what `deploy.sh` already does (and `deploy.sh` is now corrected)
- The migration doc doesn't mention the `acp-vertex-core` ADC pitfall — every Python dispatch touching Firestore/Firebase must pin `projectId` explicitly
