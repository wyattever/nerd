# System Design Document: N.E.R.D.
**NCADEMI EdTech Research for the Directory**  
*Last Updated: June 15, 2026*

## 1. Executive Summary
N.E.R.D. (Ncademi EdTech Research & Data) is a distributed, three-tier research platform designed to aggressively retrieve, validate, and format digital accessibility documentation for EdTech products. It automates the generation of NCADEMI-branded HTML fragments and JSON research artifacts using Google Vertex AI (Gemini 2.5 Flash) with Google Search Grounding.

## 2. Distributed Architecture
The system has been migrated from a monolithic prototype to a scalable, asynchronous architecture on Google Cloud Run.

### A. Frontend (`frontend/`)
*   **Next.js 16 (App Router)**: A React-based UI that manages research forms, real-time log streaming via SSE, and an editable data grid (TanStack Table v8) for listing refinement.
*   **Tailwind CSS 4**: Modern utility-first styling for a polished, accessible research dashboard.
*   **Firebase Auth**: Secure entry point for authenticated Ncademi researchers.
*   **Accessibility**: WCAG 2.1 AA compliant, verified with `@axe-core/playwright`.

### B. API Orchestrator (`api/`)
*   **FastAPI**: The central brain that validates OIDC/Bearer tokens, manages job state in **Cloud Firestore**, and enqueues research tasks via **Cloud Tasks**.
*   **SSE (Server-Sent Events)**: Provides a real-time progress log to the frontend, bridging the gap between async background workers and the user interface.
*   **Admin CRUD**: REST endpoints for managing candidate research and finalized product listings stored as JSON.

### C. Processing Worker (`api/worker.py`)
*   **Async Processing**: Executed as a separate Cloud Run service (Scale-to-Zero). It handles the heavy lifting: crawling, LLM synthesis, and link resolution.
*   **Isolation**: Only callable by Cloud Tasks via OIDC identity tokens, ensuring research quotas are protected.

### D. Core Business Logic (`nerd_core/`)
*   **`services.py`**: Orchestrates calls to the Vertex AI GenAI SDK for the initial research and deep-dive workflows.
*   **`link_validator_engine.py`**: A standalone, Playwright-based engine (via Crawlee) that performs high-fidelity, browser-rendered link checking with screenshot evidence collection and SSRF protection.
*   **`generators.py`**: Contains the core parsing logic (`parse_markdown_to_listing`) that converts AI-generated markdown into the structured `ListingData` model, and also contains the HTML rendering logic that uses Jinja2 templates.
*   **`utils.py`**: Contains general-purpose helpers and security utilities.

## 3. Core Workflows

### A. Two-Stage Research
1.  **Initial Research**: A broad sweep of the web to identify core accessibility pages (VPATs, ACRs, Help Centers).
2.  **Deep Dive**: An iterative continuation that extracts known URLs and instructs the model to ignore them, focusing on high-difficulty targets like `.edu` reviews or state-level accessibility registries.

### B. Link Resolution & Remediation
*   **Mandatory Resolution**: All `grounding-api-redirect` URLs emitted by Google Search Grounding must be resolved to canonical, verified destinations before storage.
*   **Remediation Script**: `scripts/reprocess_redirects.py` allows for bulk cleanup of artifacts where redirect tokens have expired.

### C. Live Preview & Edit
The frontend allows researchers to edit Pydantic-mapped listing data in real-time. Changes trigger a server-side Jinja2 re-render of the NCADEMI HTML fragment, providing an instant "Live Preview" of the final directory listing.

## 4. Multi-Layer Testing Strategy
The system is protected by a 4-layer validation suite (documented in `docs/TESTING.md`):

1.  **Unit Tests**: `pytest` for regex parsers, slugification, and schema validation.
2.  **Integration Tests**: `httpx.ASGITransport` to validate API routes and SSE streaming without a live network.
3.  **Data Integrity Tests**: Scans the `NCADEMI_candidates/` directory to ensure 100% schema compliance and zero "leaked" proxy URLs.
4.  **E2E Tests**: `playwright` + `axe-core` to automate the `Inject -> Edit -> Save -> Delete` UI lifecycle and verify WCAG compliance.

## 5. Security Guardrails

### A. SSRF Mitigation
The `link_validator_engine` and `utils.py` resolve hostnames to IP addresses before every request, blocking all traffic to internal GCP ranges or private networks.

### B. OIDC Handshake
The Worker-to-API communication is authenticated via Google-signed OIDC tokens, preventing unauthorized research invocations.

### C. Safe Parsing
The system uses a "Masking" pattern to protect long grounding tokens from LLM corruption during the formatting phase, restoring them post-generation.

## 6. Telemetry & Analytics
Every research event and manual modification is logged to **BigQuery** (`edtech-agent-2026.telemetry.feedback_logs`), allowing for precision prompt engineering and usage monitoring.

---
*N.E.R.D. System Architecture — Version 2.0 (Stable Production Standard)*
