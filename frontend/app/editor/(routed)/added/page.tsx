// frontend/app/editor/(routed)/added/page.tsx
//
// See frontend/app/editor/(routed)/candidates/page.tsx for the full
// rationale -- identical structure, added.json instead of candidate.json.

import { redirect } from "next/navigation";
import { getAddedProducts } from "@/lib/local-data";

export const dynamic = "force-dynamic";

export default async function EditorAddedPage() {
  const { products } = await getAddedProducts();

  if (products.length > 0) {
    redirect(`/editor/added/${products[0].slug}`);
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6 text-gray-400">
      <p className="text-sm">No records found.</p>
    </div>
  );
}
