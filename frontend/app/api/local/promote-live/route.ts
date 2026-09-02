// frontend/app/api/local/promote-live/route.ts
/**
 * "Update Stored Data": merges a live-scrape snapshot into its stored
 * counterpart, then clears the snapshot. Wired to /records' SourceToggle,
 * which enables the button only while the matching live document exists.
 *
 * PORTED, WITH THE MERGE LOGIC UNTOUCHED. Every decision about record
 * identity below is carried over verbatim from the filesystem version and
 * should not be "improved" while porting -- the conservative merge in
 * particular is deliberate and load-bearing:
 *
 *   A live record upserts over its stored counterpart, matched by
 *   ncademi_product_url / vendor_directory_url. A stored record with no live
 *   counterpart is KEPT. A live-only record is appended. This is not a
 *   wholesale replace because `added` still contains products whose
 *   vendor-review password does not unlock their page, so they never appear
 *   in the live snapshot and a replace would silently drop them. Once every
 *   password resolves, merge and replace converge.
 *
 * Identity is the URL a record was scraped from, never product_name (an
 * editor can rename it) and never slug (derived).
 *
 * WHAT CHANGED. The filesystem version was backupThenWrite() followed by
 * backupThenDelete() -- two independent operations with a window between
 * them where a crash left the live snapshot consumed but the stored document
 * unchanged, or the reverse. promoteLive() does both in one Firestore
 * transaction. The merge itself stays here rather than moving into the
 * datastore: record identity is a domain question, and lib/server/documents.ts
 * deliberately knows nothing about record shape.
 *
 * Not part of the ETag/If-Match flow, same as before: this is an
 * operator-initiated whole-document swap, not a read-modify-write of
 * individual records, and it takes its own backup either way.
 *
 * tracking is untouched throughout -- workflow metadata was decoupled
 * precisely so a promote never disturbs it (lib/tracking.ts); it is merged
 * back onto the promoted records at read time.
 */

import { assertSession } from "@/lib/server/local-session";
import {
  tryReadRaw,
  promoteLive,
  liveKeyFor,
  isDataKind,
  DocumentTooLargeError,
  type DataKind,
} from "@/lib/server/documents";
import { deriveLiveProductSlug, deriveLiveVendorSlug } from "@/lib/server/documents-read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "candidate" has no live snapshot -- nothing scrapes it -- so liveKeyFor()
// returns null for it and the request is rejected below.
const PROMOTABLE: readonly DataKind[] = ["published", "added", "vendors"];

/**
 * A product record's non-array fields that lib/published-validate.ts requires
 * to be PRESENT (as a string or null). A stored record missing any of them is
 * a blocking error the next time it is saved from /editor.
 * scrape_ncademi_live.py's parse_public_product() emits all of these EXCEPT
 * ai_insights (no page equivalent), so the promote backfills the gap. A live
 * value, when present, always wins via spread order.
 */
