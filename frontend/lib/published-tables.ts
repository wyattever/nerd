// frontend/lib/published-tables.ts
/**
 * Published-site snapshot -- read-only reference data for the Viewer's
 * AppSheet/Published data-source toggle.
 *
 * Source: a static scrape snapshot of every product page on the live
 * NCADEMI directory (ncademi.org/provide/directory/products/), denormalized
 * one object per product with resources/support/ACR already embedded --
 * unlike appsheet-tables.json, no cross-table name-matching is needed here.
 *
 * This is a static snapshot, NOT a live fetch. Regenerate by re-running the
 * scraper (see published-tables.json's $meta.generated_from for status -- a
 * dedicated scraper script to automate regeneration is still TODO).
 */

import data from "./published-tables.json";
import { ProductHeaderData } from "@/lib/appsheet-tables";

export interface PublishedResourceLink {
  text: string;
  url: string;
}

export interface PublishedSupportContact {
  type: "email" | "url";
  value: string;
  label?: string | null;
}

export interface PublishedAcrReport {
  title: string;
  url: string | null;
  version: string | null;
  date: string | null;
  auditor_name: string | null;
  auditor_url: string | null;
}

export interface PublishedProductRecord {
  slug: string;
  product_name: string;
  ncademi_product_url: string;
  vendor_name: string | null;
  vendor_directory_url: string | null;
  product_website_url: string | null;
  product_description: string | null;
  vendor_resources: PublishedResourceLink[];
  other_resources: PublishedResourceLink[];
  support_contacts: PublishedSupportContact[];
  acr_reports: PublishedAcrReport[];
  last_updated: string | null;
  ai_insights: string | null;
}

interface PublishedTablesFile {
  $schema_version: number;
  $meta: {
    purpose: string;
    source_listing_url: string;
    snapshot_taken_at: string;
    total_products: number;
    generated_from: string;
  };
  products: PublishedProductRecord[];
}

const PUBLISHED_DATA = data as PublishedTablesFile;

// Built once at module load -- O(1) lookup by slug. Unlike AppSheet's
// per-call table scan (necessary there because rows are matched by status
// AND slug together), every record here already belongs to exactly one
// slug, so a plain Map is both simpler and sufficient at this data size.
const BY_SLUG: Map<string, PublishedProductRecord> = new Map(
  PUBLISHED_DATA.products.map((p) => [p.slug, p])
);

const VALID_SUPPORT_TYPES = new Set(["email", "url"]);

/**
 * Runtime guard for support_contacts.type. This JSON is scraped external
 * data, not compiler-checked -- a future re-scrape could in principle
 * introduce a type value genSupportHtml doesn't handle. Drops the offending
 * contact and logs a warning rather than throwing, so one bad record
 * doesn't take down the whole product's preview.
 */
function sanitizeSupportContacts(
  contacts: PublishedSupportContact[],
  slug: string
): PublishedSupportContact[] {
  return contacts.filter((c) => {
    if (!VALID_SUPPORT_TYPES.has(c.type)) {
      console.warn(
        `published-tables: unexpected support_contacts.type "${c.type}" for "${slug}" -- dropping this contact`
      );
      return false;
    }
    return true;
  });
}

/**
 * Snapshot metadata -- when it was taken, how many products it covers.
 * Not wired into any UI yet; exposed for a future "data as of ..." label.
 */
export function getPublishedSnapshotMeta() {
  return PUBLISHED_DATA.$meta;
}

/**
 * Full record for one product, or null if it has no live counterpart under
 * this slug. Null is expected for AppSheet products that were never
 * published, and for the two known renamed cases (Amplify CKLA -> Amplify
 * Core Knowledge Language Arts (CKLA); mCLASS DIBELS -> mCLASS) whose
 * AppSheet slugs don't match their live slugs -- see the discrepancy report.
 */
export function getPublishedProduct(slug: string): PublishedProductRecord | null {
  return BY_SLUG.get(slug) ?? null;
}

/**
 * Header fields only, in the same ProductHeaderData shape AppSheet's
 * getPublishedProductHeader/getAddedProductHeader/getCandidateProductHeader
 * already return. Keeping this shape identical is what lets page.tsx branch
 * on data source without changing what any call site consumes.
 */
export function getPublishedProductHeader(slug: string): ProductHeaderData | null {
  const record = getPublishedProduct(slug);
  if (!record) return null;
  return {
    product_name: record.product_name,
    vendor_name: record.vendor_name ?? "",
    vendor_directory_url: record.vendor_directory_url ?? "",
    product_description: record.product_description ?? "",
    product_website_url: record.product_website_url ?? "",
    last_updated: record.last_updated ?? "",
  };
}

export function getPublishedVendorResources(slug: string): PublishedResourceLink[] {
  return getPublishedProduct(slug)?.vendor_resources ?? [];
}

export function getPublishedOtherResources(slug: string): PublishedResourceLink[] {
  return getPublishedProduct(slug)?.other_resources ?? [];
}

export function getPublishedSupportContacts(slug: string): PublishedSupportContact[] {
  const record = getPublishedProduct(slug);
  if (!record) return [];
  return sanitizeSupportContacts(record.support_contacts, slug);
}

export function getPublishedAcrReports(slug: string): PublishedAcrReport[] {
  return getPublishedProduct(slug)?.acr_reports ?? [];
}

/**
 * All slugs in the snapshot. Not wired into the Viewer's dropdowns yet --
 * that's the toggle-wiring step, not this loader.
 */
export function getAllPublishedSlugs(): string[] {
  return PUBLISHED_DATA.products.map((p) => p.slug);
}

/**
 * Every product in the snapshot, in file order. Used by the raw JSON
 * viewer/editor at /tables/published, which needs the whole array rather than
 * slug-keyed access.
 */
export function getAllPublishedProducts(): PublishedProductRecord[] {
  return PUBLISHED_DATA.products;
}

/**
 * Schema version of the snapshot file. The editor writes it back verbatim on
 * export so a round-trip with no edits produces a byte-identical file.
 */
export function getPublishedSchemaVersion(): number {
  return PUBLISHED_DATA.$schema_version;
}
