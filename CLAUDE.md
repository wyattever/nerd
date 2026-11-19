@AGENTS.md

# Next.js 15 Project Guide

## 1. Build & Test Commands
- Dev Server: `pnpm dev` (or `npm run dev`)
- Build: `pnpm build`
- Typecheck: `npx tsc --noEmit`
- Lint: `pnpm lint`

## 2. Core Architectural Values
- **Target Audience:** Production codebase for senior developers. Prioritize explicit type safety and clean architecture over shortcuts.
- **Server-First Mindset:** Keep components on the server by default. Isolate client state to leaf nodes.
- **Fail Fast:** Validate inputs and API payloads at runtime boundaries. Do not swallow errors or use empty catch blocks.

## 3. Next.js 15 Guardrails
- `params`, `searchParams`, `cookies()`, and `headers()` are **asynchronous Promises**. Always `await` them.
- Reference local documentation before implementing routing or cache logic: `node_modules/next/dist/docs/`
- Use Server Actions securely; validate authentication and input schemas at the top of every action.

## 4. Execution Boundaries
- **Minimal Diffs:** Touch only files related to the prompt. Do not reformat untouched code or perform unsolicited refactors.
- **Verification:** Run `npx tsc --noEmit` to verify type safety before considering a task complete.
- **Documentation & Schema Index:**
  - For unified directory types and schemas: Refer to `frontend/lib/directory-schema.ts` (or legacy `vendor-schema.ts`).
  - For shared UI components: Refer to `frontend/components/`.

## 5. Reporting (applies to every dispatch)
- Write the complete report for every dispatch to `.scratch/verification/<task-slug>-<YYYYMMDD-HHMM>.md`. This includes dispatches that stop early: write the file before stopping, with the stop reason and its evidence.
- The file holds everything the dispatch's REPORT section asks for: verbatim command output, diffs, commit output, assumption checks, and any judgment calls you made, with their reasons.
- Capture command output with the shell, not by retyping it: `cmd 2>&1 | tee -a <file>`, or `>> <file>`. For long output (full test runs, typecheck, lint, large diffs), redirect to the file and read back only what decides the gate: the exit code, summary lines, and failures. Read the full output whenever a gate fails.
- Keep the terminal reply to about 15 lines: the report file path, one line per gate (PASS / FAIL / SKIPPED), any commit hashes, and any stop reason in one sentence. Do not repeat report content in the reply.
- Never write password values, secrets, or credentials to a report file.
- A dispatch's own REPORT section decides what the report contains. This section decides where the report is written and how output is captured.