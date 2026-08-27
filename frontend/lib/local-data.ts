// frontend/lib/local-data.ts
/**
 * Server-only readers for candidate/added/published.json, used by the
 * routed editor/records leaves' Server Components (frontend/app/editor/
 * (routed)/*, frontend/app/records/(routed)/*) instead of a client
 * fetch('/api/local/...') round trip -- see docs/
 * UI_ROUTING_MIGRATION_IMPLEMENTATION_GUIDE_v2.md Gate 2 / Phase 2.
 *
 * Deliberately reuses readPublishedRaw() from local-write.ts rather than
 * re-implementing fs.readFile/path resolution here: that function is
 * already the "one code path that touches disk" for these three files
 * (Route Handlers use it too), so a second, independent path-construction
 * routine would be exactly the kind of duplicated boundary condition
 * isLocalOnlyAllowed() was extracted to avoid one level up.
 *
 * The `notFound()` call below is what actually enforces DECISION_LOG #6 for
 * this read path -- see local-only.ts's header and local-data.ts's Route
 * Handler counterpart (assertLocalOnly() in local-write.ts) for why this
 * can't just reuse that Response-returning function directly: a Server
 * Component has no Response to return.
 */

import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import { isLocalOnlyAllowed } from "./local-only";
import { readPublishedRaw, libDir, type DataKind } from "./local-write";
import type { PublishedProductRecord } from "./published-tables";
import type { DirectoryRecord, DirectoryFile } from "./directory-schema";

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

async function readLocalDocument(kind: DataKind): Promise<LocalDocument> {
  if (!isLocalOnlyAllowed()) notFound();

  const { data, etag } = await readPublishedRaw(kind);
  const body = JSON.parse(data) as {
    $schema_version?: unknown;
    $meta?: unknown;
    products?: unknown;
  };

  return {
    products: Array.isArray(body.products) ? (body.products as PublishedProductRecord[]) : [],
    schemaVersion: typeof body.$schema_version === "number" ? body.$schema_version : null,
    meta: body.$meta ? (body.$meta as SnapshotMeta) : null,
    etag,
  };
}

export function getCandidates(): Promise<LocalDocument> {
  return readLocalDocument("candidate");
}

export function getAddedProducts(): Promise<LocalDocument> {
  return readLocalDocument("added");
}

export function getPublishedProducts(): Promise<LocalDocument> {
  return readLocalDocument("published");
}

export interface VendorsDocument {
  vendors: DirectoryRecord[];
  schemaVersion: number | null;
  meta: DirectoryFile["$meta"] | null;
  etag: string;
}

/**
 * Reads vendors.json -- same isLocalOnlyAllowed()/readPublishedRaw()
 * guarded pattern as readLocalDocument() above, kept as its own function
 * rather than a DataKind-generic version of that one: the file's top-level
 * array key is `vendors`, not `products`, and its `$meta` shape
 * (DirectoryFile["$meta"], e.g. `total_vendors`) doesn't match
 * SnapshotMeta's product-oriented fields (`total_products`), so the two
 * response shapes can't be unified without either lying about the type or
 * adding a generic parameter for one caller.
 *
 * Callers only ever need the resolved array by the time they save (see
 * VendorEditor.tsx's own GET-then-POST at save time, which re-fetches
 * schemaVersion/meta/etag fresh rather than trusting what this function
 * returned at page-load time) -- schemaVersion/meta/etag are returned here
 * anyway for parity with the other readers and for [slug]/page.tsx's
 * initial render, not because the write path depends on them staying
 * fresh.
 */
export async function getVendors(): Promise<VendorsDocument> {
  if (!isLocalOnlyAllowed()) notFound();

  const { data, etag } = await readPublishedRaw("vendors");
  const body = JSON.parse(data) as {
    $schema_version?: unknown;
    $meta?: unknown;
    vendors?: unknown;
  };

  return {
    vendors: Array.isArray(body.vendors) ? (body.vendors as DirectoryRecord[]) : [],
    schemaVersion: typeof body.$schema_version === "number" ? body.$schema_version : null,
    meta: body.$meta ? (body.$meta as DirectoryFile["$meta"]) : null,
    etag,
  };
}

// See local-write.ts's libDir() for why process.cwd() alone isn't reliable
// here under the standalone build.
const PUBLISHED_LIVE_PATH = path.join(libDir(), "published-live.json");

/**
 * published-live.json's records carry no `slug` field at all (unlike the
 * curated candidate/added/published snapshots) -- derived here from the
 * last non-empty path segment of ncademi_product_url (e.g.
 * ".../products/99math/" -> "99math"), not the URL itself. A raw URL
 * contains slashes, which [slug]/page.tsx's single dynamic segment can't
 * hold -- using the whole URL as originally tried here produced an href
 * Next would parse as several nested route segments, not a working link.
 *
 * Exported so app/api/local/published-live/route.ts can apply the exact
 * same derivation -- the client-side fetch (that route) and this
 * server-side reader must agree on what a live record's slug is, or the
 * SAME record would resolve to two different URLs depending on which path
 * loaded it.
 */
export function deriveLiveProductSlug(ncademiProductUrl: string): string {
  const segments = ncademiProductUrl.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? ncademiProductUrl;
}

