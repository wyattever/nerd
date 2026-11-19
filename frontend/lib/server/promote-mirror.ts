// frontend/lib/server/promote-mirror.ts
/**
 * Every decision the mirror promote route (POST /api/local/promote-live)
 * makes, as pure functions: request parsing, the seven document keys, live
 * reshaping, the planner input, version tokens and conflicts, the stored
 * envelope, password and tracking row deletions, and the response bodies.
 * The contract is docs/mirror-promote-plan-11-02-26.md §3.13; the rulings
 * behind it are §3.12 (D30–D35, D40, D41).
 *
 * decidePromote runs inside transactDocuments' `decide` (D31), which
 * Firestore may invoke more than once per call. Everything here must
 * therefore stay pure: no Firestore call, no I/O, no clock, no randomness,
 * and no mutation of any input. The route handler stays thin (D41).
 */

import "server-only";
import { reconcileTrackingRows } from "../tracking";
import { planPromote, type Category, type PlanReport, type RunRecord, type StoredRecord } from "../mirror-planner";
import { deriveLiveProductSlug, deriveLiveVendorSlug } from "../live-slug";
import { parsePasswordsFile, serializePasswordsFile } from "./passwords-store";
import {
  parseTrackingRows,
  serializeTracking,
  type AuxKind,
  type DataKind,
  type DocumentKey,
  type LiveKind,
  type TransactionDocs,
} from "./documents";

// --- Constants ------------------------------------------------------------

/** The token of a document that does not exist (D32). */
export const ABSENT_TOKEN = "absent";

/** "candidate" has no live snapshot -- nothing scrapes it -- so it cannot be promoted. */
export const PROMOTABLE = ["published", "added", "vendors"] as const;

/**
 * A product record's non-array fields that lib/published-validate.ts requires
 * to be PRESENT (as a string or null). A stored record missing any of them is
 * a blocking error the next time it is saved from /editor.
 * scrape_ncademi_live.py's parse_public_product() emits all of these EXCEPT
 * ai_insights (no page equivalent), so the promote backfills the gap. A live
 * value, when present, always wins via spread order.
 */
