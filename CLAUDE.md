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