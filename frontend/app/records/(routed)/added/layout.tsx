// frontend/app/records/(routed)/added/layout.tsx
//
// See frontend/app/records/(routed)/candidates/layout.tsx for the full
// rationale -- identical structure, added.json instead of candidate.json.

import type { ReactNode } from "react";
import { getAddedProducts } from "@/lib/local-data";
import { RecordsAddedListPanel } from "./RecordsAddedListPanel";

export const dynamic = "force-dynamic";

export default async function RecordsAddedLayout({ children }: { children: ReactNode }) {
  const { products } = await getAddedProducts();
  return (
    <RecordsAddedListPanel products={products} base="/records/added">
      {children}
    </RecordsAddedListPanel>
  );
}
