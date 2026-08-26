# Directory Schema Unification — Implementation Guide

## Context
The N.E.R.D. application has migrated to a unified data schema where both Products and Vendors are treated as `DirectoryRecord` entities, distinguished by a `kind` field. This guide outlines the gated phases to implement the TypeScript interfaces and React components required to support this unified schema, repairing the currently broken imports in the routing tree.

## Rules of Engagement for Claude CLI
1. **Strict Phasing**: Do not proceed to the next phase until the developer confirms the current phase's exit criterion has been met.
2. **Scope Lock**: Only modify the files explicitly listed in the current phase.
3. **No Full-File Output**: Do not print entire file contents in chat. Apply edits directly to the repository.

---

## Phase 1: Unified Type Definitions
**Objective**: Create the single source of truth for the new unified schema.
**Target Files**: 
- `frontend/lib/directory-schema.ts` (Create)

**Tasks**:
- Define a `DirectoryRecord` interface (or discriminated union) that encompasses all fields from the unified JSON structures (e.g., `kind`, `slug`, `product_name`, `vendor_name`, `vendor_directory_url`, `product_website_url`, `product_description`, `vendor_resources`, `other_resources`, `support_contacts`, `acr_reports`, `products`, `last_updated`, `ai_insights`, `tracking_status`).
- Define any necessary sub-types (`ResourceLink`, `SupportContact`, `AcrReport`, etc.).

**Exit Criterion**: `frontend/lib/directory-schema.ts` exists and exports the required types.

---

## Phase 2: Unified Core Components
**Objective**: Build shared UI components that can render and edit any `DirectoryRecord`.
**Target Files**:
- `frontend/components/DirectoryPreview.tsx` (Create)
- `frontend/components/DirectoryHeaderEditor.tsx` (Create)

**Tasks**:
- Build `DirectoryPreview` to render a record. It must conditionally handle branch-node specific fields (like the `products` array for vendors) vs leaf-node fields.
- Build `DirectoryHeaderEditor` to edit the top-level metadata of a record.
- Ensure both components are strictly typed against `DirectoryRecord`.

**Exit Criterion**: Both components exist, use the unified schema, and compile individually without type errors.

---

## Phase 3: Route Integration & Cleanup
**Objective**: Wire the unified components into the routed editors and remove legacy code.
**Target Files**:
- `frontend/app/editor/(routed)/**/*Editor.tsx` (Update)
- `frontend/components/Vendor*.tsx` (Delete legacy files)

**Tasks**:
- Update `VendorEditor.tsx` (and `CandidateEditor.tsx`, `PublishedEditor.tsx`, `AddedEditor.tsx` as needed) to import and use the new `DirectoryPreview` and `DirectoryHeaderEditor`.
- Fix all missing hook and type imports in these files.
- Delete legacy, schema-specific components (e.g., `VendorHeaderEditor.tsx`, `VendorPreview.tsx`) if they still exist.

**Exit Criterion**: The application compiles cleanly (`npx tsc --noEmit` returns 0 errors) and all routed editors utilize the unified architecture.
