// frontend/app/records/(routed)/added/[slug]/page.tsx
//
// See frontend/app/records/(routed)/candidates/[slug]/page.tsx for the
// full rationale -- identical structure, added.json instead of
// candidate.json.

import { getAddedProducts } from "@/lib/local-data";
import { RecordsAddedDetail } from "../RecordsAddedDetail";

export const dynamic = "force-dynamic";

interface RecordsAddedDetailPageProps {
  params: Promise<{ slug: string }>;
}

export default async function RecordsAddedDetailPage({ params }: RecordsAddedDetailPageProps) {
  const { slug } = await params;
  const { products } = await getAddedProducts();
  const record = products.find((p) => p.slug === slug);

  if (!record) {
    return (
      <div role="alert" className="p-6 text-sm font-semibold text-red-700">
        Record not found.
      </div>
    );
  }

  return <RecordsAddedDetail record={record} />;
}
