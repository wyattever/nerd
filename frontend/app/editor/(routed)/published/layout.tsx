// frontend/app/editor/(routed)/published/layout.tsx
//
// See frontend/app/editor/(routed)/candidates/layout.tsx for the full
// rationale -- identical structure, published.json instead of
// candidate.json.

import type { ReactNode } from "react";
import { getPublishedProducts } from "@/lib/local-data";
import { PublishedListPanel } from "./PublishedListPanel";

export const dynamic = "force-dynamic";

export default async function PublishedLayout({ children }: { children: ReactNode }) {
  const { products } = await getPublishedProducts();
  return (
    <PublishedListPanel products={products} base="/editor/published">
      {children}
    </PublishedListPanel>
  );
}
