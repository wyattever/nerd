# UI Routing Migration — Implementation Guide (Research-Validated)

**Status:** PROPOSED — not SETTLED until Phase 6 ships and is verified in production
**Supersedes:** `UI_ROUTING_MIGRATION.md` (drafted before architecture research was conducted)
**Validated against:** `Next_js_Architecture_Refactoring_Patterns.md` — Next.js App Router / React 19 research report
**Revision note:** both gates are now resolved and reconciled into the body below (§1, §4). An earlier revision carried a Gemini Web addendum that resolved Gate 2 to direct `fs.readFile` reads without updating Phase 2's guard logic — that gap (bypassing the DECISION_LOG #6 local-only boundary) is fixed here; see §4 step 1.
**Second revision note:** the first fix reused `assertLocalOnly()` as-is inside the new Server Component reader, but that function returns `Response | null` rather than throwing — called and ignored (as the §4 step 1 sample did), it blocks nothing, since nothing checks the return value and a Server Component can't `return` a `Response` the way a Route Handler does. §4 step 1 now extracts the boundary condition into its own boolean predicate with two thin call-site wrappers: the existing `Response`-returning form for Route Handlers (unchanged), and a new `notFound()`-throwing form for the Server Component readers, which is what actually halts rendering.
**Owner:** frontend
**Related:** `docs/DECISION_LOG.md` #6 (local auth bypass), #8 (multi-layer testing); `frontend/AGENTS.md` (Next.js 16 breaking-change warning)

---

## 0. What changed from the pre-research draft — read this first

The original draft was directionally correct (route groups for strangler-fig safety, `layout.tsx` for the sidebar shell, `useSearchParams` for the source toggle) but was written without confirming several Next.js 16 / React 19 specifics against source material. The research report confirms some choices, corrects others, and surfaces one significant gap. Nothing below is silently changed — each row is a decision, not a fact, until a gate in §1 is signed off.

| Area | Original draft | Research finding | Resolution |
|---|---|---|---|
| Route structure for candidates/added/published | Three separate parenthesized leaf folders, each hardcoding its own tab identity | Confirms named leaf routes over a generic `[type]` dynamic segment when per-type controls differ (Import Candidate, Delete Added, etc. are unconditional-per-file, not `activeTab === X &&` branches) — this is exactly the anti-pattern the refactor is escaping | **No change.** Keep three named leaves. Research's `[type]` example is illustrative shorthand, not a recommendation to reintroduce type-conditional branching. |
| Selected record inside a tab | In-memory `useState(selectedSlug)`, not linkable | Route segments for entity identity are "vastly superior" to search params or local state for caching, Suspense isolation, and deep-linking (§ URL Design) | **New capability, Gate 1.** Promote `selectedSlug` to a `[slug]` dynamic segment. |
| `source=live` toggle | `useSearchParams`, explicitly *without* a `<Suspense>` boundary, reasoning "nothing static to bail out of" | Next.js throws a hard build-time error ("Missing Suspense boundary with useSearchParams") on *any* `useSearchParams()` call site — this is independent of whether the rest of the page is static | **Correction.** Suspense boundary is mandatory around the toggle, not optional. |
| Local JSON data fetching | Leaf pages are `"use client"`, `fetch('/api/local/...')` inside `useEffect` | API route + client-side `fetch` for local JSON is flagged as an anti-pattern; Server Components should read data server-side and eliminate the client round trip | **Resolved, Gate 2 → Option 2a.** Server Components read the files directly via `fs.readFile`. See §4 step 1 for the guard this requires — reading directly means the route-level `assertLocalOnly()` check no longer runs in the request path, so an equivalent check has to move with the read. |
| Sidebar `<Link>` clicks | No `scroll={false}` specified anywhere | Next.js scroll-resets to top on every route transition by default; without `scroll={false}` the persistent-sidebar UX (the entire point of Phase 1) breaks on first click | **Addition.** `scroll={false}` on every intra-shell `<Link>` and `router.push`/`replace` call. |
| Unsaved-edit protection during navigation | Not addressed | App Router removed `Router.events`; the App Router has no built-in navigation-guard hook. A hybrid `beforeunload` + capture-phase click interception + temporary `router.push`/`replace` patching is required, or edits made in Phase 2's field editors are silently discardable by any sidebar click | **New phase (Phase 4).** This is the highest-value gap: six linkable leaf routes make "click away mid-edit" far easier than the single-page monolith ever allowed. |
| `layout.tsx` for the persistent shell | Already planned correctly | Confirms `layout.tsx` (not `template.tsx`) is required for DOM/state persistence across sibling navigations | No change — validated as-is. |

