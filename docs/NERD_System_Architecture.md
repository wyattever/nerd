# System Design Document: N.E.R.D.
**NCADEMI EdTech Research for the Directory**  
*Last Synced: June 12, 2026*

## 1. Executive Summary
N.E.R.D. is an AI-powered, human-in-the-loop research assistant built on Streamlit and Google Vertex AI (Gemini 2.5 Flash). It is designed to aggressively retrieve, validate, and format digital accessibility documentation (VPATs, ACRs, third-party reviews, and vendor help docs) for EdTech products, generating perfectly formatted Markdown and HTML artifacts for the NCADEMI directory.

## 2. System Architecture
The application follows a modular, production-ready architecture, separating the UI from the business logic and external I/O.

*   **`app.py` (UI Controller)**: Manages the Streamlit layout, session state initialization, CSS styling, and the highly-reactive UI fragments.
*   **`nerd_core/services.py` (Integration Layer)**: Orchestrates the Google GenAI SDK, Google Search Grounding tools, and BigQuery telemetry logging. It holds the strict Prompt definitions.
*   **`nerd_core/parser.py` (Data Engine)**: Contains the greedy Markdown parser. It strictly enforces structural headers and segregates unlinked narrative knowledge into the AI Generated Insights field.
*   **`nerd_core/generators.py` (Artifact Engine)**: Responsible for dynamically building the NCADEMI-branded HTML preview and creating downloadable `.docx` files.
*   **`nerd_core/utils.py` (Security & Network)**: Handles URL validation, Proxy resolution, and SSRF threat mitigation.
*   **`eval/` (Evaluation Layer)**: Contains Promptfoo configurations, custom providers, and the Golden Dataset.
    *   `eval_data.json`: The source of truth for evaluation.
    *   `provider.py`: Custom Promptfoo Python wrapper for Vertex AI.
    *   `assertions.py`: Custom logic for calculating URL Recall.
*   **`prompts/` (Versioned Instructions)**: Externalized system instructions (Jinja2 templates) for version control and iterative testing.
    *   `system_prompt.j2`: Initial research pass.
    *   `delta_system_prompt.j2`: Deep-dive continuation pass.
    *   `synthesis_prompt.j2`: AI Generated Insights synthesis.

## 3. Core Workflows

### A. Iterative Research ("Continue Research")
To prevent redundant API calls and model stagnation, the app supports multi-phase research:
1.  **Phase 1 (Broad)**: Generates the initial directory listing based on a product URL.
2.  **Phase 2 (Deep Dive)**: If the user clicks "Continue", the app extracts all `ALREADY KNOWN` URLs from the current draft. It instructs the agent to ignore those URLs and perform targeted `.edu` and `filetype:pdf` queries to append *new* findings to the existing state.

### B. Live Markdown-to-HTML Sync
The application eschews complex WYSIWYG editors in favor of a "Raw Markdown Editor" bound to a `@st.fragment`. 
*   When a user manually modifies the generated Markdown, only the specific fragment reruns.
*   The HTML preview, DOCX, and HTML downloads are updated instantaneously without triggering a full page refresh or losing the underlying session state.

## 4. Data Structure & Prompting Mandates
To maintain a high-signal directory, the `SYSTEM_PROMPT` enforces a strict schema constraint:

*   **Strict Link Mandate**: The `Vendor Resources` and `Third-Party Insights` sections are restricted to bulleted `[Text](URL)` links only. Narrative descriptions are forbidden in these lists.
*   **Source-Free AI Synthesis**: The "AI Generated Insights" section follows an anonymized knowledge mandate:
    *   **Synthesis**: Synthesizes all retrieved text into a single cohesive paragraph (max 6 sentences).
    *   **Source Stripping**: All specific source references and parenthetical citations are removed to provide a pure narrative summary.
*   **Knowledge Preservation**: Any unlinked knowledge synthesized by the AI (or descriptive text lacking a URL) is automatically parsed and routed into a dedicated `AI Generated Insights` section.

## 5. Security & Stability Guardrails

### A. URL Sanity & Proxy Resolution
*   **Proxy Resolution**: Google Search Grounding metadata often returns `grounding-api-redirect` tracking links. The app programmatically resolves these server-side redirects to extract the canonical destination URL.
*   **Compliance**: These tracking URIs are accessible for up to 30 days. To comply with Google's "no automated querying" rule, resolution is performed sparingly and results are cached in the `st.session_state` during the active session. Canonical URLs are stored in the final Markdown to eliminate redundant resolution.
*   **Hallucination Prevention**: URLs exceeding 700 characters or containing repetitive character sequences (e.g., `2_2_2_...`) are blocked.

### B. Safe Network Validation (SSRF Mitigation)
Before any URL is validated, its hostname is resolved to an IP address. The application strictly blocks requests to internal, private, loopback, or metadata network ranges, preventing Server-Side Request Forgery attacks from within the Cloud Run environment.

### C. Permissive Link Handling
To prevent the loss of valid research due to transient network latency, the URL validator treats `ReadTimeout` or `ConnectError` exceptions as **"Unverified"** rather than "Broken". Links are flagged with a status label but preserved in the Markdown for the human-in-the-loop to review.

### D. URL Integrity & Token Protection
To prevent the model from corrupting long `grounding-api-redirect` tokens during formatting, the system utilizes a **Placeholder Masking** pattern:
*   **Masking**: Before an LLM call, raw URLs are swapped with short placeholders (e.g., `<<URL_1>>`).
*   **Audit**: After generation, the system audits the output to ensure no raw URLs "leaked."
*   **Restoration**: Placeholders are swapped back to their original signed tokens post-generation.

