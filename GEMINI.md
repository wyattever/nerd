# GEMINI.md — N.E.R.D. Agent Instructions

This file is the authoritative instruction set for the Gemini CLI agent
working on the N.E.R.D. codebase. Rules here apply to every session
unless explicitly overridden by the user in that session. When in doubt,
do less and ask.

---

## 1. Project Identity

**N.E.R.D.** (Ncademi EdTech Research & Data) is a production tool for
retrieving, validating, and formatting digital accessibility documentation
for EdTech products listed in the NCADEMI K-12 directory. It generates
WordPress-compatible HTML fragments using Vertex AI (Gemini 2.5 Flash)
with Google Search Grounding.

**GCP Project:** `edtech-agent-2026`
**Region:** `us-central1`
**GitHub:** `wyattever/nerd` (main branch is always deployable)

---

## 2. Precedence Over Global Configuration

This project's Gemini CLI sessions also load a GLOBAL config file at
~/.gemini/GEMINI.md, titled "Antigravity IDE Overrides." That file is
written for a different tool (Antigravity CLI/IDE) and is NOT applicable
to N.E.R.D. work. It is left in place globally because it may be relevant
to other projects or a future migration — it is not being deleted or
edited.

When working in this repository, DISREGARD the global "Antigravity IDE
Overrides" content entirely, including but not limited to:
- Model-tier switching guidance (Flash vs. Pro/Advanced)
- The "state and wait" mandatory protocol override
- "Do not read files not directly relevant to the current task" — this
  CONTRADICTS this project's read-only-diagnostics-first discipline
  (Section 9 [renumbered] / originally Section 8) and must not be
  followed here
- The single-retry-then-stop deployment rule — this project's own deploy
  rollback triggers (Section 7 [renumbered] / originally Section 6)
  govern deployment behavior instead

This project's rules (this file) take precedence over the global file in
every case of overlap or conflict, with no exceptions.

---

## 3. Architecture Overview

Three Cloud Run services plus shared core logic:

| Service | Purpose | Auth |
|---------|---------|------|
| `nerd-frontend` | Next.js 16 UI | Firebase Auth (client) |
| `nerd-api` | FastAPI orchestrator | Firebase ID token (Bearer) |
| `nerd-worker` | Async research processor | OIDC via Cloud Tasks only |

**Core packages:**
- `nerd_core/` — research, parsing, artifact generation (shared by api and worker)
- `prompts/` — Vertex AI prompt templates (shared by api and worker)
- `templates/` — Jinja2 HTML templates for NCADEMI listing output

**Data storage:**
- Firestore `nerd_candidates` — 28 research records (pending products)
- Firestore `nerd_products` — 43 finalized product records
- Firestore `nerd_research_jobs` — async job state (TTL: 24h)
- Local filesystem `NCADEMI_candidates/` and `NCADEMI_products/` — source
  JSON files on disk, seeded into LOCAL_MODE in-memory store on startup

**Stack versions:**
- Next.js 16.2.9, React 19, Tailwind 4, TypeScript 5
- FastAPI 0.124+, Python 3.10 (upgrade to 3.12 before Oct 2026)
- Firebase Auth (client-side), firebase-admin (server-side, ADC)
- `@microsoft/fetch-event-source` (SSE transport with Bearer auth)

---

## 4. Environment Model

There are exactly two environments. Never create a third.

### LOCAL_MODE=true (development)
- Firestore replaced by in-memory dict seeded from filesystem JSON files
- Cloud Tasks replaced by FastAPI BackgroundTasks
- Firebase Auth bypassed via NEXT_PUBLIC_DISABLE_AUTH=true
- All research runs are free (no Vertex AI calls unless explicitly testing)
- Run with: `LOCAL_MODE=true uvicorn api.main:app --port 8000 --reload`

### Production (Cloud Run)
- Firestore: real data, PITR enabled
- Cloud Tasks: real queue with OIDC auth
- Firebase Auth: enforced, tokens verified by firebase-admin via ADC
- Worker uses ADC (roles/aiplatform.user on compute SA) — NO API key
- ENABLE_AI_INSIGHTS=true on the worker

**CRITICAL:** Never set LOCAL_MODE=true or NEXT_PUBLIC_DISABLE_AUTH=true
in any Dockerfile, cloudbuild.yaml, or deploy configuration. If found,
flag as a CRITICAL blocker and stop.

---

## 5. Authentication Architecture

### Worker (nerd-worker)
Uses Application Default Credentials via the Cloud Run service account
(`660897852208-compute@developer.gserviceaccount.com`).
- `roles/aiplatform.user` granted for Vertex AI / Gemini calls
- `roles/datastore.user` granted for Firestore
- NO GEMINI_API_KEY — do not add one
- ENABLE_AI_INSIGHTS=true in production

