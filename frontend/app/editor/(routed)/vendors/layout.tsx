// frontend/app/editor/(routed)/vendors/layout.tsx
//
// Mirrors frontend/app/editor/(routed)/candidates/layout.tsx -- see that
// file for the full rationale (leaf-level persistence, why `dynamic =
// "force-dynamic"` is required). vendors.json instead of candidate.json.
//
// getVendors() (lib/local-data.ts) returns DirectoryRecord[] directly --
// no boundary cast needed here, unlike candidates/added/published's
// layouts (still backed by PublishedProductRecord[]).

import type { ReactNode } from "react";
import { getVendors } from "@/lib/server/documents-read";
import { IntegratedListPanel } from "@/components/IntegratedListPanel";

export const dynamic = "force-dynamic";

export default async function VendorsLayout({ children }: { children: ReactNode }) {
  const { vendors } = await getVendors();
  return (
    <IntegratedListPanel items={vendors} baseRoute="/editor/vendors" activeMode="editor" activeCategory="vendors">
      {children}
    </IntegratedListPanel>
  );
}
