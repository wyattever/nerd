// frontend/lib/server/candidate-import.ts
/**
 * Every decision bulk Candidate import makes, as pure functions: request
 * parsing, version tokens, per-record validation and duplicate checks, the
 * preview, and the candidate, tracking and passwords writes of an apply.
 *
 * decideCandidateImport is meant to run inside transactDocuments' `decide`,
 * which Firestore may invoke more than once per call. Everything here must
 * therefore stay pure: no Firestore call, no I/O, no clock (the caller
 * passes `now`), no randomness, and no mutation of any input.
 */

import "server-only";
import {
  applyBoilerplateDefaults,
  nameKey,
  normalizeSlug,
  normalizeUrlForMatch,
  parsePaste,
} from "../candidate-import";
import { getOrCreatePassword } from "../passwords";
import { validateProductRecord } from "../published-validate";
import { reconcileTrackingRows, stripTrackingFields, type TrackingRecord } from "../tracking";
import { parseTrackingRows, serializeTracking, type AuxKind, type DataKind, type TransactionDocs } from "./documents";
import { parsePasswordsFile, serializePasswordsFile } from "./passwords-store";
import { ABSENT_TOKEN } from "./promote-mirror";

// --- Constants ------------------------------------------------------------

/** The five documents read by an import, in the order they are read. */
export const IMPORT_KEYS = ["candidate", "tracking", "passwords", "added", "published"] as const;

export type ImportKey = (typeof IMPORT_KEYS)[number];

const MODE_ERROR = '"mode" must be "preview" or "apply".';
const TEXT_ERROR = '"text" must be a string.';
const SELECTED_ERROR = '"selected" must be a non-empty array of distinct strings.';
const TOKENS_ERROR = `"tokens" must be an object with exactly these keys, each a string: ${IMPORT_KEYS.join(", ")}.`;
const CANDIDATE_MISSING_ERROR = "The candidate document is missing.";
const CONFLICT_NOTICE = "The stored data changed after this check. Review the updated results and import again.";
const SLUG_MISSING_ISSUE = "Slug is missing or has no letters or digits.";

/** The stored documents a pasted record is checked against, in check order. */
const STORED_SOURCES = [
  { key: "candidate", label: "Candidates" },
  { key: "added", label: "Added" },
  { key: "published", label: "Published" },
] as const;

// --- Request --------------------------------------------------------------

export type CandidateImportRequest =
  | { mode: "preview"; text: string }
  | { mode: "apply"; text: string; selected: string[]; tokens: Record<string, string> };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validates a request body. In preview, `selected` and `tokens` are ignored. */
export function parseCandidateImportRequest(
  body: unknown
): { ok: true; request: CandidateImportRequest } | { ok: false; error: string } {
  const fields = isPlainObject(body) ? body : {};

  const text = fields.text;
  if (typeof text !== "string") return { ok: false, error: TEXT_ERROR };

  const mode = fields.mode;
  if (mode !== "preview" && mode !== "apply") return { ok: false, error: MODE_ERROR };

  if (mode === "preview") return { ok: true, request: { mode, text } };

  const selected = fields.selected;
  if (
    !Array.isArray(selected) ||
    selected.length === 0 ||
    !selected.every((s): s is string => typeof s === "string") ||
    new Set(selected).size !== selected.length
  ) {
    return { ok: false, error: SELECTED_ERROR };
  }

  const raw = fields.tokens;
  if (!isPlainObject(raw)) return { ok: false, error: TOKENS_ERROR };
  const rawKeys = Object.keys(raw);
  if (rawKeys.length !== IMPORT_KEYS.length || !IMPORT_KEYS.every((key) => rawKeys.includes(key))) {
    return { ok: false, error: TOKENS_ERROR };
  }
  const tokens: Record<string, string> = {};
  for (const key of IMPORT_KEYS) {
    const value = raw[key];
    if (typeof value !== "string") return { ok: false, error: TOKENS_ERROR };
    tokens[key] = value;
  }
  return { ok: true, request: { mode, text, selected: [...selected], tokens } };
}

// --- Response bodies --------------------------------------------------------

export type ImportRecordStatus = "ready" | "warning" | "blocked";

export interface CandidateImportPreviewBody {
  mode: "preview";
  tokens: Record<string, string>;
  summary: { total: number; ready: number; warning: number; blocked: number };
  records: Array<{
    index: number;
    slug: string | null;
    product_name: string | null;
    status: ImportRecordStatus;
    issues: string[];
  }>;
}

export interface CandidateImportAppliedBody {
  mode: "apply";
  imported: Array<{ slug: string; product_name: string }>;
  passwordsCreated: number;
}

export interface CandidateImportConflictBody {
  conflict: true;
  notice: string;
  preview: CandidateImportPreviewBody;
}

export interface CandidateImportErrorBody {
  error: string;
}

export type CandidateImportResponseBody =
  | CandidateImportPreviewBody
  | CandidateImportAppliedBody
  | CandidateImportConflictBody
  | CandidateImportErrorBody;

