// frontend/lib/server/documents.ts
/**
 * Firestore-backed replacement for lib/local-write.ts. Same documents, same
 * whole-document model, same strong-ETag optimistic concurrency contract as
 * seen by HTTP callers -- different substrate, and one deliberate change to
 * the internal shape (see COMPARE-AND-SWAP below).
 *
 * ---------------------------------------------------------------------------
 * STORAGE MODEL
 * ---------------------------------------------------------------------------
 * One Firestore document per logical document, in collection
 * `nerd_documents`, keyed by the same closed union of literals the fs
 * version used as filenames. The JSON is stored as a STRING (`bytes`), not
 * as a parsed Firestore map. Three reasons, in order of weight:
 *
 *   1. It preserves the ETag contract byte-for-byte. The ETag has always
 *      been SHA-256 over the exact serialized bytes. Round-tripping through
 *      a Firestore map would reorder keys, coerce types, and drop nulls,
 *      so the hash would no longer be a hash of anything a client could
 *      reproduce -- and every If-Match comparison would be against a value
 *      whose derivation had quietly changed.
 *   2. Firestore cannot store the shape anyway without a rewrite. Nested
 *      arrays-of-objects are fine, but `undefined` is rejected, key
 *      ordering is not preserved, and the records carry keys the frontend
 *      schema modules own -- putting Pydantic-free record shape into
 *      Firestore's type system buys nothing and creates a second schema
 *      authority. See docs/DECISION_LOG.md #51.
 *   3. It keeps the port near-1:1, which is the whole reason this
 *      substrate was chosen over a per-record redesign.
 *
 * Every document fits with an order of magnitude to spare: the largest
 * (published-live.json) is ~128 KB against Firestore's 1,048,487-byte
 * un-indexed field-value ceiling.
 *
 * ---------------------------------------------------------------------------
 * !! REQUIRED FIRESTORE CONFIGURATION -- WRITES FAIL WITHOUT IT !!
 * ---------------------------------------------------------------------------
 * Firestore rejects any commit containing an INDEXED field value larger
 * than 1,500 bytes with INVALID_ARGUMENT ("The value of property bytes is
 * longer than 1500 bytes"). Single-field indexes are created automatically
 * for every field, so the `bytes` field MUST carry a single-field index
 * exemption before the first real write. This is not a performance tuning
 * step; without it, every save of every document fails.
 *
 * Declared in firestore.indexes.json (fieldOverrides), or applied directly:
 *
 *   gcloud beta firestore indexes fields update bytes \
 *     --collection-group=nerd_documents \
 *     --database='(default)' \
 *     --disable-indexes
 *
 * The same exemption is needed on the `backups` collection group. Nothing
 * in this app ever queries these documents -- every access is by known
 * document id -- so no index on `bytes` is wanted for any purpose.
 *
 * ---------------------------------------------------------------------------
 * COMPARE-AND-SWAP: the one deliberate deviation from a 1:1 port
 * ---------------------------------------------------------------------------
 * The fs version's Route Handlers did: read ETag -> compare to If-Match ->
 * write -> re-read ETag. Four separate operations. On one local disk with
 * one operator that race window was theoretical. On Cloud Run it is not:
 * two instances can both read the same ETag, both pass the If-Match check,
 * and both write, and the second silently destroys the first. The ETag
 * would be protecting nothing -- which is worse than having no ETag, since
 * the UI would report success.
 *
 * So the comparison and the write are folded into ONE Firestore
 * transaction here (saveGuarded). The HTTP contract is unchanged --
 * If-Match still yields 412 on mismatch, success still returns the new
 * ETag -- but the guarantee is now real rather than nominal.
 *
 * Two consequences worth knowing, both accepted:
 *   - Route Handlers must validate the request body BEFORE calling
 *     saveGuarded, so a stale save now surfaces validation errors it
 *     previously short-circuited past. Reporting both problems is better
 *     than reporting one.
 *   - tracking.json's reconcile now happens INSIDE the same transaction
 *     (see saveGuarded's `tracking` option). The fs version wrote it after
 *     the main document specifically so a rejected save could not leave a
 *     half-applied tracking write behind; a transaction gives that
 *     property outright instead of by sequencing.
 *
 * ---------------------------------------------------------------------------
 * BACKUPS
 * ---------------------------------------------------------------------------
 * The fs version relied on two safety nets: `${file}.bak` on the promote
 * path, and git, which tracked all six JSON files. Firestore has neither.
 * Every write here therefore stores the PREVIOUS bytes at
 * nerd_documents/{key}/backups/latest inside the same transaction -- a
 * strict superset of the old .bak behavior, uniform across all documents
 * rather than promote-only, and the direct replacement for what git was
 * doing. It is one extra document write on a workload of a handful of
 * saves per day. It is a single-step undo, not history; see the design doc
 * for the bounded-revision-log option that was considered and deferred.
 *
 * ---------------------------------------------------------------------------
 * NO FILESYSTEM FALLBACK
 * ---------------------------------------------------------------------------
 * There is deliberately no "if local, use fs" branch. A dual-path
 * persistence layer selected by an environment variable is the exact shape
 * of the 2026-07-08 LOCAL_MODE incident (DECISION_LOG #27), and it is the
 * opposite of DRY. Local development runs against the Firestore emulator,
 * seeded by scripts/nerd_documents.py -- the same script that performs the
 * production migration, so the migration path is exercised on every local
 * setup instead of being run once, in anger, against real data.
 */

