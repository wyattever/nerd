# Code Review: NCADEMI EdTech Research Assistant

## TL;DR
- **The application contains at least one outright production-breaking defect: the Google Search grounding tool is passed as `types.Tool(google_search=types.GoogleSearchRetrieval())`, which Gemini 2.x on Vertex AI rejects with HTTP 400 "Please use google_search field instead of google_search_retrieval field." The correct call is `types.Tool(google_search=types.GoogleSearch())`.** Because grounding is the core of the product, every grounded generation is at risk of hard failure.
- **The developer's paramount constraint — correct ordering and completion-before-next-step — is violated in several places that no amount of `time.sleep()` can fix.** The eager evaluation of `download_button(data=...)` on every rerun, the read of `url_input` at feedback time, the `time.sleep(0.5)`-before-`st.rerun()` band-aid, and the `setTimeout(..., 1000)` skip-link injection are all ordering hazards. The fix pattern is deterministic: compute artifacts only after a result changes, store them in `session_state`, gate steps on explicit state flags, and use callbacks/fragments — never sleeps or timers.
- **A 10-minute model timeout cannot work on this stack and creates silent data-loss risk.** Cloud Run's default request timeout is 300 seconds (max 3600s); the genai SDK has a documented ~5-minute server-disconnect ceiling; telemetry is written with `insert_rows_json` wrapped in `except: pass`. Fix the ordering and reliability issues first (they match the developer's stated priority), then harden security (hardcoded password + query-param bypass on a public URL) and dependencies (Python 3.9 reached end-of-life on 2025-10-31).

---

## Key Findings

1. **`GoogleSearchRetrieval` is rejected by Gemini 2.x on Vertex AI (CRITICAL, confirmed).** Google AI's official "Grounding with Google Search" documentation states verbatim: "Note: Older models use a google_search_retrieval tool. For all current models, use the google_search tool as shown in the examples." Using the legacy field against gemini-2.0/2.5 returns HTTP 400 INVALID_ARGUMENT: "Unable to submit request because Please use google_search field instead of google_search_retrieval field." This is reproduced in multiple Google issue trackers (googleapis/python-aiplatform #4779, googleapis/google-cloud-java #11470, google-gemini #667).

2. **The 10-minute timeout is structurally impossible on this stack.** The `HttpOptions(timeout=...)` value is in milliseconds (confirmed by the SDK source comment "HttpOptions.timeout is in milliseconds. But httpx.Client.request() expects seconds"), so `max_search_time*60*1000` is numerically correct. However: (a) Google Cloud's "Configure request timeout for services" doc states "The timeout is set by default to 5 minutes (300 seconds) and can be extended up to 60 minutes (3600 seconds)"; (b) the genai SDK exhibits a documented ~5-minute "server disconnected" ceiling (googleapis/python-genai #911 — requests "still getting timed out after ~5 min" despite a larger HttpOptions value). A 10-minute Gemini call therefore exceeds Cloud Run's default 300s request timeout and will be killed before completion unless the service timeout is raised and the model call is bounded well under the real ceiling.

3. **Telemetry is best-effort and lossy where the roadmap requires durability.** `insert_rows_json` is the legacy `tabledata.insertAll` streaming API; Google's own guidance is "For new projects, we recommend using the BigQuery Storage Write API instead of the tabledata.insertAll method," and "If you are migrating from the legacy tabledata.insertall API, consider using the default stream. It has similar write semantics, with greater data resiliency and fewer scaling restrictions." The `except: pass` swallows every failure silently, and the two-part table id `telemetry.feedback_logs` omits the project prefix.

4. **Server-side fetching of LLM-emitted URLs is an SSRF exposure.** `validate_url` issues HEAD/GET to arbitrary model-supplied URLs from inside the container; OWASP's SSRF Prevention Cheat Sheet warns "In cloud environments SSRF is often used to access and steal credentials and access tokens from metadata services (e.g. AWS Instance Metadata Service, Azure Instance Metadata Service, GCP metadata server)" and advises "Deny-lists are bypass-prone. Prefer allow-lists." Required controls include blocking loopback/private/link-local/metadata ranges (including GCP's `169.254.169.254` / `metadata.google.internal`), disabling automatic redirects or re-validating them, and restricting schemes to https.

