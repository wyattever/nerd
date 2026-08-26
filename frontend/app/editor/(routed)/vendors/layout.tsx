// frontend/app/editor/(routed)/vendors/layout.tsx
//
// Mirrors frontend/app/editor/(routed)/candidates/layout.tsx -- see that
// file for the full rationale (leaf-level persistence, why `dynamic =
// "force-dynamic"` is required). vendors.json instead of candidate.json.
//
// getVendors() (lib/local-data.ts) returns DirectoryRecord[] directly --
// no boundary cast needed here, unlike the pre-unification version of this
// file.

import type { ReactNode } from "react";
import { getVendors } from "@/lib/local-data";
import { VendorsListPanel } from "./VendorsListPanel";

export const dynamic = "force-dynamic";

export default async function VendorsLayout({ children }: { children: ReactNode }) {
  const { vendors } = await getVendors();
  return (
    <VendorsListPanel vendors={vendors} base="/editor/vendors">
      {children}
    </VendorsListPanel>
  );
}