import "server-only";
import { createHash } from "node:crypto";
import { FieldValue, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import { db } from "./firebase-admin";
import { reconcileTrackingRows, type TrackingRecord } from "../tracking";

// --- Keys -----------------------------------------------------------------

/** The four documents guarded by the ETag / If-Match concurrency contract.
 *  Unchanged from lib/local-write.ts's DataKind -- same literals, same
 *  closed union, same reason: no caller ever supplies a document name, so
 *  there is no path-traversal-equivalent input to sanitize. */
export type DataKind = "published" | "added" | "candidate" | "vendors";

/** Live-scrape snapshots. Written only by the scrape (Phase 5), read by
 *  /records, consumed and cleared by the promote. No client write path, so
 *  no ETag guard. */
export type LiveKind = "published-live" | "added-live" | "vendors-live";

/** Side documents outside the ETag system, matching the fs version's
 *  treatment of tracking.json and passwords.json: single-operator,
 *  read-modify-write, no concurrency guarantee needed or claimed. */
export type AuxKind = "tracking" | "passwords";

export type DocumentKey = DataKind | LiveKind | AuxKind;

const DATA_KINDS: readonly DataKind[] = ["published", "added", "candidate", "vendors"];

/** `kind`'s live-scrape counterpart, or null where none exists.
 *  "candidate" has no live snapshot -- nothing scrapes it -- which is why
 *  the promote route rejects it. Mirrors liveSnapshotPath() in the fs
 *  version. */
export function liveKeyFor(kind: DataKind): LiveKind | null {
  switch (kind) {
    case "published":
      return "published-live";
    case "added":
      return "added-live";
    case "vendors":
      return "vendors-live";
    default:
      return null;
  }
}

export function isDataKind(value: unknown): value is DataKind {
  return typeof value === "string" && (DATA_KINDS as readonly string[]).includes(value);
}

// --- Constants ------------------------------------------------------------

const COLLECTION = "nerd_documents";
const BACKUPS = "backups";
const BACKUP_DOC = "latest";

/**
 * Refuses a write that would approach Firestore's 1,048,487-byte
 * un-indexed field-value ceiling. Set well below it so the failure is this
 * clear message at the application boundary rather than an opaque
 * INVALID_ARGUMENT from the client library halfway through a transaction.
 * Current largest document is ~128 KB.
 */
export const MAX_DOCUMENT_BYTES = 900_000;

// --- Errors ---------------------------------------------------------------

export class DocumentNotFoundError extends Error {
  constructor(public readonly key: DocumentKey) {
    super(`No document stored at ${COLLECTION}/${key}.`);
    this.name = "DocumentNotFoundError";
  }
}

export class DocumentTooLargeError extends Error {
  constructor(public readonly key: DocumentKey, public readonly size: number) {
    super(
      `Refusing to write ${size} bytes to ${COLLECTION}/${key}: exceeds the ` +
        `${MAX_DOCUMENT_BYTES}-byte application limit.`
    );
    this.name = "DocumentTooLargeError";
  }
}

// --- ETag -----------------------------------------------------------------

/**
 * SHA-256 over the UTF-8 encoding of `bytes`, hex-encoded.
 *
 * Identical by construction to what lib/local-write.ts computed over the
 * Buffer read from disk, so a document migrated by
 * scripts/nerd_documents.py carries the SAME ETag it had as a file. That is
 * not cosmetic: it means the migration can be verified by comparing hashes
 * rather than by trusting that the copy worked, and it means a client
 * holding a pre-migration ETag is not spuriously 412'd.
 */
export function etagOf(bytes: string): string {
  return createHash("sha256").update(Buffer.from(bytes, "utf8")).digest("hex");
}

// --- Reads ----------------------------------------------------------------

export interface RawDocument {
  data: string;
  etag: string;
}

/** Reads `key` and returns its raw bytes plus stored ETag, or null when the
 *  document does not exist. Null rather than a throw because "not there
 *  yet" is the normal state for every LiveKind -- the callers that treat
 *  absence as an error use readRaw() below instead. */
export async function tryReadRaw(key: DocumentKey): Promise<RawDocument | null> {
  const snap = await db().collection(COLLECTION).doc(key).get();
  if (!snap.exists) return null;
  return { data: snap.get("bytes") as string, etag: snap.get("etag") as string };
}

/** As tryReadRaw(), but throws DocumentNotFoundError on absence. The direct
 *  replacement for readPublishedRaw(), whose fs.readFile threw ENOENT in
 *  the same situation. */
export async function readRaw(key: DocumentKey): Promise<RawDocument> {
  const found = await tryReadRaw(key);
  if (!found) throw new DocumentNotFoundError(key);
  return found;
}

/** Parsed convenience wrapper. Returns the ETag alongside so a caller that
 *  reads-then-writes never has to re-serialize to recover it. */
export async function readJson<T = Record<string, unknown>>(
  key: DocumentKey
): Promise<{ body: T; etag: string }> {
  const { data, etag } = await readRaw(key);
  return { body: JSON.parse(data) as T, etag };
}

// --- Writes ---------------------------------------------------------------

function assertSize(key: DocumentKey, bytes: string): void {
  const size = Buffer.byteLength(bytes, "utf8");
  if (size > MAX_DOCUMENT_BYTES) throw new DocumentTooLargeError(key, size);
}

/** Stages the current contents of `key` (if any) into its rolling backup,
 *  then stages the new contents. Both writes; caller must already have
 *  performed every transaction read. */
function stageWrite(
  t: Transaction,
  key: DocumentKey,
  previous: { bytes: string; etag: string } | null,
  bytes: string,
  actor: string
): string {
  const ref = db().collection(COLLECTION).doc(key);
  const nextEtag = etagOf(bytes);

  if (previous) {
    t.set(ref.collection(BACKUPS).doc(BACKUP_DOC), {
      bytes: previous.bytes,
      etag: previous.etag,
      backed_up_at: FieldValue.serverTimestamp(),
      replaced_by: actor,
    });
  }

  t.set(ref, {
    bytes,
    etag: nextEtag,
    size_bytes: Buffer.byteLength(bytes, "utf8"),
    updated_at: FieldValue.serverTimestamp(),
    updated_by: actor,
  });

  return nextEtag;
}

function snapshotOf(snap: DocumentSnapshot) {
  return snap.exists
    ? { bytes: snap.get("bytes") as string, etag: snap.get("etag") as string }
    : null;
}

export type GuardedSaveResult =
  | { ok: true; etag: string }
  | { ok: false; currentEtag: string | null };

export interface TrackingWrite {
  /** Every product_name the incoming batch contained -- the set of tracking
   *  rows this write is authoritative for. Rows outside it are untouched. */
  scopeNames: string[];
  /** The rows to persist for names inside `scopeNames`. */
  rows: TrackingRecord[];
}

/**
 * Compare-and-swap save for the four ETag-guarded documents.
 *
 * Replaces the fs version's read / compare / write / re-read sequence with
 * a single transaction. Returns `{ ok: false, currentEtag }` when
 * `ifMatch` does not match what is stored -- the caller turns that into
 * the same 412 it always did.
 *
 * When `tracking` is supplied, tracking's reconcile happens in the SAME
 * transaction: either both documents change or neither does.
 */
export async function saveGuarded(params: {
  key: DataKind;
  ifMatch: string;
  bytes: string;
  actor: string;
  tracking?: TrackingWrite;
}): Promise<GuardedSaveResult> {
  const { key, ifMatch, bytes, actor, tracking } = params;
  assertSize(key, bytes);

  const database = db();
  const ref = database.collection(COLLECTION).doc(key);
  const trackingRef = database.collection(COLLECTION).doc("tracking");

  return database.runTransaction(async (t) => {
    // Firestore requires every read in a transaction to precede every
    // write, so both reads happen up front regardless of whether the
    // guard is going to pass.
    const [snap, trackingSnap] = await Promise.all([
      t.get(ref),
      tracking ? t.get(trackingRef) : Promise.resolve(null),
    ]);

    const current = snapshotOf(snap);
    if ((current?.etag ?? null) !== ifMatch) {
      return { ok: false as const, currentEtag: current?.etag ?? null };
    }

    const etag = stageWrite(t, key, current, bytes, actor);

    if (tracking) {
      const previousTracking = trackingSnap && trackingSnap.exists ? snapshotOf(trackingSnap) : null;
      const nextTracking = serializeTracking(
        reconcileTrackingRows(
          previousTracking ? parseTrackingRows(previousTracking.bytes) : [],
          tracking.scopeNames,
          tracking.rows
        )
      );
      assertSize("tracking", nextTracking);
      stageWrite(t, "tracking", previousTracking, nextTracking, actor);
    }

    return { ok: true as const, etag };
  });
}

/**
 * Unconditional write, for documents outside the ETag system: the aux
 * documents (tracking, passwords) and the live-scrape snapshots. Still
 * takes a backup, still transactional -- the read is only there to capture
 * the previous bytes for that backup, not to guard anything.
 */
export async function saveUnguarded(params: {
  key: DocumentKey;
  bytes: string;
  actor: string;
}): Promise<{ etag: string }> {
  const { key, bytes, actor } = params;
  assertSize(key, bytes);

  const database = db();
  const ref = database.collection(COLLECTION).doc(key);

  return database.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const etag = stageWrite(t, key, snapshotOf(snap), bytes, actor);
    return { etag };
  });
}

