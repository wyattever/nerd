// frontend/app/editor/(routed)/added/[slug]/page.tsx
//
// See frontend/app/editor/(routed)/candidates/[slug]/page.tsx for the full
// rationale -- identical structure, added.json instead of candidate.json.

import { getAddedProducts } from "@/lib/server/documents-read";
import { AddedEditor } from "../AddedEditor";

export const dynamic = "force-dynamic";

interface AddedDetailPageProps {
  params: Promise<{ slug: string }>;
}

export default async function AddedDetailPage({ params }: AddedDetailPageProps) {
  const { slug } = await params;
  const { products, schemaVersion, meta, etag } = await getAddedProducts();
  const record = products.find((p) => p.slug === slug);

  if (!record) {
    return (
      <div role="alert" className="p-6 text-sm font-semibold text-red-700">
        Record not found.
      </div>
    );
  }

  return (
    <AddedEditor
      slug={slug}
      initialProducts={products}
      initialSchemaVersion={schemaVersion}
      initialMeta={meta}
      initialEtag={etag}
    />
  );
}
