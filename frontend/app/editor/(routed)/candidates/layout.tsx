// frontend/app/editor/(routed)/candidates/layout.tsx
//
// Leaf-level layout: persists the filter/sort/list nav across navigation
// between `page.tsx` (empty state) and `[slug]/page.tsx` (record editor) --
// both render as `{children}` here, so CandidatesListPanel's own DOM/state
// (scroll position, filter text) survives selecting a different record,
// per the layout.tsx-vs-template.tsx distinction the routing guide's Phase
// 1 already established for the section-level shell. This is the same
// pattern one level deeper: that top-level layout (frontend/app/editor/
// (routed)/layout.tsx) can't hold this list, because it wraps EVERY leaf
// and has no access to any one leaf's fetched products; this layout wraps
// only candidates/page.tsx and candidates/[slug]/page.tsx, so it can.
//
// `dynamic = "force-dynamic"` is required here for the same reason it was
// required on the Phase 2 leaf pages this replaces -- see that phase's
// page.tsx header comment (still present on the sibling files this list
// used to fetch from) for the full explanation: a plain fs.readFile is
// invisible to Next's "auto" caching heuristic, so without this the layout
// would be prerendered once, at build time, under NODE_ENV=production.

import type { ReactNode } from "react";
import { getCandidates } from "@/lib/local-data";
import { CandidatesListPanel } from "./CandidatesListPanel";

export const dynamic = "force-dynamic";

export default async function CandidatesLayout({ children }: { children: ReactNode }) {
  const { products } = await getCandidates();
  return (
    <CandidatesListPanel products={products} base="/editor/candidates">
      {children}
    </CandidatesListPanel>
  );
}
