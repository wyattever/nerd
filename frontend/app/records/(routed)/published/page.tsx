// frontend/app/records/(routed)/published/page.tsx
//
// See frontend/app/records/(routed)/candidates/page.tsx for the full
// rationale -- identical structure, published.json instead of
// candidate.json. No `p-6` on the empty state here (unlike the other five
// leaves): RecordsPublishedListPanel's own content wrapper already applies
// padding around `{children}` (it needs to, for the Site Data box above),
// so adding it here too would double it -- see the earlier UI-fidelity
// patch this mirrors.
//
// Forwards `?source=live` into the redirect target -- without this, a
// deep link to /records/published?source=live would have its query string
// silently dropped the moment this leaf redirects to the first record,
// defeating the whole point of Phase 5's URL-based toggle for the one case
// (a fresh/shared link) it matters most for.

import { redirect } from "next/navigation";
import { getPublishedProducts } from "@/lib/local-data";

export const dynamic = "force-dynamic";

interface RecordsPublishedPageProps {
  searchParams: Promise<{ source?: string }>;
}

export default async function RecordsPublishedPage({ searchParams }: RecordsPublishedPageProps) {
  const { products } = await getPublishedProducts();
  const { source } = await searchParams;
  const query = source === "live" ? "?source=live" : "";

  if (products.length > 0) {
    redirect(`/records/published/${products[0].slug}${query}`);
  }

  return (
    <div className="flex min-h-full items-center justify-center text-gray-400">
      <p className="text-sm">No records found.</p>
    </div>
  );
}
