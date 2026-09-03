// frontend/app/editor/(routed)/vendors/[slug]/page.tsx
import { getVendors } from "@/lib/server/documents-read";
import { VendorEditor } from "./VendorEditor";

interface DetailPageProps {
  params: Promise<{ slug: string }>;
}

export default async function VendorDetailPage({ params }: DetailPageProps) {
  const { slug } = await params;
  const decodedSlug = decodeURIComponent(slug);

  // getVendors() (lib/local-data.ts) returns DirectoryRecord[] directly --
  // no boundary cast needed here, unlike the pre-unification version of
  // this file.
  const { vendors } = await getVendors();
  const record = vendors.find((v) => v.slug === decodedSlug);

  if (!record) {
    return (
      <div className="flex min-h-full items-center justify-center p-6 text-gray-500">
        <p>Record &quot;{decodedSlug}&quot; not found.</p>
      </div>
    );
  }

  // Existing display names for the "Add Vendor" duplication check --
  // product_name is the unified schema's display name (see
  // VendorsListPanel.tsx's identical choice).
  const existingNames = vendors.map((v) => v.product_name);

  return <VendorEditor record={record} existingVendorNames={existingNames} />;
}
