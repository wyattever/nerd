// frontend/app/records/(routed)/vendors/layout.tsx
//
// See frontend/app/records/(routed)/candidates/layout.tsx for the full
// rationale -- identical structure, vendors.json (via getVendors()) instead
// of candidate.json. getVendors() already returns DirectoryRecord[]
// natively (no boundary cast needed), matching
// frontend/app/editor/(routed)/vendors/layout.tsx's own read.

import type { ReactNode } from "react";
import { getVendors } from "@/lib/server/documents-read";
import { IntegratedListPanel } from "@/components/IntegratedListPanel";

export const dynamic = "force-dynamic";

export default async function RecordsVendorsLayout({ children }: { children: ReactNode }) {
  const { vendors } = await getVendors();
  return (
    <IntegratedListPanel items={vendors} baseRoute="/records/vendors" activeMode="records" activeCategory="vendors">
      {children}
    </IntegratedListPanel>
  );
}
