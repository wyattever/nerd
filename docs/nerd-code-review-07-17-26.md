# **N.E.R.D. Codebase Review — Verified Findings Report**

**Source of truth:** `/mnt/project/repomix-output.xml` (153 files packed; only `docs/decision-log-6-14-26.rtf` and a binary favicon excluded — coverage is effectively complete). **Method:** full extraction to a working tree, complete read of all production code, empirical execution of the parser/conversion/validator/healthz logic, a live run of the test suite in a Python 3.12 venv, PyPI metadata checks, and library-source verification of the SSE client. Every finding below states how it was verified. One caveat up front: the snapshot appears to partially predate the 7/9 sprint (see §7), so a few items may already be fixed in the live repo — treat file:line citations as citations into the snapshot.

## **Bottom line**

The architecture is sound and the LOCAL\_MODE/production split is cleanly executed, but the pipeline has **one systemic root-cause defect** (redirect resolution was silently lost when the hardened liveness validator was swapped in) that explains the grounding-api-redirect backlog and guarantees it will keep growing; **five empirically proven critical bugs** (production `/healthz` crashes, the worker image cannot run validation as specified, the ACR pipeline destroys every ACR it finds, the two primary output buttons fail in production, and failed jobs hang the UI permanently); and a **large dead-code surface** (\~700+ lines across the Playwright engine, InvalidLinksModal, deep-dive, and utility functions) that directly violates SRD by carrying unreachable complexity.

## **1\. Critical errors — empirically proven**

**1.1 — Production `/healthz` always returns 500\.** `api/main.py:357` runs `any(v.startswith("error") for v in checks.values())` over a dict whose first two values are booleans (`checks["worker_url_configured"] = bool(WORKER_URL)`, line 321). I executed the exact logic: `AttributeError: 'bool' object has no attribute 'startswith'`. The LOCAL\_MODE path returns at line 328 before reaching the bug, which is why the passing integration tests never see it — only production traffic does. Fix is one line (`str(v).startswith` or restrict the generator to the two string keys).

**1.2 — The worker image, as specified, cannot execute link validation.** `nerd_core/tools/liveness_validator.py:34` constructs `httpx.AsyncClient(http2=True, ...)`. I verified with a clean venv containing exactly `httpx==0.28.1` that this raises `ImportError: ... the 'h2' package is not installed` at client construction. `requirements-worker.txt` declares plain `httpx` and nothing that transitively supplies `h2` (verified: fastapi, uvicorn\[standard\], pydantic, three google-cloud packages, google-genai, jinja2, beautifulsoup4, url-normalize). Every worker job would die at `_validate` with `fail_job(job_id, "ImportError")`. The API image is build-date-dependent: crawlee ≤0.6.x declares `httpx[brotli,http2,zstd]` as a core dep (verified via PyPI metadata), but current crawlee 1.8.2 moved it behind an extra that `crawlee[playwright]` does not include — so a fresh API build today loses `h2` too. Since HTTP/2 buys nothing for liveness checks, the SRD-correct fix is deleting `http2=True`, not adding a dependency. *Caveat:* I cannot verify what the deployed images actually contain; if production jobs currently succeed, the deployed images differ from this snapshot's requirements — worth a `pip show h2` inside the running containers to confirm.

**1.3 — The ACR pipeline destroys every ACR the model finds.** Three components conspire, each verified: (a) `prompts/system_prompt.j2` instructs the model to emit `Report Title:` plus a `Link: [Text](URL) {confidence...}` line; (b) `nerd_core/generators.py:180-183` parses only the `Report Title:` line and hard-codes `url="#"` — I ran the parser on a schema-conformant draft containing a valid VPAT link and got `[('BrainPOP VPAT 2.4', '#')]`; (c) `api/worker.py:64-68` then calls `is_likely_vpat_acr("#")`, which fails (`httpx.URL('#').host == ''`, verified), so the title is overwritten to "None found". Net effect: a research run that successfully locates a VPAT renders as if none exists — in a directory whose central artifact is the ACR. This also renders `preparation_type` (Internal/External — a domain-required field) permanently stuck at its default, since neither converter in `api/conversions.py` copies it (verified by execution).

**1.4 — Copy HTML and Download HTML fail in production.** `frontend/app/page.tsx:527-533` and `543-547` POST to `/render` with **no Authorization header**, unlike every other fetch in the file. `/render` requires `verify_token` (`api/main.py:193`), so production returns 401 `{"detail": ...}`, `d.html` is `undefined`, and the user gets the string "undefined" on their clipboard or in the downloaded file. There is also no `.catch`, so the failure is silent.

**1.5 — Failed jobs hang the UI permanently.** `fail_job` emits an `event: status` with `{"status": "error", ...}` then `done=True`; `stream_job_events` (`api/job_store.py:195-199`) then sends `event: end` and closes. In `frontend/hooks/useResearch.ts`, the `onmessage` handler only transitions state on `event === "result"`; an error-status event is appended to the log as text, `end` has no handler, and no `onclose` is defined. I verified against the library source (Azure/fetch-event-source `src/fetch.ts`): stream end with no `onclose` → `resolve()`, no retry, no callback that changes state. Result: `state.status` remains `"streaming"` forever, which keeps the URL input, Generate button, and both dropdowns disabled (`disabled={state.status === "streaming"}`), and the fake heartbeat messages keep firing into the live region every second. The only recovery is a page reload. The same gap means quota exhaustion (`fail_job(..., "quota_exhausted", 429)`) is invisible to the user.

**1.6 — Liveness validator systematically false-negatives valid sites.** Two verified defects: (a) **relative redirects break the loop** — `liveness_validator.py:47` assigns `current_url = resp.headers.get("location")` without `urljoin`; I stood up a local server issuing `Location: /final` and got `is_live=False, reason='Name or service not known'` for a perfectly live URL. Relative Location headers are RFC-legal and common. (b) **No User-Agent header** — the client sends httpx's default UA, so bot-protected sites 403 (this is your known false-negative issue; confirmed present in the snapshot: no `headers=` anywhere in the file). Because `adaptive_validate` silently deletes any resource that fails this validator, both defects translate directly into valid accessibility documentation being stripped from listings with no trace.

## **2\. Systemic root cause: URL resolution was amputated, not replaced**

This is the finding that reframes the grounding-api-redirect backlog. `resolve_and_validate_url` (`nerd_core/utils.py:28`) returns `return url, result.is_live, result.reason` — the **input** URL, always. `validate_link` follows redirects internally for SSRF checking but `ValidationResult` has no final-URL field, so the resolved destination is discarded. Consequences, all traceable in code:

