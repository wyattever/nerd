# Integrated List Panel — Rollout Guide

## Context
The N.E.R.D. application is migrating from a split-sidebar navigation model (vertical mode icons + separate list panel) to a unified, integrated list panel. The new design places both Mode selection (Editor vs. Database) and Category selection (Candidates, Added, Published, Vendor) horizontally at the top of the main list column. To minimize risk, this rollout is phased—starting with a shared component refactor, deploying to the read-only `/records` routes first, expanding to the stateful `/editor` routes, and finally cleaning up legacy code.

## Rules of Engagement for Claude CLI
1. **Strict Phasing**: Do not proceed to the next phase until the developer confirms the current phase's exit criterion has been met.
2. **Scope Lock**: Only modify the files explicitly listed in the current phase.
3. **No Full-File Output**: Do not print entire file contents in chat. Apply edits directly to the repository.

---

## Phase 1: Component Refactoring & Generalization
**Objective**: Transform the sandbox `RecordsTestListPanel` into a production-ready, shared navigation component.
**Target Files**: 
- `frontend/components/IntegratedListPanel.tsx` (Create/Rename from `RecordsTestListPanel.tsx`)
- `frontend/components/RecordsTestListPanel.tsx` (Delete)

**Tasks**:
- Rename `RecordsTestListPanel` to `IntegratedListPanel` and move it to standard production usage.
- Generalize the component to accept props for the active mode (`editor` vs `records`) and active category (`candidates`, `added`, `published`, `vendors`).
- Ensure the mode toggle buttons correctly route to the corresponding base paths while preserving the current category.
- Ensure strict typing against the unified `DirectoryRecord` schema.

**Exit Criterion**: `IntegratedListPanel.tsx` is created, fully generalized, strictly typed, and compiles cleanly (`npx tsc --noEmit`).

---

## Phase 2: Rollout to Records Pages (`/records`)
**Objective**: Deploy the new integrated layout to the low-risk, read-only database routes.
**Target Files**:
- `frontend/app/records/(routed)/candidates/layout.tsx` (Update)
- `frontend/app/records/(routed)/candidates/RecordsCandidatesListPanel.tsx` (Delete/Replace)
- `frontend/app/records/(routed)/added/layout.tsx` (Update)
- `frontend/app/records/(routed)/added/RecordsAddedListPanel.tsx` (Delete/Replace)
- `frontend/app/records/(routed)/published/layout.tsx` (Update)
- `frontend/app/records/(routed)/published/RecordsPublishedListPanel.tsx` (Delete/Replace)

**Tasks**:
- Replace the legacy list panels in the `/records` layouts with the new `IntegratedListPanel`.
- Ensure routing, search filtering, and A-Z sorting function correctly within the new component.
- Delete the legacy `Records*ListPanel.tsx` components.

**Exit Criterion**: All `/records` routes use the `IntegratedListPanel`. The application compiles cleanly, and navigation between categories in the Database mode works seamlessly.

---

## Phase 3: Rollout to Editor Pages (`/editor`)
**Objective**: Expand the integrated layout to the stateful editor routes.
**Target Files**:
- `frontend/app/editor/(routed)/candidates/layout.tsx` (Update)
- `frontend/app/editor/(routed)/candidates/CandidatesListPanel.tsx` (Delete/Replace)
- `frontend/app/editor/(routed)/added/layout.tsx` (Update)
- `frontend/app/editor/(routed)/added/AddedListPanel.tsx` (Delete/Replace)
- `frontend/app/editor/(routed)/published/layout.tsx` (Update)
- `frontend/app/editor/(routed)/published/PublishedListPanel.tsx` (Delete/Replace)
- `frontend/app/editor/(routed)/vendors/layout.tsx` (Update)
- `frontend/app/editor/(routed)/vendors/VendorsListPanel.tsx` (Delete/Replace)

**Tasks**:
- Replace the legacy list panels in the `/editor` layouts with the new `IntegratedListPanel`.
- Ensure the `useUnsavedChangesGuard` correctly intercepts navigation attempts from the new integrated header links if a record is dirty.
- Delete the legacy `*ListPanel.tsx` components from the editor directories.

**Exit Criterion**: All `/editor` routes use the `IntegratedListPanel`. The application compiles cleanly, and unsaved changes are protected during navigation.

---

## Phase 4: Cleanup & Deprecation
**Objective**: Remove the obsolete global navigation and sandbox routes.
**Target Files**:
- `frontend/components/EditorNavSidebar.tsx` (Delete)
- `frontend/app/layout.tsx` (or whichever layout imports `EditorNavSidebar`) (Update)
- `frontend/app/records-test/` (Delete directory)

**Tasks**:
- Remove the old vertical `EditorNavSidebar` from the global application shell/layout.
- Delete `EditorNavSidebar.tsx`.
- Delete the `records-test` sandbox directory entirely.

**Exit Criterion**: All legacy navigation files and sandbox routes are deleted. `npx tsc --noEmit` and `npm run lint` return 0 errors.