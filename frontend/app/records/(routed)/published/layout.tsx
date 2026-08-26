// frontend/app/records/(routed)/published/layout.tsx
//
// See frontend/app/records/(routed)/candidates/layout.tsx for the full
// rationale -- identical structure, published.json instead of
// candidate.json. The Stored/Live toggle stays client-driven inside
// RecordsPublishedListPanel (see that file's header) -- this layout only
// ever fetches the STORED document.

import type { ReactNode } from "react";
import { getPublishedProducts } from "@/lib/local-data";
import { RecordsPublishedListPanel } from "./RecordsPublishedListPanel";

export const dynamic = "force-dynamic";

export default async function RecordsPublishedLayout({ children }: { children: ReactNode }) {
  const { products } = await getPublishedProducts();
  return (
    <RecordsPublishedListPanel initialProducts={products} base="/records/published">
      {children}
    </RecordsPublishedListPanel>
  );
}
