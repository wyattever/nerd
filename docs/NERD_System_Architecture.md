# System Design Document: N.E.R.D.

**NCADEMI EdTech Research for the Directory** *Last Updated: July 08, 2026*

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

## 3. Core Workflows

### A. Two-Stage Research

1. **Initial Research**: A broad sweep identifying core accessibility pages.
2. **Deep Dive**: Iterative extraction focusing on high-difficulty targets like `.edu` reviews or state-level registries.

### B. Link Resolution & Remediation

* **Mandatory Resolution**: All redirect URLs from Google Search Grounding are resolved to canonical destinations before storage.
* **On-Demand Validation**: High-fidelity browser validation is invoked **manually** by administrative users; it is no longer triggered by automated UI research workflows.

### C. Live Preview & Edit

Researchers can edit Pydantic-mapped listing data in real-time, triggering server-side Jinja2 re-renders for instant preview.

## 4. Multi-Layer Testing Strategy

Protected by a 4-layer validation suite (documented in `docs/TESTING.md`):

1. **Unit Tests**: `pytest` for parsers and schema validation.
2. **Integration Tests**: Validates API routes and SSE streaming.
3. **Data Integrity Tests**: Ensures 100% schema compliance and zero leaked proxy URLs.
4. **E2E Tests**: Automates the full UI lifecycle and WCAG compliance.

## 5. Security Guardrails

### A. SSRF Mitigation

Hostnames are resolved to IP addresses before every request, blocking all traffic to internal GCP ranges or private networks.

### B. OIDC Handshake

Worker-to-API communication is authenticated via Google-signed OIDC tokens.

### C. Safe Parsing

Masking pattern protects long grounding tokens from LLM corruption during formatting.

## 6. Telemetry & Analytics

Every event is logged to **BigQuery** (`edtech-agent-2026.telemetry.feedback_logs`). Administrative validation events are logged as distinct from automated research logs.

---

*N.E.R.D. System Architecture — Version 2.2 (FinOps Optimized)*