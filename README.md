# N.E.R.D.

**N**CADEMI **E**dTech **R**esearch & **D**ocumentation — a K-12 EdTech accessibility directory tool. It researches and documents WCAG 2.2, VPAT/ACR, and Section 508 compliance for EdTech products, and generates WordPress-ready HTML for the NCADEMI accessibility directory (`ncademi.org`).

MVP-stage. Local-server-only; public deployment is not yet active.

## Current scope

Active development is scoped to the **Import Data** path: pasting a Gemini-Gem-generated Markdown research draft into the UI, validating and parsing it through the production pipeline (`nerd_core/pipeline.py`), and loading the result into the editor for review before saving as a candidate.

**Generate Listing** — triggering a *new* live research run against Gemini directly (`/research/initial`, `/research/deep-dive`, the SSE streaming UI) — is deliberately out of scope for now. See [Decision #30](docs/DECISION_LOG.md#30-generate-listing--deferred-import-data-is-the-active-path). The shared pipeline code means fixes to the Import Data path benefit Generate Listing whenever it's reinstated.

A separate, unaffected initiative — the **NCADEMI Products Viewer** — is also in progress; see [`docs/NERD_System_Architecture.md` §3.E](docs/NERD_System_Architecture.md#e-ncademi-products-viewer-separate-initiative-in-progress).

## Stack

- **Frontend** (`frontend/`) — Next.js 16 (App Router, TypeScript) + Tailwind + Firebase Auth. Deployed as `nerd-frontend`.
- **API** (`api/`) — FastAPI, deployed as `nerd-api`. Handles auth, admin CRUD, SSE job streaming, and `/ingest/draft`.
- **Worker** (`api/worker.py`) — separate FastAPI Cloud Run deployment, `nerd-worker`. Long-running research, invoked via Cloud Tasks. Callable only via OIDC.
- **Core logic** (`nerd_core/`) — research, parsing, validation, and HTML generation. Shared by `api` and the worker; both Dockerfiles copy it independently (`requirements.txt` for `nerd-api`, `requirements-worker.txt` for `nerd-worker`).
- **Data** — Firestore in production; in-memory dict in `LOCAL_MODE`. Async queue: Cloud Tasks in production, FastAPI `BackgroundTasks` in `LOCAL_MODE`. Telemetry to BigQuery.
- **AI** — Gemini 2.5 Flash with Google Search Grounding via Vertex AI, ADC-authenticated (worker) / API-key-authenticated (`nerd-api`) — these differ intentionally, see [Decision #28](docs/DECISION_LOG.md#28-worker-auth--adc-only-no-gemini_api_key-on-nerd-worker).
- **Output** — WordPress-compatible HTML mirroring `wp-block` classes. HTML only; DOCX generation was removed ([Decision #1](docs/DECISION_LOG.md#1-output-format--html-only-docx-removed)).

GCP project: `edtech-agent-2026`, region `us-central1`.

## Repo layout

```
api/            FastAPI app: endpoints, schemas, job store, admin CRUD
nerd_core/      Shared research/parsing/validation/generation logic
frontend/       Next.js app (App Router)
  app/
    page.tsx          Generate Listing / Import Data editor
    researcher/        /researcher — seeded product tracking table
    tables/            /tables — read-only AppSheet recovery tables
    users/              /users — user directory (no auth gate yet, MVP-stage)
scripts/        Ops, migration, and batch-ingestion scripts
templates/      Jinja2 HTML templates (preview only, not a publishing artifact)
prompts/        Gemini system prompts
eval/           promptfoo-based prompt evaluation harness
tests/          unit / integration / integrity / smoke / e2e
docs/           Architecture, decisions, and reference docs (see below)
```

## Local development

```
run_nerd()          # starts nerd-api-local (Docker, port 8080) and the Next.js dev server (port 3000)
```

`run_nerd()` hardcodes `GOOGLE_CLOUD_PROJECT=edtech-agent-2026` and mounts Application Default Credentials — the shell's global `GOOGLE_CLOUD_PROJECT` (used by unrelated tooling) must never leak into N.E.R.D.'s containers.

Python: `python3` / `python3 -m pytest`, with `venv312` activated (system Python via Homebrew lacks project packages). Node: standard `npm run dev` inside `frontend/`.

```
python3 -m pytest tests/ --ignore=tests/smoke -q      # full suite, excluding cloud smoke tests
cd frontend && npx tsc --noEmit                        # typecheck
cd frontend && npm run build                            # production build
```

## Key docs

- [`docs/DECISION_LOG.md`](docs/DECISION_LOG.md) — present-tense record of settled architectural and scope decisions. Check here before revisiting something that looks odd; it's probably deliberate.
- [`docs/NERD_System_Architecture.md`](docs/NERD_System_Architecture.md) — system design, distributed architecture, workflows, security.
- [`docs/nerd-import-data-architecture-v4.md`](docs/nerd-import-data-architecture-v4.md) — the Import Data feature's full architecture spec, cited throughout the codebase.
- [`docs/TESTING.md`](docs/TESTING.md) — the 4-layer testing strategy.
- [`docs/superseded/`](docs/superseded/) — historical docs, one-off dispatch prompts, and reports that no longer reflect the current codebase. Kept for provenance, not for reference.

## Multi-agent workflow

Claude acts as architect, reviewer, and prompt author. Gemini CLI is a mechanical code executor, dispatched via scoped, single-phase prompts with explicit stop gates — Gemini's self-reported PASS/FAIL is never accepted without independent verification against actual diffs and terminal output.