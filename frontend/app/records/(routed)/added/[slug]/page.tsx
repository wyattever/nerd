// frontend/app/records/(routed)/added/[slug]/page.tsx
//
// See frontend/app/records/(routed)/published/[slug]/page.tsx for the
// full rationale -- identical structure, added.json instead of
// published.json for the STORED side. Source-aware: looks up `slug`
// against added-live.json when the URL carries ?source=live (its own
// live snapshot -- the `--target added` scrape unlocks each protected
// page with its vendor-review password and writes full detail there,
// separate from published-live.json's public-only set), STORED
// added.json otherwise.

import { getAddedProducts, getAddedLiveProducts } from "@/lib/server/documents-read";
import { RecordsAddedDetail } from "../RecordsAddedDetail";

export const dynamic = "force-dynamic";

interface RecordsAddedDetailPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ source?: string }>;
}

export default async function RecordsAddedDetailPage({ params, searchParams }: RecordsAddedDetailPageProps) {
  const { slug } = await params;
  const { source } = await searchParams;
  const isLive = source === "live";

  const { products: liveProducts } = await getAddedLiveProducts();
  const hasLiveScrapeData = liveProducts.length > 0;

  const products = isLive ? liveProducts : (await getAddedProducts()).products;
  const record = products.find((p) => p.slug === slug);

  if (!record) {
    return (
      <div role="alert" className="p-6 text-sm font-semibold text-red-700">
        Record not found.
      </div>
    );
  }

  return <RecordsAddedDetail record={record} hasLiveScrapeData={hasLiveScrapeData} />;
}
