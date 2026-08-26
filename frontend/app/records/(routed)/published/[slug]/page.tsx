// frontend/app/records/(routed)/published/[slug]/page.tsx
//
// See frontend/app/records/(routed)/candidates/[slug]/page.tsx for the
// full rationale. Looks up `slug` against the STORED published.json only
// -- see RecordsPublishedListPanel.tsx's header for the known gap this
// leaves against the client-only "Live Data" toggle (a live-only record
// deep-linked/clicked will show "Record not found" here until Phase 5
// makes the data source a URL concern this Server Component can read).

import { getPublishedProducts } from "@/lib/local-data";
import { RecordsPublishedDetail } from "../RecordsPublishedDetail";

export const dynamic = "force-dynamic";

interface RecordsPublishedDetailPageProps {
  params: Promise<{ slug: string }>;
}

export default async function RecordsPublishedDetailPage({ params }: RecordsPublishedDetailPageProps) {
  const { slug } = await params;
  const { products } = await getPublishedProducts();
  const record = products.find((p) => p.slug === slug);

  if (!record) {
    return (
      <div role="alert" className="text-sm font-semibold text-red-700">
        Record not found.
      </div>
    );
  }

  return <RecordsPublishedDetail record={record} />;
}