---

## 1. Decision gates (resolve before Phase 1 work is dispatched to Gemini)

### Gate 1 — Promote record selection to a `[slug]` route segment?

**Recommendation: adopt.** Low implementation cost, and it directly fixes a real gap in the original plan (selected record is currently unlinkable and lost on refresh — the same defect the whole migration exists to fix for the *tab*, just one level down for the *record*). Route: `/editor/candidates/[slug]`, `/records/published/[slug]`.

Trade-off to be aware of: this adds one more nested `page.tsx` per leaf (6 leaves × 1 detail page = 6 new files) and a "nothing selected" empty state at the parent leaf's own `page.tsx`. Modest, bounded cost.

### Gate 2 — Move local JSON reads from client-side `fetch('/api/local/...')` to server-side reads?

Two options were on the table:

- **Option 2a — Full research recommendation:** Server Components read the underlying data source directly (bypassing the `/api/local/*` route entirely) and pass it down as props. Eliminates the client network round trip completely.
- **Option 2b — Middle path:** keep the existing `/api/local/*` route layer, just move the `fetch` call from a client `useEffect` up into the Server Component. Lower-risk, preserves the existing route boundary unchanged.

**RESOLVED: Option 2a.** The network-latency argument is a genuine improvement and the app has no static-import build step for this data to protect against — reading straight from disk is safe from a *rendering* standpoint.

**This resolution has one condition that is not optional:** `/api/local/candidate` (and its siblings) currently 404 on `GET` unless `assertLocalOnly()` passes — `NODE_ENV !== "production"` **and** `NEXT_PUBLIC_DISABLE_AUTH === "true"` — which is the exact boundary `docs/DECISION_LOG.md` #6 exists to enforce. A Server Component calling `fs.readFile` directly does not pass through that route, so it does not pass through that guard. Adopting Option 2a as written would mean candidate/added/published JSON gets read and rendered in production, not only in local dev — the opposite of what Decision #6 settled. Two changes are therefore mandatory alongside the fs-read migration, not optional follow-ups:

1. Extract the *condition itself* — not the existing `assertLocalOnly()` function — into a shared boolean predicate, e.g. `frontend/lib/local-only.ts` exporting `isLocalOnlyAllowed(): boolean`. `assertLocalOnly()` stays exactly as it is today (a thin `Response | null` wrapper around that predicate) so the existing `/api/local/*` Route Handlers are untouched. This distinction matters: `assertLocalOnly()`'s `Response | null` return only does anything because Route Handlers explicitly check it and `return` the `Response`. A Server Component can't do that — there is no `Response` to return from a `page.tsx`. Reusing `assertLocalOnly()` there and discarding its return value (as an earlier draft of this section did) compiles fine and blocks nothing.
2. The new server-side read functions (`getCandidates()`, `getAddedProducts()`, `getPublishedProducts()`) call `isLocalOnlyAllowed()` directly and call `notFound()` (from `next/navigation`) when it's `false` — `notFound()` throws and actually terminates rendering of the route segment, which is the Server Component equivalent of the Route Handler's `return blocked`. This is spelled out in §4 step 1 below and is part of Phase 2's exit criterion, not a later hardening pass.

Both gates are now resolved; the phase descriptions below are written against these resolutions directly rather than carrying a parallel "if Option 2a" branch.

---

## 2. Nothing to change: auth and build config

Unchanged from the original assessment — re-verify at Phase 1 kickoff rather than re-deriving from scratch:

- **`frontend/proxy.ts`** already matches every route except a static-asset denylist; new leaf and detail routes need no matcher changes.
- **`frontend/next.config.ts`** sets only `output: "standalone"` — no route-specific config required.

