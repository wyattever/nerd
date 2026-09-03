// frontend/app/editor/(routed)/candidates/page.tsx
//
// Auto-redirects to the first candidate record's editor, mirroring the
// legacy monolith's mount-time `setSelectedSlug(candidateDoc.products[0].
// slug)` -- "first" means array order as read from disk, the same order
// the monolith used, not the A-Z-sorted order CandidatesListPanel renders
// (that's a display-only derived view; products[0] here is unsorted).
// EXPLICIT DEVIATION from the routing guide's Phase 3 (this leaf as an
// empty state) -- authorized for this patch.
//
// `dynamic = "force-dynamic"` is required for the same reason as the
// sibling [slug]/page.tsx and layout.tsx -- see those files' headers.

import { redirect } from "next/navigation";
import { getCandidates } from "@/lib/server/documents-read";

export const dynamic = "force-dynamic";

export default async function EditorCandidatesPage() {
  const { products } = await getCandidates();

  if (products.length > 0) {
    redirect(`/editor/candidates/${products[0].slug}`);
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6 text-gray-400">
      <p className="text-sm">No records found.</p>
    </div>
  );
}
