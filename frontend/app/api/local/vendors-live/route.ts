// frontend/app/api/local/vendors-live/route.ts
/**
 * Read-only existence and content check for the live-scrape snapshot of
 * `vendors`. Backs /records' mount-time check for whether the "Live Data"
 * and "Update Stored Data" buttons should be enabled.
 *
 * Deliberately not part of the DataKind write system, unchanged from the
 * filesystem version: that union is "the closed set of documents this app can
 * WRITE," and there is no client write path for a scrape snapshot. Under the
 * new architecture the scrape service writes it (Phase 5); nothing in the
 * browser does.
 *
 * ABSENCE IS THE NORMAL STATE, NOT AN ERROR. A live snapshot exists only
 * between a scrape and its promote. Returns 404 with `{ exists: false }`
 * rather than throwing -- /records' check depends on this not crashing.
 * `readRaw` would throw here, so `tryReadRaw` is used instead; that is the
 * whole reason the datastore exposes both.
 *
 * Live records carry no `slug` field, so one is synthesized per record via
 * deriveLiveVendorSlug() -- the SAME function lib/server/documents-read.ts's
 * server-side reader uses, not a second copy of the derivation. If the two
 * ever diverged, one record would resolve to two different URLs depending on
 * which path loaded it.
 *
 * Mirrors app/api/local/published-live/route.ts entirely -- see that file's
 * header for the full rationale. Differs only in the document key, the array
 * key (`vendors`), and applying deriveLiveVendorSlug() to
 * vendor_directory_url rather than deriveLiveProductSlug() to
 * ncademi_product_url.
 */

import { assertSession } from "@/lib/server/local-session";
import { tryReadRaw, readTrackingRecords } from "@/lib/server/documents";
import { deriveLiveVendorSlug } from "@/lib/server/documents-read";
import { mergeTracking } from "@/lib/tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY = "vendors-live" as const;
const ARRAY_KEY = "vendors" as const;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    // no-store is explicit: this route's entire purpose is telling the caller
    // whether a scrape has landed since the page loaded, so a cached 404
    // would leave "Live Data" stuck disabled after one actually did.
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function GET(): Promise<Response> {
  const gate = await assertSession();
  if ("response" in gate) return gate.response;

  const found = await tryReadRaw(KEY);
  if (!found) return jsonResponse({ exists: false }, 404);

  let body: { [key: string]: unknown };
  try {
    body = JSON.parse(found.data) as { [key: string]: unknown };
  } catch {
    // A snapshot that will not parse is indistinguishable, to this route's
    // only consumer, from one that is not there -- it just wants to know
    // whether the toggle can be shown, not why not.
    return jsonResponse({ exists: false }, 404);
  }

  const raw = Array.isArray(body[ARRAY_KEY])
    ? (body[ARRAY_KEY] as Array<Record<string, unknown>>)
    : [];
  const withSlug = raw.map((record) => ({
    ...record,
    slug: deriveLiveVendorSlug(record.vendor_directory_url as string),
  }));
  const records = mergeTracking(withSlug, await readTrackingRecords());

  return jsonResponse({ ...body, [ARRAY_KEY]: records }, 200);
}
