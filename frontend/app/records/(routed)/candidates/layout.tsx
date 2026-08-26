// frontend/app/records/(routed)/candidates/layout.tsx
//
// Mirrors frontend/app/editor/(routed)/candidates/layout.tsx -- see that
// file for the full rationale (leaf-level persistence, why `dynamic =
// "force-dynamic"` is required). candidate.json instead of the editor's
// write-capable flow; this whole section is read-only.

import type { ReactNode } from "react";
import { getCandidates } from "@/lib/local-data";
import { RecordsCandidatesListPanel } from "./RecordsCandidatesListPanel";

export const dynamic = "force-dynamic";

export default async function RecordsCandidatesLayout({ children }: { children: ReactNode }) {
  const { products } = await getCandidates();
  return (
    <RecordsCandidatesListPanel products={products} base="/records/candidates">
      {children}
    </RecordsCandidatesListPanel>
  );
}
