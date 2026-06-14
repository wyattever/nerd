# N.E.R.D. Technical Logic Documentation

This document serves as the architectural reference for N.E.R.D. (NCADEMI EdTech Research for the Directory). It documents the core logic, modular structure, and iterative workflows as of June 12, 2026.

## 1. Modular Architecture
The application has been refactored from a monolithic script into a clean, modular Python package to ensure separation of concerns and testability.

### Module Map:
- **`app.py` (Controller)**: The main entry point. Handles Streamlit page configuration, UI layout, and high-reactivity fragments.
- **`nerd_core/services.py` (Integration Layer)**: Orchestrates external APIs (Gemini 2.5 Flash via Google GenAI SDK, Google Search Grounding, BigQuery).
- **`nerd_core/parser.py` (Data Engine)**: Responsible for the "Greedy Narrative Parser" and deep-dive markdown merging.
- **`nerd_core/generators.py` (Artifact Engine)**: Builds the NCADEMI-standard HTML preview and DOCX reports.
- **`nerd_core/utils.py` (Security & Network)**: Handles permissive link validation, Google Search proxy resolution, and SSRF threat mitigation.
- **`eval/`**: Programmatic evaluation harness (Promptfoo/DSPy) and Golden Dataset.
- **`prompts/`**: Versioned Jinja2 templates (`system_prompt.j2`, `delta_system_prompt.j2`, `synthesis_prompt.j2`).

---

## 2. Core Workflows
### Iterative Research & Deep Dives
N.E.R.D. utilizes a state-aware iterative research model to prevent redundant API calls:
1.  **Initial Research**: A broad pass using `system_prompt.j2` loaded via Jinja2.
2.  **Deep-Dive Continuation**: Triggered by the "Continue Research" button using `delta_system_prompt.j2`.
    -   **Memory**: Extracts all existing URLs from the current draft.
    -   **Pivoting**: Instructs Gemini to ignore `ALREADY KNOWN` sources and focus on institutional audits (`.edu`), PDF VPATs, and technical blog repositories.
    -   **Additive Merging**: New findings are programmatically injected into the existing Markdown headers.

### Live Markdown-to-HTML Sync
Instead of a separate "Add Resources" tool, the app uses a **Live Preview Engine**:
-   **Isolation**: The Markdown Editor and HTML Preview are unified in an `@st.fragment`.
-   **Reactivity**: Keystrokes in the `st.text_area` are synced to state. Upon focus-out or `Ctrl+Enter`, only the fragment reruns, reloading the HTML preview and updating the DOCX/HTML download bytes instantly.

---

## 3. High-Reliability Systems
### Permissive Link Validation (`resolve_and_validate_url`)
To prevent research data loss, the validator has transitioned from a "Delete-on-Failure" model to a "Label-on-Failure" model:
-   **Proxy Resolution**: Automatically follows `grounding-api-redirect` links to find canonical URLs.
-   **SSRF Protection**: Resolves hostnames to IPs and blocks private/metadata network ranges.
-   **Status Labeling**: Broken or unverified links are preserved in the Markdown but appended with a status tag (e.g., `(Status: Unverified)`), giving the human researcher final control.

### Greedy Narrative Parser
To capture AI-found knowledge that lacks a source link, the parser uses a "vacuum" logic:
-   **Link-Only Sections**: `Vendor Resources` and `Third-Party Insights` are strictly filtered for URLs.
-   **Insight Routing**: Any descriptive text or linkless bullet points are automatically moved to the `AI Generated Insights` section.

### Source-Free AI Synthesis
The "AI Generated Insights" section follows a strict "Anonymized Knowledge" mandate:
-   **Synthesis**: The agent synthesizes all retrieved text into a single cohesive paragraph (max 6 sentences).
-   **Source Stripping**: All specific source references and parenthetical citations are removed.
-   **Output**: The resulting text contains only standard alphanumeric characters, providing a pure narrative summary of the product's accessibility posture.

### URL Integrity & Token Protection
To prevent the synthesis phase from corrupting long `grounding-api-redirect` tokens, the application implements the **URL Masking Pattern**:
1.  **Isolation**: Before calling the LLM to synthesize the paragraph, a regex scans the draft for all valid URLs.
2.  **Masking**: Each URL is swapped for a stable, integer-based placeholder (e.g., `<<URL_1>>`).
3.  **Round-Trip Integrity**: The LLM processes the text using only the placeholders.
4.  **Restoration**: After generation, the original signed tokens are mapped back to their respective placeholders, ensuring that redirect links remain 100% functional.

---

## 4. UI & Brand Standards
-   **Action Bar**: Single horizontal row containing Generate, Continue Research, DOCX, HTML, and Clear.
-   **Button Specs**: Fixed 160px width with precise 25px horizontal margins.
-   **Status Center**: Animated `st.status` messages are pinned to a solid white fixed-position bar at the bottom of the viewport.
-   **Zero-Shift Layout**: Space for the status bar is reserved with 120px bottom padding, and the container is placed at the end of the script to prevent layout jumping.

---

## 5. Security & Deployment
-   **Project**: `edtech-agent-2026` | **Model**: `gemini-2.5-flash`.
-   **Rate Limiting**: Graceful catch for `429 RESOURCE_EXHAUSTED` errors to prevent UI clearing.
-   **Access**: Password-protected login (defaulting to empty string for testing) with a refined 200px entry field.
- **Telemetry**: Every event is streamed to BigQuery (`telemetry.feedback_logs`). 
    -   **Fields**: `timestamp`, `event_type` (generate/deep_dive/etc), `product_url`, `original_markdown`, `user_feedback`, `refined_markdown`, `error_code`.