5. **The DOCX altChunk technique is a fragile, non-portable hack with an embedded XSS vector.** altChunk HTML import is only reliably converted by Microsoft Word desktop on Windows; LibreOffice, macOS, Google Docs, and Word for web do not render it. Embedding remote `<script>`/stylesheet references and un-escaped LLM output compounds the risk.

6. **Security posture is unacceptable for a public URL.** A hardcoded plaintext password, three documented bypasses (`?testing=yes`, `TESTING_MODE`, `--testing=yes`), and the password itself written into a repo markdown file are deployed behind a public `run.app` endpoint. Per the Google Cloud Blog, "You can now enable IAP directly on Cloud Run in a single click, with no load balancers, and at no added cost… IAP is the recommended authentication mechanism for internal business applications on Cloud Run."

7. **Python 3.9 is end-of-life.** Per Python.org, "Python 3.9 reached end-of-life on 2025-10-31" (final security release 3.9.25). The Dockerfile pins `python:3.9-slim` and the code suppresses the google.auth FutureWarning about it.

---

## Section 1 — Critical Issues

### C1. Wrong grounding tool class — guaranteed API rejection on Gemini 2.5
**Severity: Critical (production-breaking).**
**Evidence:** Code passes `tools=[types.Tool(google_search=types.GoogleSearchRetrieval())]` while calling `model="gemini-2.5-flash"`.
**Why it violates best practice:** Google's grounding docs state plainly: "Older models use a google_search_retrieval tool. For all current models, use the google_search tool." Gemini 2.x on Vertex AI returns HTTP 400 "Please use google_search field instead of google_search_retrieval field." `GoogleSearchRetrieval` is the object for the legacy `google_search_retrieval` field; pairing it with the `google_search` keyword is additionally a type mismatch.
**Simple, reliable fix:** Replace with `tools=[types.Tool(google_search=types.GoogleSearch())]`. Add a single integration test that performs one live grounded call in CI/staging so this class of regression fails loudly instead of silently in production. This is the SRD-compliant fix: one-line change, removes a whole failure mode.