/**
 * Replaces `storedKey` with `bytes` and deletes `liveKey`, atomically --
 * the promote path (/records' "Update Stored Data"). The fs version was
 * backupThenWrite() followed by backupThenDelete(), two independent
 * operations with a window between them where a crash left the live
 * snapshot consumed but the stored document unchanged, or vice versa.
 *
 * The MERGE itself is not done here. It is domain logic about record
 * identity (matching on ncademi_product_url / vendor_directory_url) and it
 * stays in the route handler where it already lives; this function takes
 * the already-merged bytes. Keeping the datastore free of record-shape
 * knowledge is the same boundary lib/local-write.ts held.
 */
export async function promoteLive(params: {
  storedKey: DataKind;
  liveKey: LiveKind;
  bytes: string;
  actor: string;
}): Promise<{ etag: string }> {
  const { storedKey, liveKey, bytes, actor } = params;
  assertSize(storedKey, bytes);

  const database = db();
  const storedRef = database.collection(COLLECTION).doc(storedKey);
  const liveRef = database.collection(COLLECTION).doc(liveKey);

  return database.runTransaction(async (t) => {
    const [storedSnap, liveSnap] = await Promise.all([t.get(storedRef), t.get(liveRef)]);

    const etag = stageWrite(t, storedKey, snapshotOf(storedSnap), bytes, actor);

    // The live snapshot's own rolling backup is refreshed before deletion,
    // matching backupThenDelete() -- a promote that turns out to have
    // merged wrongly can still be diagnosed against what was consumed.
    const liveCurrent = snapshotOf(liveSnap);
    if (liveCurrent) {
      t.set(liveRef.collection(BACKUPS).doc(BACKUP_DOC), {
        bytes: liveCurrent.bytes,
        etag: liveCurrent.etag,
        backed_up_at: FieldValue.serverTimestamp(),
        replaced_by: actor,
      });
    }
    t.delete(liveRef);

    return { etag };
  });
}

