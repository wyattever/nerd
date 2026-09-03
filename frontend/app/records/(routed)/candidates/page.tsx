// frontend/app/records/(routed)/candidates/page.tsx
//
// Auto-redirects to the first candidate record's detail view, mirroring
// the legacy monolith's mount-time auto-select -- see
// frontend/app/editor/(routed)/candidates/page.tsx for the full rationale
// ("first" means array order as read from disk, not the A-Z-sorted order
// RecordsCandidatesListPanel renders). Previously a static "nothing
// selected" empty state -- that was only because candidates/[slug]/page.tsx
// didn't exist yet when this leaf was first split out; it does now, so
// this can redirect into it like the /editor leaves already do.

import { redirect } from "next/navigation";
import { getCandidates } from "@/lib/server/documents-read";

export const dynamic = "force-dynamic";

export default async function RecordsCandidatesPage() {
  const { products } = await getCandidates();

  if (products.length > 0) {
    redirect(`/records/candidates/${products[0].slug}`);
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6 text-gray-400">
      <p className="text-sm">No records found.</p>
    </div>
  );
}