### C2. 10-minute model timeout exceeds Cloud Run's request timeout — in-flight work is killed
**Severity: Critical (ordering/completion failure).**
**Evidence:** Timeout slider 1–10 min, passed as `HttpOptions(timeout=max_search_time*60*1000)` (ms). Cloud Run default request timeout is 300s.
**Why it violates best practice:** Cloud Run terminates any request (including the WebSocket carrying the Streamlit session) that exceeds the configured timeout; per the Google Developer Experts "This is Cloud Run: Configuration" guidance, "the timeout applies per-request. If a single request takes longer than the timeout, Cloud Run terminates it. WebSocket connections are also subject to this timeout." The genai SDK also exhibits a ~5-minute server-disconnect ceiling (python-genai #911). A 10-minute setting cannot complete; the user's generation is cut off mid-flight — a direct violation of "each process must finish before the next starts."
**Simple, reliable fix (staged):** (1) Set the Cloud Run service `--timeout=3600` and `--no-cpu-throttling` (CPU always allocated) so long synchronous work is not throttled outside request handling. (2) Cap the model timeout slider to a value safely under the real ceiling (e.g., 4 minutes / 240000 ms) rather than 10. (3) Enable session affinity and `--min-instances=1` so the Streamlit WebSocket is less likely to be re-routed mid-generation. Document that anything beyond a few minutes must move to an async job pattern (submit → poll), not a synchronous request. (Google's own long-task guidance: extend the timeout, pair with always-on CPU, and for work that cannot fit, switch to an async submit-and-poll pattern.)

### C3. Eager `download_button(data=...)` regenerates the DOCX on every rerun and races feedback updates
**Severity: Critical (ordering hazard + correctness).**
**Evidence:** `create_docx(st.session_state.current_result)` is passed directly as `data`; Streamlit evaluates `data` on every script run, re-parsing markdown, reading the 210KB CSS from disk, and rebuilding the package each rerun.
**Why it violates best practice:** Streamlit's own docs warn that download data is computed when the button is declared and recommend lazy/cached generation; they explicitly describe a "race-like condition where the user doesn't see the updated data in their download" when a pending widget change coincides with a download. With eager evaluation, a download can serialize a half-updated `current_result` relative to an in-progress feedback update.
**Simple, reliable fix:** Pass a **callable** to `data` — per the Streamlit docs, "Pass a callable to data to generate the bytes lazily when the user clicks the button. Streamlit commands inside this callable are ignored" — and set `on_click="ignore"` so the download does not trigger a rerun. Generate the artifact only when `current_result` actually changes (guard on a state hash) and cache the 210KB CSS read with `@st.cache_data`. This guarantees the DOCX reflects exactly the displayed result and removes the per-rerun work.

### C4. `time.sleep(0.5)` before `st.rerun()` is a non-deterministic band-aid
**Severity: High.**
**Evidence:** Feedback flow sets `current_result`, then `time.sleep(0.5)`, then `st.rerun()`.
**Why it violates best practice:** Sleeping does not synchronize state; Streamlit reruns the whole script top-to-bottom and state mutations are already applied synchronously before `st.rerun()`. A fixed sleep is a timing guess that fails under load and wastes a held Cloud Run request. There is no sanctioned Streamlit pattern that uses a sleep to order state.
**Simple, reliable fix:** Remove the sleep. Drive ordering with explicit `session_state` flags and Streamlit **callbacks** (`on_click`), which the docs note "execute a function at the beginning of a script rerun" (i.e., before the rerun body), or wrap the feedback step in an `@st.fragment` so it completes atomically before the surrounding script proceeds. Set state, then call `st.rerun()` immediately.

### C5. Unescaped LLM output interpolated into HTML rendered via `components.html` — stored XSS / HTML injection
**Severity: Critical (security).**
**Evidence:** Product name, vendor, descriptions, URLs, link text, and broken-link replacement strings are interpolated into an f-string HTML template with no escaping, then rendered with `st.components.v1.html` and embedded in the downloadable DOCX.
**Why it violates best practice:** Any untrusted string (here, model output, which can be influenced by researched page content) rendered into HTML without escaping is an injection vector. The python-mammoth docs make the general point that unsanitized document/HTML pipelines can "create links that can execute arbitrary JavaScript when clicked."
**Simple, reliable fix:** Escape every interpolated value with `html.escape()` (and escape attribute/URL contexts appropriately), or switch to a templating engine with autoescaping (Jinja2 `autoescape=True`). Combined with structured output (see Section 3), this also makes the HTML deterministic.

### C6. SSRF: server fetches arbitrary model-supplied URLs, including the GCP metadata endpoint
**Severity: Critical (security).**
**Evidence:** `validate_url` performs HEAD/GET against any URL the model emits; only `grounding-api-redirect` is filtered, and `follow_redirects=True`.
**Why it violates best practice:** OWASP's SSRF Cheat Sheet requires blocking destinations that resolve to loopback, private, link-local, or metadata addresses (IPv4 `127/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`; IPv6 `::1`, `fc00::/7`, `fe80::/10`), preferring allowlists ("Deny-lists are bypass-prone. Prefer allow-lists."), rejecting non-HTTP schemes, and disabling/re-validating redirects. On GCP the metadata server at `169.254.169.254` / `metadata.google.internal` can expose service-account tokens.
**Simple, reliable fix:** Before fetching, parse the URL, require `https`, resolve the hostname, and reject any resolved IP in private/loopback/link-local/metadata ranges (DNS-pin the resolved IP and re-validate after any redirect to defeat DNS-rebinding/TOCTOU). Block `metadata.google.internal`. As defense-in-depth, restrict the Cloud Run service's egress and consider blocking `169.254.169.254` at the network layer.

### C7. Hardcoded password + multiple auth bypasses on a public Cloud Run URL
**Severity: Critical (security).**
**Evidence:** Plaintext password `"edtechRA61126"` compared in source; bypass via `?testing=yes`, `TESTING_MODE`, and `--testing=yes`; password and bypasses documented in a repo markdown file.
**Why it violates best practice:** Secrets in source are an industry-recognized anti-pattern; the query-param bypass means the "auth" is effectively optional. Cloud Run now supports enabling IAP directly in one click, free of charge and without a load balancer, and Google positions IAP as "the recommended authentication mechanism for internal business applications on Cloud Run."
**Simple, reliable fix (staged):** (1) Immediately remove the bypasses and rotate the password out of source/markdown. (2) Enable IAP directly on the Cloud Run service and set ingress to internal+load-balancing or restrict invokers; let Google handle authentication. (3) If an app-level password is still wanted, store it in Secret Manager and mount it as an env var, comparing with `hmac.compare_digest`. Note: IAP on Cloud Run defaults to same-organization Google identities; external users require a custom OAuth client.

### C8. Documentation drift hiding ordering/definition bugs (NameError evidence)
**Severity: High.**
**Evidence:** Logic doc and UI caption say "Gemini 2.0 Flash" but code calls `gemini-2.5-flash`; debug log shows `name 'client' is not defined` and `name 'SYSTEM_PROMPT' is not defined`.
**Why it matters:** The NameErrors are direct evidence of top-to-bottom execution-order bugs — symbols referenced before definition during Streamlit reruns. This is the exact failure class the developer most wants eliminated.
**Simple, reliable fix:** Define all module-level constants (`SYSTEM_PROMPT`, `PROJECT_ID`) and cached client factories at the top of the module before any code path can reference them; reconcile the docs to "Gemini 2.5 Flash." Add a smoke test that imports and runs the script once to catch NameErrors in CI.

---

## Section 2 — Simple & Reliable Optimizations (reliability/ordering, not speed)

### S1. Bound the wrong-status link removal to avoid false "broken link" stripping
A new `httpx.Client` is built per URL, with the default httpx User-Agent, and **any** non-200 (403, 405, 429) is treated as broken and silently stripped. Sites behind Cloudflare routinely return 403 to non-browser User-Agents (Cloudflare/DataDome flag default library UAs and TLS fingerprints), causing valid sources to be deleted. Reliable fix: use a single `httpx.Client` with a realistic browser `User-Agent`, treat the full redirected range 200–399 as valid, retry a HEAD that returns 405 with a GET, and classify 403/429 as **"unverifiable"** (keep the link, annotate) rather than "broken." This improves correctness and determinism; speed is irrelevant per the constraint.

### S2. Replace `setTimeout(setupSkip, 1000)` with a deterministic attach
The skip-link accessibility JS attaches a listener after a hard 1-second timer — a literal race if Streamlit renders slower than 1s. Replace with a `MutationObserver` (or a bounded retry loop that re-checks until the element exists) so the listener attaches when the node appears, regardless of render time.

### S3. Make citation handling consistent across both flows
Generation stores `search_entry_point.rendered_content`; the feedback flow does not replace/append citations consistently. Define one helper that always recomputes and **replaces** citations from the latest response, called identically by both flows, so the displayed sources always match the displayed text.

### S4. Log the URL that produced the draft, not the live field
The feedback BigQuery row logs the current `url_input`, which can be edited/cleared before "Send" (the debug log shows an empty URL in a FEEDBACK_START event). Snapshot the URL into `session_state` when the draft is generated and log that snapshot. Simple, removes a data-integrity bug.

### S5. Bound `session_state.history` and set expectations on persistence
History is unbounded (per-session memory growth) and is lost on instance restart/scale-to-zero (Cloud Run instances are ephemeral). Cap history length (e.g., last N) and make explicit in the UI that results are session-scoped; rely on the DOCX/Markdown download for durability. No external store is needed for the stated use case.

### S6. Make the BigQuery write non-blocking to the user flow and never silent
Even before migrating APIs, move the telemetry write out of the critical path (e.g., write after `current_result` is set and the UI is updated) and replace `except: pass` with a logged exception. The user flow should not block on or be affected by telemetry; failures must be observable.

---

## Section 3 — Other Recommendations

### Structured output (roadmap-supporting; removes brittle parsing)
`parse_markdown_to_dict` uses substring matching on free-form LLM text. Gemini supports enforced structured output via `response_mime_type="application/json"` plus a `response_schema` (Pydantic), which Google describes as ensuring "predictable, type-safe results" and "valid JSON" conforming to the schema. **Important nuance for this app:** combining built-in tools (Google Search grounding) with structured output in a single call is documented as a Gemini 3-series capability; on gemini-2.5-flash you generally cannot use grounding and `response_schema` in the same request. The SRD-compliant pattern is two deterministic steps: (1) grounded generation to gather sourced facts, then (2) a second, tool-free call with `response_schema` to coerce the result into a typed object for the DOCX/HTML renderer. This eliminates the brittle parser and the documentation drift between prose format and renderer expectations.

### BigQuery Storage Write API migration (roadmap-supporting)
For the load-bearing telemetry (Looker dashboards, prompt-engineering feedback loop, golden-set eval), migrate from `insert_rows_json` to the Storage Write API **default stream**, which Google recommends for new projects ("greater data resiliency and fewer scaling restrictions") and which offers exactly-once semantics with offsets and lower cost. Use a fully-qualified table id (`project.dataset.table`). For durability under extended unavailability, Google's own guidance is to "publish the rows to a Pub/Sub topic for later evaluation and possible insertion" rather than dropping them. At minimum, fix the bare except and the missing project prefix now.

### DOCX generation: drop altChunk for a native/portable path
altChunk HTML is only reliably converted by Word desktop on Windows; per multiple maintainers, "LibreOffice, macOS, Google Docs and many other DOCX readers don't support this tag," and even Word "re-formats/re-parses the files with altchunk if you 'save as.'" Remote `<script>`/stylesheet references inside the chunk are an additional security and reliability liability. Prefer native python-docx composition (headings, paragraphs, hyperlinks, tables) from the **structured** object above, or a maintained converter (e.g., html2docx / pandoc) if HTML fidelity is required. This is more code but far more deterministic and portable — aligned with SRD.

### Retry/backoff with the already-installed `tenacity`
There is no retry anywhere despite tenacity being a dependency. Add bounded exponential backoff with jitter around (a) the Gemini `generate_content` call and (b) the BigQuery write, retrying only idempotent/transient failures (timeouts, 5xx, 429). Keep retries small and deterministic; this raises reliability without affecting ordering.

### `st.cache_resource` thread-safety on Cloud Run
`st.cache_resource` returns a single global instance shared across all sessions/threads; Streamlit's docs warn that "Global resources must be thread-safe. If thread safety is an issue, consider using a session-scoped cache or storing the resource in st.session_state instead," and "Using st.cache_resource on objects that are not thread-safe might lead to crashes or corrupted data." With Cloud Run concurrency > 1, the cached `genai.Client`/`bigquery.Client` are shared across sessions. The simplest reliable mitigation given that speed is unimportant is to set Cloud Run `--concurrency=1` (one session per instance, scale horizontally) and/or use `@st.cache_resource(scope="session")` for the clients, eliminating cross-session sharing concerns.

### Dependency hygiene and Docker
- **Upgrade off Python 3.9** (EOL 2025-10-31) to `python:3.12-slim` or `3.13-slim`; remove the FutureWarning suppression. google-genai and google-cloud-bigquery are "compatible with all current active and maintenance versions of Python" and recommend updating off EOL runtimes.
- **Pin `google-cloud-bigquery`** (the only unpinned dependency) and review the old `urllib3==1.26.20` pin.
- **Dockerfile best practices:** run as a non-root user, pin the base image by digest, and use a multi-stage build.

### Graceful shutdown on Cloud Run
Cloud Run sends SIGTERM with a 10-second grace period before SIGKILL on scale-down/redeploy ("a SIGTERM signal will be sent to the container and your application will have 10 seconds to exit"). Install a SIGTERM handler (and run the app as PID 1 or forward signals) that flushes any pending telemetry so an instance termination mid-session does not silently drop the last events. Pair with `--no-cpu-throttling` so cleanup is not slowed during shutdown.

---

## Race-Condition Matrix (developer's paramount constraint)

| # | Location / trigger | Ordering hazard | Simplest reliable fix |
|---|---|---|---|
| R1 | `download_button(data=create_docx(...))` | `data` re-evaluated every rerun; can serialize a half-updated `current_result`; races feedback update | Pass a **callable** to `data`; `on_click="ignore"`; build only when `current_result` hash changes; cache CSS read |
| R2 | `url_input` read at feedback time | URL field may be edited/cleared before "Send"; wrong/empty `product_url` logged | Snapshot URL into `session_state` at generation; log the snapshot |
| R3 | Citations append (generation) vs inconsistent handling (feedback) | Displayed sources can diverge from displayed text | One shared helper that always **replaces** citations from the latest response |
| R4 | `key=f"hist_{idx}"` with `reversed(enumerate(...))` | Indices shift as history grows → widget-state mismatch, button identity changes between reruns | Use a stable unique key (e.g., a per-entry UUID stored with the history item), not positional index |
| R5 | `setTimeout(setupSkip, 1000)` | Listener never attaches if render > 1s | `MutationObserver` or bounded retry until node exists |
| R6 | `genai.Client`/`bigquery.Client` via global `st.cache_resource` | Shared across sessions/threads when Cloud Run concurrency > 1; thread-safety not guaranteed | `--concurrency=1` and/or `scope="session"` clients |
| R7 | Cloud Run instance termination mid-generation | 10-min model call killed by 300s request timeout / scale-down; partial result, dropped telemetry | Raise `--timeout`, `--min-instances=1`, session affinity, `--no-cpu-throttling`; cap model timeout under real ceiling; SIGTERM flush |
| R8 | `time.sleep(0.5)` before `st.rerun()` | Timing guess, not synchronization; fails under load | Remove; use callbacks / `@st.fragment` / explicit state flags, then `st.rerun()` immediately |
| R9 | Telemetry `insert_rows_json` in critical path with `except: pass` | Blocks/affects user flow; silent loss | Move out of critical path; log failures; migrate to Storage Write API default stream; Pub/Sub fallback |

---

## Recommendations (staged, with thresholds)

**Stage 0 — stop the bleeding (deploy today):**
- Fix C1 (`GoogleSearch()`), C7 (remove bypasses, rotate password, enable IAP), C5/C6 (escape HTML, block SSRF ranges). *Threshold to proceed:* a live grounded call succeeds in staging and IAP blocks an unauthenticated request.

**Stage 1 — ordering & completion (the paramount constraint):**
- Fix C2 (Cloud Run timeout/CPU/affinity + cap model timeout), C3 (lazy/cached download), C4 (remove sleep, use callbacks/fragments), C8 (define-before-use, reconcile docs), and race items R1–R8. *Threshold:* no NameErrors in a CI smoke run; downloads always match the displayed result; a forced scale-down during generation no longer truncates a completed call.

**Stage 2 — reliability & roadmap durability:**
- Migrate telemetry to Storage Write API (default stream) with fully-qualified table id and Pub/Sub fallback; add tenacity backoff; adopt structured output (two-step grounded → schema). *Threshold:* telemetry rows are observable end-to-end in BigQuery with zero silent drops in a fault-injection test; parser replaced by typed object.

**Stage 3 — hygiene:**
- Upgrade to Python 3.12/3.13-slim, non-root pinned-digest multi-stage Docker, pin `google-cloud-bigquery`, replace altChunk with native python-docx, add SIGTERM flush. *Threshold:* image scans clean of EOL-runtime findings; DOCX opens correctly in LibreOffice/Google Docs/Word-web.

---

## Caveats
- The ~5-minute genai server-disconnect ceiling is partly user-reported (python-genai #911 was closed as "not planned"/stale) plus a forum 504 report; the SDK passing `timeout=None`/defaults is confirmed in code (pydantic-ai #4031). Treat the precise ceiling as approximate but the conclusion (10-minute synchronous calls are not viable on default Cloud Run) as robust.
- Whether `genai.Client`/`bigquery.Client` are fully thread-safe under `st.cache_resource` is not definitively documented for the shared-singleton case; the recommended `--concurrency=1`/session-scope mitigations are conservative and sidestep the question.
- The `HttpOptions(timeout=...)` millisecond unit means the current `*60*1000` math is correct — the problem is the *magnitude* (10 minutes) relative to platform limits, not the unit conversion.
- IAP-on-Cloud-Run "internal only" access defaults to same-organization Google identities; external users require a custom OAuth client configuration.
- Several supporting references (OneUptime, Medium) corroborate official Google documentation but are secondary; every best-practice claim above is anchored to a primary source (Google Cloud docs, Google AI docs, Streamlit docs, OWASP, or Python.org) where one exists.