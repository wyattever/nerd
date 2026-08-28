// frontend/app/api/local/promote-live/route.ts
/**
 * Local-only "Update Stored Data" promote: replaces a stored document
 * (published.json / added.json / vendors.json) with its live-scrape
 * snapshot (*-live.json), then clears the snapshot. Wired to /records'
 * SourceToggle "Update Stored Data" button, which is enabled only while the
 * matching *-live.json exists (the same gate as its "Live Data" button).
 *
 * Gated to local development (assertLocalOnly), same as every /api/local/*
 * route. Deliberately NOT part of the DataKind ETag/If-Match concurrency
 * flow: this is an operator-initiated, whole-file swap, not a
 * read-modify-write of individual records, and it takes its own `.bak`
 * safety copy of the file it overwrites.
 *
 * Steps:
 *   1-2. Refresh the stored file's single rolling backup (`${path}.bak`).
 *   3.   MERGE the live snapshot into the stored file (not a wholesale
 *        replace): a live record upserts over its stored counterpart
 *        (matched by ncademi_product_url / vendor_directory_url), a stored
 *        record with no live counterpart is KEPT as-is, and a live-only
 *        record is appended. This is deliberately conservative for now --
 *        `added` in particular still has products whose vendor-review
 *        password doesn't unlock their page, so they never appear in
 *        added-live.json and a replace would silently drop them. Once every
 *        password resolves, merge and replace converge.
 *        Live records are re-shaped to the stored schema on the way in: a
 *        `slug` is derived (live snapshots carry none, see lib/local-data.ts)
 *        and any missing required field is backfilled. The stored file's own
 *        `$schema_version` + `$meta` envelope is kept, provenance refreshed.
 *   4-5. Refresh the live snapshot's own `.bak`.
 *   6.   Delete the live snapshot file, so "Live Data" / "Update Stored
 *        Data" go back to disabled until the next "Retrieve Live Data".
 *
 * tracking.json is untouched throughout -- editor workflow metadata was
 * decoupled precisely so a promote never disturbs it (see lib/tracking.ts);
 * lib/local-data.ts merges it back onto the newly-promoted records on read.
 *
 * Node runtime declared explicitly: fs is unavailable on Edge.
 */

import { promises as fs } from "node:fs";
import {
  assertLocalOnly,
  documentPath,
  liveSnapshotPath,
  backupThenWrite,
  backupThenDelete,
  type DataKind,
} from "@/lib/local-write";
import { deriveLiveProductSlug, deriveLiveVendorSlug } from "@/lib/local-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Only the categories with a live-scrape snapshot. "candidate" has none and
// is rejected below.
const PROMOTABLE = new Set<DataKind>(["published", "added", "vendors"]);

// A product record's non-array fields that lib/published-validate.ts
// requires to be PRESENT (as a string or null) -- a stored record missing
// any of them is a blocking error the next time it's saved from /editor.
// scrape_ncademi_live.py's parse_public_product() emits all of these
// EXCEPT ai_insights (it has no page equivalent), so the promote backfills
// the gap; a live value, when present, always wins via spread order.
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
  const blocked = assertLocalOnly();
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Request body is not valid JSON." }, 400);
  }

  const category = (body as { category?: unknown } | null)?.category;
  if (typeof category !== "string" || !PROMOTABLE.has(category as DataKind)) {
    return jsonResponse(
      { error: '"category" must be one of "published", "added", "vendors".' },
      400
    );
  }
  const kind = category as DataKind;
  const isVendors = kind === "vendors";
  const arrayKey = isVendors ? "vendors" : "products";
  // Stable identity for the merge -- the URL a record was scraped from,
  // never product_name (which an editor can rename) or slug (derived).
  const idKey = isVendors ? "vendor_directory_url" : "ncademi_product_url";
  const totalKey = isVendors ? "total_vendors" : "total_products";
  const deriveSlug = isVendors ? deriveLiveVendorSlug : deriveLiveProductSlug;

  const livePath = liveSnapshotPath(kind);
  if (!livePath) {
    return jsonResponse({ error: `"${kind}" has no live snapshot.` }, 400);
  }

  let liveRaw: string;
  try {
    liveRaw = await fs.readFile(livePath, "utf8");
  } catch {
    return jsonResponse(
      { error: 'No live data to promote. Run "Retrieve Live Data" first.' },
      409
    );
  }

  let live: Record<string, unknown>;
  try {
    live = JSON.parse(liveRaw) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "The live snapshot on disk is not valid JSON." }, 500);
  }
  const liveRecords = Array.isArray(live[arrayKey])
    ? (live[arrayKey] as Array<Record<string, unknown>>)
    : [];

  // Re-shape each live record to the stored schema on the way in.
  const liveShaped: Array<Record<string, unknown>> = liveRecords.map((record) => ({
    ...(isVendors ? {} : PRODUCT_FIELD_DEFAULTS),
    ...record,
    slug: deriveSlug(record[idKey] as string),
  }));

  // Read the current stored file: its schema envelope is preserved, and its
  // records are the base the live snapshot merges INTO.
  const storedPath = documentPath(kind);
  let storedSchemaVersion = 1;
  let storedMeta: Record<string, unknown> = {};
  let storedRecords: Array<Record<string, unknown>> = [];
  try {
    const stored = JSON.parse(await fs.readFile(storedPath, "utf8")) as Record<string, unknown>;
    if (typeof stored.$schema_version === "number") storedSchemaVersion = stored.$schema_version;
    if (stored.$meta && typeof stored.$meta === "object") {
      storedMeta = stored.$meta as Record<string, unknown>;
    }
    if (Array.isArray(stored[arrayKey])) {
      storedRecords = stored[arrayKey] as Array<Record<string, unknown>>;
    }
  } catch {
    // Stored file absent or unreadable -- the promote creates it fresh from
    // the live snapshot alone.
  }

  // Merge: a live record replaces its stored counterpart in place (matched
  // by idKey), a stored record with no live counterpart is kept, a
  // live-only record is appended. Stored order is preserved.
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
    const live = typeof id === "string" ? liveById.get(id) : undefined;
    if (live) {
      merged.push(live);
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

  const liveMeta = (live.$meta && typeof live.$meta === "object" ? live.$meta : {}) as Record<string, unknown>;
  const nextStored = {
    $schema_version: storedSchemaVersion,
    $meta: {
      ...storedMeta,
      snapshot_taken_at:
        typeof liveMeta.last_scraped === "string" ? liveMeta.last_scraped : new Date().toISOString(),
      [totalKey]: merged.length,
      generated_from: `live-scrape merge via /records ("Update Stored Data")`,
    },
    [arrayKey]: merged,
  };
  const bytes = `${JSON.stringify(nextStored, null, 2)}\n`;

  await backupThenWrite(storedPath, bytes);
  await backupThenDelete(livePath);

  return jsonResponse(
    { ok: true, category: kind, updated, keptFromStored, addedNew, total: merged.length },
    200
  );
}
