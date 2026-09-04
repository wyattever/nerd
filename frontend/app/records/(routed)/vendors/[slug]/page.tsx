// frontend/app/records/(routed)/vendors/[slug]/page.tsx
//
// See frontend/app/records/(routed)/candidates/[slug]/page.tsx for the
// full rationale (independent getVendors() read, inline "Record not found"
// vs notFound(), why `dynamic = "force-dynamic"` is required).

import { getVendors, getLiveVendors } from "@/lib/server/documents-read";
import { RecordsVendorDetail } from "./RecordsVendorDetail";

export const dynamic = "force-dynamic";

interface RecordsVendorDetailPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ source?: string }>;
}

export default async function VendorRecordDetailPage({ params, searchParams }: RecordsVendorDetailPageProps) {
  const { slug } = await params;
  const { source } = await searchParams;
  const { vendors: storedVendors } = await getVendors();
  const { vendors: liveVendors, lastScraped } = await getLiveVendors();

  const isLive = source === "live";
  const storedVendor = storedVendors.find((v) => v.slug === slug);

  if (isLive) {
    const liveMatch = liveVendors.find(
      (v) =>
        v.slug === slug ||
        (storedVendor && v.vendor_name === storedVendor.vendor_name) ||
        (storedVendor && v.vendor_name === storedVendor.product_name)
    );

    if (!liveMatch) {
      return (
        <div role="alert" className="p-6 text-sm font-semibold text-red-700">
          Record not found in live data.
        </div>
      );
    }

    return <RecordsVendorDetail record={liveMatch} hasLiveScrapeData={liveVendors.length > 0} lastScraped={lastScraped} />;
  }

  if (!storedVendor) {
    return (
      <div role="alert" className="p-6 text-sm font-semibold text-red-700">
        Record not found.
      </div>
    );
  }

  return <RecordsVendorDetail record={storedVendor} hasLiveScrapeData={liveVendors.length > 0} lastScraped={lastScraped} />;
}
