// frontend/app/editor/(routed)/added/layout.tsx
//
// See frontend/app/editor/(routed)/candidates/layout.tsx for the full
// rationale (leaf-level persistence, why `dynamic = "force-dynamic"` is
// required, and why the `as unknown as DirectoryRecord[]` boundary cast is
// needed here) -- identical structure, added.json instead of
// candidate.json.

import type { ReactNode } from "react";
import { getAddedProducts } from "@/lib/local-data";
import { IntegratedListPanel } from "@/components/IntegratedListPanel";
import type { DirectoryRecord } from "@/lib/directory-schema";

export const dynamic = "force-dynamic";

export default async function AddedLayout({ children }: { children: ReactNode }) {
  const { products } = await getAddedProducts();
  return (
    <IntegratedListPanel
      items={products as unknown as DirectoryRecord[]}
      baseRoute="/editor/added"
      activeMode="editor"
      activeCategory="added"
    >
      {children}
    </IntegratedListPanel>
  );
}
