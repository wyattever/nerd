// frontend/app/records/(routed)/published/[slug]/page.tsx
//
// See frontend/app/records/(routed)/candidates/[slug]/page.tsx for the
// full rationale. Source-aware: looks up `slug` against
// published-live.json when the URL carries ?source=live, STORED
// published.json otherwise. `hasLiveScrapeData` (for SourceToggle's "Live
// Data" button enabled state) comes from the same getPublishedLiveProducts()
// call, fetched unconditionally so the toggle's enabled state is correct
// even while viewing stored data.
//
// SourceToggle itself now renders inside RecordsPublishedDetail.tsx
// (Phase 4.6), positioned between the Tracking block and the visual
// preview -- this page only fetches `hasLiveScrapeData` and passes it
// down as a prop.

import { getPublishedLiveProducts, getPublishedProducts } from "@/lib/server/documents-read";
import { RecordsPublishedDetail } from "../RecordsPublishedDetail";

export const dynamic = "force-dynamic";

interface RecordsPublishedDetailPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ source?: string }>;
}

export default async function RecordsPublishedDetailPage({ params, searchParams }: RecordsPublishedDetailPageProps) {
  const { slug } = await params;
  const { source } = await searchParams;
  const isLive = source === "live";

  const { products: liveProducts, lastScraped } = await getPublishedLiveProducts();
  const hasLiveScrapeData = liveProducts.length > 0;

  const products = isLive ? liveProducts : (await getPublishedProducts()).products;
  const record = products.find((p) => p.slug === slug);

  if (!record) {
    return (
      <div role="alert" className="p-6 text-sm font-semibold text-red-700">
        Record not found.
      </div>
    );
  }

  return <RecordsPublishedDetail record={record} hasLiveScrapeData={hasLiveScrapeData} lastScraped={lastScraped} />;
}