---

## 3. Phase 1 — Route Skeleton & Server-Component Shell

**Goal:** `/editor/candidates`, `/editor/added`, `/editor/published` (and `/records` equivalents) render inside a shared sidebar shell that is a **Server Component by default** per the research report's layout-persistence findings — only drop to `"use client"` where a hook genuinely requires it. No real data yet.

1. `frontend/app/editor/(routed)/layout.tsx` — same route-group rationale as the original draft (isolates the new shell from the still-live `frontend/app/editor/page.tsx` monolith; a `layout.tsx` placed directly in `app/editor/` would incorrectly wrap the legacy page too). Keep this as a plain Server Component:
   ```tsx
   // frontend/app/editor/(routed)/layout.tsx
   import { EditorNavSidebar } from "@/components/EditorNavSidebar";

   export default function EditorRoutedLayout({
     children,
   }: LayoutProps<'/editor/(routed)'>) {
     return (
       <div className="flex min-w-[1200px]">
         <EditorNavSidebar base="/editor" />
         <main className="flex-1 p-6">{children}</main>
       </div>
     );
   }
   ```
2. `frontend/components/EditorNavSidebar.tsx` — new, separate from `EditorSidebar.tsx` (do not touch the legacy component; it still drives the monolith). Tab links use `<Link href={...} scroll={false}>` — **`scroll={false}` is not optional**, per the research report's finding that Next.js resets scroll to the top of the viewport on every transition by default, which would defeat the persistent-sidebar goal on the very first click.
3. Placeholder leaf pages at `frontend/app/editor/(routed)/candidates/page.tsx`, `.../added/page.tsx`, `.../published/page.tsx` (and `/records` equivalents).
4. Verify: `/editor` still renders the untouched legacy monolith; the four (six, counting `/records`) new URLs render the shell with a working, non-scroll-jumping tab bar.

**Exit criterion:** six new URLs resolve, share one sidebar shell instance per section, zero legacy behavior changed, and clicking between tabs does not move the scroll position.

---

## 4. Phase 2 — Route Isolation & Server-Side Data Fetch

**Goal:** each leaf owns its own data fetch for exactly the document it displays — no more three-arrays-on-every-mount — **and** the read happens server-side, direct from disk, per Gate 2 / Option 2a, so the leaf renders with data already present rather than flashing empty and then populating.

1. Before any leaf page is written, extract the local-only *condition* into a shared predicate, and add a new server-only reader module that uses it. Two files, not one — the predicate is shared, the enforcement mechanism deliberately is not, because Route Handlers and Server Components have no common way to "return" a block:
   ```tsx
   // frontend/lib/local-only.ts — single source of truth for the DECISION_LOG #6 boundary
   export function isLocalOnlyAllowed(): boolean {
     return process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_DISABLE_AUTH === "true";
   }
   ```
   ```tsx
   // frontend/lib/local-write.ts — existing file, `assertLocalOnly()` now delegates to the shared predicate
   // instead of re-stating the condition inline. Behavior and Response-based call sites (the existing
   // /api/local/* route handlers) are UNCHANGED — this is a refactor of where the condition lives, not
   // of how Route Handlers consume it.
   import { isLocalOnlyAllowed } from "./local-only";

   export function assertLocalOnly(): Response | null {
     if (!isLocalOnlyAllowed()) return new Response(null, { status: 404 });
     return null;
   }
   ```
   ```tsx
   // frontend/lib/local-data.ts — server-only, imported ONLY by the new Server Components (Phase 2 leaves,
   // Phase 3 [slug] detail pages). Route Handlers keep using assertLocalOnly() above, unchanged — they are
   // NOT refactored to call these functions, because notFound()'s "throw to halt this route segment's
   // render" contract is a Server Component / Route Handler rendering mechanism, not the same guaranteed
   // Response contract the existing routes already have working and tested.
   import "server-only";
   import { promises as fs } from "node:fs";
   import path from "node:path";
   import { notFound } from "next/navigation";
   import { isLocalOnlyAllowed } from "./local-only";

   async function readLocalJson(dir: string, filename: string) {
     if (!isLocalOnlyAllowed()) notFound(); // throws — actually halts rendering, unlike a discarded Response
     const filePath = path.join(dir, filename);
     const raw = await fs.readFile(filePath, "utf8");
     return JSON.parse(raw);
   }

   export function getCandidates() {
     return readLocalJson(process.env.CANDIDATES_DIR!, "candidate.json");
   }
   export function getAddedProducts() {
     return readLocalJson(process.env.PRODUCTS_DIR!, "added.json");
   }
   export function getPublishedProducts() {
     return readLocalJson(process.env.PRODUCTS_DIR!, "published.json");
   }
   ```
   The existing `/api/local/*` routes are left as-is beyond the one-line `local-only.ts` delegation above — no behavior change, no new call sites. The new leaf and detail pages import from `local-data.ts` instead.
