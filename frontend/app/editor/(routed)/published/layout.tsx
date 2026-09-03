// frontend/app/editor/(routed)/published/layout.tsx
//
// See frontend/app/editor/(routed)/candidates/layout.tsx for the full
// rationale -- identical structure, published.json instead of
// candidate.json.

import type { ReactNode } from "react";
import { getPublishedProducts } from "@/lib/server/documents-read";
import { IntegratedListPanel } from "@/components/IntegratedListPanel";
import type { DirectoryRecord } from "@/lib/directory-schema";

export const dynamic = "force-dynamic";

export default async function PublishedLayout({ children }: { children: ReactNode }) {
  const { products } = await getPublishedProducts();
  return (
    <IntegratedListPanel
      items={products as unknown as DirectoryRecord[]}
      baseRoute="/editor/published"
      activeMode="editor"
      activeCategory="published"
    >
      {children}
    </IntegratedListPanel>
  );
}
