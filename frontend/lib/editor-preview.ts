// frontend/lib/editor-preview.ts
/**
 * Adapts a PublishedProductRecord into the ListingData shape ListingCard
 * expects, so the /editor visual preview can reuse the same NCADEMI-theme
 * iframe renderer used elsewhere in the app rather than duplicating HTML
 * generation. The two shapes are structurally close (same field names for
 * everything ListingCard renders) but differ in nullability: published
 * snapshot fields are `string | null`, ListingData's are plain `string` (or
 * optional). Null becomes "" for direct text fields and undefined for
 * ListingData's optional fields -- there is no PublishedProductRecord
 * concept of "field present but empty" versus "field absent" to preserve
 * here, so the simpler mapping is correct, not lossy.
 */

import type { ACRReport, ListingData, ResourceLink, SupportContact } from "@/lib/types";
import type { PublishedProductRecord } from "@/lib/published-tables";

export function toListingData(record: PublishedProductRecord): ListingData {
  const vendorResources: ResourceLink[] = record.vendor_resources;
  const otherResources: ResourceLink[] = record.other_resources;

  const supportContacts: SupportContact[] = record.support_contacts.map((c) => ({
    type: c.type,
    value: c.value,
    label: c.label ?? undefined,
  }));

  const acrReports: ACRReport[] = record.acr_reports.map((a) => ({
    title: a.title,
    url: a.url ?? "",
    version: a.version ?? undefined,
    date: a.date ?? undefined,
    auditor_name: a.auditor_name ?? undefined,
    auditor_url: a.auditor_url ?? undefined,
  }));

  return {
    product_name: record.product_name,
    vendor_name: record.vendor_name ?? "",
    vendor_directory_url: record.vendor_directory_url ?? "",
    product_description: record.product_description ?? "",
    product_website_url: record.product_website_url ?? "",
    vendor_resources: vendorResources,
    other_resources: otherResources,
    support_contacts: supportContacts,
    acr_reports: acrReports,
    last_updated: record.last_updated ?? undefined,
  };
}