2. Fill out `EditorNavSidebar` (or extract a sibling `RecordListPanel` if the JSX volume warrants it) to accept a single `products` prop, not three. Port filter/sort logic from `EditorSidebar` largely verbatim — the only structural change is dropping the `sourceList` switch, since each route now has exactly one list.
3. Each leaf becomes an `async` Server Component that calls the shared reader and passes the result to a client sidebar/list component as a prop:
   ```tsx
   // frontend/app/editor/(routed)/candidates/page.tsx
   import { getCandidates } from "@/lib/local-data";
   import { CandidatesListPanel } from "./CandidatesListPanel"; // "use client"

   export default async function EditorCandidatesPage() {
     const { products } = await getCandidates();
     return <CandidatesListPanel products={products ?? []} />;
   }
   ```
   The field editors, save handlers, and tracking-metadata fieldset stay in the client component (`CandidatesListPanel`), ported unchanged from the `activeTab === "candidate"` branch of `editor/page.tsx`. Only the *read* moved; the edit/save interactivity is necessarily still client-side.
4. Candidate-only / added-only / published-only controls become the unconditional content of their one leaf, as in the original plan — this part of the draft is unaffected by the research and is preserved as-is.
5. Repeat for all six leaves under `/editor/(routed)/` and `/records/(routed)/`. `/records` leaves additionally port the `RESEARCHER_NAMES` dropdowns and the Messages log, unchanged.

