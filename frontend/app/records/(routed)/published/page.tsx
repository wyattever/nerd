// frontend/app/records/(routed)/published/page.tsx
//
// See frontend/app/records/(routed)/candidates/page.tsx for the full
// rationale -- identical structure, published.json instead of
// candidate.json. No `p-6` on the empty state here (unlike the other five
// leaves): RecordsPublishedListPanel's own content wrapper already applies
// padding around `{children}` (it needs to, for the Site Data box above),
// so adding it here too would double it -- see the earlier UI-fidelity
// patch this mirrors.

import { redirect } from "next/navigation";
import { getPublishedProducts } from "@/lib/local-data";

export const dynamic = "force-dynamic";

export default async function RecordsPublishedPage() {
  const { products } = await getPublishedProducts();

  if (products.length > 0) {
    redirect(`/records/published/${products[0].slug}`);
  }

  return (
    <div className="flex min-h-full items-center justify-center text-gray-400">
      <p className="text-sm">No records found.</p>
    </div>
  );
}