export const PRODUCT_FIELD_DEFAULTS: Record<string, null | []> = {
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

const STORED_KEYS: readonly DataKind[] = ["published", "added", "candidate", "vendors"];

const LIVE_KEYS: Record<Category, LiveKind> = {
  published: "published-live",
  added: "added-live",
  vendors: "vendors-live",
};

const CATEGORY_ERROR = '"category" must be one of "published", "added", "vendors".';
const MODE_ERROR = '"mode" must be "preview" or "apply".';
const NO_LIVE_DATA_ERROR = 'No live data to promote. Run "Retrieve Live Data" first.';
const CONFLICT_ERROR =
  "The stored data changed after the preview. Review the updated preview and confirm again.";
const GENERATED_FROM = 'mirror promote via /records ("Update Stored Data")';

// --- Request --------------------------------------------------------------

export type PromoteMode = "preview" | "apply";

export interface PromoteRequest {
  category: Category;
  mode: PromoteMode;
  /** The seven tokens, in the fixed key order; null in preview. */
  tokens: Readonly<Record<string, string>> | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPromotable(value: unknown): value is Category {
  return typeof value === "string" && (PROMOTABLE as readonly string[]).includes(value);
}

/** The seven documents in the §3.13 fixed order: the category's stored
 *  document, the other three stored documents, the live snapshot,
 *  passwords, tracking. Also the order of `tokens` and `changed`. */
export function promoteDocumentKeys(category: Category): DocumentKey[] {
  return [
    category,
    ...STORED_KEYS.filter((key) => key !== category),
    LIVE_KEYS[category],
    "passwords",
    "tracking",
  ];
}

/** Validates a request body per §3.13 "Request". In preview, `tokens` is ignored. */
export function parsePromoteRequest(
  body: unknown
): { ok: true; request: PromoteRequest } | { ok: false; error: string } {
  const fields = isPlainObject(body) ? body : {};

  const category = fields.category;
  if (!isPromotable(category)) return { ok: false, error: CATEGORY_ERROR };

  const mode = fields.mode;
  if (mode !== "preview" && mode !== "apply") return { ok: false, error: MODE_ERROR };

  if (mode === "preview") return { ok: true, request: { category, mode, tokens: null } };

  const expected = promoteDocumentKeys(category);
  const tokensError = `"tokens" must be an object with exactly these keys, each a non-empty string: ${expected.join(", ")}.`;
  const raw = fields.tokens;
  if (!isPlainObject(raw)) return { ok: false, error: tokensError };
  const rawKeys = Object.keys(raw);
  if (rawKeys.length !== expected.length || !expected.every((key) => rawKeys.includes(key))) {
    return { ok: false, error: tokensError };
  }
  const tokens: Record<string, string> = {};
  for (const key of expected) {
    const value = raw[key];
    if (typeof value !== "string" || value === "") return { ok: false, error: tokensError };
    tokens[key] = value;
  }
  return { ok: true, request: { category, mode, tokens } };
}

// --- Live reshaping (D33) ---------------------------------------------------

/** Re-shapes live records to the stored schema: product defaults (a live
 *  value wins) and the derived slug, then drops the scraper-only
 *  `is_protected`. Returns copies; the input records are never mutated. */
export function reshapeLiveRecords(
  category: Category,
  records: ReadonlyArray<Record<string, unknown>>
): Record<string, unknown>[] {
  return records.map((record) => {
    const copy: Record<string, unknown> =
      category === "vendors"
        ? { ...record, slug: deriveLiveVendorSlug(record.vendor_directory_url as string) }
        : {
            ...PRODUCT_FIELD_DEFAULTS,
            ...record,
            slug: deriveLiveProductSlug(record.ncademi_product_url as string),
          };
    delete copy.is_protected;
    return copy;
  });
}

// --- Response bodies (§3.13) --------------------------------------------------

export interface PromotePlanBody {
  outcome: "preview" | "applied";
  category: Category;
  runId: string;
  runFinishedAt: string;
  tokens: Record<string, string>;
  deletionsAllowed: boolean;
  deletionsBlockedReason: string | null;
  report: PlanReport;
  passwordNamesToDelete: string[];
  trackingNamesToDelete: string[];
  counts: {
    storedBefore: number;
    storedAfter: number;
    updated: number;
    appended: number;
    removed: number;
    needsCorrectPassword: number;
    needsPassword: number;
    couldNotCheck: number;
    untrackedProtected: number;
    unscrapedProtectedVendors: number;
    passwordRowsToDelete: number;
    trackingRowsToDelete: number;
  };
  /** `applied` only. */
  written?: { stored: true; passwords: boolean; tracking: boolean; liveDeleted: true };
}

export interface PromoteRefusedBody {
  outcome: "refused";
  category: Category;
  error: string;
  runId: string | null;
  runFinishedAt: string | null;
  tokens: Record<string, string>;
}

export interface PromoteErrorBody {
  error: string;
}

export interface PromoteConflictBody {
  outcome: "conflict";
  category: Category;
  error: string;
  changed: DocumentKey[];
  /** Exactly what a preview of the same category gives from the same documents. */
  fresh: { status: number; body: PromotePlanBody | PromoteRefusedBody | PromoteErrorBody };
}

export type PromoteResponseBody =
  | PromotePlanBody
  | PromoteRefusedBody
  | PromoteConflictBody
  | PromoteErrorBody;

export interface PromoteDecision {
  writes: Array<{ key: DataKind | AuxKind; bytes: string }>;
  deletes: LiveKind[];
  status: number;
  body: PromoteResponseBody;
}

// --- Decision ---------------------------------------------------------------

function respond(status: number, body: PromoteResponseBody): PromoteDecision {
  return { writes: [], deletes: [], status, body };
}

function recordsKeyFor(key: DocumentKey): "products" | "vendors" {
  return key === "vendors" || key === "vendors-live" ? "vendors" : "products";
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * §3.13 "Processing", steps 1–9, in order, over the seven documents read by
 * transactDocuments. Preview and every non-200 decision write nothing.
 */
export function decidePromote(request: PromoteRequest, docs: TransactionDocs): PromoteDecision {
  const { category, mode } = request;
  const keys = promoteDocumentKeys(category);
  const storedKeys = keys.slice(0, 4);
  const liveKey = LIVE_KEYS[category];
  const arrayKey = recordsKeyFor(category);

  // 1. Tokens: each document's etag, or "absent".
  const tokens: Record<string, string> = {};
  for (const key of keys) {
    const doc = docs.get(key);
    if (doc === undefined) {
      throw new Error(`decidePromote: document "${key}" was not read.`);
    }
    if (doc === null) {
      tokens[key] = ABSENT_TOKEN;
      continue;
    }
    if (typeof doc.etag !== "string") {
      return respond(500, { error: `The "${key}" document has no etag.` });
    }
    tokens[key] = doc.etag;
  }

  // 2. Apply only: any token that differs is a conflict (D32).
  if (mode === "apply") {
    const requestTokens = request.tokens;
    if (requestTokens === null) {
      throw new Error("decidePromote: apply requires tokens.");
    }
    const changed = keys.filter((key) => requestTokens[key] !== tokens[key]);
    if (changed.length > 0) {
      const fresh = decidePromote({ category, mode: "preview", tokens: null }, docs);
      // A preview never returns a conflict, so this narrowing always holds.
      const freshBody = fresh.body as PromotePlanBody | PromoteRefusedBody | PromoteErrorBody;
      return respond(409, {
        outcome: "conflict",
        category,
        error: CONFLICT_ERROR,
        changed,
        fresh: { status: fresh.status, body: freshBody },
      });
    }
  }

  // 3. Live snapshot absent.
  if (docs.get(liveKey) === null) {
    return respond(409, { error: NO_LIVE_DATA_ERROR });
  }

  // 4. A stored document absent.
  for (const key of storedKeys) {
    if (docs.get(key) === null) {
      return respond(503, { error: `The stored "${key}" document does not exist.` });
    }
  }

  // 5. A present document that is not valid JSON; for the four stored
  //    documents and the live snapshot, also one that is not a JSON object
  //    or has no records array. passwords and tracking keep their own parse
  //    functions' behaviour.
  const bodies = new Map<DocumentKey, Record<string, unknown>>();
  for (const key of keys) {
    const doc = docs.get(key);
    if (!doc) continue;
    let value: unknown;
    try {
      value = JSON.parse(doc.bytes);
    } catch {
      return respond(500, { error: `The "${key}" document is not valid JSON.` });
    }
    if (key === "passwords" || key === "tracking") continue;
    if (!isPlainObject(value)) {
      return respond(500, { error: `The "${key}" document is not a JSON object.` });
    }
    const recordsKey = recordsKeyFor(key);
    if (!Array.isArray(value[recordsKey])) {
      return respond(500, { error: `The "${key}" document has no "${recordsKey}" array.` });
    }
    bodies.set(key, value);
  }

  // 6. Plan.
  const storedBody = bodies.get(category) as Record<string, unknown>;
  const storedRecords = storedBody[arrayKey] as unknown[];

  const namesInOtherCategories: string[] = [];
  for (const key of storedKeys.slice(1)) {
    const records = (bodies.get(key) as Record<string, unknown>)[recordsKeyFor(key)] as unknown[];
    for (const record of records) {
      if (isPlainObject(record) && typeof record.product_name === "string") {
        namesInOtherCategories.push(record.product_name);
      }
    }
  }

  const liveBody = bodies.get(liveKey) as Record<string, unknown>;
  const liveRecords = liveBody[arrayKey] as Array<Record<string, unknown>>;
  const liveMeta = isPlainObject(liveBody.$meta) ? liveBody.$meta : {};
  const run: unknown = liveMeta.run;

  const passwordsDoc = docs.get("passwords") ?? null;
  const passwordsFile = parsePasswordsFile(passwordsDoc ? passwordsDoc.bytes : null);
  const trackingDoc = docs.get("tracking") ?? null;
  const trackingRows = trackingDoc ? parseTrackingRows(trackingDoc.bytes) : [];

  const result = planPromote({
    category,
    stored: storedRecords as StoredRecord[],
    live: reshapeLiveRecords(category, liveRecords) as unknown as StoredRecord[],
    run: run as RunRecord,
    namesInOtherCategories,
    passwords: passwordsFile.passwords,
    tracking: trackingRows,
  });

  const runId = isPlainObject(run) && typeof run.run_id === "string" ? run.run_id : null;
  const runFinishedAt = isPlainObject(run) ? nonEmptyString(run.finished_at) : null;

  if (!result.ok) {
    return respond(409, {
      outcome: "refused",
      category,
      error: result.error,
      runId,
      runFinishedAt,
      tokens,
    });
  }

  // 7. The run record must say when the snapshot was taken.
  if (runFinishedAt === null) {
    return respond(409, {
      outcome: "refused",
      category,
      error: `Run "${String(runId)}" has no finished_at (§3.9); the promote cannot record when the snapshot was taken.`,
      runId,
      runFinishedAt,
      tokens,
    });
  }

  const plan = result.plan;

  // Row changes (D40), computed in preview too for the counts.
  const passwordNames = new Set(plan.passwordNamesToDelete);
  const keptPasswords = passwordsFile.passwords.filter((row) => !passwordNames.has(row.product_name));
  const passwordRowsToDelete = passwordsFile.passwords.length - keptPasswords.length;
  const nextTracking = reconcileTrackingRows(trackingRows, plan.trackingNamesToDelete, []);
  const trackingRowsToDelete = trackingRows.length - nextTracking.length;

  const report = plan.report;
  const body: PromotePlanBody = {
    outcome: mode === "apply" ? "applied" : "preview",
    category,
    runId: plan.runId,
    runFinishedAt,
    tokens,
    deletionsAllowed: plan.deletionsAllowed,
    deletionsBlockedReason: plan.deletionsBlockedReason,
    report,
    passwordNamesToDelete: plan.passwordNamesToDelete,
    trackingNamesToDelete: plan.trackingNamesToDelete,
    counts: {
      storedBefore: storedRecords.length,
      storedAfter: plan.nextStored.length,
      updated: report.updated.length,
      appended: report.appended.length,
      removed: report.removed.length,
      needsCorrectPassword: report.needsCorrectPassword.length,
      needsPassword: report.needsPassword.length,
      couldNotCheck: report.couldNotCheck.length,
      untrackedProtected: report.untrackedProtected.length,
      unscrapedProtectedVendors: report.unscrapedProtectedVendors.length,
      passwordRowsToDelete,
      trackingRowsToDelete,
    },
  };

  // 8. Preview writes nothing.
  if (mode === "preview") return respond(200, body);

  // 9. Apply: the stored envelope (D35), then the row changes (D40).
  const storedMeta = isPlainObject(storedBody.$meta) ? storedBody.$meta : {};
  const totalKey = category === "vendors" ? "total_vendors" : "total_products";
  const nextDoc = {
    $schema_version: typeof storedBody.$schema_version === "number" ? storedBody.$schema_version : 1,
    $meta: {
      ...storedMeta,
      snapshot_taken_at: runFinishedAt,
      [totalKey]: plan.nextStored.length,
      generated_from: GENERATED_FROM,
      run_id: plan.runId,
    },
    [arrayKey]: plan.nextStored,
  };

  const writes: PromoteDecision["writes"] = [
    { key: category, bytes: `${JSON.stringify(nextDoc, null, 2)}\n` },
  ];
  const passwordsWritten = passwordRowsToDelete > 0;
  if (passwordsWritten) {
    writes.push({
      key: "passwords",
      bytes: serializePasswordsFile({ ...passwordsFile, passwords: keptPasswords }),
    });
  }
  const trackingWritten = trackingRowsToDelete > 0;
  if (trackingWritten) {
    writes.push({ key: "tracking", bytes: serializeTracking(nextTracking) });
  }

  return {
    writes,
    deletes: [liveKey],
    status: 200,
    body: {
      ...body,
      written: { stored: true, passwords: passwordsWritten, tracking: trackingWritten, liveDeleted: true },
    },
  };
}
