// frontend/app/editor/(routed)/added/layout.tsx
//
// See frontend/app/editor/(routed)/candidates/layout.tsx for the full
// rationale (leaf-level persistence, why `dynamic = "force-dynamic"` is
// required) -- identical structure, added.json instead of candidate.json.

import type { ReactNode } from "react";
import { getAddedProducts } from "@/lib/local-data";
import { AddedListPanel } from "./AddedListPanel";

export const dynamic = "force-dynamic";

export default async function AddedLayout({ children }: { children: ReactNode }) {
  const { products } = await getAddedProducts();
  return (
    <AddedListPanel products={products} base="/editor/added">
      {children}
    </AddedListPanel>
  );
}
