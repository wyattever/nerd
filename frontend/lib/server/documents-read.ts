// frontend/lib/server/documents-read.ts
/**
 * Server Component readers for the editor and records route trees, replacing
 * lib/local-data.ts. Same functions, same return shapes, same callers -- the
 * routed leaves under app/editor/(routed)/* and app/records/(routed)/* need
 * no changes beyond their import path.
 *
 * WHY THESE EXIST AT ALL, unchanged from the module they replace: a Server
 * Component reading its own data directly avoids a client fetch round trip to
 * the Route Handler that would return the same bytes.
 *
 * WHY THEY REUSE lib/server/documents.ts rather than reaching for Firestore
 * themselves: that module is the one code path that touches the datastore, and
 * a second, independently-maintained one would be exactly the duplicated
 * boundary condition that isLocalOnlyAllowed() was extracted to avoid one
 * level up. Same reasoning local-data.ts gave for reusing readPublishedRaw().
 *
 * TWO CHANGES FROM local-data.ts:
 *
 *   1. The guard. `if (!isLocalOnlyAllowed()) notFound()` becomes
 *      `await requireSessionUser()`, which redirects to /login. A Server
 *      Component has no Response to return, which is why it needs its own
 *      guard shape rather than the Route Handlers' assertSession(); see
 *      lib/server/session.ts.
 *
 *      notFound() was right when these routes were never meant to be
 *      reachable in production -- a 404 leaked nothing about a route that
 *      officially did not exist. They are now a deployed, intended part of
 *      the app, and a visitor who is one sign-in away from the page should be
 *      sent to sign in, not told the page does not exist.
 *
 *   2. Missing documents. The three live snapshots return an empty result
 *      rather than throwing, matching local-data.ts exactly ("no live data
 *      yet" is the normal state). The four stored documents now throw
 *      DocumentNotFoundError instead of ENOENT, which surfaces as a 500 --
 *      correct, because after the migration their absence means the database
 *      was never seeded, and that is not a condition any page should try to
 *      render around.
 */

import "server-only";
import { readRaw, tryReadRaw, readTrackingRecords, type DataKind } from "./documents";
import { requireSessionUser } from "./session";
import { mergeTracking } from "../tracking";
import type { PublishedProductRecord } from "../published-tables";
import type { DirectoryRecord, DirectoryFile } from "../directory-schema";

export interface SnapshotMeta {
  purpose: string;
  source_listing_url: string;
  snapshot_taken_at: string;
  total_products: number;
  generated_from: string;
}

export interface LocalDocument {
  products: PublishedProductRecord[];
  schemaVersion: number | null;
  meta: SnapshotMeta | null;
  etag: string;
}

async function readProductDocument(kind: DataKind): Promise<LocalDocument> {
  await requireSessionUser();

  const { data, etag } = await readRaw(kind);
  const body = JSON.parse(data) as {
    $schema_version?: unknown;
    $meta?: unknown;
    products?: unknown;
  };

  // tracking_* lives in its own document -- merged back in here (by
  // product_name) so every consumer still sees the same record shape. The
  // ETag hashes the stored bytes, which contain no tracking, so the merge is
  // display-only and cannot cause a spurious 412 on a later save.
  const raw = Array.isArray(body.products) ? (body.products as PublishedProductRecord[]) : [];
  const products = mergeTracking(
    raw as unknown as Array<Record<string, unknown>>,
    await readTrackingRecords()
  ) as unknown as PublishedProductRecord[];

  return {
    products,
    schemaVersion: typeof body.$schema_version === "number" ? body.$schema_version : null,
    meta: body.$meta ? (body.$meta as SnapshotMeta) : null,
    etag,
  };
}

export function getCandidates(): Promise<LocalDocument> {
  return readProductDocument("candidate");
}

export function getAddedProducts(): Promise<LocalDocument> {
  return readProductDocument("added");
}

export function getPublishedProducts(): Promise<LocalDocument> {
  return readProductDocument("published");
}

export interface VendorsDocument {
  vendors: DirectoryRecord[];
  schemaVersion: number | null;
  meta: DirectoryFile["$meta"] | null;
  etag: string;
}

/**
 * Kept as its own function rather than a generic version of the above, for
 * the reason local-data.ts gave: the top-level array key is `vendors`, and
 * the $meta shape (`total_vendors`) does not match SnapshotMeta's
 * product-oriented fields. Unifying them would mean either lying about the
 * type or adding a generic parameter for one caller.
 */