/**
 * Reads published-live.json -- deliberately NOT routed through
 * readLocalDocument()/DataKind above: that pair's whole design is "closed
 * set of documents this app can WRITE" (see local-write.ts's header), and
 * there is no write path for the live scrape snapshot (see
 * app/api/local/published-live/route.ts's own header for the full
 * rationale, which this mirrors). Same isLocalOnlyAllowed() + notFound()
 * guard as readLocalDocument(), applied directly here instead.
 *
 * Returns `{ products: [] }` rather than throwing when the file doesn't
 * exist yet -- matches the sibling Route Handler's "no live data yet is
 * the expected, common case, not an error" stance, and lets the one caller
 * ([slug]/page.tsx) fall through to its existing "Record not found" state
 * without a separate empty-snapshot code path.
 */
export async function getPublishedLiveProducts(): Promise<{ products: PublishedProductRecord[] }> {
  if (!isLocalOnlyAllowed()) notFound();

  let raw: string;
  try {
    raw = await fs.readFile(PUBLISHED_LIVE_PATH, "utf8");
  } catch {
    return { products: [] };
  }

  const body = JSON.parse(raw) as { products?: unknown };
  const rawProducts = Array.isArray(body.products) ? (body.products as Array<Record<string, unknown>>) : [];
  const products = rawProducts.map((p) => ({
    ...p,
    slug: deriveLiveProductSlug(p.ncademi_product_url as string),
  })) as PublishedProductRecord[];

  return { products };
}

// See local-write.ts's libDir() for why process.cwd() alone isn't reliable
// here under the standalone build.
const ADDED_LIVE_PATH = path.join(libDir(), "added-live.json");

/**
 * Reads added-live.json -- mirrors getPublishedLiveProducts() exactly (same
 * isLocalOnlyAllowed() + notFound() guard, same "no live data yet" ->
 * `{ products: [] }` fallback, same deriveLiveProductSlug() injection).
 *
 * Separate file because a password-protected ("Added to Site", pending
 * vendor review) product page is scraped with its vendor-review password
 * and written here by scrape_ncademi_live.py's `--target added` run, while
 * published-live.json now holds only publicly-visible pages -- so
 * /records/added's ?source=live view reads this file, not the one
 * /records/published reads.
 */
export async function getAddedLiveProducts(): Promise<{ products: PublishedProductRecord[] }> {
  if (!isLocalOnlyAllowed()) notFound();

  let raw: string;
  try {
    raw = await fs.readFile(ADDED_LIVE_PATH, "utf8");
  } catch {
    return { products: [] };
  }

  const body = JSON.parse(raw) as { products?: unknown };
  const rawProducts = Array.isArray(body.products) ? (body.products as Array<Record<string, unknown>>) : [];
  const products = rawProducts.map((p) => ({
    ...p,
    slug: deriveLiveProductSlug(p.ncademi_product_url as string),
  })) as PublishedProductRecord[];

  return { products };
}

// See local-write.ts's libDir() for why process.cwd() alone isn't reliable
// here under the standalone build.
const VENDORS_LIVE_PATH = path.join(libDir(), "vendors-live.json");

/**
 * Same derivation as deriveLiveProductSlug() above, applied to
 * vendor_directory_url instead of ncademi_product_url -- vendors-live.json's
 * records carry no `slug` field either. Exported so
 * app/api/local/vendors-live/route.ts can apply the exact same derivation
 * this server-side reader uses.
 */
export function deriveLiveVendorSlug(vendorDirectoryUrl: string): string {
  const segments = vendorDirectoryUrl.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? vendorDirectoryUrl;
}

/**
 * Reads vendors-live.json -- mirrors getPublishedLiveProducts() above:
 * same isLocalOnlyAllowed() + notFound() guard, same "no live data yet"
 * -> `{ vendors: [] }` fallback rather than throwing.
 */
export async function getLiveVendors(): Promise<{ vendors: DirectoryRecord[] }> {
  if (!isLocalOnlyAllowed()) notFound();

  let raw: string;
  try {
    raw = await fs.readFile(VENDORS_LIVE_PATH, "utf8");
  } catch {
    return { vendors: [] };
  }

  const body = JSON.parse(raw) as { vendors?: unknown };
  const rawVendors = Array.isArray(body.vendors) ? (body.vendors as Array<Record<string, unknown>>) : [];
  // map_vendor_to_directory_record() (scrape_ncademi_live.py) already
  // writes the full DirectoryRecord shape (kind/product_name/
  // vendor_resources/other_resources/support_contacts/acr_reports/etc.),
  // so `...v` carries that through untouched here -- only `slug` (which
  // the script deliberately doesn't write; see deriveLiveVendorSlug's own
  // docstring) is synthesized. `product_name` keeps a fallback since
  // DirectoryRecord requires a string and a parse failure (no <h1> found)
  // can leave the script's vendor_name null.
  const vendors = rawVendors.map((v) => ({
    ...v,
    slug: deriveLiveVendorSlug(v.vendor_directory_url as string),
    product_name: v.product_name || v.vendor_name || "Unknown",
  })) as unknown as DirectoryRecord[];

  return { vendors };
}