* Grounding redirect URIs (`vertexaisearch.../grounding-api-redirect/...`) validate as "live" (they redirect to a 200\) and are persisted **verbatim** into markdown, listings, and candidates. Nothing in `nerd_core/` or `api/` contains the string `grounding-api-redirect` — only the remediation scripts do. So the 12-file backlog is not legacy residue; **every future research run mints new unresolved redirects.** The remediation scripts treat symptoms of an active defect.  
* The substitution machinery already exists and is dead: `filter_broken_links`'s `if resolved_url != url: processed_md.replace(...)` branches (`utils.py:90-91, 108-109`) can never fire because `resolved_url == url` by construction. `eval/provider.py`'s docstring still describes `_URL_CACHE` values as "the resolved canonical URL" — the contract everyone downstream assumes.  
* The single highest-leverage fix in the codebase: add `final_url` to `ValidationResult` (the loop already tracks `current_url`), return it from `resolve_and_validate_url`, and the existing dead replacement code comes back to life. That one change retires the root cause, both remediation scripts' future workload, and part of the eval-recall depression.

## **3\. Verified test-suite state**

Ran with pytest 3.12: **21 passed, 2 failed, plus 2 collection errors under the repo's declared dependencies.** Specifics: `tests/unit/test_generators.py::test_parse_markdown_basic` and `::test_parse_markdown_missing_sections` fail with `AttributeError: 'ListingData' object has no attribute 'ai_insights'` (stale post-removal assertions — and note the stale-`ai_insights` set is **five** files in the snapshot, not four: `test_generators.py`, `test_job_lifecycle.py`, `migration_verification.py`, `system_test.py`, `parser_robustness_test.py`). `tests/test_link_validator.py` fails collection on the known wrong import path (`nerd_core.link_validator_engine` vs the actual `nerd_core.tools.administrative_validators.link_validator_engine`). Separately, the suite requires `httpx-sse` (test\_sse\_api.py) and `pytest-httpx` (test\_liveness.py) — **neither appears in any requirements file**, so the suite is unrunnable from the repo's own declared dependencies. With those two added, everything except the stale-`ai_insights` pair passes.

## **4\. Unfinished features and dead code (all zero-caller-verified by grep)**

