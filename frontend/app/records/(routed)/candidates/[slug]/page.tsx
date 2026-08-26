// frontend/app/records/(routed)/candidates/[slug]/page.tsx
//
// Mirrors frontend/app/editor/(routed)/candidates/[slug]/page.tsx -- see
// that file's header for the full rationale (independent getCandidates()
// read, inline "Record not found" vs notFound(), why `dynamic =
// "force-dynamic"` is required).

import { getCandidates } from "@/lib/local-data";
import { RecordsCandidateDetail } from "../RecordsCandidateDetail";

export const dynamic = "force-dynamic";

interface RecordsCandidateDetailPageProps {
  params: Promise<{ slug: string }>;
}

export default async function RecordsCandidateDetailPage({ params }: RecordsCandidateDetailPageProps) {
  const { slug } = await params;
  const { products } = await getCandidates();
  const record = products.find((p) => p.slug === slug);

  if (!record) {
    return (
      <div role="alert" className="p-6 text-sm font-semibold text-red-700">
        Record not found.
      </div>
    );
  }

  return <RecordsCandidateDetail record={record} />;
}
