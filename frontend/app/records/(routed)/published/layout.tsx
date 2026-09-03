// frontend/app/records/(routed)/published/layout.tsx
//
// See frontend/app/records/(routed)/candidates/layout.tsx for the full
// rationale -- identical structure, published.json instead of
// candidate.json. Unlike the deleted RecordsPublishedListPanel.tsx, the
// shared IntegratedListPanel has no client-side Stored/Live source toggle
// -- this layout now only ever fetches and displays the STORED document
// (see this phase's report for that scope note; SourceToggle.tsx is left
// in place but is no longer imported by anything).

import type { ReactNode } from "react";
import { getPublishedProducts } from "@/lib/server/documents-read";
import { IntegratedListPanel } from "@/components/IntegratedListPanel";
import type { DirectoryRecord } from "@/lib/directory-schema";

export const dynamic = "force-dynamic";

export default async function RecordsPublishedLayout({ children }: { children: ReactNode }) {
  const { products } = await getPublishedProducts();
  return (
    <IntegratedListPanel
      items={products as unknown as DirectoryRecord[]}
      baseRoute="/records/published"
      activeMode="records"
      activeCategory="published"
    >
      {children}
    </IntegratedListPanel>
  );
}