/** Deletes `key`, refreshing its rolling backup first. Only the live
 *  snapshots are ever deleted in normal operation; exposed generally
 *  because the promote is not the only caller that may need it. */
export async function deleteDocument(key: DocumentKey, actor: string): Promise<void> {
  const database = db();
  const ref = database.collection(COLLECTION).doc(key);

  await database.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const current = snapshotOf(snap);
    if (!current) return;
    t.set(ref.collection(BACKUPS).doc(BACKUP_DOC), {
      bytes: current.bytes,
      etag: current.etag,
      backed_up_at: FieldValue.serverTimestamp(),
      replaced_by: actor,
    });
    t.delete(ref);
  });
}

// --- tracking -------------------------------------------------------------

interface TrackingFile {
  $schema_version: number;
  $meta: Record<string, unknown>;
  tracking: TrackingRecord[];
}

const TRACKING_META = {
  purpose:
    "Editor-set workflow metadata (priority/status/gatherer/reviewer) for products and vendors, " +
    "keyed by product_name. Decoupled from published/added/candidate/vendors so a live-data " +
    "refresh of those documents never disturbs it -- see lib/tracking.ts.",
};

function coerceTrackingRow(value: unknown): TrackingRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.product_name !== "string" || row.product_name === "") return null;
  const str = (k: string) =>
    typeof row[k] === "string" && row[k] !== "" ? (row[k] as string) : null;
  return {
    product_name: row.product_name,
    tracking_priority: str("tracking_priority"),
    tracking_status: str("tracking_status"),
    tracking_gatherer: str("tracking_gatherer"),
    tracking_reviewer: str("tracking_reviewer"),
  };
}