### E. Graceful Quota Recovery
The Gemini SDK's internal `tenacity` retry logic is managed transparently. If a `429 RESOURCE_EXHAUSTED` error surfaces, it is caught at the callback level. The UI displays a clear "Quota Exhausted" status message without crashing the server or clearing the page state.

## 6. UI / UX Design
*   **Collapsed Reference Sidebar**: The exact Markdown template is housed in a collapsible sidebar, ensuring the reference material is always accessible.
*   **Unified Action Bar**: All controls (Generate, Continue, DOCX, HTML, Clear) exist on a single, fixed-width horizontal plane (160px buttons, 25px gaps).
*   **Overlay Status Bar**: Long-running network tasks are tracked via an animated `st.status` container pinned to the bottom of the viewport.

## 7. BigQuery Telemetry & Analytics
Every generation and manual edit event is streamed synchronously to the BigQuery table `edtech-agent-2026.telemetry.feedback_logs`.

**Schema:**
*   `timestamp`: TIMESTAMP of the event (UTC).
*   `event_type`: "generate" | "deep_dive" | "manual_edit" | "error".
*   `product_url`: The target product URL.
*   `original_markdown`: The state before the action.
*   `user_feedback`: The user's instruction or refined tag.
*   `refined_markdown`: The resulting output.
*   `error_code`: Optional discriminator for failures (e.g. "429", "SSRF_BLOCKED").

This telemetry data is used for **Prompt Debugging** (analyzing when the model fails to follow schema) and **Usage Tracking** (monitoring research volume and costs).

---

## 8. Phase 4: Production Architecture (GCP)
The system is migrated from a monolithic Streamlit app to a distributed three-tier architecture on Google Cloud Run.

### A. Component Services
1.  **Frontend (Next.js)**: Deployed to Cloud Run. Handles UI, Form management, and real-time Preview via Jinja2/API. Protected by **Firebase Auth**.
2.  **API (FastAPI)**: Deployed to Cloud Run. Serves as the orchestrator. Validates auth, enqueues research tasks to Cloud Tasks, and manages Job status in Firestore.
3.  **Worker (FastAPI)**: Deployed to Cloud Run (Scale-to-Zero). Executes long-running research tasks. Protected by **OIDC Authentication** (only callable by Cloud Tasks).

### B. Deployment & Runtime Considerations
*   **Stateless Caching**: Cloud Run is stateless. Local filesystem caching (`.next/cache`) is per-instance. Multi-instance scaling may result in redundant image optimization or cache misses. For this internal tool, this is acceptable.
*   **CPU Throttling**: By default, Cloud Run freezes CPU after an HTTP response is sent. Any Next.js background tasks (like ISR revalidation) require `--no-cpu-throttling` to ensure completion.
*   **Structured Logging**: To leverage Cloud Logging (Stackdriver), critical errors should be emitted as JSON objects (including `severity` and `message` fields) rather than raw text strings.
*   **Firestore TTL**: A native TTL policy on the `expires_at` field in the `nerd_research_jobs` collection automatically purges job data after 24 hours.

---

## 9. Automated LLM Evaluation & Prompt Optimization Pipeline
*Synthesized from Technical Validation Reports (Gemini & Claude)*

To achieve deterministic improvements, N.E.R.D. utilizes a dual-layer evaluation architecture.

### A. CI Gating with Promptfoo
For day-to-day development, **Promptfoo** serves as the primary evaluation harness.
1.  **Custom Python Provider**: Wraps the Vertex AI `generate_content` SDK to extract grounding metadata directly.
2.  **Custom Assertion (URL Recall)**: Programmatically computes the intersection between AI-generated URLs and the Golden Dataset.
3.  **CI Gate**: Integrated into GitHub Actions, this suite blocks PRs that regress the **URL Recall** score below baseline levels.

### B. Autonomous Optimization with DSPy + GEPA
For periodic prompt refinement, **DSPy** is utilized with the **GEPA (Generalized Evolutionary Prompt Adaptation)** optimizer (SOTA July 2025).
1.  **Sample Efficiency**: GEPA is optimized for small datasets (20–30 products).
2.  **Feedback-Bearing Metric**: It utilizes a larger model (Gemini 2.5 Pro) as the `reflection_lm` that receives textual feedback about specifically missed URLs (e.g., *"Missed technical help-center pages like webaim.org"*), driving faster instructional convergence.
3.  **Metadata Weighting**: Metadata fields (`difficulty`, `known_failure_mode`) are used to filter the train/val sets, ensuring "hard" cases are prioritized for training while "easy" cases provide a stable baseline.
4.  **Few-Shot Bootstrapping**: Optimization prefers "BootstrapFewShot" techniques over total prompt rewrites to prevent overfitting.

### C. URL Normalization Strategy
To ensure accurate Recall scoring, URLs are normalized:
*   **Denylist Stripping**: Removal of tracking identifiers (`utm_*`, `fbclid`, `ref`, etc.).
*   **Canonicalization**: Lowercasing, forcing HTTPS, and stripping trailing slashes via `url-normalize`.

### D. Operational Resilience (Rate-Limit Mitigation)
*   **Concurrency Control**: Uses `asyncio.Semaphore` to cap simultaneous in-flight requests.
*   **Rate Shaping**: Implements an `AsyncLimiter` to stay strictly under RPM quotas.

### E. The Golden Dataset Schema
The Golden Dataset (`eval_data.json`) includes rich metadata for every test case, such as `difficulty` and `known_failure_mode`. These fields are used as **Annotation Filters** by the Optimizer LLM to prioritize the tuning of the most challenging research scenarios.