export interface CandidateImportDecision {
  writes: Array<{ key: DataKind | AuxKind; bytes: string }>;
  status: number;
  body: CandidateImportResponseBody;
}

// --- Decision ---------------------------------------------------------------

function respond(status: number, body: CandidateImportResponseBody): CandidateImportDecision {
  return { writes: [], status, body };
}

/** The values a record is matched on for exact duplicates and near names. */
interface MatchKeys {
  slug: string | null;
  name: string | null;
  website: string | null;
}

function matchKeysOf(record: Record<string, unknown>): MatchKeys {
  return {
    slug: typeof record.slug === "string" && record.slug !== "" ? record.slug : null,
    name: typeof record.product_name === "string" && record.product_name !== "" ? record.product_name : null,
    website: normalizeUrlForMatch(record.product_website_url),
  };
}

/** The first of slug, name, website that both sides share, or null. */
function sameBy(a: MatchKeys, b: MatchKeys): "slug" | "name" | "website" | null {
  if (a.slug !== null && a.slug === b.slug) return "slug";
  if (a.name !== null && a.name === b.name) return "name";
  if (a.website !== null && a.website === b.website) return "website";
  return null;
}

/** Both name keys are at least 4 characters and one contains the other. */
function resembles(a: string, b: string): boolean {
  const ka = nameKey(a);
  const kb = nameKey(b);
  return ka.length >= 4 && kb.length >= 4 && (ka.includes(kb) || kb.includes(ka));
}

/**
 * The parsed body and records array of a stored document; an empty body for
 * an absent one. A present document that is not a JSON object with a
 * "products" array is a data fault, not an import outcome: throw, so the
 * transaction aborts with nothing written.
 */
function storedProducts(
  docs: TransactionDocs,
  key: "candidate" | "added" | "published"
): { body: Record<string, unknown>; products: unknown[] } {
  const doc = docs.get(key);
  if (!doc) return { body: {}, products: [] };
  const value: unknown = JSON.parse(doc.bytes);
  if (!isPlainObject(value) || !Array.isArray(value.products)) {
    throw new Error(`decideCandidateImport: the "${key}" document has no "products" array.`);
  }
  return { body: value, products: value.products };
}

interface Evaluated {
  index: number;
  /** The normalized record; null for a paste error entry. */
  record: Record<string, unknown> | null;
  slug: string | null;
  productName: string | null;
  status: ImportRecordStatus;
  issues: string[];
}

function productNameOf(value: unknown): string {
  return isPlainObject(value) && typeof value.product_name === "string" ? value.product_name : "";
}

/**
 * Turns a paste plus the five stored documents into a preview, or into the
 * writes for an apply. Preview and every non-200 decision write nothing.
 */
