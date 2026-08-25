# N.E.R.D. Frontend

Next.js 16 (App Router) frontend for N.E.R.D. — NCADEMI EdTech Research & Documentation. See `../docs/NERD_System_Architecture.md` for the full system design and `../docs/DECISION_LOG.md` for settled decisions and their rationale.

## Getting Started

```bash
npm run dev
```

Requires `frontend/.env.local` with `NEXT_PUBLIC_DISABLE_AUTH=true` for local-mode auth bypass and to unlock the local-write API routes (see below) — production builds must never set this. Open [http://localhost:3000](http://localhost:3000); `/` redirects to `/editor`.

## Routes

* **`/editor`** — canonical visual editor for `published-tables.json`, `added-tables.json`, and `candidate-tables.json`.
* **`/vendors`** — visual editor for the global vendor registry (`lib/vendors.json`).
* **`/researcher`** — seeded product-tracking table.
* **`/tables`** — read-only AppSheet recovery tables.
* **`/users`** — user directory (no auth gate yet, MVP-stage).
* **`/login`** — Firebase Auth entry point.
* **`/api/local/*`** — local-only, dev-gated write API backing `/editor` and `/vendors` (ETag-checked, atomic writes to disk). Returns 404 outside local development.

## Notes

* **Data grids** are hand-rolled (`ResearcherTable.tsx`, `AppsheetSortableTable.tsx`), not a third-party grid library.
* **Accessibility**: WCAG 2.2 AA is a hard requirement, verified with `@axe-core/playwright` (`tests/e2e/`).
* **Next.js 16**: this version has breaking changes from prior Next.js releases — see the repo-root `frontend/AGENTS.md` note and `node_modules/next/dist/docs/` before assuming an older API still applies. `proxy.ts` (not `middleware.ts`) is the current file convention for edge/proxy logic.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