function parseTrackingRows(bytes: string): TrackingRecord[] {
  const body = JSON.parse(bytes) as Partial<TrackingFile>;
  const rows = Array.isArray(body.tracking) ? body.tracking : [];
  return rows.map(coerceTrackingRow).filter((r): r is TrackingRecord => r !== null);
}

function serializeTracking(rows: TrackingRecord[]): string {
  const payload: TrackingFile = { $schema_version: 1, $meta: TRACKING_META, tracking: rows };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/** Every tracking row. Returns [] when the document does not exist yet --
 *  callers merge against an empty list without a separate code path,
 *  exactly as readTrackingRecords() did. */
export async function readTrackingRecords(): Promise<TrackingRecord[]> {
  const found = await tryReadRaw("tracking");
  if (!found) return [];
  return parseTrackingRows(found.data);
}

/** Standalone tracking write, for the one caller that changes tracking
 *  without touching a guarded document. Saves that DO touch one must pass
 *  `tracking` to saveGuarded() instead, so both land in one transaction. */
export async function writeTrackingRecords(
  scopeNames: string[],
  rows: TrackingRecord[],
  actor: string
): Promise<void> {
  const existing = await readTrackingRecords();
  const bytes = serializeTracking(reconcileTrackingRows(existing, scopeNames, rows));
  await saveUnguarded({ key: "tracking", bytes, actor });
}
