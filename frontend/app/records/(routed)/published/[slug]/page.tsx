// frontend/app/records/(routed)/published/[slug]/page.tsx
//
// See frontend/app/records/(routed)/candidates/[slug]/page.tsx for the
// full rationale. Now source-aware: looks up `slug` against
// published-live.json when the URL carries ?source=live (forwarded here by
// RecordsPublishedListPanel.tsx's row links and the leaf page.tsx's
// redirect -- see both files' headers), STORED published.json otherwise.
// Closes the gap RecordsPublishedListPanel.tsx's header used to document:
// a live-only record no longer 404s as "Record not found" just because
// this Server Component couldn't see the client-only toggle state.

import { getPublishedLiveProducts, getPublishedProducts } from "@/lib/local-data";
import { RecordsPublishedDetail } from "../RecordsPublishedDetail";

export const dynamic = "force-dynamic";

interface RecordsPublishedDetailPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ source?: string }>;
}

export default async function RecordsPublishedDetailPage({ params, searchParams }: RecordsPublishedDetailPageProps) {
  const { slug } = await params;
  const { source } = await searchParams;
  const { products } = source === "live" ? await getPublishedLiveProducts() : await getPublishedProducts();
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
