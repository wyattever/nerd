# Global Agent Guidelines (AGENTS.md)

## 1. Next.js 15 Environment
- **Source of Truth:** This repository uses Next.js 15. Dynamic APIs (`params`, `searchParams`, `cookies()`, `headers()`) are **asynchronous Promises**. Always `await` them.
- **Local Documentation Hook:** Before modifying routing or server data fetching, read the exact guide in:
  `node_modules/next/dist/docs/`
- Default to React Server Components (RSC). Do not add `'use client'` unless browser APIs or interactive state are mandatory.

## 2. Cross-Agent Execution Boundaries
- **Scope Lock:** Only modify files explicitly requested or strictly necessary for the prompt.
- **No Full-File Rewrites:** Use targeted edits; preserve existing comments, exports, and adjacent logic.
- **Verification:** Do not execute full E2E or Playwright test suites. Run light verification (`npx tsc --noEmit`) to confirm builds.