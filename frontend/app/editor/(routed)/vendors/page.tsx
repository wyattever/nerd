// frontend/app/editor/(routed)/vendors/page.tsx
//
// Auto-redirects to the first vendor's editor, mirroring the candidates/
// added/published leaves (see frontend/app/editor/(routed)/candidates/
// page.tsx for the full rationale). Routes are keyed by `slug`
// (DirectoryRecord, lib/directory-schema.ts), not `vendor_name` -- see
// directory-schema.ts's header on why vendor_name is no longer the right
// field for routing.
//
// `dynamic = "force-dynamic"` is required for the same reason as every
// other leaf in this migration -- see candidates/page.tsx's header.

import { redirect } from "next/navigation";
import { getVendors } from "@/lib/server/documents-read";

export const dynamic = "force-dynamic";

export default async function EditorVendorsPage() {
  // getVendors() (lib/local-data.ts) returns DirectoryRecord[] directly --
  // no boundary cast needed here.
  const { vendors } = await getVendors();

  if (vendors.length > 0) {
    redirect(`/editor/vendors/${encodeURIComponent(vendors[0].slug)}`);
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6 text-gray-400">
      <p className="text-sm">No records found.</p>
    </div>
  );
}