export function decideCandidateImport(
  request: CandidateImportRequest,
  docs: TransactionDocs,
  now: Date
): CandidateImportDecision {
  // 1. Tokens: each document's etag, or "absent".
  const tokens: Record<string, string> = {};
  for (const key of IMPORT_KEYS) {
    const doc = docs.get(key);
    if (doc === undefined) {
      throw new Error(`decideCandidateImport: document "${key}" was not read.`);
    }
    tokens[key] = doc === null ? ABSENT_TOKEN : doc.etag;
  }

  // 2. The candidate document must exist; the others count as empty when absent.
  if (docs.get("candidate") === null) {
    return respond(500, { error: CANDIDATE_MISSING_ERROR });
  }

  // 3. Split the paste.
  const parsed = parsePaste(request.text);
  if (!parsed.ok) return respond(400, { error: parsed.error });

  // 4. Evaluate each entry, in paste order.
  const candidateDoc = storedProducts(docs, "candidate");
  const stored = STORED_SOURCES.map(({ key, label }) => ({
    label,
    records: (key === "candidate" ? candidateDoc : storedProducts(docs, key)).products
      .filter(isPlainObject)
      .map((record) => ({ keys: matchKeysOf(record), record })),
  }));

  const evaluated: Evaluated[] = [];
  for (const entry of parsed.entries) {
    if (entry.record === null) {
      evaluated.push({
        index: entry.index,
        record: null,
        slug: null,
        productName: null,
        status: "blocked",
        issues: [entry.error ?? "not a product record"],
      });
      continue;
    }

    const issues: string[] = [];
    let blocked = false;
    let warned = false;
    const block = (issue: string): void => {
      issues.push(issue);
      blocked = true;
    };
    const warn = (issue: string): void => {
      issues.push(issue);
      warned = true;
    };

    const record = stripTrackingFields({ ...entry.record });
    if (typeof record.slug === "string") {
      const original = record.slug;
      const normalized = normalizeSlug(original);
      if (normalized !== original) warn(`Slug changed from "${original}" to "${normalized}".`);
      record.slug = normalized;
    }
    if (typeof record.slug !== "string" || record.slug === "") block(SLUG_MISSING_ISSUE);

    applyBoilerplateDefaults(record, now);

    for (const issue of validateProductRecord(record)) {
      const text = `${issue.path}: ${issue.message}`;
      if (issue.severity === "error") block(text);
      else warn(text);
    }

    const keys = matchKeysOf(record);
    let exactDuplicate = false;

    for (const source of stored) {
      for (const other of source.records) {
        const by = sameBy(keys, other.keys);
        if (by === null) continue;
        exactDuplicate = true;
        block(`Already in ${source.label} as "${productNameOf(other.record)}" (same ${by}).`);
      }
    }

    const earlier = evaluated.filter((e) => e.record !== null);
    for (const other of earlier) {
      const by = sameBy(keys, matchKeysOf(other.record as Record<string, unknown>));
      if (by === null) continue;
      exactDuplicate = true;
      block(`Same product as record ${other.index} (same ${by}).`);
    }

    if (!exactDuplicate && keys.name !== null) {
      const name = keys.name;
      for (const source of stored) {
        for (const other of source.records) {
          if (other.keys.name !== null && resembles(name, other.keys.name)) {
            warn(`Name resembles "${other.keys.name}" in ${source.label}.`);
          }
        }
      }
      for (const other of earlier) {
        if (other.productName !== null && resembles(name, other.productName)) {
          warn(`Name resembles "${other.productName}" in this paste.`);
        }
      }
    }

    evaluated.push({
      index: entry.index,
      record,
      slug: typeof record.slug === "string" ? record.slug : null,
      productName: typeof record.product_name === "string" ? record.product_name : null,
      status: blocked ? "blocked" : warned ? "warning" : "ready",
      issues,
    });
  }

  const preview: CandidateImportPreviewBody = {
    mode: "preview",
    tokens,
    summary: {
      total: evaluated.length,
      ready: evaluated.filter((e) => e.status === "ready").length,
      warning: evaluated.filter((e) => e.status === "warning").length,
      blocked: evaluated.filter((e) => e.status === "blocked").length,
    },
    records: evaluated.map((e) => ({
      index: e.index,
      slug: e.slug,
      product_name: e.productName,
      status: e.status,
      issues: e.issues,
    })),
  };

  // 5. Preview writes nothing.
  if (request.mode === "preview") return respond(200, preview);

  // 6. Apply: any token that differs is a conflict.
  const requestTokens = request.tokens;
  if (IMPORT_KEYS.some((key) => requestTokens[key] !== tokens[key])) {
    return respond(409, { conflict: true, notice: CONFLICT_NOTICE, preview });
  }

  // 7. Apply: every selected slug names exactly one importable record.
  const importable = evaluated.filter((e) => e.status !== "blocked");
  const rejected = request.selected.filter(
    (slug) => importable.filter((e) => e.slug === slug).length !== 1
  );
  if (rejected.length > 0) {
    return respond(400, { error: `These records cannot be imported: ${rejected.join(", ")}.` });
  }

  // 8. Apply: the writes, taking the selected records in paste order.
  const selectedSet = new Set(request.selected);
  const chosen = importable.filter((e) => e.slug !== null && selectedSet.has(e.slug));
  const chosenRecords = chosen.map((e) => e.record as Record<string, unknown>);
  const chosenNames = chosen.map((e) => e.productName as string);

  const products = [...candidateDoc.products, ...chosenRecords].sort((a, b) =>
    productNameOf(a).localeCompare(productNameOf(b))
  );
  const writes: CandidateImportDecision["writes"] = [
    {
      key: "candidate",
      bytes: `${JSON.stringify({ ...candidateDoc.body, products }, null, 2)}\n`,
    },
  ];

  const trackingDoc = docs.get("tracking") ?? null;
  const existingTracking = trackingDoc ? parseTrackingRows(trackingDoc.bytes) : [];
  const newRows: TrackingRecord[] = chosenNames.map((name) => ({
    product_name: name,
    tracking_priority: null,
    tracking_status: "Gathering",
    tracking_gatherer: null,
    tracking_reviewer: null,
  }));
  writes.push({
    key: "tracking",
    bytes: serializeTracking(reconcileTrackingRows(existingTracking, chosenNames, newRows)),
  });

  const passwordsDoc = docs.get("passwords") ?? null;
  const passwordsFile = parsePasswordsFile(passwordsDoc ? passwordsDoc.bytes : null);
  let passwordRows = passwordsFile.passwords;
  let passwordsCreated = 0;
  for (const record of chosenRecords) {
    const vendorName = typeof record.vendor_name === "string" ? record.vendor_name : null;
    const result = getOrCreatePassword(passwordRows, record.product_name as string, vendorName, now);
    passwordRows = result.records;
    if (result.created) passwordsCreated += 1;
  }
  if (passwordsCreated > 0) {
    writes.push({
      key: "passwords",
      bytes: serializePasswordsFile({ ...passwordsFile, passwords: passwordRows }),
    });
  }

  return {
    writes,
    status: 200,
    body: {
      mode: "apply",
      imported: chosen.map((e) => ({ slug: e.slug as string, product_name: e.productName as string })),
      passwordsCreated,
    },
  };
}
