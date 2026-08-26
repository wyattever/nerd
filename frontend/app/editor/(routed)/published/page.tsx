// frontend/app/editor/(routed)/published/page.tsx
//
// See frontend/app/editor/(routed)/candidates/page.tsx for the full
// rationale -- identical structure, published.json instead of
// candidate.json.

import { redirect } from "next/navigation";
import { getPublishedProducts } from "@/lib/local-data";

export const dynamic = "force-dynamic";

export default async function EditorPublishedPage() {
  const { products } = await getPublishedProducts();

  if (products.length > 0) {
    redirect(`/editor/published/${products[0].slug}`);
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6 text-gray-400">
      <p className="text-sm">No records found.</p>
    </div>
  );
}