export async function getVendors(): Promise<VendorsDocument> {
  await requireSessionUser();

  const { data, etag } = await readRaw("vendors");
  const body = JSON.parse(data) as {
    $schema_version?: unknown;
    $meta?: unknown;
    vendors?: unknown;
  };

  // A vendor record's product_name is its vendor name, which is the tracking
  // key -- so the same merge applies with no special casing.
  const raw = Array.isArray(body.vendors) ? (body.vendors as DirectoryRecord[]) : [];
  const vendors = mergeTracking(
    raw as unknown as Array<Record<string, unknown>>,
    await readTrackingRecords()
  ) as unknown as DirectoryRecord[];

  return {
    vendors,
    schemaVersion: typeof body.$schema_version === "number" ? body.$schema_version : null,
    meta: body.$meta ? (body.$meta as DirectoryFile["$meta"]) : null,
    etag,
  };
}

// --- Live snapshots -------------------------------------------------------

/**
 * Live records carry no `slug` field, unlike the curated snapshots. Derived
 * from the last non-empty path segment of the record's URL (e.g.
 * ".../products/99math/" -> "99math"), never the URL itself -- a raw URL
 * contains slashes, which a single dynamic [slug] segment cannot hold, and
 * using the whole URL produced an href Next parsed as several nested route
 * segments rather than a working link.
 *
 * Exported so the Route Handler siblings apply the SAME derivation. Two
 * independently-maintained copies would let one record resolve to two
 * different URLs depending on which path loaded it.
 */
export function deriveLiveProductSlug(ncademiProductUrl: string): string {
  const segments = (ncademiProductUrl ?? "").split("/").filter(Boolean);
  return segments[segments.length - 1] ?? ncademiProductUrl;
}

/** Same derivation applied to vendor_directory_url. */
export function deriveLiveVendorSlug(vendorDirectoryUrl: string): string {
  const segments = (vendorDirectoryUrl ?? "").split("/").filter(Boolean);
  return segments[segments.length - 1] ?? vendorDirectoryUrl;
}

async function readLiveProducts(
  key: "published-live" | "added-live"
): Promise<{ products: PublishedProductRecord[] }> {
  await requireSessionUser();

  const found = await tryReadRaw(key);
  if (!found) return { products: [] };

  const body = JSON.parse(found.data) as { products?: unknown };
  const raw = Array.isArray(body.products) ? (body.products as Array<Record<string, unknown>>) : [];
  const withSlug = raw.map((record) => ({
    ...record,
    slug: deriveLiveProductSlug(record.ncademi_product_url as string),
  }));

  // A live record is the same product, so its stored tracking shows alongside
  // the freshly-scraped content and survives a promote of this snapshot.
  const products = mergeTracking(
    withSlug,
    await readTrackingRecords()
  ) as unknown as PublishedProductRecord[];

  return { products };
}

export function getPublishedLiveProducts(): Promise<{ products: PublishedProductRecord[] }> {
  return readLiveProducts("published-live");
}

export function getAddedLiveProducts(): Promise<{ products: PublishedProductRecord[] }> {
  return readLiveProducts("added-live");
}

export async function getLiveVendors(): Promise<{ vendors: DirectoryRecord[] }> {
  await requireSessionUser();

  const found = await tryReadRaw("vendors-live");
  if (!found) return { vendors: [] };

  const body = JSON.parse(found.data) as { vendors?: unknown };
  const raw = Array.isArray(body.vendors) ? (body.vendors as Array<Record<string, unknown>>) : [];

  // scrape_ncademi_live.py's map_vendor_to_directory_record() already writes
  // the full DirectoryRecord shape, so the spread carries it through
  // untouched -- only `slug` is synthesized. product_name keeps a fallback
  // because DirectoryRecord requires a string and a parse failure (no <h1>)
  // can leave the script's vendor_name null.
  const withSlug = raw.map((record) => ({
    ...record,
    slug: deriveLiveVendorSlug(record.vendor_directory_url as string),
    product_name: record.product_name || record.vendor_name || "Unknown",
  }));

  const vendors = mergeTracking(
    withSlug,
    await readTrackingRecords()
  ) as unknown as DirectoryRecord[];

  return { vendors };
}
