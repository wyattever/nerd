// frontend/lib/directory-schema.ts
/**
 * Unified directory schema -- the shape actually written to
 * frontend/lib/vendors.json by scripts/migrate_vendors_to_unified.py.
 * Mirrors PublishedProductRecord (published-tables.ts) field-for-field
 * (same product_name/vendor_name/vendor_resources/other_resources/
 * support_contacts/acr_reports/last_updated/ai_insights shape), plus two
 * fields PublishedProductRecord has no equivalent for: `kind` (the
 * branch/leaf discriminant -- "vendor" records are branch nodes, "product"
 * records are leaves) and `products` (a vendor's child product links).
 * Deliberately not a third schema -- see each field's provenance below.
 *
 * `products` currently holds DirectoryProductLink stubs (product_name +
 * ncademi_product_url), not full nested DirectoryRecord leaves -- the
 * "vendor as branch node with real leaf children" model referenced in the
 * schema-unification proposal is not yet realized in the migrated data,
 * only the top-level vendor/product field convergence is.
 *
 * The vendor_name: null data bug and the contact_type/type script mismatch
 * (both flagged in this file's earlier revisions) were fixed in
 * scripts/migrate_vendors_to_unified.py and vendors.json has been
 * regenerated -- no longer an open issue.
 *
 * The legacy VendorRecord bridge (toLegacyVendorRecord et al.) that used to
 * live here has been removed: every component in the vendors editor stack
 * now consumes DirectoryRecord natively (see VendorGlobalResourcesEditor.tsx,
 * VendorProductsEditor.tsx, VendorSupportEditor.tsx, VendorCreateModal.tsx,
 * VendorEditor.tsx). vendor-schema.ts's VendorRecord/VendorResource/
 * VendorProductLink types still describe the pre-migration shape but are no
 * longer imported anywhere in that stack.
 */

import type { PublishedSupportContact } from "@/lib/published-tables";

export type DirectoryRecordKind = "vendor" | "product";

export interface DirectoryResourceLink {
  text: string;
  url: string;
}

export interface DirectoryAcrReport {
  title: string;
  url: string | null;
  version: string | null;
  date: string | null;
  auditor_name: string | null;
  auditor_url: string | null;
}

/** Stub child-product link under a vendor's `products` array -- not yet a
 *  full DirectoryRecord leaf. See this file's header. */
export interface DirectoryProductLink {
  product_name: string;
  ncademi_product_url: string;
}

export interface DirectoryRecord {
  kind: DirectoryRecordKind;
  slug: string;
  product_name: string;
  vendor_name: string | null;
  vendor_directory_url: string | null;
  product_website_url: string | null;
  product_description: string | null;
  vendor_resources: DirectoryResourceLink[];
  other_resources: DirectoryResourceLink[];
  support_contacts: PublishedSupportContact[];
  acr_reports: DirectoryAcrReport[];
  /** Only meaningful for kind "vendor". See this file's header. */
  products: DirectoryProductLink[];
  last_updated: string | null;
  ai_insights: string | null;
  tracking_status: "ready for site" | "published to site" | null;
}

export interface DirectoryFileMeta {
  purpose: string;
  source_listing_url: string;
  snapshot_taken_at: string;
  total_vendors: number;
  generated_from: string;
}

/** Top-level frontend/lib/vendors.json shape. Key stays `vendors` (not
 *  `records`) to match the file on disk and /api/local/vendors's existing
 *  contract -- renaming it is a separate, out-of-scope change. */
export interface DirectoryFile {
  $schema_version: number;
  $meta: DirectoryFileMeta;
  vendors: DirectoryRecord[];
}

/** Shared with VendorCreateModal.tsx (new-record slug generation) and
 *  scripts/migrate_vendors_to_unified.py's own slugify (kept in sync
 *  manually across the Python/TypeScript boundary). */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
