# NCADEMI EdTech Research Assistant: Technical Logic Documentation

This document serves as the architectural reference for the NCADEMI Research Assistant. It documents the core logic, state management, and external integrations as of June 11, 2026.

## 1. Core Architecture
The application is a **Streamlit** web application containerized with **Docker** and deployed on **Google Cloud Run**. It leverages **Gemini 2.0 Flash** via Vertex AI for research and refinement.

### Key Components:
- **Research Engine**: Uses Gemini with Google Search Retrieval to find accessibility documentation.
- **Feedback Loop**: Enables iterative refinement of directory entries based on user instructions.
- **Link Validator**: A custom high-reliability system that verifies every discovered URL in real-time.
- **Document Generator**: High-fidelity HTML and DOCX (via `altChunk`) generators that match NCADEMI visual standards.
- **Telemetry**: Synchronous streaming of feedback events into **BigQuery**.

---

## 2. Research & Generation Logic
### Initial Research
- **Trigger**: "Generate Listing" button.
- **Input**: Product URL.
- **Logic**:
    1.  Clears existing feedback responses.
    2.  Calculates API timeout based on the "Max Research Time" slider (1–10 minutes).
    3.  Calls Gemini with a specialized `SYSTEM_PROMPT` containing 40+ verified EdTech research locations.
    4.  Applies a strict constraint: Max 10 Vendor sources, 10 Third-party sources.
    5.  **Post-Process**: Runs `filter_broken_links` on the raw AI output before updating session state.
    6.  Stores results in `st.session_state.history`.

### Feedback Refinement
- **Trigger**: "Send" button in the Feedback row.
- **Input**: User text instructions (e.g., "Add X", "Remove Y").
- **Logic**:
    1.  Captures the `old_markdown` and extracts current links.
    2.  Sends refinement instructions to Gemini with the same timeout logic.
    3.  **Validation**: Verifies all links in the *new* draft.
    4.  **Analysis**: Compares `new_links` vs `old_links` to calculate exactly how many were added or removed.
    5.  **Response**: Updates the read-only "Response" field with a concise summary (e.g., "2 new source(s) added.").
    6.  **Telemetry**: Synchronously streams the event to `telemetry.feedback_logs` in BigQuery.

### Manual Link Injection (Add Resources)
- **Trigger**: "Add to Listing" button within the "➕ Add Resources" expander.
- **Input**: `Link text | URL;` formatted strings in Vendor or Other Sources text areas.
- **Logic**:
    1.  **Parsing**: Uses `parse_manual_links` to convert the string into structured tuples.
    2.  **Deterministic Injection**: Directly replaces section headers in the markdown with the headers + new link lines. This bypasses the LLM entirely for 0s latency.
    3.  **Validation**: Runs the updated markdown through `filter_broken_links`.
    4.  **Telemetry**: Logs the manual addition to BigQuery.

---

## 3. High-Reliability Systems
### Link Validation (`validate_url`)
- **Library**: `httpx`.
- **Logic**:
    - Rejects `grounding-api-redirect` (proxy) links.
    - Performs a `HEAD` request (with fallback to `GET`) to verify a **200 OK** status.
    - Handles timeouts (5s) and connection errors gracefully.
    - **Filtering**: Replaces broken links in the UI with a non-clickable text label explaining the failure reason.

### DOCX Generation (`altChunk`)
- **Library**: `python-docx`.
- **Logic**: 
    - Instead of standard text building, it uses the **Office Open XML (OOXML) altChunk** feature.
    - Embeds the fully-styled NCADEMI HTML template directly into the Word package.
    - Ensures visual consistency between the web app and the downloaded report.

---

## 4. UI & Accessibility (WCAG 2.1)
- **Focus Order**: A hidden **Skip Link** is the first element in the DOM, allowing keyboard users to jump directly to the Product URL field (positioned 15px from top when visible).
- **Visual Feedback**: Global focus/hover indicators (3px blue outline) are applied to all interactive elements.
- **Cognitive Load**: The Streamlit "Running" spinner icon is hidden via CSS to reduce distraction.
- **Dynamic Layout**: 
    - URL Field: 600px width.
    - Action Buttons: 150px width with 25px gaps.
    - Download and Feedback UI remain hidden until a result is present.

---

## 5. Deployment Details
- **Project ID**: `edtech-agent-2026`
- **Region**: `us-central1`
- **Registry**: Artifact Registry (`edtech-assistant-repo`)
- **Security**: 
    - Password-protected (`edtechRA61126`).
    - Bypassable via `?testing=yes` URL parameter or local terminal command (`edtech`).
- **Dependencies**: Managed in `requirements.txt` (including `google-cloud-bigquery` and `httpx`).

---

## 6. Future Development Roadmap
1.  **Looker Studio Integration**: Connect to the BigQuery telemetry table to visualize agent performance.
2.  **Prompt Engineering**: Use the `feedback_logs` to identify recurring failures and refine the `SYSTEM_PROMPT`.
3.  **Model Benchmarking**: Use the stored data to build a "Golden Set" for evaluating future Gemini versions.
