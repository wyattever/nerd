// frontend/lib/tracking.ts
/**
 * Editor-owned workflow metadata (priority / status / gatherer / reviewer),
 * decoupled from the four main documents (published / added / candidate /
 * vendors) into its own side file, frontend/lib/tracking.json -- the same
 * split lib/passwords.ts already applies to vendor-review passwords, and
 * for the same reasons:
 *
 *   - Different lifecycle. The scraped/curated content in the main
 *     documents is refreshed wholesale from the live site (see
 *     scripts/scrape_ncademi_live.py and /records' "Update Stored Data"
 *     promote of *-live.json over the stored file). Tracking state is set
 *     by a human in /editor and must survive every such refresh. Co-located,
 *     every content refresh has to carefully merge it back; separated, it
 *     is simply never touched.
 *   - The live scrape has no opinion on any tracking value, so co-locating
 *     forced it to emit `tracking_*: null` on every record purely to match
 *     the schema. It no longer does.
 *
 * Keyed by exact `product_name` string -- the same cross-reference key
 * passwords.ts and the rest of the app use (a vendor record's
 * `product_name` is its vendor name, see
 * scripts/migrate_vendors_to_unified.py / scrape_ncademi_live.py's
 * map_vendor_to_directory_record).
 *
 * This module is PURE (no fs) -- the read/modify/write of tracking.json
 * lives in lib/local-write.ts (readTrackingRecords / writeTrackingRecords),
 * mirroring how passwords.ts stays pure while app/api/local/passwords/
 * route.ts owns the disk access. The split (on write) and merge (on read)
 * happen server-side, so /editor and /records components still see the
 * exact same record shape they always have -- the fields are just filled
 * in from tracking.json at read time instead of living inline.
 */

export const TRACKING_FIELDS = [
  "tracking_priority",
  "tracking_status",
  "tracking_gatherer",
  "tracking_reviewer",
] as const;

export type TrackingField = (typeof TRACKING_FIELDS)[number];

export interface TrackingRecord {
  product_name: string;
  tracking_priority: string | null;
  tracking_status: string | null;
  tracking_gatherer: string | null;
  tracking_reviewer: string | null;
}

type TrackingValues = Omit<TrackingRecord, "product_name">;

const EMPTY_VALUES: TrackingValues = {
  tracking_priority: null,
  tracking_status: null,
  tracking_gatherer: null,
  tracking_reviewer: null,
};

/** The four tracking_* values off `record`, each coerced to a non-blank
 *  string or null (a blank/whitespace value is treated as "not set", so a
 *  select cleared back to its placeholder round-trips to no row rather than
 *  a row full of ""). */
function readTrackingValues(record: Record<string, unknown>): TrackingValues {
  const val = (k: TrackingField): string | null => {
    const v = record[k];
    return typeof v === "string" && v.trim() !== "" ? v : null;
  };
  return {
    tracking_priority: val("tracking_priority"),
    tracking_status: val("tracking_status"),
    tracking_gatherer: val("tracking_gatherer"),
    tracking_reviewer: val("tracking_reviewer"),
  };
}

function hasAnyValue(values: TrackingValues): boolean {
  return TRACKING_FIELDS.some((f) => values[f] !== null);
}

/** A shallow copy of `record` with the four tracking_* keys removed. */
export function stripTrackingFields<T extends Record<string, unknown>>(record: T): T {
  const copy: Record<string, unknown> = { ...record };
  for (const f of TRACKING_FIELDS) delete copy[f];
  return copy as T;
}

/**
 * Splits an incoming batch of records (an /editor tab POSTs its whole
 * category array) into the content to persist in the main document and the
 * tracking rows to persist in tracking.json.
 *
 * - `records`: the same objects with the tracking_* keys stripped.
 * - `tracking`: one row per record that carries at least one non-null
 *   tracking value. A record whose tracking was cleared produces NO row --
 *   `scopeNames` is how writeTrackingRecords() knows to delete the row it
 *   used to have.
 * - `scopeNames`: every `product_name` in the batch, i.e. the set of rows
 *   this write is authoritative for. Rows outside it (other categories) are
 *   left alone.
 */
export function splitTracking<T extends Record<string, unknown>>(
  records: T[]
): { records: T[]; tracking: TrackingRecord[]; scopeNames: string[] } {
  const stripped: T[] = [];
  const tracking: TrackingRecord[] = [];
  const scopeNames: string[] = [];

  for (const record of records) {
    const name = typeof record.product_name === "string" ? record.product_name : null;
    if (name) scopeNames.push(name);

    const values = name ? readTrackingValues(record) : EMPTY_VALUES;
    if (name && hasAnyValue(values)) {
      tracking.push({ product_name: name, ...values });
    }
    stripped.push(stripTrackingFields(record));
  }

  return { records: stripped, tracking, scopeNames };
}

/**
 * Fills each record's tracking_* fields from its `tracking.json` row
 * (matched by exact `product_name`). Only non-null values are applied, so a
 * record with no row -- or a row that only sets some of the four -- keeps
 * whatever it already had (in practice: absent, rendered as the select's
 * placeholder). Returns the same array untouched when `tracking` is empty.
 */
export function mergeTracking<T extends Record<string, unknown>>(
  records: T[],
  tracking: TrackingRecord[]
): T[] {
  if (tracking.length === 0) return records;
  const byName = new Map(tracking.map((t) => [t.product_name, t]));

  return records.map((record) => {
    const name = typeof record.product_name === "string" ? record.product_name : null;
    const row = name ? byName.get(name) : undefined;
    if (!row) return record;

    const merged: Record<string, unknown> = { ...record };
    for (const f of TRACKING_FIELDS) {
      if (row[f] !== null) merged[f] = row[f];
    }
    return merged as T;
  });
}

/**
 * Reconciles the full tracking row set for one save.
 *
 * Within `scopeNames` -- every product_name the incoming batch contained --
 * `existing` rows are replaced by `rows`, so a record whose tracking was
 * cleared loses its row and a newly-set one gains it. Rows for
 * product_names OUTSIDE `scopeNames` (the other editor categories) are
 * carried through untouched.
 *
 * Pure, and deliberately so: this runs inside a Firestore transaction (see
 * lib/server/documents.ts's saveGuarded), where the transaction callback
 * may be retried on contention and must therefore have no side effects of
 * its own. The fs version's writeTrackingRecords() interleaved this logic
 * with its own read and write; that interleaving is what is being undone.
 *
 * Output is sorted by product_name so the serialized document is stable --
 * two saves producing the same logical rows produce byte-identical
 * documents, and therefore the same ETag.
 */
export function reconcileTrackingRows(
  existing: TrackingRecord[],
  scopeNames: string[],
  rows: TrackingRecord[]
): TrackingRecord[] {
  const scope = new Set(scopeNames);
  const next = existing.filter((r) => !scope.has(r.product_name));
  for (const row of rows) {
    if (TRACKING_FIELDS.some((f) => row[f] !== null)) next.push(row);
  }
  next.sort((a, b) => a.product_name.localeCompare(b.product_name));
  return next;
}
