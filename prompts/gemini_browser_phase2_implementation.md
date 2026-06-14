PROMPT FOR EXTERNAL AGENT (Gemini-browser)
N.E.R.D. Phase 2 — Async Worker Implementation
========================================================

You are the implementation agent for the N.E.R.D. (Ncademi Edtech Research & Data) project.
Phase 1 is complete. Your task is to implement Phase 2: Async Execution.

Refer to the following documents in the 'manifest' Google Doc:
- MIGRATION_PROMPT.md: The technical specification for all phases.
- PHASE_2_DECISIONS.md: The finalized architectural decisions for the worker, queue, and status store.
- GEMINI.md: Engineering standards and security mandates.

YOUR GOAL
---------
Implement the asynchronous worker architecture using Cloud Tasks and Firestore.

REQUIRED FILES
--------------
Please draft the complete code for the following files and write them to the 'Output' Google Doc:

1. api/job_store.py (New)
   - Implement an abstraction over Google Cloud Firestore to manage job states and results.
   - Use the async Firestore client (`google-cloud-firestore[async]`).
   - Define methods to create a job, add a status event, mark as complete with result, and mark as error.
   - IMPLEMENTATION DECISION NEEDED: Decide on the best method for the SSE endpoint to listen to Firestore updates (e.g., async polling every 0.5s vs. native snapshot listeners with an async queue). Choose the most robust and maintainable option for FastAPI and justify it in comments.

2. api/worker.py (New)
   - A FastAPI application dedicated to processing research jobs triggered by Cloud Tasks.
   - Create a POST endpoint (e.g., `/process`) that receives the task payload (job_id, type, and research parameters).
   - The endpoint must call the appropriate `nerd_core.services` functions:
     - `run_initial_research(product_url, timeout_min)`
     - `run_deep_dive(product_url, product_name, current_draft, timeout_min)`
   - Implement the validation sequence (`_validate` and `_build_result_payload`) as currently seen in `api/main.py`.
   - Update the job status in Firestore at each stage (searching, validating, complete, etc.).
   - Ensure BigQuery telemetry (`nerd_core.telemetry.log_event`) is called.

3. api/main.py (Updated)
   - Refactor `research_initial` and `research_deep_dive` to:
     - Generate a UUID4 for the job.
     - Create the initial "queued" record in Firestore using `api/job_store.py`.
     - Construct a Cloud Tasks HTTP request targeting the `api/worker.py` endpoint.
     - Enqueue the task to the `research-queue`.
   - Refactor `jobs_sse` to:
     - Use `api/job_store.py` to stream updates from Firestore to the client.

4. requirements-worker.txt (New)
   - List the minimal top-level dependencies for the worker container (google-cloud-tasks, google-cloud-firestore, fastapi, uvicorn, httpx, etc., plus nerd_core dependencies).

5. Dockerfile.worker (New)
   - A lean multi-stage build for the worker service.
   - Ensure WORKDIR is at the repository root so Jinja2 can resolve "prompts/".

CONSTRAINTS
-----------
- DO NOT MODIFY `nerd_core`.
- Maintain the exact `ListingData` schema contract.
- Respect the `ENABLE_AI_INSIGHTS` environment variable logic.
- Ensure the worker handles `QuotaExhaustedError` by emitting an "error" status to Firestore and finishing the task.

INSTRUCTIONS
------------
Draft the code for all five files. Use clear comments. Once complete, write your response to the 'Output' Google Doc.
