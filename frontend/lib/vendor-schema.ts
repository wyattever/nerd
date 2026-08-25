// frontend/lib/vendor-schema.ts
/**
 * Schema for the global vendors registry (frontend/lib/vendors.json), read
 * and written by /api/local/vendors and the /vendors editor page.
 *
 * Ported from docs/superseded/vendor_schema_proposal.ts -- that file documents
 * the full provenance of every field below against the AppSheet "vendors"
 * and "vendor-resources" table columns; see it for the "why" behind each
 * one. The one addition here: `support_contacts` on VendorRecord, matching
 * PublishedSupportContact's shape (frontend/lib/published-tables.ts) rather
 * than inventing a parallel type, since a vendor's support contacts are the
 * same {type, value, label} shape a product's are. Optional/nullable
 * because no vendor in the current scrape (scrape_vendors.py) has this
 * populated yet -- it isn't scraped from the live vendor page.
 */

import type { PublishedSupportContact } from "@/lib/published-tables";

/** One row from the "vendor-resources" table, joined onto its vendor. */
export interface VendorResource {
  /** Row ID -- the one genuinely stable identifier AppSheet assigned this row. */
  id: string;
  /** Resource Name */
  text: string;
  /** URL */
  url: string;
  /**
   * Source -- "Internal" (the vendor's own resource) or "External"
   * (a third-party resource about the vendor). Only these two values were
   * observed in the sampled data.
   */
  source: "Internal" | "External";
  /** Label -- e.g. "Statement/Policy". Frequently blank in the source data. */
  label: string | null;
  /** Date -- free-text timestamp as AppSheet exported it (e.g. "2/17/2026 9:35:34 AM"), not parsed/normalized here. */
  date: string | null;
  /** Added to Site -- "Yes"/"No" in the source, modeled as boolean. */
  added_to_site: boolean;
  tracking_status?: "ready for site" | "published to site" | null;
}

/** Represents a product linked to this vendor from the NCADEMI live directory. */
export interface VendorProductLink {
  product_name: string;
  ncademi_product_url: string;
}

/** One row from the "vendors" table, with its vendor-resources rows joined in by Vendor Name. */
export interface VendorRecord {
  tracking_status?: "ready for site" | "published to site" | null;

  /** Vendor Name -- the join key used to match vendor-resources rows above. */
  vendor_name: string;
  /** Vendor Website -- the vendor's own external site (nullable: several sampled rows had no linked URL). */
  vendor_website_url: string | null;
  /** NCADEMI Vendor URL -- this vendor's own page on ncademi.org, distinct from vendor_website_url above. */
  vendor_directory_url: string | null;
  /** Last Updated -- free-text timestamp as AppSheet exported it (e.g. "2/17/26, 10:27 AM"), not parsed/normalized here. */
  last_updated: string | null;
  /** Added to Site -- "Yes"/"No" in the source, modeled as boolean. */
  added_to_site: boolean;
  /** Notes -- free text, frequently blank in the source data. */
  notes: string | null;
  /** Not a source column -- vendor-resources rows joined in by exact Vendor Name match (see the file header). */
  resources: VendorResource[];
  /** Products associated with this vendor, extracted from the vendor directory page. */
  products: VendorProductLink[];
  /** Support contacts for this vendor. Not yet scraped -- see the file header. */
  support_contacts?: PublishedSupportContact[] | null;
}

/**
 * Top-level file shape, mirroring the $schema_version/$meta/products
 * envelope already used by frontend/lib/published.json (see
 * PublishedProductRecord's file in published-tables.ts) rather than
 * inventing a new envelope convention for this one file.
 */
export interface VendorsFile {
  $schema_version: number;
  $meta: {
    purpose: string;
    source_listing_url: string;
    snapshot_taken_at: string;
    total_vendors: number;
    generated_from: string;
  };
  vendors: VendorRecord[];
}