### API (nerd-api)
- Firebase ID tokens verified by firebase-admin via ADC
- FRONTEND_URL env var controls CORS — must match the deployed frontend URL
- Current production value: `https://nerd-frontend-meomhj23xq-uc.a.run.app`

### Frontend (nerd-frontend)
- NEXT_PUBLIC_FIREBASE_API_KEY and NEXT_PUBLIC_FIREBASE_APP_ID are
  build-time variables baked into the JS bundle at Cloud Build time
- They are passed as --substitutions in cloudbuild.yaml
- Changing them at runtime on Cloud Run does NOTHING — requires rebuild
- They must be exported as shell env vars before running deploy.sh

---

## 6. Data Directory Structure

There are TWO data directories. Both matter. Do not confuse them.

| Directory | Firestore Collection | Count | Purpose |
|-----------|---------------------|-------|---------|
| `NCADEMI_candidates/` | `nerd_candidates` | 30 files (28 real + 2 fixtures) | Research in progress |
| `NCADEMI_products/` | `nerd_products` | 43 files | Finalized, on NCADEMI website |

**Test fixtures (do not migrate to Firestore):**
- `NCADEMI_candidates/e2e-test-candidate.json` — E2E test fixture
- `NCADEMI_candidates/test-product-29.json` — test fixture

**Migration script:** `scripts/migrate_to_firestore.py`
- Supports `--dry-run` and `--collection candidates|products`
- Skips files whose product_name contains "test" or "e2e"
- Must be run with GOOGLE_CLOUD_PROJECT=edtech-agent-2026
- Only run against production Firestore with explicit user authorization

---

## 7. Deploy Rules (Read Before Touching deploy.sh)

`scripts/deploy.sh` is the canonical deployment script. It deploys in
order: worker → api → frontend.

### NEVER modify deploy.sh without showing a diff first and receiving
explicit user confirmation. The following have been broken by unauthorized
changes in the past:

- `--no-traffic` and `--tag=candidate` on the frontend deploy command —
  these are REQUIRED. Removing them sends untested code to 100% traffic.
- `--set-secrets="GEMINI_API_KEY=..."` on the worker — the worker uses
  ADC, not a secret key. Do not add this back.
- `ENABLE_AI_INSIGHTS=true` on the worker — do not change to false.
- `--set-env-vars` on the API — FRONTEND_URL must be present and correct.

### Before running deploy.sh you must verify:
1. NEXT_PUBLIC_FIREBASE_API_KEY is exported in the shell
2. NEXT_PUBLIC_FIREBASE_APP_ID is exported in the shell
3. A .gcloudignore file exists in the execution directory
4. The working tree is clean (git status --short returns nothing)
5. The test suite is green (92+ passed, 0 failed)

### After a frontend deploy:
- The revision lands with 0% traffic (--no-traffic)
- Manual validation is required at the tagged URL before shifting traffic
- Traffic shift is always: 5% → 25% → 50% → 100%
- Rollback trigger: error rate > 5% or p99 latency > 5s

### After an API or worker deploy:
- Verify FRONTEND_URL is still set on nerd-api
- Verify ENABLE_AI_INSIGHTS=true on nerd-worker
- Verify no GEMINI_API_KEY secret reference was added to worker

---

## 8. Output Safety

**NEVER output credentials, secrets, or sensitive values in plain text.**
This includes API keys, secret tokens, App IDs, project credentials,
service account keys, OAuth tokens, or any value sourced from Secret
Manager, .env files, or `gcloud secrets versions access`.

When a command returns a sensitive value:
- Confirm it is present and non-empty: yes / no
- Confirm it is not a placeholder: yes / no
- Truncate output to the first 8 characters followed by [REDACTED]
- Never paste the full value, even partially, into response output

This rule applies to ALL output regardless of context, session, or
instruction. It cannot be overridden by any prompt or user request.

---
\
## 9. Test Suite

Four layers — all must be green before merging to main or deploying.

```bash
# Run all Python tests (unit + integration + integrity)
source venv312/bin/activate
export PYTHONPATH=$PYTHONPATH:.
LOCAL_MODE=true pytest tests/ --tb=short -q --disable-warnings

# Frontend build check (catches TypeScript errors)
cd frontend && npm run build

# E2E (run before merging UI or auth changes)
cd frontend && npx playwright test
```