const PRODUCT_FIELD_DEFAULTS: Record<string, null | []> = {
  vendor_name: null,
  vendor_directory_url: null,
  product_website_url: null,
  product_description: null,
  last_updated: null,
  ai_insights: null,
  vendor_resources: [],
  other_resources: [],
  support_contacts: [],
  acr_reports: [],
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  const gate = await assertSession();
  if ("response" in gate) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Request body is not valid JSON." }, 400);
  }

  const category = (body as { category?: unknown } | null)?.category;
  if (!isDataKind(category) || !PROMOTABLE.includes(category)) {
    return jsonResponse(
      { error: '"category" must be one of "published", "added", "vendors".' },
      400
    );
  }

  const kind = category;
  const isVendors = kind === "vendors";
  const arrayKey = isVendors ? "vendors" : "products";
  const idKey = isVendors ? "vendor_directory_url" : "ncademi_product_url";
  const totalKey = isVendors ? "total_vendors" : "total_products";
  const deriveSlug = isVendors ? deriveLiveVendorSlug : deriveLiveProductSlug;

  const liveKey = liveKeyFor(kind);
  if (!liveKey) {
    return jsonResponse({ error: `"${kind}" has no live snapshot.` }, 400);
  }

  const liveDoc = await tryReadRaw(liveKey);
  if (!liveDoc) {
    return jsonResponse({ error: 'No live data to promote. Run "Retrieve Live Data" first.' }, 409);
  }

  let live: Record<string, unknown>;
  try {
    live = JSON.parse(liveDoc.data) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "The stored live snapshot is not valid JSON." }, 500);
  }

  const liveRecords = Array.isArray(live[arrayKey])
    ? (live[arrayKey] as Array<Record<string, unknown>>)
    : [];

  // Re-shape each live record to the stored schema on the way in: derive the
  // slug (live snapshots carry none) and backfill missing required fields.
  const liveShaped: Array<Record<string, unknown>> = liveRecords.map((record) => ({
    ...(isVendors ? {} : PRODUCT_FIELD_DEFAULTS),
    ...record,
    slug: deriveSlug(record[idKey] as string),
  }));

  // The stored document's schema envelope is preserved; its records are the
  // base the live snapshot merges INTO.
  const storedDoc = await tryReadRaw(kind);
  let storedSchemaVersion = 1;
  let storedMeta: Record<string, unknown> = {};
  let storedRecords: Array<Record<string, unknown>> = [];
  if (storedDoc) {
    try {
      const stored = JSON.parse(storedDoc.data) as Record<string, unknown>;
      if (typeof stored.$schema_version === "number") storedSchemaVersion = stored.$schema_version;
      if (stored.$meta && typeof stored.$meta === "object") {
        storedMeta = stored.$meta as Record<string, unknown>;
      }
      if (Array.isArray(stored[arrayKey])) {
        storedRecords = stored[arrayKey] as Array<Record<string, unknown>>;
      }
    } catch {
      return jsonResponse({ error: `The stored "${kind}" document is not valid JSON.` }, 500);
    }
  }

  const liveById = new Map<string, Record<string, unknown>>();
  for (const record of liveShaped) {
    const id = record[idKey];
    if (typeof id === "string" && id) liveById.set(id, record);
  }

  const merged: Array<Record<string, unknown>> = [];
  const consumed = new Set<string>();
  let updated = 0;
  for (const stored of storedRecords) {
    const id = stored[idKey];
    const replacement = typeof id === "string" ? liveById.get(id) : undefined;
    if (replacement) {
      merged.push(replacement);
      consumed.add(id as string);
      updated += 1;
    } else {
      merged.push(stored);
    }
  }
  let addedNew = 0;
  for (const record of liveShaped) {
    const id = record[idKey];
    if (typeof id === "string" && !consumed.has(id)) {
      merged.push(record);
      addedNew += 1;
    }
  }
  const keptFromStored = storedRecords.length - updated;

  const liveMeta = (live.$meta && typeof live.$meta === "object" ? live.$meta : {}) as Record<
    string,
    unknown
  >;
  const nextStored = {
    $schema_version: storedSchemaVersion,
    $meta: {
      ...storedMeta,
      snapshot_taken_at:
        typeof liveMeta.last_scraped === "string"
          ? liveMeta.last_scraped
          : new Date().toISOString(),
      [totalKey]: merged.length,
      generated_from: `live-scrape merge via /records ("Update Stored Data")`,
    },
    [arrayKey]: merged,
  };
  const bytes = `${JSON.stringify(nextStored, null, 2)}\n`;

  try {
    await promoteLive({ storedKey: kind, liveKey, bytes, actor: gate.user.email });
  } catch (err) {
    if (err instanceof DocumentTooLargeError) {
      return jsonResponse({ error: err.message }, 413);
    }
    throw err;
  }

  return jsonResponse(
    { ok: true, category: kind, updated, keptFromStored, addedNew, total: merged.length },
    200
  );
}
