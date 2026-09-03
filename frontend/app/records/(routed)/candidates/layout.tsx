// frontend/app/records/(routed)/candidates/layout.tsx
//
// Mirrors frontend/app/editor/(routed)/candidates/layout.tsx -- see that
// file for the full rationale (leaf-level persistence, why `dynamic =
// "force-dynamic"` is required). candidate.json instead of the editor's
// write-capable flow; this whole section is read-only.
//
// Uses the shared IntegratedListPanel (see
// docs/integrated_list_panel_rollout_guide.md Phase 2) instead of the
// deleted RecordsCandidatesListPanel.tsx. getCandidates() returns
// PublishedProductRecord[], not DirectoryRecord[] -- IntegratedListPanel
// is strictly typed against the latter, so this boundary needs the same
// `as unknown as DirectoryRecord[]` cast the /editor routes already use
// elsewhere, until candidate.json itself is migrated onto the unified
// schema.

import type { ReactNode } from "react";
import { getCandidates } from "@/lib/server/documents-read";
import { IntegratedListPanel } from "@/components/IntegratedListPanel";
import type { DirectoryRecord } from "@/lib/directory-schema";

export const dynamic = "force-dynamic";

export default async function RecordsCandidatesLayout({ children }: { children: ReactNode }) {
  const { products } = await getCandidates();
  return (
    <IntegratedListPanel
      items={products as unknown as DirectoryRecord[]}
      baseRoute="/records/candidates"
      activeMode="records"
      activeCategory="candidates"
    >
      {children}
    </IntegratedListPanel>
  );
}
