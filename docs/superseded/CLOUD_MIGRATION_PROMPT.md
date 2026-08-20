# CLAUDE AGENT PROMPT: N.E.R.D. Cloud Migration Strategy

## Context
You are a Cloud Infrastructure Expert. I am preparing to migrate the **N.E.R.D. (Ncademi Edtech Research & Data)** tool from a local development environment to its production home on Google Cloud Platform. 

The project has recently undergone a major architectural shift:
1.  **Stack Migration:** From a Streamlit monolithic prototype to a Next.js (Frontend) + FastAPI (Backend) + Async Worker (Processing) architecture.
2.  **Codebase Rename:** The working directory and internal package name have been changed from `edtech-agent` to `nerd`.
3.  **Data Remediation:** 61 candidate research records have been verified for integrity, including the resolution of short-lived Google Search proxy URLs.

---

## Technical Comparison

### 1. Cloud Infrastructure (Current State)
*   **Project ID:** `edtech-agent-2026`
*   **Cloud Run Services:**
    *   `nerd-api`: FastAPI wrapper (deployed but outdated).
    *   `nerd-worker`: Async processing logic (deployed but outdated).
    *   `edtech-assistant`: Legacy Streamlit application (deprecated).
*   **Secrets (Secret Manager):**
    *   `gemini-api-key`: Wired and active.
*   **Networking:**
    *   Cloud Tasks: `nerd-research-queue` (us-central1) is active.
    *   Service Account: `nerd-tasks-invoker` configured for OIDC auth between API and Worker.
*   **Database:** Firestore (Native Mode) is active.

### 2. Local Stack (`nerd` directory)
*   **Frontend:** Next.js 16 (App Router), Tailwind CSS 4, Playwright + Axe-core.
    *   *Requirements:* Needs `FIREBASE_API_KEY`, `FIREBASE_APP_ID`, and `NEXT_PUBLIC_API_BASE_URL`.
*   **Backend:** FastAPI 0.115+.
    *   *Features:* SSE for real-time logs, CRUD for candidates/products, CORS-aware.
*   **Core:** `nerd_core` package with Link Validator Engine (Playwright/Crawlee).
*   **Test Suite:** Multi-layer (Unit, Integration, Data Integrity, E2E) with 100% pass rate.
*   **Artifacts:** 61 remediated JSON/HTML/MD files in `NCADEMI_candidates/`.

---

## Potential Issues to Consider
1.  **Directory Path Drift:** Dockerfiles and Cloud Build triggers must be verified against the new `nerd/` directory structure to avoid context-root failures.
2.  **CORS Gap:** The `FRONTEND_URL` environment variable in `nerd-api` must be synchronized with the eventual Cloud Run URL of the Next.js frontend.
3.  **Secret Provisioning:** Firebase Auth keys are present locally but missing in the Cloud Secret Manager.
4.  **Static Data Migration:** The 61 corrected candidate files currently live in the local filesystem. We need a strategy to seed Firestore or a GCS bucket so the cloud API has access to verified history.
5.  **OIDC Loop:** Ensuring the worker-to-API and task-to-worker OIDC handshakes are valid in the new `nerd-` service namespace.

---

## Request
Please generate a **Comprehensive Migration Report** that guides the final push to production. Your report must include:

1.  **Best Practices:** Identify industry-standard patterns for managing the cutover from the legacy Streamlit app to the Next.js frontend.
2.  **Step-by-Step Execution Plan:** A logical sequence of commands and configuration changes to update the infrastructure and deploy the new services.
3.  **Validation Checkpoints:** How to use the existing multi-layer test suite to verify the cloud deployment before finalizing the cutover.
4.  **Remediation Logic:** Specific advice on migrating the local `NCADEMI_candidates/` data to a cloud-persistent store (Firestore or GCS).
5.  **Final Security Audit:** Verification of Secret Manager wiring and OIDC token logic for the renamed services.

*Focus on surgical, zero-downtime updates where possible, ensuring the 61 verified candidate records are preserved and accessible.*

---

## Recommended Files for Review
Before finalizing your report, please examine these 6 core files to understand the current implementation and deployment parameters:
1.  **`api/main.py`**: Backend routes, auth bypass, and OIDC task creation.
2.  **`api/job_store.py`**: SSE event logic, state transitions, and Firestore/Local switching.
3.  **`nerd_core/generators.py`**: The parsing engine and HTML rendering logic.
4.  **`frontend/app/page.tsx`**: Main UI integration and state handling.
5.  **`scripts/deploy.sh`**: Infrastructure blueprints and Cloud Run configuration.
6.  **`docs/TESTING.md`**: The validation protocols for Unit, Integration, and E2E layers.

