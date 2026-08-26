// frontend/app/records-test/layout.tsx
//
// Standalone shell for previewing IntegratedListPanel.tsx in isolation --
// see that component's header for what's being explored here. Fetches
// real vendor data via getVendors() (lib/local-data.ts) rather than
// getCandidates(): IntegratedListPanel is strictly typed against
// DirectoryRecord, and getVendors() is the one existing reader that
// already returns DirectoryRecord[] natively (getCandidates() returns
// PublishedProductRecord[], a different shape -- see
// lib/directory-schema.ts's header on how the two relate).
//
// `dynamic = "force-dynamic"` is required for the same reason as
// candidates/layout.tsx -- see that file's header.

import type { ReactNode } from "react";
import { getVendors } from "@/lib/local-data";
import { IntegratedListPanel } from "@/components/IntegratedListPanel";

export const dynamic = "force-dynamic";

export default async function RecordsTestLayout({ children }: { children: ReactNode }) {
  const { vendors } = await getVendors();
  return (
    <IntegratedListPanel items={vendors} baseRoute="/editor/vendors" activeMode="editor" activeCategory="vendors">
      {children}
    </IntegratedListPanel>
  );
}
