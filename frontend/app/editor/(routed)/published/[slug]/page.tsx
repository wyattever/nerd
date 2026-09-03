// frontend/app/editor/(routed)/published/[slug]/page.tsx
//
// See frontend/app/editor/(routed)/candidates/[slug]/page.tsx for the full
// rationale -- identical structure, published.json instead of
// candidate.json.

import { getPublishedProducts } from "@/lib/server/documents-read";
import { PublishedEditor } from "../PublishedEditor";

export const dynamic = "force-dynamic";

interface PublishedDetailPageProps {
  params: Promise<{ slug: string }>;
}

export default async function PublishedDetailPage({ params }: PublishedDetailPageProps) {
  const { slug } = await params;
  const { products, schemaVersion, meta, etag } = await getPublishedProducts();
  const record = products.find((p) => p.slug === slug);

  if (!record) {
    return (
      <div role="alert" className="p-6 text-sm font-semibold text-red-700">
        Record not found.
      </div>
    );
  }

  return (
    <PublishedEditor
      slug={slug}
      initialProducts={products}
      initialSchemaVersion={schemaVersion}
      initialMeta={meta}
      initialEtag={etag}
    />
  );
}