**Exit criterion:** each leaf reads exactly one document server-side, gated by `isLocalOnlyAllowed()` via `local-data.ts`'s `notFound()` call (verify via Network tab: legacy `/editor` shows 3 concurrent client fetches; new `/editor/candidates` shows 0 client-side fetches for the initial list — data arrives with the HTML), renders its own filtered/sorted list, **and** a build/run with `NODE_ENV=production` and `NEXT_PUBLIC_DISABLE_AUTH` unset confirms the leaf pages render Next's not-found UI instead of candidate/added/published data (guard actually fires — this is the case the earlier draft's discarded `assertLocalOnly()` call would have silently passed) — this check did not exist before Gate 2 was resolved and must not be skipped.

---

## 5. Phase 3 — Record Selection as a Route (`[slug]`)

**Goal (new phase, Gate 1):** selecting a record becomes a real navigation to `/editor/candidates/[slug]`, not an in-memory `useState`. This is the direct application of the research report's "Option A" URL-design finding.

1. Add `frontend/app/editor/(routed)/candidates/[slug]/page.tsx` (and equivalents for `added`, `published`, and both `/records` leaves):
   ```tsx
   interface DetailPageProps {
     params: Promise<{ slug: string }>;
   }

   export default async function CandidateDetailPage({ params }: DetailPageProps) {
     const { slug } = await params;
     const { products } = await getCandidates(); // same guarded reader from frontend/lib/local-data.ts
     const record = products.find((p: { slug: string }) => p.slug === slug);
     if (!record) return <div role="alert">Record not found.</div>;
     return <CandidateEditor record={record} />; // "use client" — field editors, save handler
   }
   ```
2. The parent leaf's own `page.tsx` (from Phase 2) becomes the "nothing selected" empty state, and the list panel's row links point at `${base}/${slug}` with `scroll={false}` — same rationale as Phase 1's tab links: without it, selecting a record from a long filtered list would jump the viewport back to the top of the record list on every click.
3. Because `[slug]` sits below the shared `layout.tsx` in the file tree, navigating between two records reuses the layout instance untouched (per the research report's `layout.tsx` vs. `template.tsx` distinction) — the sidebar's scroll position and filter text survive the navigation with no extra code required, provided the filter/search input state lives in the sidebar component itself (client state, not URL state — per the research report's "internal tool = local state over URL state for filters" guidance) and the sidebar's own scrollable container has an independent `overflow-y-auto`.

**Exit criterion:** `/editor/candidates/{slug}` deep-links directly to a record's editor; navigating between two records in the filtered list preserves scroll position and filter text without a full remount (verify no `useEffect` re-fires on the sidebar between selections).

---

## 6. Phase 4 — Unsaved-Changes Route Guard (new)

**Goal (new phase — this was not in the original draft):** navigating away from a leaf detail page (Phase 3) with unsaved field edits does not silently discard them. This did not matter as much in the single-monolith design because there was nowhere to navigate *to*; it matters now because every record and every tab is a real link.

The research report is explicit that the App Router removed `Router.events`, so there is no first-party navigation-cancel hook. A hybrid, dependency-light approach covers the three distinct navigation escapes it identifies:

| Navigation type | Trigger | Mitigation |
|---|---|---|
| Hard navigation | Tab close, refresh, address-bar entry | `window.beforeunload` |
| Soft navigation | `<Link>` click, `router.push`/`replace()` | Capture-phase `document` click listener + temporary `router.push`/`replace` patching |
| History traversal | Back/Forward buttons | Deliberately **not** fought — the research report flags aggressive `popstate` cancellation as an anti-pattern that corrupts the bfcache and breaks state restoration; accept this gap rather than introduce that regression |

1. Add `frontend/lib/useUnsavedChangesGuard.ts`, a client hook taking a single `isDirty: boolean`, implementing the `beforeunload` listener and the capture-phase click interception exactly as validated in the research report (native `window.confirm`, not a custom modal, to avoid a false sense of security about styling something the browser controls anyway for the `beforeunload` case).
2. Wire `isDirty` in each detail-page client editor (`CandidateEditor`, etc.) from existing field-dirty tracking, or add a minimal `isDirty` flag if none exists yet — check `editor/page.tsx`'s current save-handler logic before adding new state; it may already track this.
3. Explicitly out of scope for this phase: React 19 `useActionState`/`useOptimistic` integration described in the research report. The current save handlers are not yet Server Actions; wiring the guard to suspend during a pending action is deferred until (if) the save path itself migrates to `useActionState` — noting this here so it isn't silently dropped, per the "flag judgment calls" instruction, rather than picked up implicitly later.

**Exit criterion:** with an unsaved edit present, clicking a sidebar record link, a tab link, or attempting to close/refresh the tab all trigger a confirmation; confirming proceeds, canceling stays on the page with the edit intact; a completed save clears the guard with no leftover prompt on the next navigation.

---

## 7. Phase 5 — URL State for the Stored/Live Toggle (`?source=live`)

**Goal:** unchanged from the original draft's Phase 3 — the toggle becomes a real query parameter — with one correction from the research report.

Context is unchanged: `dataSource` moves from `useState<"stored" | "live">` to `useSearchParams`, gated by the existing `hasLiveScrapeData` check, switching between `/api/local/published` and `/api/local/published-live`.

**Correction from the original draft:** the draft explicitly skipped a `<Suspense>` boundary around the toggle, reasoning the leaf pages were already fully client-rendered with nothing static to bail out of. The research report contradicts this directly: Next.js's "Missing Suspense boundary with useSearchParams" is a hard build-time error tied to the `useSearchParams()` call site itself, not to whether the surrounding page happens to be static. Wrap the toggle regardless:

```tsx
// frontend/app/editor/(routed)/published/page.tsx
import { Suspense } from "react";
import { SourceToggle } from "./SourceToggle"; // "use client", calls useSearchParams internally

export default function PublishedPage() {
  return (
    <>
      {/* ...list panel, server-fetched per Phase 2... */}
      <Suspense fallback={<div className="h-10 w-32 animate-pulse rounded bg-gray-200" />}>
        <SourceToggle />
      </Suspense>
    </>
  );
}
```

All other reasoning from the original draft still holds and is unaffected by the research: `router.replace` (not `push`) for the toggle, since a display toggle shouldn't add history entries; omit `?source=stored` for the default rather than writing it explicitly; `scroll={false}` on the `router.replace` call, consistent with Phase 1/3's rule.

**Exit criterion:** `/records/published?source=live` deep-links into the live view when `hasLiveScrapeData` is true; toggling doesn't add history entries; refresh preserves the toggle; a production build (`next build`) completes without the CSR-bailout warning.

---

## 8. Phase 6 — Cutover

**Goal:** unchanged from the original draft. New routes become the only routes; monolithic state logic is deleted.

1. `frontend/app/page.tsx` redirects to `/editor/published` instead of `/editor`.
2. Delete `frontend/app/editor/page.tsx` and `frontend/app/records/page.tsx`; collapse `(routed)/*` up one level now that the route group's only job (isolating the new layout from the old page) is no longer needed.
3. Add thin `frontend/app/editor/page.tsx` / `frontend/app/records/page.tsx` redirects to the default child leaf, so bare `/editor` and `/records` bookmarks keep working.
4. Delete `frontend/components/EditorSidebar.tsx` once nothing imports it (repo-wide grep first — both legacy pages were its only consumers) and remove the now-unused `SourceTab` type if fully superseded.
5. Re-grep for hardcoded `/editor` / `/records` string literals introduced during Phases 1–5 and repoint them at specific sub-routes.
6. Add the DECISION_LOG entry only once this ships and is verified in production — the log records settled decisions, not plans.

**Exit criterion:** `editor/page.tsx` and `records/page.tsx` are thin redirects only, `EditorSidebar.tsx` is deleted, `/`, `/editor`, `/records` all resolve to a sensible default leaf, and the unsaved-changes guard from Phase 4 is exercised on the production build.

---

## 9. Testing (per Decision Log #8 — multi-layer, checked at the layer that exercises the change)

- **Phase 1:** manual check + smoke E2E asserting the six new URLs return 200, render the tab bar, and scroll position does not reset on tab switch.
- **Phase 2:** Network-request-count assertion (0 client-side fetches for the initial list load, not 3) plus the existing tracking-metadata round-trip E2E, repointed at each new leaf.
- **Phase 3:** E2E for `/editor/candidates/{slug}` deep-linking directly to a record; scroll/filter-preservation check across two in-tab record selections; 404/empty-state check for an unknown slug.
- **Phase 4:** E2E (or manual, if `beforeunload` proves hard to automate reliably) for: dirty-state Link-click prompts and cancels correctly; dirty-state tab-bar click prompts; a completed save clears the guard; Back-button behavior is explicitly *not* asserted to be blocked (documented as accepted per §6's anti-pattern note, not an oversight).
- **Phase 5:** E2E for the deep-link case, the no-history-entry case, and a `next build` run in CI asserting no CSR-bailout warning is emitted.
- **Phase 6:** E2E for both redirect chains (`/` → `/editor/published`, `/editor` → `/editor/published`) plus a full regression pass of whatever suite currently targets `/editor` and `/records`, repointed at the new URLs.
- **Phase 2 addition:** an automated check (CI env-var override, not just manual) that `getCandidates()`/`getAddedProducts()`/`getPublishedProducts()` call `notFound()` (assert the thrown `NEXT_HTTP_ERROR_FALLBACK;404`, not just "doesn't return data") under simulated production conditions (`NODE_ENV=production`, `NEXT_PUBLIC_DISABLE_AUTH` unset) — this is the regression test for the DECISION_LOG #6 boundary now that the read path no longer goes through the API route. A test that only asserts "no data leaks to the client" without also asserting the specific throw would not have caught the earlier draft's discarded-`assertLocalOnly()`-call bug, since that draft's `readLocalJson()` would have happily returned the real parsed JSON under simulated production conditions — assert the throw itself, not just an absence of data downstream.

