# N.E.R.D. Frontend

Next.js 16 (App Router) frontend for N.E.R.D. — NCADEMI EdTech Research & Documentation. See `../docs/NERD_System_Architecture.md` for the full system design and `../docs/DECISION_LOG.md` for settled decisions and their rationale.

## Getting Started

```bash
npm run dev
```

Requires `frontend/.env.local`. Open [http://localhost:3000](http://localhost:3000); `/` redirects to `/editor`.

### `NEXT_PUBLIC_DISABLE_AUTH`

This flag is **no longer an auth bypass**. Phase 3 replaced the login gate with real Firebase session cookies (`lib/server/session.ts`, [Decision #61](../docs/DECISION_LOG.md)); `proxy.ts` and `/login` no longer read it, and local sign-in works normally without it.

What it still does: it is one of the two conditions in `isLocalOnlyAllowed()` (`lib/local-only.ts`), and the only route still reached through that function is **`/api/local/scrape`**. Leave the flag unset and that one route returns a bare 404. Nothing else in the app is affected.

Three things to know about it:

* **It is deliberately absent from `.env.local.example`.** Phase 3 removed it there under [Decision #54](../docs/DECISION_LOG.md) — a "skip all auth" switch should not be advertised as standard local setup. Set it in your own `.env.local` only if you need the scrape route.
* **It must never be set in any deployed environment** — [Decision #27](../docs/DECISION_LOG.md#27-production-guardrails--local_mode-and-next_public_disable_auth-must-never-reach-deployed-environments), which records the 2026-07-08 incident where its `LOCAL_MODE` sibling reached production.
* **It is scheduled for deletion in Phase 4**, together with the rest of the local-only module group it belongs to — `lib/local-only.ts`, `lib/local-data.ts`, and `lib/local-write.ts`. `/api/local/scrape` is the sole remaining consumer of all four, so they are removed together when Phase 4 rehomes that route as a Cloud Run Job.

## Routes

* **`/editor`** — canonical visual editor for `published.json`, `added.json`, and `candidate.json`.
* **`/vendors`** — visual editor for the global vendor registry (`lib/vendors.json`).
* **`/researcher`** — seeded product-tracking table.
* **`/records`** — stored / live record views.
* **`/users`** — user directory (no auth gate yet, MVP-stage).
* **`/login`** — Firebase Auth entry point.
* **`/api/local/*`** — session-gated read/write API backing `/editor`, `/vendors`, and `/records`. Persists to **Firestore** via `lib/server/documents.ts` (single-transaction compare-and-swap), not to disk. Every route except `scrape` calls `assertSession()` and returns **401** when unauthenticated — these are deployed, intended routes, not dev-only ones. Breakdown:
  * `published`, `added`, `candidate`, `vendors` — GET + POST. POST requires `If-Match`; missing header is 428, stale ETag is 412.
  * `published-live`, `added-live`, `vendors-live` — GET only, read-only views of the scrape snapshots.
  * `passwords`, `promote-live` — writes that are deliberately outside the ETag system (see each route's own header for why).
  * **`scrape`** — the one exception. Still gated by `assertLocalOnly()` and still returns a bare **404** outside local development, because it shells out to the Python scraper and reads from disk. It is the last route on the old local-only path; Phase 4 migrates it.

## Notes

* **Data grids** are hand-rolled (`ResearcherTable.tsx`), not a third-party grid library.
* **Accessibility**: WCAG 2.2 AA is a hard requirement, verified with `@axe-core/playwright` (`tests/e2e/`).
* **Next.js 16**: this version has breaking changes from prior Next.js releases — see the repo-root `frontend/AGENTS.md` note and `node_modules/next/dist/docs/` before assuming an older API still applies. `proxy.ts` (not `middleware.ts`) is the current file convention for edge/proxy logic.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