**Dead in production, carrying real cost:** `link_validator_engine.py` (206 lines) is imported only by the broken test — yet it is the sole reason `crawlee[playwright]` sits in `requirements.txt`, and `Dockerfile.api`'s claim of "Playwright support" is false anyway since browsers are never installed (`playwright install` is absent). Removing the engine or moving it out of the API image removes the heaviest dependency in the stack. **Dead frontend:** `InvalidLinksModal.tsx` (248 lines, never imported), `lib/api.ts` (`fetchWithAuth`, zero callers, and it reads `NEXT_PUBLIC_API_URL` — a different env var than the `NEXT_PUBLIC_API_BASE_URL` used everywhere else, a trap for whoever wires it up). **Backend-complete but unreachable:** the entire deep-dive path (`/research/deep-dive`, `worker_deep_dive`, `delta_system_prompt.j2`) has no frontend caller; note also that the delta prompt omits the `{confidence, why}` annotation format, so if it's ever wired up, all deep-dive finds parse at confidence 0.0 and sort below the cap-5 cutoff whenever the initial run found ≥5 resources — the feature would silently discard its own output. `/research/validate-links` likewise has no caller. **Dead utilities:** `_GROUNDING_CONFIG` (services.py:37), `CandidateRecord` (schemas.py:60 — notably, the one schema that *would* preserve `raw_markdown`, unused), `URLMask`, `load_css` (references a file that doesn't exist), `extract_known_urls`, and `normalize_url` — the last meaning tracking-param stripping never applies to production listings either. **Stale ai\_insights remnants in the frontend:** `types.ts` still requires `ai_insights` on `ListingData` and includes it in `SectionKey`; `page.tsx:609` gates a button on a field the backend never sends; `ncademiPreview.ts` carries `genAiInsightsHtml`; the listing template retains an `{% if ai_insights %}` block fed by a variable `render_listing_html` never passes.

## **5\. Data-integrity defects (verified by execution or trace)**

**5.1 — Confidence/justification zeroed at the API boundary.** The parser extracts them correctly (verified: 0.95 / justification intact), then `dataclass_to_pydantic` (`conversions.py`) constructs `schemas.ResourceLink(url=r.url, text=r.text)`, dropping both — verified output: `(0.0, '')` — even though the Pydantic model has the fields. The frontend `types.ts` never had them. So the ranking signal the prompt works hard to produce survives exactly one function call. (Ranking still works *inside* the worker because `_rank_and_cap_resources` runs pre-conversion — but nothing downstream can ever display, audit, or re-rank.)

**5.2 — `raw_markdown` is destroyed on every candidate update.** Worker auto-persist stores it (`worker.py:109`); GET returns it; but `PUT /admin/candidates/{slug}` and `POST /admin/candidates` accept `schemas.ListingData`, whose Pydantic-v2 default `extra="ignore"` silently drops `raw_markdown`, and `_upsert_record` uses full-replace `.set(data)` (`store.py:116`). One click of "Update Candidate" permanently erases the research provenance. Related: the PUT handler ignores the path slug — `upsert_candidate` re-slugifies from `product_name`, so renaming a product during an edit creates a new document and orphans the old one; and failed parses defaulting to "Unknown Product" all collide on the slug `unknown-product`, overwriting each other in batch runs.

**5.3 — `ListingData` still lacks `extra="forbid"`** (only `SectionOverrides` has it) — confirming your known open item; the Golden Set silent-pass behavior stands.

**5.4 — Redundant, disagreeing validation passes.** One worker job validates the same URLs up to three times with fresh GETs: `resolve_and_validate_all` (whose returned results are discarded — it exists only to warm a cache), `filter_broken_links` (which takes no cache parameter and re-fetches everything), and `adaptive_validate` (again, per resource). Beyond the DRY violation, the passes can disagree on transient failures, producing a markdown that labels a link valid while the parsed listing has silently dropped it. Threading the existing `url_cache` through all three is the SRD fix.

## **6\. Accessibility findings (hard requirement per project instructions)**

**6.1 — The live region is flooded with fabricated status.** `MICRO_MESSAGES` (`page.tsx:94-118`) injects invented activity ("Analyzing robots.txt...", "Traversing DOM tree...", "Synthesizing AI-generated insights..." — none of which the Gemini-grounding backend does, and one of which references a removed feature) into the `aria-live="polite"` log **every 1000ms** for the duration of a multi-minute job. For a screen-reader user that is hundreds of announcements per run — the opposite of SC 4.1.3's intent — and for any user it misrepresents what the tool actually does, which matters in an accessibility-documentation product. **6.2 — No `role="alert"` for research errors** on the main page (only the login page has one); errors land as plain text in the polite log — and `frontend/tests/e2e/live_run.spec.ts:45` asserts a `[role="alert"]` locator that the main page cannot produce. **6.3 — No `prefers-reduced-motion` guard**: `globals.css` defines the `ellipsis` keyframe animation with no reduced-motion media query anywhere in the stylesheet, violating your stated hard requirement. **6.4 —** Minor: `role="toolbar"` used twice (once nested) without the arrow-key navigation the pattern implies, and `aria-live="assertive"` on save-confirmation text where polite is appropriate.

## **7\. Snapshot-vs-record discrepancies and unverifiable items (stated, not asserted)**

The snapshot contains `scripts/migrate_to_firestore.py` — present with a project guard (`EXPECTED_PROJECT` check, lines 121-125) rather than deleted — which conflicts with the recorded "hard-retired" status; it also contains `prompts/research_schema_prompt.txt` and root-clutter files (`directive-step*.txt`, `claude-report-6-14-26-1.md`, `VALIDATION_REPORT_6-15-26.md`, `dreambox…/last-good-known-epic.html`, three candidate .txt lists) consistent with the pending root cleanup. Either the snapshot predates part of the 7/9 sprint or "retired" meant "guarded" — needs your confirmation before anyone acts on it. Docs also drifted: `NERD_System_Architecture.md:25` and `DECISION_LOG.md:130` still justify `--max-instances 1` via `validation_jobs`, which no longer exists anywhere in code — the pin itself may still be wanted (cost, deliberate decision, preserved per instructions), but its documented rationale is dead; flag for a doc correction, not a config change. Unverifiable from a static snapshot and explicitly *not* asserted: live Cloud Run env state, deployed image contents, Firestore contents, and whether production jobs currently succeed.

## **8\. Reliability/ops findings (traced, not executed)**

`deploy.sh` uses destructive `--set-env-vars` on both the worker and API deploys (lines \~114 and \~150) — violating the repo's own recorded standing rule; a full script run self-heals `FRONTEND_URL` at step 7b, but any partial re-run of the API section wipes it, and there is a window between steps 6 and 7b where CORS falls back to `localhost:3000`. The gated-deploy pattern is applied only to the frontend, and even there **no promote step exists** — `--no-traffic --tag=candidate` with no scripted or checklist-documented promotion means frontend redeploys never go live via this script. The stale-job reclaim logic in `claim_job` is dead: it checks `current_status == "processing"`, a status no code path ever sets (actual values: queued, searching\_initial, validating\_links, deep\_dive, complete, error) — harmless today only because `--max-attempts=1` means nothing ever redelivers, but it's broken as designed, and combined with the worker's 300s timeout vs. a 4-minute Gemini call plus validation, a timeout-killed job is permanently stuck "searching\_initial" with a client streaming until the 24h TTL. Smaller: `_enqueue_task` makes a blocking gRPC call directly on the event loop (`main.py:129`; the healthz path correctly wraps the same client in `to_thread`); `/admin/batch-report` is the one unauthenticated route (`main.py:226-234` — no `Depends(verify_token)`), serving a file only local batch runs ever create; `telemetry.log_event` slices its arguments before the try block, so a `None` `response.text` (blocked/empty Gemini response) raises through the "never raises" contract and fails the job with a bare `TypeError`; and dual HTML renderers (`generators.py` vs `ncademiPreview.ts`) have already drifted — the empty-ACR "None found" link is `https://example.com` in Python output (`generators.py:250`, i.e., shipped to WordPress) vs `#` in the preview — directly contradicting `conversions.py`'s "single source of truth" docstring. The preview drift is a judgment call (server-render the preview via `/render` to eliminate the duplicate, or accept and test-pin parity); the `example.com` href in production HTML is simply wrong either way.

## **9\. Priority ordering (recommendation)**

Root-cause first: **(1)** `final_url` in `ValidationResult` \+ return it through `resolve_and_validate_url` (kills the redirect backlog at the source); **(2)** the five §1 criticals — healthz one-liner, drop `http2=True`, parse the ACR `Link:` line, add auth headers to the two `/render` calls, handle error/end events in `useResearch` (a `msg.event === "status"` check for `data.status === "error"`, plus an `onclose`); **(3)** User-Agent \+ `urljoin` in the liveness validator; **(4)** the data-integrity trio (conversions field-copying, `CandidateRecord` on the candidate endpoints or merge-semantics upsert, `extra="forbid"`); **(5)** the a11y items, led by removing or drastically throttling MICRO\_MESSAGES and adding the alert region \+ reduced-motion query; **(6)** dead-code removal (engine \+ crawlee out of the API image first — biggest simplification per line of effort); **(7)** test hygiene (two undeclared test deps into a requirements file, fix or delete the five stale files, fix the import path). Every item above maps to a citation in §§1–8; nothing here is speculative.

Each of these decomposes into a single-phase, gated Gemini dispatch. Say which block you want first and I'll author the dispatch.

# N.E.R.D. Remediation Implementation Plan

\*\*Version:\*\* 1.0 — 2026-07-17

\*\*Source:\*\* Claude full-codebase review of \`repomix-output.xml\` snapshot (verified empirically; see Findings Registry)

\*\*Executor:\*\* Gemini CLI (single-phase dispatches, STOP-gated)

\*\*Approval gate for all commits/deploys/decisions:\*\* Monkey Boy

\*\*Architect/verifier:\*\* Claude (Web)

\---

\#\# 0\. STANDING RULES (apply to every phase — non-negotiable)

1\. \*\*SRD:\*\* Simple, Reliable, DRY. Correct sequencing over speed. Never optimize for performance. Never "improve" beyond the stated phase scope. Deliberate prior decisions (\`--max-instances 1\`, no GLB, HTML-only output, \`--max-attempts=1\` queue, data dirs outside repo root) are preserved; flag, never silently change.

2\. \*\*One phase per dispatch.\*\* Complete → verify → STOP → report verbatim output → await authorization for next phase.

3\. \*\*Verification discipline:\*\* No fix is "done" on self-report. Every phase ends with real programmatic output (pytest run, executed script, curl, rendered diff). Grep alone is insufficient for behavioral claims.

4\. \*\*Git discipline:\*\* Checkpoint commit at last verified-good state before any multi-file phase. Review \`git diff \--staged\` before every commit. NEVER push or rewrite history without explicit approval. No file deletion without a grep-confirmed zero-reference check pasted into the report.

5\. \*\*Fix-attempt cap:\*\* Max 2 self-directed attempts at the same root cause. On the 2nd failure: STOP, paste exact error \+ what was tried.

6\. \*\*\`.scratch/\` conventions:\*\* \`.scratch/snapshots/\` (verbatim file dumps), \`.scratch/verification/\` (live-call outputs, phase/run-tagged filenames, never overwritten), \`.scratch/fixtures/\` (reusable test inputs). Write a structured PASS/FAIL summary file beside raw output. NEVER modify \`.gitignore\` to work around ReadFile refusals — use \`cat\`/\`head\`. If \`.gitignore\` is touched by mistake: \`git checkout \-- .gitignore\` immediately.

7\. \*\*GCP guard:\*\* Correct project is \`edtech-agent-2026\` / \`us-central1\`. The shell-global \`GOOGLE\_CLOUD\_PROJECT=acp-vertex-core\` must never leak into any command, container, or script. State call count/scope as the first output line before any multi-call live-API work.

8\. \*\*Python syntax check:\*\* \`python \-c "import ast; ast.parse(open('\<file\>').read())"\` on every Python file written (WriteFile f-string corruption risk).

9\. \*\*Multi-attempt live jobs:\*\* \`NCADEMI\_candidates/\` is the verification pool; \`NCADEMI\_products/\` is human-vetted production data — never use products as a test sample.

\---

\#\# 1\. SYSTEM CONTEXT (retained knowledge)

\- \*\*Purpose:\*\* N.E.R.D. researches K-12 EdTech accessibility documentation (WCAG 2.2, VPAT/ACR, Section 508\) via Gemini 2.5 Flash \+ Search Grounding and emits WordPress-ready HTML for the NCADEMI directory. WCAG compliance of the app itself is a HARD requirement. Mobile is out of scope. DOCX is removed; HTML-only.

\- \*\*Stack:\*\* FastAPI \`api/main.py\` (orchestrator, Cloud Run \`nerd-api\`, \`--max-instances 1\`), FastAPI \`api/worker.py\` (Cloud Run \`nerd-worker\`, invoked via Cloud Tasks queue \`nerd-research-queue\`, \`--max-attempts=1\`), \`nerd\_core/\` shared logic, Next.js 16 frontend (\`nerd-frontend\`), Firestore (prod) / in-memory (LOCAL\_MODE), BigQuery telemetry, Firebase Auth.

\- \*\*Job flow:\*\* POST \`/research/initial\` → \`create\_job\` (Firestore \`nerd\_research\_jobs\`) → Cloud Task → worker \`claim\_job\` → \`run\_initial\_research\` (Gemini, \`system\_prompt.j2\`) → \`\_validate\` (resolve\_and\_validate\_all \+ filter\_broken\_links) → \`parse\_markdown\_to\_listing\` → \`adaptive\_validate\` → \`complete\_job\` → SSE \`/jobs/{id}\` polled by \`useResearch.ts\` (@microsoft/fetch-event-source 2.0.1).

\- \*\*Key stores:\*\* candidates \`nerd\_candidates\` (prod Firestore currently EMPTY), products \`nerd\_products\`; LOCAL\_MODE seeds from \`\~/nerd\_data/candidates|products\` via \`CANDIDATES\_DIR\`/\`PRODUCTS\_DIR\` env.

\- \*\*Snapshot caveat:\*\* The reviewed snapshot may partially predate the 2026-07-09 sprint. Phase 0 reconciles snapshot vs live repo before any edit.

\---

\#\# 2\. FINDINGS REGISTRY (all evidence retained; IDs referenced by phases)

\#\#\# Critical (empirically proven)

\- \*\*F1 — /healthz 500s in production.\*\* \`api/main.py:357\` \`any(v.startswith("error") ...)\` iterates dict values that include booleans (\`worker\_url\_configured\`, \`tasks\_sa\_configured\` at :321-322). Executed: \`AttributeError: 'bool' object has no attribute 'startswith'\`. LOCAL\_MODE returns early at :328, which is why tests pass.

\- \*\*F2 — Worker image cannot run validation.\*\* \`liveness\_validator.py:34\` \`httpx.AsyncClient(http2=True)\` raises \`ImportError\` without \`h2\` (proven with clean venv @ httpx==0.28.1). \`requirements-worker.txt\` supplies no \`h2\` path. API image is build-date-dependent: crawlee ≤0.6.x pulled \`httpx\[http2\]\` as core dep; crawlee ≥1.x made it an extra excluded by \`crawlee\[playwright\]\`. Fix: DELETE \`http2=True\` (SRD) rather than add a dep. Live-image state unverified — Phase 0 confirms.

\- \*\*F3 — ACR pipeline destroys every ACR found.\*\* \`system\_prompt.j2\` instructs a \`Link: \[Text\](URL)\` line; \`generators.py:180-183\` parses only \`Report Title:\` and hard-codes \`url="\#"\` (proven: valid VPAT link in → \`('BrainPOP VPAT 2.4', '\#')\` out); \`worker.py:64-68\` then fails \`is\_likely\_vpat\_acr("\#")\` (\`httpx.URL('\#').host \== ''\`) and overwrites title to "None found". \`preparation\_type\` also never copied by either converter (proven: always resets to "Internal").

\- \*\*F4 — Copy HTML / Download HTML broken in production.\*\* \`page.tsx:527-533, 543-547\` POST \`/render\` with NO Authorization header; endpoint requires \`verify\_token\` → 401 → \`d.html \=== undefined\` → "undefined" copied/downloaded. No \`.catch\`.

\- \*\*F5 — Failed jobs hang the UI permanently.\*\* \`fail\_job\` emits \`event:status {"status":"error",...}\` \+ \`event:end\`; \`useResearch.ts\` \`onmessage\` transitions only on \`event \=== "result"\`, has no \`end\` handler and no \`onclose\`. Verified against Azure/fetch-event-source \`src/fetch.ts\`: stream end with no \`onclose\` → \`resolve()\`, no retry, no state change. \`state.status\` stays \`"streaming"\` forever; inputs stay disabled; fake heartbeat keeps announcing. Quota exhaustion (429) equally invisible.

\- \*\*F6 — Liveness validator false-negatives valid sites.\*\* (a) Relative \`Location\` headers break the redirect loop — \`liveness\_validator.py:47\` no \`urljoin\`; proven with local server: live URL → \`is\_live=False, 'Name or service not known'\`. (b) No User-Agent header → bot-protected sites 403\. \`adaptive\_validate\` then silently deletes those resources from listings.

\#\#\# Systemic root cause

\- \*\*F7 — URL resolution amputated.\*\* \`utils.py:28\` returns the INPUT url always; \`ValidationResult\` has no final-URL field even though the validator follows redirects internally. Consequences: grounding-api-redirect URIs validate "live" and persist verbatim (nothing in \`nerd\_core/\`/\`api/\` handles that string — only remediation scripts \`reprocess\_redirects.py\`, \`rerun\_redirect\_candidates.py\`); the 12-file backlog GROWS with every run; \`filter\_broken\_links\`'s replacement branches (\`utils.py:90-91, 108-109\`) are dead code awaiting a resolver; \`eval/provider.py\` \`\_URL\_CACHE\` docstring still promises canonical URLs; production never applies \`normalize\_url\` either.

\#\#\# Data integrity

\- \*\*F8 — confidence/justification zeroed at API boundary.\*\* Parser extracts them (proven 0.95/text); \`conversions.py\` \`dataclass\_to\_pydantic\` constructs \`ResourceLink(url=..., text=...)\` only → proven \`(0.0, '')\` out. \`pydantic\_to\_dataclass\` drops them too. Frontend \`types.ts\` never had the fields.

\- \*\*F9 — raw\_markdown destroyed on update.\*\* Worker persists it (\`worker.py:109\`); \`PUT/POST /admin/candidates\` accept \`schemas.ListingData\` (Pydantic v2 default \`extra="ignore"\` drops it); \`store.py:116\` full-replace \`.set(data)\`. One "Update Candidate" click erases provenance. Also: PUT ignores path slug — \`upsert\_candidate\` re-slugifies from \`product\_name\` → rename orphans old doc; failed parses ("Unknown Product") collide on slug \`unknown-product\`. \`CandidateRecord\` (schemas.py:60) would preserve raw\_markdown but has ZERO callers.

\- \*\*F10 — \`ListingData\` lacks \`extra="forbid"\`\*\* (only \`SectionOverrides\` has it). Golden Set silent-pass stands.

\- \*\*F11 — Triple validation, no shared cache.\*\* Same URLs GET-validated up to 3× per job: \`resolve\_and\_validate\_all\` (results discarded), \`filter\_broken\_links\` (no cache param), \`adaptive\_validate\`. Passes can disagree → markdown says valid while listing silently dropped the link.

\#\#\# Accessibility (hard requirement)

\- \*\*F12 — Fabricated MICRO\_MESSAGES flood aria-live.\*\* \`page.tsx:94-118\` injects invented status ("Analyzing robots.txt...", "Synthesizing AI-generated insights...") into \`aria-live="polite"\` every 1000ms for entire runs — hundreds of announcements, misrepresents actual pipeline (SC 4.1.3 violation in spirit and practice).

\- \*\*F13 — No \`role="alert"\` for research errors\*\* on main page; \`live\_run.spec.ts:45\` asserts a locator the page cannot produce.

\- \*\*F14 — No \`prefers-reduced-motion\`\*\* anywhere in \`globals.css\`; \`ellipsis\` animation unconditional. Violates stated hard requirement.

\- \*\*F15 — Minor ARIA:\*\* nested \`role="toolbar"\` without arrow-key nav; \`aria-live="assertive"\` on save confirmations (should be polite).

\#\#\# Dead code / unfinished

\- \*\*F16 — \`link\_validator\_engine.py\` (206 lines) dead\*\* — sole importer is the broken test; sole reason \`crawlee\[playwright\]\` is in \`requirements.txt\`; \`Dockerfile.api\` "Playwright support" claim false (no \`playwright install\`).

\- \*\*F17 — Frontend dead:\*\* \`InvalidLinksModal.tsx\` (248 lines, zero imports), \`lib/api.ts\` \`fetchWithAuth\` (zero callers; uses wrong env var \`NEXT\_PUBLIC\_API\_URL\`).

\- \*\*F18 — Deep-dive backend-complete, frontend-unreachable.\*\* Also \`delta\_system\_prompt.j2\` omits \`{confidence, why}\` → if wired, all deep-dive finds parse at 0.0 and fall below the cap-5 cutoff.

\- \*\*F19 — \`/research/validate-links\` has no caller.\*\*

\- \*\*F20 — Dead utilities:\*\* \`\_GROUNDING\_CONFIG\` (services.py:37), \`CandidateRecord\`, \`URLMask\`, \`load\_css\` (references nonexistent file), \`extract\_known\_urls\`; \`normalize\_url\` unused by production.

\- \*\*F21 — ai\_insights remnants:\*\* frontend \`types.ts\` (required field \+ SectionKey), \`page.tsx:609\` gate, \`ncademiPreview.ts\` \`genAiInsightsHtml\`, template \`{% if ai\_insights %}\` block never fed.

\#\#\# Tests

\- \*\*F22 — Suite state (executed):\*\* 21 pass / 2 fail / 2 collection errors. Failures: \`test\_generators.py\` ×2 (\`ListingData\` has no \`ai\_insights\`). Collection: \`test\_link\_validator.py\` wrong import path (\`nerd\_core.link\_validator\_engine\`); \`test\_sse\_api.py\` needs \`httpx-sse\`. \`test\_liveness.py\` needs \`pytest-httpx\`. Neither dep declared anywhere. Stale-ai\_insights set is FIVE files: \`test\_generators.py\`, \`test\_job\_lifecycle.py\`, \`migration\_verification.py\`, \`system\_test.py\`, \`parser\_robustness\_test.py\`.

\#\#\# Ops / reliability

\- \*\*F23 — deploy.sh destructive env vars:\*\* \`--set-env-vars\` on worker (\~:114) and API (\~:150) violates the repo's own \`--update-env-vars\` rule; partial re-run of API section wipes \`FRONTEND\_URL\`; CORS falls to localhost between steps 6 and 7b.

\- \*\*F24 — No promote step:\*\* frontend deployed \`--no-traffic \--tag=candidate\` with no scripted/documented promotion → redeploys never go live via script.

\- \*\*F25 — Stale-claim logic dead:\*\* \`claim\_job\` checks \`status \== "processing"\` — a value NO code path sets (actual: queued/searching\_initial/validating\_links/deep\_dive/complete/error). With worker \`--timeout 300\` vs 4-min Gemini call \+ validation, a timeout-killed job is stuck "searching\_initial" until 24h TTL.

\- \*\*F26 — \`\_enqueue\_task\` blocking gRPC on event loop\*\* (\`main.py:129\`; healthz path wraps same client in \`to\_thread\`).

\- \*\*F27 — \`/admin/batch-report\` unauthenticated\*\* (\`main.py:226-234\`) — only route without \`Depends(verify\_token)\`; serves a file only local batch runs create.

\- \*\*F28 — \`telemetry.log\_event\` slices before try\*\* → \`None\` \`response.text\` raises through "never raises" contract → job fails with bare TypeError.

\- \*\*F29 — Dual renderers drifted:\*\* Python \`generators.py:250\` empty-ACR "None found" links \`https://example.com\` (ships to WordPress); TS preview links \`\#\`. Contradicts conversions.py "single source of truth" docstring. The \`example.com\` href is wrong regardless of the dual-renderer decision.

\- \*\*F30 — Docs drift:\*\* \`NERD\_System\_Architecture.md:25\`, \`DECISION\_LOG.md:130\` justify \`--max-instances 1\` via \`validation\_jobs\`, which exists nowhere in code. Pin stays; rationale needs correction. \`system\_prompt.j2\` references deleted \`synthesis\_prompt.j2\`/\`synthesize\_insights\`.

\- \*\*F31 — Snapshot/record discrepancy:\*\* \`scripts/migrate\_to\_firestore.py\` present (with project guard :121-125) despite recorded "hard-retired". Root clutter (\`directive-step\*.txt\`, old reports, sample HTML, candidate .txt lists) still present.

\#\#\# Unverifiable from snapshot (never assert; confirm live)

Live Cloud Run env vars, deployed image contents (h2 presence), Firestore contents, whether production jobs currently succeed.

\---

\#\# 3\. PHASES (execute strictly in order; each ends at a STOP gate)

\#\#\# PHASE 0 — Baseline & Reconciliation (read-only; no edits)

\*\*Goal:\*\* Establish that the live repo matches (or diverges from) the reviewed snapshot before touching anything.

1\. \`git log \--oneline \-15\` and \`git status\` — paste verbatim.

2\. Reconcile the F31 discrepancy: \`ls scripts/migrate\_to\_firestore.py\`; report whether present. Confirm presence/absence of: root clutter files, \`prompts/research\_schema\_prompt.txt\`, five stale-ai\_insights test files.

3\. For each finding F1–F29 that cites a file:line, confirm the cited code still exists verbatim (grep the exact expression; e.g. \`grep \-n "startswith(\\"error\\")" api/main.py\`, \`grep \-n "http2=True" nerd\_core/tools/liveness\_validator.py\`, \`grep \-n 'url="\#"' nerd\_core/generators.py\`). Output a table: FINDING | CONFIRMED-IN-LIVE-REPO | DRIFTED. Any DRIFTED finding is re-triaged by Claude before its phase runs.

4\. Baseline test run: \`pip install httpx-sse pytest-httpx\` into the dev env (dev-only; not committed yet), then \`python \-m pytest tests/unit tests/integration \-q\` → save to \`.scratch/verification/phase0\_pytest\_baseline.txt\`. Expected: 21 pass / 2 fail (ai\_insights).

5\. Live-state confirmation commands FOR MONKEY BOY TO RUN (do not run without approval; they touch prod):

   \- \`gcloud run services describe nerd-worker \--region us-central1 \--format="value(spec.template.spec.containers\[0\].image)"\` then image \`pip show h2\` check (confirms F2 live impact).

   \- \`gcloud run services describe nerd-api \--region us-central1 \--format="value(spec.template.spec.containers\[0\].env)"\`.

\*\*STOP GATE 0:\*\* Reconciliation table \+ baseline pytest output reviewed by Claude; Monkey Boy approves phase order.

\---

\#\#\# PHASE 1 — Root Cause: Restore URL Resolution (F7) — highest leverage

\*\*Files:\*\* \`nerd\_core/tools/liveness\_validator.py\`, \`nerd\_core/utils.py\`. Nothing else.

1\. Checkpoint commit current state.

2\. Add \`final\_url: str \= ""\` to \`ValidationResult\`. In \`validate\_link\`, populate it with \`current\_url\` on every return path (success, HTTP error, exception, too-many-redirects — on pre-request failure, echo input).

3\. In \`resolve\_and\_validate\_url\`, return \`result.final\_url or url\` as the resolved URL instead of \`url\`.

4\. NO other behavior changes. The dead replacement branches in \`filter\_broken\_links\` (utils.py:90-91, 108-109) become live automatically — do not modify them.

\*\*Verification:\*\*

\- New unit test \`tests/unit/test\_resolution.py\`: local HTTP server issuing an absolute redirect A→B; assert \`validate\_link(A).final\_url \== B\` and \`resolve\_and\_validate\_url(A)\` returns B.

\- Fixture-based test: markdown containing a redirecting URL through \`filter\_broken\_links\` → output markdown contains the final URL, not the input.

\- Full suite: no regressions vs Phase 0 baseline.

\*\*STOP GATE 1:\*\* Paste test output \+ diff. Note for Monkey Boy: after deploy, new research runs stop minting grounding-api-redirect URLs; the existing 12-file backlog remediation (live run of the replacement scripts) becomes a separate approved task.

\#\#\# PHASE 2A — /healthz crash (F1)

\`api/main.py:357\`: restrict the error scan to string values: \`any(isinstance(v, str) and v.startswith("error") for v in checks.values())\`. \*\*Verify:\*\* reproduce old crash in a REPL with the dict shape, then confirm fixed logic returns bool for all-ok, firestore-error, and queue-error cases; paste all three. \*\*STOP GATE 2A.\*\*

\#\#\# PHASE 2B — Remove http2=True (F2)

\`liveness\_validator.py:34\`: delete \`http2=True\`. Do NOT add \`h2\`/\`httpx\[http2\]\` anywhere. \*\*Verify:\*\* in a clean venv from \`requirements-worker.txt\` exactly, run a script that constructs the client and validates one public URL; paste output proving no ImportError. \*\*STOP GATE 2B.\*\*

\#\#\# PHASE 2C — ACR Link parsing (F3)

\*\*Files:\*\* \`nerd\_core/generators.py\`, \`api/conversions.py\`.

1\. In the \`acr\` section branch: after a \`Report Title:\` creates an ACRReport, parse a subsequent \`Link:\` line (reuse \`\_LINK\_RE\` semantics on the content after \`Link:\`) and set \`url\` on the most recent report. Keep template-only frugality — no other metadata scraping.

2\. In BOTH converters in \`conversions.py\`, copy \`preparation\_type\` on ACRReport, and (pre-staging F8) note but do not yet change ResourceLink.

3\. \`worker.py\` ACR check logic unchanged — with a real URL, \`is\_likely\_vpat\_acr\` now performs its intended liveness role.

\*\*Verify:\*\* run the Phase-2C fixture (schema-conformant draft with \`Report Title:\` \+ \`Link:\`) through \`parse\_markdown\_to\_listing\` → assert \`(title, real\_url)\`; through \`dataclass\_to\_pydantic\` → assert \`preparation\_type\` round-trips. Full suite green vs baseline. \*\*STOP GATE 2C.\*\*

\#\#\# PHASE 2D — /render auth headers (F4)

\`frontend/app/page.tsx\` Copy HTML \+ Download HTML handlers: add \`Authorization: Bearer ${token ?? "local-bypass"}\` via \`getIdToken()\` (mirror \`handleSave\`), add \`.ok\` check \+ \`.catch\` that logs to the message log. \*\*Verify:\*\* \`npm run build\` clean; LOCAL\_MODE manual check: both buttons produce non-"undefined" HTML (paste first 200 chars of clipboard/download content). \*\*STOP GATE 2D.\*\*

\#\#\# PHASE 2E — SSE error/end handling (F5)

\`frontend/hooks/useResearch.ts\`:

1\. In \`onmessage\`, when \`msg.event \=== "status"\` and parsed \`data.status \=== "error"\`: abort controller, set \`status: "error"\`, \`error: data.error ?? "Research failed"\` (surface \`quota\_exhausted\` with a human message).

2\. Handle \`msg.event \=== "end"\`: if state not already complete/error, treat as error ("Stream ended without result"), abort.

3\. Add \`onclose\` that, if status still streaming, sets error state (defense in depth; per library source, absent onclose the promise resolves silently).

\*\*Verify:\*\* LOCAL\_MODE with a forced worker exception (temporary raise in a scratch copy or an unreachable product URL): UI transitions to error, inputs re-enable, heartbeat stops. Paste the observed log sequence. \*\*STOP GATE 2E.\*\*

\#\#\# PHASE 3 — Liveness robustness (F6)

\`liveness\_validator.py\`: (a) resolve \`Location\` with \`urllib.parse.urljoin(current\_url, location)\`; (b) add a realistic browser User-Agent (+ \`Accept\` header) to the client. No other changes; keep GET, keep SSRF-per-hop.

\*\*Verify:\*\* rerun the Phase-review relative-redirect reproduction (local server, \`Location: /final\`) → now \`is\_live=True\`. Unit tests via pytest-httpx for both behaviors. Full suite green. \*\*STOP GATE 3.\*\*

\#\#\# PHASE 4A — Field-preserving conversions (F8)

\`api/conversions.py\`: copy \`confidence\`, \`justification\` in both directions for ResourceLink. \`frontend/lib/types.ts\`: add optional \`confidence?\`, \`justification?\` to ResourceLink (display wiring is OUT of scope). \*\*Verify:\*\* executed round-trip shows values preserved (the review's reproduction, now passing). \*\*STOP GATE 4A.\*\*

\#\#\# PHASE 4B — Candidate persistence integrity (F9)

\*\*Files:\*\* \`api/main.py\`, \`api/store.py\` (decision-gated — presents options, does not decide alone):

\- Switch \`POST/PUT /admin/candidates\` request models to \`schemas.CandidateRecord\` (preserves raw\_markdown; resurrects F20's dead class purposefully), OR change \`\_upsert\_record\` to merge semantics. \*\*Escalate the choice to Claude/Monkey Boy with a packaged evidence block before editing.\*\*

\- PUT slug handling: honor the path slug (pass explicit slug into upsert) OR delete-old-on-rename. Escalate likewise.

\*\*Verify (post-decision):\*\* LOCAL\_MODE lifecycle test: worker-persisted candidate → GET → PUT update → GET again → \`raw\_markdown\` intact; rename case produces no orphan. \*\*STOP GATE 4B.\*\*

\#\#\# PHASE 4C — Schema strictness (F10)

Add \`model\_config \= {"extra": "forbid"}\` to \`schemas.ListingData\` (inherited by CandidateRecord — confirm raw\_markdown field ordering keeps it valid). \*\*Verify:\*\* full suite \+ a Golden Set record with an unknown field now 422s (fixture test). Watch for legitimate stored docs with legacy extra keys — if integration tests reveal any, STOP and report rather than loosening. \*\*STOP GATE 4C.\*\*

\#\#\# PHASE 5 — Accessibility (5A–5D as one dispatch, frontend-only)

\- \*\*5A (F12):\*\* Remove \`MICRO\_MESSAGES\` \+ heartbeat interval entirely; the log shows only REAL backend status events. If Monkey Boy wants activity indication, a single static "Working…" line with the existing ellipsis (motion-guarded per 5C) — decision noted at gate, default is removal.

\- \*\*5B (F13):\*\* Add a \`role="alert"\` region rendering \`state.error\` when status is error (satisfies \`live\_run.spec.ts:45\`).

\- \*\*5C (F14):\*\* \`globals.css\`: \`@media (prefers-reduced-motion: reduce) { .ellipsis-animation::after { animation: none; } }\` (and any other animation/transition introduced).

\- \*\*5D (F15):\*\* Remove the nested \`role="toolbar"\` (keep outer or drop both to plain groups with aria-label); change save-confirmation spans to \`aria-live="polite"\`.

\*\*Verify:\*\* \`npm run build\`; run \`frontend/tests/e2e/accessibility.spec.ts\` \+ \`live\_run.spec.ts\` in LOCAL\_MODE; paste axe results. \*\*STOP GATE 5.\*\*

\#\#\# PHASE 6 — Dead code removal (grep-proof required per deletion)

\- \*\*6A (F16):\*\* Delete \`nerd\_core/tools/administrative\_validators/\` \+ \`tests/test\_link\_validator.py\`; remove \`crawlee\[playwright\]\` from \`requirements.txt\`; fix \`Dockerfile.api\` comment. \*\*Check first:\*\* confirm nothing else needs crawlee-transitive deps (clean \`pip install \-r requirements.txt \-c constraints.txt\` in fresh venv, then import \`api.main\`). Decision flag: \`LINK\_VALIDATOR\_SPEC.md\` and schemas \`LinkValidationDetailedResult\`/\`LinkValidationJobStatus\` — archive or delete per Monkey Boy.

\- \*\*6B (F17, F19):\*\* Delete \`InvalidLinksModal.tsx\`, \`lib/api.ts\`; decision-gate \`/research/validate-links\` endpoint \+ \`LinkValidationRequest/Response\` (keep if a validation UI is planned; delete otherwise — escalate).

\- \*\*6C (F20):\*\* Delete \`\_GROUNDING\_CONFIG\`, \`URLMask\`, \`load\_css\`, \`extract\_known\_urls\`. \`CandidateRecord\`: KEEP if Phase 4B adopted it. \`normalize\_url\`: KEEP (eval/scraper use it); flag separately whether production should adopt it (deferred decision, not this plan).

\- \*\*6D (F21):\*\* Frontend ai\_insights removal: \`types.ts\` (field \+ SectionKey), \`page.tsx:609\` block \+ \`showAiInsights\` state, \`ncademiPreview.ts\` \`genAiInsightsHtml\` \+ case, \`ListingCard\` prop; template \`{% if ai\_insights %}\` block in \`ncademi\_listing.html\`.

\- \*\*6E (F18) — DECISION GATE, no code yet:\*\* deep-dive is backend-complete/frontend-absent. Options: (i) wire a UI \+ fix \`delta\_system\_prompt.j2\` annotations, (ii) remove the surface. Escalate with evidence block.

\*\*Verify:\*\* zero-reference greps pasted per deletion; full pytest \+ \`npm run build\` green; fresh-venv import check for 6A. \*\*STOP GATE 6.\*\*

\#\#\# PHASE 7 — Test hygiene (F22)

1\. Add \`httpx-sse\`, \`pytest-httpx\` to a dev/test requirements location (recommend appending to \`requirements-eval.txt\` or a new \`requirements-dev.txt\` — escalate placement preference, default \`requirements-dev.txt\`).

2\. Fix or delete the five stale-ai\_insights files: \`test\_generators.py\` → update assertions (keep the tests, drop ai\_insights checks); the four legacy scripts (\`test\_job\_lifecycle\` check ai\_insights usage — likely just strips a field reference; \`migration\_verification.py\`, \`system\_test.py\`, \`parser\_robustness\_test.py\` — delete if superseded, escalate with grep evidence).

\*\*Verify:\*\* \`python \-m pytest tests/ \--ignore=tests/smoke \-q\` → 0 failures, 0 collection errors; paste. \*\*STOP GATE 7.\*\*

\#\#\# PHASE 8 — Ops & docs (each item small; one dispatch, itemized diff review)

\- \*\*8A (F23):\*\* deploy.sh: convert worker/API deploys to preserve env (\`--update-env-vars\` on redeploys; document first-deploy bootstrap), eliminating the FRONTEND\_URL wipe window.

\- \*\*8B (F24):\*\* Add explicit promote step (or documented \`gcloud run services update-traffic\` command in the checklist) after frontend candidate verification.

\- \*\*8C (F25):\*\* Fix stale-claim: match against the real in-flight statuses (\`searching\_initial\`, \`validating\_links\`, \`deep\_dive\`) or track a generic \`in\_progress\` flag. Note: only matters if retries are ever enabled; still fix for correctness. Optionally add a worker-side \`asyncio.wait\_for\` around the job body under the 300s ceiling so timeouts produce \`fail\_job\` instead of a stuck doc — escalate as judgment call.

\- \*\*8D (F27):\*\* Add \`Depends(verify\_token)\` to \`/admin/batch-report\` (or delete the route if batch reports remain local-only — escalate).

\- \*\*8E (F28):\*\* In \`telemetry.log\_event\`, coerce \`original\_markdown \= (original\_markdown or "")\` etc. before slicing; move slicing inside try.

\- \*\*8F (F26):\*\* Wrap \`tasks\_client.create\_task\` in \`asyncio.to\_thread\` inside \`\_enqueue\_task\`.

\- \*\*8G (F29):\*\* Change Python empty-ACR href from \`https://example.com\` to \`\#\` to match preview (WordPress output must not ship example.com). The dual-renderer consolidation itself is a DEFERRED decision — record only.

\- \*\*8H (F30):\*\* Docs: correct the \`validation\_jobs\` rationale for \`--max-instances 1\` (pin retained; rationale \= cost \+ simplicity, per Monkey Boy's wording); remove the \`synthesis\_prompt.j2\` reference from \`system\_prompt.j2\`.

\- \*\*8I (F31):\*\* Root cleanup \+ \`migrate\_to\_firestore.py\` disposition — execute only per Phase 0 reconciliation outcome and explicit approval.

\*\*Verify:\*\* shellcheck-style read of deploy.sh diff; pytest green; paste diffs. \*\*STOP GATE 8.\*\*

\---

\#\# 4\. DEFERRED DECISIONS LOG (not scheduled; recorded so nothing is lost)

1\. Dual-renderer consolidation (server-rendered preview via \`/render\` vs parity tests) — F29.

2\. Production adoption of \`normalize\_url\`/tracking-param stripping — F20.

3\. Deep-dive: build UI or remove — F18/6E.

4\. Backlog remediation live run for the 12 grounding-redirect candidate files (post-Phase-1 deploy).

5\. Populate production Firestore \`nerd\_candidates\` from local seeds (known open item; unrelated to this plan's phases but sequenced after 4B/4C so ingested data meets the stricter schema).

6\. Watchdog for stuck jobs / frontend stream timeout — F25 extension.

7\. Proper \`logging.basicConfig\` consolidation for \`nerd\_core/\` (telemetry double-handler) — standing fix remains until then.

\#\# 5\. COMPLETION CRITERIA

All phases gated-complete; full pytest suite 0 fail/0 error from declared deps; \`npm run build\` \+ e2e a11y specs green; one LOCAL\_MODE end-to-end research run producing a listing with (a) no grounding-api-redirect URLs, (b) a real ACR link when one exists, (c) error path verified to surface in UI; deploy performed via corrected deploy.sh with gated promote; findings F1–F31 individually marked RESOLVED/DEFERRED/WONT-FIX in a final verification log with evidence links into \`.scratch/verification/\`.

