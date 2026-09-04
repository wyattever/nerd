# N.E.R.D. Frontend

Next.js 16 (App Router) frontend for N.E.R.D. — NCADEMI EdTech Research & Documentation. See `../docs/NERD_System_Architecture.md` for the full system design and `../docs/DECISION_LOG.md` for settled decisions and their rationale.

## Getting Started

```bash
npm run dev
```

Requires `frontend/.env.local`. Open [http://localhost:3000](http://localhost:3000); `/` redirects to `/editor`.

## Routes

* **`/editor`** — canonical visual editor for `published.json`, `added.json`, and `candidate.json`.
* **`/vendors`** — visual editor for the global vendor registry (`lib/vendors.json`).
* **`/researcher`** — seeded product-tracking table.
* **`/records`** — stored / live record views.
* **`/users`** — user directory (no auth gate yet, MVP-stage).
* **`/login`** — Firebase Auth entry point.
* **`/api/local/*`** — session-gated read/write API backing `/editor`, `/vendors`, and `/records`. Persists to **Firestore** via `lib/server/documents.ts` (single-transaction compare-and-swap), not to disk. Every route calls `assertSession()` and returns **401** when unauthenticated — these are deployed, intended routes, not dev-only ones. Breakdown:
  * `published`, `added`, `candidate`, `vendors` — GET + POST. POST requires `If-Match`; missing header is 428, stale ETag is 412.
  * `published-live`, `added-live`, `vendors-live` — GET only, read-only views of the scrape snapshots.
  * `passwords`, `promote-live` — writes that are deliberately outside the ETag system (see each route's own header for why).

## Notes

* **Data grids** are hand-rolled (`ResearcherTable.tsx`), not a third-party grid library.
* **Accessibility**: WCAG 2.2 AA is a hard requirement, verified with `@axe-core/playwright` (`tests/e2e/`).
* **Next.js 16**: this version has breaking changes from prior Next.js releases — see the repo-root `frontend/AGENTS.md` note and `node_modules/next/dist/docs/` before assuming an older API still applies. `proxy.ts` (not `middleware.ts`) is the current file convention for edge/proxy logic.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
