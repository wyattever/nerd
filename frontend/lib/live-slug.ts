// frontend/lib/live-slug.ts
/**
 * Slug derivation for live-scrape records. Pure (plain string operations,
 * no imports), so it can be used both by server modules and by node:test
 * (plan D41). lib/server/documents-read.ts re-exports both functions, so
 * existing imports from there keep working.
 */

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