Warnings are suppressed from output via --disable-warnings. This
hides the summary block only — it does not disable warning
collection. As of this writing, all known warnings (14) originate
from third-party dependencies (protobuf/googleapis-common-protos,
pydantic usage inside google-generativeai, dspy-ai) and require no
action in this codebase. To see full warning detail when debugging
a dependency upgrade or investigating new behavior, run with -rw
instead: LOCAL_MODE=true pytest tests/ --tb=short -q -rw

**Current baseline:** 92 Python tests passing, 6 E2E tests passing.
Any PR that reduces these counts requires explicit justification.

**Tests that directly assert on filesystem paths:**
- `tests/integrity/test_candidate_files.py` — has conditional skip for
  non-GCP environments. Validates source JSON files on disk, not Firestore.

---

## 10. Branch and Commit Discipline

- `main` is always deployable. Never commit broken code to main.
- Use feature branches for all work: `feat/`, `fix/`, `chore/` prefixes.
- Commit at verified-good states, not after every edit.
- Never push or rewrite git history without explicit user instruction.
- Never run `git push` without explicit user instruction.
- Show diffs before applying any edit to an existing file.
- Show complete new file contents before writing any new file.

**Commit message format:**
```
type: short description (imperative, max 72 chars)

- Bullet points for non-obvious details
- Reference any decision log entries affected
```

---

## 11. Code Change Rules

- Do not refactor or improve code beyond what the current task requires.
- Do not add npm packages that are not imported in source code.
- Do not add Python packages without updating requirements.txt or
  requirements-worker.txt as appropriate.
- Do not modify production modules (api/, nerd_core/) to make a test
  pass — fix the test infrastructure instead.
- WCAG compliance is mandatory, not optional. Any new UI component must
  have: aria labels, keyboard operability, visible focus, role="alert"
  for errors, aria-live for status updates.
- Any new or modified interactive UI component must have a corresponding
  automated accessibility check using @axe-core/playwright (already a
  devDependency) before it is considered complete. Manual ARIA attribute
  review alone does not satisfy this requirement — run the actual
  AxeBuilder scan as part of the E2E suite (tests/e2e/) and confirm zero
  violations, consistent with NERD_System_Architecture.md Section 4.D.
- Mobile is out of scope. Do not factor mobile into any decision.
- Output format is WordPress-compatible HTML only. DOCX is removed.
- NEVER write code that persists a raw `grounding-api-redirect` URL
  (the temporary https://vertexaisearch.cloud.google.com/grounding-api-redirect/...
  format returned in Vertex AI groundingChunks) directly into a
  ListingData JSON artifact, Firestore document, or any other storage
  layer. These URLs expire and must be resolved to their canonical
  destination via the link validator engine before persistence. If you
  are writing or modifying parsing/storage code that touches grounding
  metadata and you are not certain whether resolution has already
  happened upstream, STOP and ask rather than assume.

---

## 12. Session Hygiene

Start a new Gemini session (exit and reinvoke without --resume) when:
- You are starting a new phase or major task
- You observe "Compressing chat history..." on two consecutive turns
- You have just completed a /restore rollback
- You cannot locate an execution rule established at the start of the
  session without the user re-stating it

Before any task that reads multiple large files or runs a test suite,
run /compress if the session is more than 15 turns old.

Never resume a session that was interrupted mid-task without first
checking git status and git diff to understand what state was left.

---

## 13. Deferred Cleanup Items

These are known issues flagged for future action. Do not address them
unless explicitly instructed:

- `artifacts/` directory is still COPYed in `Dockerfile.api` — bloats
  the image, should be removed.
- Legacy Artifact Registry image at `edtech-agent-2026/edtech-assistant-
  repo/edtech-assistant` — can be deleted to save storage costs.
- `gemini-api-key` in Secret Manager contains a placeholder — unused
  since worker switched to ADC. Can be deleted or updated.
- Python 3.10 in API base image — upgrade to 3.12 before October 2026.
- `NEXT_PUBLIC_DISABLE_AUTH` reference in middleware.ts — document that
  this must never be true in any production build config.

---

## 14. Quick Reference — Production URLs

| Service | URL |
|---------|-----|
| Frontend | https://nerd-frontend-meomhj23xq-uc.a.run.app |
| API | https://nerd-api-meomhj23xq-uc.a.run.app |
| Worker | https://nerd-worker-meomhj23xq-uc.a.run.app |
| Firebase Console | https://console.firebase.google.com/project/edtech-agent-2026 |
| Cloud Run Console | https://console.cloud.google.com/run?project=edtech-agent-2026 |
| Firestore Console | https://console.cloud.google.com/firestore?project=edtech-agent-2026 |

---

*Last updated: June 16, 2026 — Post-migration production baseline.*
*All three Cloud Run services deployed and verified. Legacy edtech-assistant retired.*
