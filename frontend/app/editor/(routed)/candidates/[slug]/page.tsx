// frontend/app/editor/(routed)/candidates/[slug]/page.tsx
//
// Server Component: looks up the record for `slug` server-side via
// local-data.ts and renders CandidateEditor for it. A second, independent
// getCandidates() read from the one candidates/layout.tsx already did for
// the list -- both are cheap local fs reads, and this is the same pattern
// docs/UI_ROUTING_MIGRATION_IMPLEMENTATION_GUIDE_v2.md's own Phase 3
// example uses, rather than threading the layout's result down through
// React context just to avoid one extra disk read.
//
// A missing slug renders an inline "Record not found" message rather than
// calling next/navigation's notFound() -- this is a DATA lookup miss (the
// slug isn't in candidate.json), a different case from the DECISION_LOG #6
// auth gate inside getCandidates() itself, which already throws its own
// notFound() before this ever runs.
//
// `dynamic = "force-dynamic"` is required for the same reason as
// candidates/layout.tsx -- see that file's header.

import { getCandidates } from "@/lib/server/documents-read";
import { CandidateEditor } from "../CandidateEditor";

export const dynamic = "force-dynamic";

interface CandidateDetailPageProps {
  params: Promise<{ slug: string }>;
}

export default async function CandidateDetailPage({ params }: CandidateDetailPageProps) {
  const { slug } = await params;
  const { products, schemaVersion, meta, etag } = await getCandidates();
  const record = products.find((p) => p.slug === slug);

  if (!record) {
    return (
      <div role="alert" className="p-6 text-sm font-semibold text-red-700">
        Record not found.
      </div>
    );
  }

  return (
    <CandidateEditor
      slug={slug}
      initialProducts={products}
      initialSchemaVersion={schemaVersion}
      initialMeta={meta}
      initialEtag={etag}
    />
  );
}
