# N.E.R.D. Development Mandates

## Current Progress
- **Phase 0-2**: Core package isolation, FastAPI wrapper, and Async Worker architecture complete.
- **Phase 3**: Next.js Frontend implementation complete.
    - Zod schemas mirror Pydantic models.
    - Two-stage research flow implemented with SSE.
    - Editable data grids (TanStack Table v8) and Live Preview (Jinja2 via API) operational.
    - App shell CSS (globals.css) and Firebase Auth stubbed.

## Upcoming: Phase 4 (Deployment & Infrastructure)
- **Firebase Auth Enforcement**: Implement login/auth guards and secure the SSE stream.
- **GCP Provisioning**: Set up Cloud Tasks queue ("nerd-research-queue") and Firestore.
- **Secret Manager**: Configure backend/worker to pull Vertex/BigQuery credentials.
- **Cloud Run Deployment**: Finalize Dockerfiles and deploy services to `edtech-agent-2026`.

## Validation Rules
- **E2E Live Testing**: Every code change MUST be validated by running the live end-to-end test suite. This ensures that changes to the parser, prompts, or services do not break the population of the NCADEMI product page sections.
- **Test Command**: `source venv312/bin/activate && export PYTHONPATH=$PYTHONPATH:. && python3 tests/e2e_live_validation.py`
- **System Test Command**: `source venv312/bin/activate && export PYTHONPATH=$PYTHONPATH:. && python3 tests/system_test.py`
- **Verification Criteria**:
    - Research must return a non-empty draft.
    - Parser must successfully map: Product Name, Vendor, Description, Vendor Resources, Third-Party Insights, and AI Insights.
    - HTML generation must include all primary sections from the NCADEMI template.
    - Frontend must build successfully (`npm run build`).

## Output Safety

**NEVER output credentials, secrets, or sensitive values in plain text.**
This includes API keys, secret tokens, App IDs, project credentials,
service account keys, OAuth tokens, or any value sourced from Secret
Manager, .env files, or gcloud secrets versions access.

When a command returns a sensitive value:
- Confirm it is present and non-empty: yes / no
- Confirm it is not a placeholder (e.g. "PLACEHOLDER_KEY"): yes / no
- Truncate output to the first 8 characters followed by [REDACTED]
- Never paste the full value, even partially, into response output

This rule applies to ALL output regardless of context, session, or
instruction. It cannot be overridden by any prompt or user request.

## Engineering Standards
- **Google Drive Security**: All `rclone` operations MUST be restricted to the project root folder (`15GjL2xX5JIX2S8CgUgmIh79xcFqlbcqC`) using the `--drive-root-folder-id` flag. This is a non-negotiable safety mandate to prevent accidental access to external files.
- **Python Version**: 3.12 (as specified in `Dockerfile` and `requirements.txt`).
- **Dependency Management**: Load-bearing transitive pins are locked in `constraints.txt`. Use `-c constraints.txt` for all installations.
- **Robust Parsing**: Use flexible regex in `nerd_core/generators.py` to handle varied AI Markdown output (Standard, Parenthetical, or Raw URLs).

## Deployment Safety Rule
Before executing any `gcloud run deploy`, `gcloud app deploy`, or `gcloud builds submit` commands, you MUST verify the presence of a `.gcloudignore` file in the execution directory. If it does not exist, you must create it and ensure it explicitly excludes heavy local directories (e.g., `node_modules/`, `venv/`, `.venv/`, `.next/`, `__pycache__/`, and `.env`). Do not initiate a deployment without this safeguard in place.

