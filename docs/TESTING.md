# N.E.R.D. Testing Suite Guide

This document outlines the multi-layer testing strategy for the N.E.R.D. (Ncademi Edtech Research & Data) application.

## Testing Layers

### 1. Unit Tests (`pytest`)
- **Target:** `tests/unit/`
- **Scope:** Pure functions, regex parsers, and schema validation.
- **Run:** `source venv312/bin/activate && export PYTHONPATH=$PYTHONPATH:. && pytest tests/unit/`

### 2. Integration Tests (`pytest` + `httpx`)
- **Target:** `tests/integration/`
- **Scope:** FastAPI endpoints, CRUD lifecycle, and SSE job streaming.
- **Run:** `export LOCAL_MODE=true && pytest tests/integration/`
- **Note:** Uses `httpx.ASGITransport` to test the API without a live server.

### 3. Data Integrity Tests (`pytest`)
- **Target:** `tests/integrity/`
- **Scope:** Validates all stored JSON files in `NCADEMI_candidates/` against the current Pydantic schema and scans for unresolved redirects.
- **Run:** `pytest tests/integrity/`

### 4. E2E Tests (Playwright + Axe)
- **Target:** `frontend/tests/e2e/`
- **Scope:** Full UI flows (Inject, Edit, Save, Delete) and WCAG accessibility scans.
- **Prerequisites:**
  - Backend running: `bash scripts/run_nerd.sh` (or `uvicorn api.main:app --port 8000`)
  - Frontend running: `cd frontend && npm run dev`
- **Run:** `cd frontend && npx playwright test`

## Best Practices

### Mocking
- **Vertex AI / Gemini:** Always mock LLM calls in unit and integration tests.
- **Firebase Auth:** Use `LOCAL_MODE=true` to bypass real token verification during local development and testing.

### Accessibility (WCAG)
- Every new UI component must be scanned using `@axe-core/playwright`.
- Maintain `aria-live` regions for status updates to ensure compliance with WCAG 4.1.3.

### Data Validation
- If you modify `api/schemas.py`, immediately run Data Integrity tests to ensure existing files are still compatible.

## Out of Scope
- **Mobile Viewports:** Only desktop layout is currently tested.
- **Load Testing:** Research jobs are rate-limited by upstream LLM/Crawler quotas.
