// frontend/app/records/(routed)/vendors/page.tsx
//
// Auto-redirects to the first vendor's detail view, mirroring
// frontend/app/records/(routed)/candidates/page.tsx exactly -- see that
// file for the full rationale.

import { redirect } from "next/navigation";
import { getVendors } from "@/lib/server/documents-read";

export const dynamic = "force-dynamic";

export default async function RecordsVendorsPage() {
  const { vendors } = await getVendors();

  if (vendors.length > 0) {
    redirect(`/records/vendors/${vendors[0].slug}`);
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6 text-gray-400">
      <p className="text-sm">No vendors found.</p>
    </div>
  );
}
