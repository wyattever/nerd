/**
 * Mirror-promote planner — docs/mirror-promote-plan-11-02-26.md, D2.
 *
 * One pure planning function shared by the Added, Published and Vendors
 * promotes. It implements the case tables of §3.2, §3.3 and §3.4, the
 * discovery gate (D15), the full-run gate (D18), the shared-name rule (D20)
 * and the protected-vendor rule (D22), against the §3.9 run-record format.
 *
 * Purity: no I/O, no clock, no randomness, and no mutation of any input.
 * Only `import type` statements are used so the module runs under Node's
 * type stripping without resolving the imported modules.
 */

import type { PublishedProductRecord } from "./published-tables";
import type { DirectoryRecord } from "./directory-schema";
import type { PasswordRecord } from "./passwords";
import type { TrackingRecord } from "./tracking";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Category = "added" | "published" | "vendors";

export type PostType = "product" | "vendor";

export type OutcomeStatus =
  | "public_ok"
  | "protected_unlocked"
  | "password_rejected"
  | "no_password"
  | "not_tracked"
  | "protected_vendor"
  | "fetch_error"
  | "parse_error";

export interface RunOutcome {
  url: string;
  post_type: PostType;
  status: OutcomeStatus;
  name: string | null;
  detail: string | null;
}

export interface DiscoveryInfo {
  complete: boolean;
  expected_total: number | null;
  discovered: number;
  error: string | null;
}

export interface RunRecord {
  run_id: string;
  started_at: string;
  finished_at: string;
  target: string;
  discovery: { product: DiscoveryInfo; vendor: DiscoveryInfo };
  outcomes: RunOutcome[];
}

/** A stored record: PublishedProductRecord for added/published, DirectoryRecord for vendors. */
export type StoredRecord = PublishedProductRecord | DirectoryRecord;

export interface PlanInput {
  category: Category;
  /** The stored document's records for this category. */
  stored: StoredRecord[];
  /** The snapshot's records, already reshaped to stored shape by the caller. */
  live: StoredRecord[];
  /** The snapshot's `$meta.run`. */
  run: RunRecord;
  /** product_name of every record in the OTHER three of {published, added, candidate, vendors}. */
  namesInOtherCategories: string[];
  passwords: PasswordRecord[];
  tracking: TrackingRecord[];
}

export type RemovalReason = "not on site" | "now public" | "now protected";

export interface ReportEntry {
  url: string;
  name: string;
}

export interface PlanReport {
  updated: ReportEntry[];
  appended: ReportEntry[];
  removed: { url: string; name: string; reason: RemovalReason }[];
  /** Added only: `password_rejected`. */
  needsCorrectPassword: ReportEntry[];
  /** Added only: `no_password`. */
  needsPassword: ReportEntry[];
  /** fetch/parse error, protected vendor page, discovery incomplete; items with no stored record (D27, D28). */
  couldNotCheck: { url: string; name: string; reason: string }[];
  /** Added only: `not_tracked` outcomes with no stored record. */
  untrackedProtected: { url: string; name: string | null }[];
  /** Vendors only: `protected_vendor` outcomes with no stored record. */
  unscrapedProtectedVendors: { url: string }[];
}

export interface Plan {
  category: Category;
  runId: string;
  /** false when the governing discovery is incomplete (D15). */
  deletionsAllowed: boolean;
  deletionsBlockedReason: string | null;
  /** The complete new stored array. */
  nextStored: StoredRecord[];
  /** product_names whose password rows are removed (after D20). */
  passwordNamesToDelete: string[];
  /** product_names whose tracking rows are removed (after D20). */
  trackingNamesToDelete: string[];
  report: PlanReport;
}

export type PlanResult =
  | { ok: false; error: string }
  | { ok: true; plan: Plan };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const ALL_STATUSES: readonly string[] = [
  "public_ok",
  "protected_unlocked",
  "password_rejected",
  "no_password",
  "not_tracked",
  "protected_vendor",
  "fetch_error",
  "parse_error",
];

/** §3.9: these statuses occur only for post_type "product". */
const PRODUCT_ONLY_STATUSES: readonly string[] = [
  "protected_unlocked",
  "password_rejected",
  "no_password",
  "not_tracked",
];

/** §3.9: this status occurs only for post_type "vendor". */
const VENDOR_ONLY_STATUSES: readonly string[] = ["protected_vendor"];

type Decision =
  | { kind: "update" }
  | { kind: "keep"; flag: "needs_correct_password" | "needs_password" }
  | { kind: "untouched"; reason: string }
  | { kind: "delete"; reason: RemovalReason };

function fail(error: string): PlanResult {
  return { ok: false, error };
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function sortedByUrl<T extends { url: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => compareStrings(a.url, b.url));
}

function sortedNames(names: Set<string>): string[] {
  return [...names].sort(compareStrings);
}

function readProp(obj: object, prop: string): unknown {
  return (obj as Record<string, unknown>)[prop];
}

/** The match key: ncademi_product_url for added/published, vendor_directory_url for vendors. */
function matchKey(category: Category, record: StoredRecord): string | null {
  const raw: unknown =
    category === "vendors"
      ? record.vendor_directory_url
      : readProp(record, "ncademi_product_url");
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function withDetail(base: string, detail: string | null): string {
  return detail !== null && detail !== "" ? `${base}: ${detail}` : base;
}

function describeIncompleteDiscovery(postType: PostType, info: DiscoveryInfo): string {
  const counts =
    info.expected_total === null
      ? `discovered ${info.discovered}, expected total unknown`
      : `discovered ${info.discovered} of ${info.expected_total}`;
  const error = info.error !== null && info.error !== "" ? `: ${info.error}` : "";
  return `${postType} URL discovery was incomplete (${counts})${error}. No records are deleted (D15).`;
}

function validateDiscovery(run: RunRecord): string | null {
  const discovery: unknown = run.discovery;
  if (discovery === null || typeof discovery !== "object") {
    return "Run record has no discovery block (§3.9).";
  }
  for (const postType of ["product", "vendor"] as const) {
    const info: unknown = readProp(discovery, postType);
    if (info === null || typeof info !== "object") {
      return `Run record has no discovery.${postType} block (§3.9).`;
    }
    if (typeof readProp(info, "complete") !== "boolean") {
      return `discovery.${postType}.complete must be a boolean (§3.9).`;
    }
    if (typeof readProp(info, "discovered") !== "number") {
      return `discovery.${postType}.discovered must be a number (§3.9).`;
    }
  }
  return null;
}

/**
 * The case tables of §3.2 (Added), §3.3 (Published) and §3.4 (Vendors),
 * for a stored record whose URL has the given outcome (or none).
 *
 * "delete" decisions are returned as written in the tables; the caller
 * applies the D15 gate (deletions require complete discovery).
 * Returns null for a status/category combination with no table row.
 */
function decide(category: Category, outcome: RunOutcome | undefined): Decision | null {
  if (outcome === undefined) {
    // "No outcome entry, and discovery complete" → Removed: not on site.
    // The incomplete-discovery variant is applied by the caller (D15).
    return { kind: "delete", reason: "not on site" };
  }

  const status = outcome.status;

  // Every table: fetch_error / parse_error → Untouched; Could not check (D3).
  if (status === "fetch_error") {
    return { kind: "untouched", reason: withDetail("fetch error", outcome.detail) };
  }
  if (status === "parse_error") {
    return { kind: "untouched", reason: withDetail("parse error", outcome.detail) };
  }

  if (category === "added") {
    if (status === "protected_unlocked") return { kind: "update" };
    if (status === "password_rejected") return { kind: "keep", flag: "needs_correct_password" };
    if (status === "no_password") return { kind: "keep", flag: "needs_password" };
    if (status === "public_ok") return { kind: "delete", reason: "now public" };
    if (status === "not_tracked") {
      // RESOLVED (D24): §3.2 has no row for a STORED Added record whose URL has a
      // `not_tracked` outcome (the scraper assigns not_tracked by comparing
      // against stored Added at scrape time, so this arises when a record was
      // added to stored Added between the scrape and the promote). Most
      // conservative reading: untouched, reported as "could not check".
      // Ruling: untouched, reported as could not check.
      return { kind: "untouched", reason: "not tracked at scrape time; re-scrape to check" };
    }
    return null;
  }

  if (category === "published") {
    if (status === "public_ok") return { kind: "update" };
    if (
      status === "protected_unlocked" ||
      status === "password_rejected" ||
      status === "no_password" ||
      status === "not_tracked"
    ) {
      return { kind: "delete", reason: "now protected" };
    }
    return null;
  }

  // category === "vendors"
  if (status === "public_ok") return { kind: "update" };
  if (status === "protected_vendor") {
    // D22: exists, could not check. The stub is never used as an update.
    return { kind: "untouched", reason: "protected vendor page" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The planner
// ---------------------------------------------------------------------------

export function planPromote(input: PlanInput): PlanResult {
  const { category, run } = input;
  const postType: PostType = category === "vendors" ? "vendor" : "product";
  const keyField = category === "vendors" ? "vendor_directory_url" : "ncademi_product_url";
  // §3.9 "Snapshot contents": the only status a live record of this category may have.
  const requiredLiveStatus: OutcomeStatus = category === "added" ? "protected_unlocked" : "public_ok";

  // ---- Run-record gates: D18 and the §3.9 invariants -------------------------

  if (run === null || typeof run !== "object") {
    return fail("Snapshot has no run record ($meta.run); the mirror promote requires one (D16).");
  }
  if (run.target !== "all") {
    return fail(
      `Run "${String(run.run_id)}" has target "${String(run.target)}"; the mirror promote accepts only full runs (target "all") (D18).`
    );
  }
  const discoveryProblem = validateDiscovery(run);
  if (discoveryProblem !== null) return fail(discoveryProblem);
  if (!Array.isArray(run.outcomes)) {
    return fail("Run record has no outcomes array (§3.9).");
  }

  const outcomesByUrl = new Map<string, RunOutcome>();
  let productOutcomeCount = 0;
  let vendorOutcomeCount = 0;
  for (const outcome of run.outcomes) {
    if (outcome === null || typeof outcome !== "object") {
      return fail("Run record contains an outcome entry that is not an object (§3.9).");
    }
    if (typeof outcome.url !== "string" || outcome.url.length === 0) {
      return fail("Run record contains an outcome entry without a url (§3.9).");
    }
    if (outcome.post_type !== "product" && outcome.post_type !== "vendor") {
      return fail(`Outcome for ${outcome.url} has unknown post_type "${String(outcome.post_type)}" (§3.9).`);
    }
    if (!ALL_STATUSES.includes(outcome.status)) {
      return fail(`Outcome for ${outcome.url} has unknown status "${String(outcome.status)}" (§3.9).`);
    }
    if (outcome.post_type === "vendor" && PRODUCT_ONLY_STATUSES.includes(outcome.status)) {
      return fail(
        `Outcome for ${outcome.url} has status "${outcome.status}", which is not valid for post_type "vendor" (§3.9).`
      );
    }
    if (outcome.post_type === "product" && VENDOR_ONLY_STATUSES.includes(outcome.status)) {
      return fail(
        `Outcome for ${outcome.url} has status "${outcome.status}", which is not valid for post_type "product" (§3.9).`
      );
    }
    if (outcomesByUrl.has(outcome.url)) {
      return fail(`Outcome URL ${outcome.url} appears more than once in the run record (§3.9).`);
    }
    outcomesByUrl.set(outcome.url, outcome);
    if (outcome.post_type === "product") productOutcomeCount += 1;
    else vendorOutcomeCount += 1;
  }

  // RESOLVED (D25): §3.9 states that outcomes.length equals the SUM of
  // discovery.*.discovered. Implemented per post type (stricter, and implied by
  // "one entry for every URL discovered for either post type").
  // Ruling: per-post-type check kept.
  if (productOutcomeCount !== run.discovery.product.discovered) {
    return fail(
      `Run record has ${productOutcomeCount} product outcome entries but discovery.product.discovered is ${run.discovery.product.discovered} (§3.9).`
    );
  }
  if (vendorOutcomeCount !== run.discovery.vendor.discovered) {
    return fail(
      `Run record has ${vendorOutcomeCount} vendor outcome entries but discovery.vendor.discovered is ${run.discovery.vendor.discovered} (§3.9).`
    );
  }

  // ---- Governing discovery (D15) --------------------------------------------

  const discovery = postType === "vendor" ? run.discovery.vendor : run.discovery.product;
  const deletionsAllowed = discovery.complete;
  const deletionsBlockedReason = deletionsAllowed
    ? null
    : describeIncompleteDiscovery(postType, discovery);
  const incompleteReason =
    discovery.error !== null && discovery.error !== ""
      ? `discovery incomplete: ${discovery.error}`
      : "discovery incomplete";

  // ---- Index stored and live records -----------------------------------------

  const storedEntries: { key: string; record: StoredRecord }[] = [];
  const storedByKey = new Map<string, StoredRecord>();
  for (const record of input.stored) {
    const key = matchKey(category, record);
    if (key === null) {
      return fail(
        `Stored ${category} record "${String(record.product_name)}" has no ${keyField}; it cannot be matched to the run record.`
      );
    }
    if (storedByKey.has(key)) {
      return fail(`Stored ${category} document has more than one record with ${keyField} ${key}.`);
    }
    storedByKey.set(key, record);
    storedEntries.push({ key, record });
  }

  const liveEntries: { key: string; record: StoredRecord }[] = [];
  const liveByKey = new Map<string, StoredRecord>();
  for (const record of input.live) {
    const key = matchKey(category, record);
    if (key === null) {
      return fail(`Live ${category} record "${String(record.product_name)}" has no ${keyField} (§3.9).`);
    }
    if (liveByKey.has(key)) {
      return fail(`Live ${category} snapshot has more than one record with ${keyField} ${key}.`);
    }
    const outcome = outcomesByUrl.get(key);
    if (outcome === undefined) {
      return fail(`Live ${category} record ${key} has no outcome entry in the run record (§3.9).`);
    }
    if (outcome.post_type !== postType) {
      return fail(
        `Live ${category} record ${key} matches a "${outcome.post_type}" outcome; expected post_type "${postType}" (§3.9).`
      );
    }
    if (outcome.status !== requiredLiveStatus) {
      return fail(
        `Live ${category} record ${key} has outcome status "${outcome.status}"; a ${category}-live record must have status "${requiredLiveStatus}" (§3.9).`
      );
    }
    liveByKey.set(key, record);
    liveEntries.push({ key, record });
  }

  // ---- Stored records: apply the case tables ---------------------------------

  const nextStored: StoredRecord[] = [];
  const deletedNames: string[] = [];
  const rejectedPasswordNames: string[] = [];

  const updated: ReportEntry[] = [];
  const appended: ReportEntry[] = [];
  const removed: { url: string; name: string; reason: RemovalReason }[] = [];
  const needsCorrectPassword: ReportEntry[] = [];
  const needsPassword: ReportEntry[] = [];
  const couldNotCheck: { url: string; name: string; reason: string }[] = [];
  const untrackedProtected: { url: string; name: string | null }[] = [];
  const unscrapedProtectedVendors: { url: string }[] = [];

  for (const { key, record } of storedEntries) {
    const name = record.product_name;
    const outcome = outcomesByUrl.get(key);

    if (outcome !== undefined && outcome.post_type !== postType) {
      // RESOLVED (D26): the tables do not say what to do when a stored record's URL
      // matches an outcome of the OTHER post type. Refusing deletes nothing.
      // Ruling: refuse.
      return fail(
        `Stored ${category} record "${name}" (${key}) matches a "${outcome.post_type}" outcome; expected post_type "${postType}".`
      );
    }

    const decision = decide(category, outcome);
    if (decision === null) {
      return fail(
        `Outcome for ${key} has status "${outcome === undefined ? "none" : outcome.status}", which has no rule for category "${category}".`
      );
    }

    // D15: deletions require complete discovery. A record that would have been
    // deleted is untouched and reported as "could not check".
    if (decision.kind === "delete" && !deletionsAllowed) {
      nextStored.push(record);
      couldNotCheck.push({ url: key, name, reason: incompleteReason });
      continue;
    }

    switch (decision.kind) {
      case "update": {
        const live = liveByKey.get(key);
        if (live === undefined) {
          return fail(
            `Outcome for ${key} is "${outcome === undefined ? "none" : outcome.status}" but the ${category}-live snapshot has no record for it; cannot update "${name}".`
          );
        }
        nextStored.push(live);
        updated.push({ url: key, name });
        break;
      }
      case "keep": {
        nextStored.push(record);
        if (decision.flag === "needs_correct_password") {
          // D5: delete the password row; D20 does not apply (the row belongs to this record).
          rejectedPasswordNames.push(name);
          needsCorrectPassword.push({ url: key, name });
        } else {
          // D4: no password on file is treated like a wrong password, minus the deletion.
          needsPassword.push({ url: key, name });
        }
        break;
      }
      case "untouched": {
        nextStored.push(record);
        couldNotCheck.push({ url: key, name, reason: decision.reason });
        break;
      }
      case "delete": {
        deletedNames.push(name);
        removed.push({ url: key, name, reason: decision.reason });
        break;
      }
    }
  }

  // ---- Live records with no stored counterpart ---------------------------------
  //
  // Published and Vendors: "(No stored record) public_ok → Append", in `live` order.
  // Every live record has already been validated to carry the required status.
  //
  // RESOLVED (D27): §3.2 (Added) has no append row. A live Added record with no
  // stored counterpart (protected_unlocked, no stored record) is therefore
  // neither appended nor deleted. It is not listed under untrackedProtected,
  // which the report interface reserves for `not_tracked`.
  // Ruling: not appended; reported under couldNotCheck.

  // URLs with no stored record already listed in couldNotCheck (D27, D28), so
  // that each such URL is reported at most once.
  const reportedWithoutStored = new Set<string>();
  const reportWithoutStored = (url: string, name: string, reason: string): void => {
    if (reportedWithoutStored.has(url)) return;
    reportedWithoutStored.add(url);
    couldNotCheck.push({ url, name, reason });
  };

  if (category === "added") {
    for (const { key, record } of liveEntries) {
      if (storedByKey.has(key)) continue;
      const outcome = outcomesByUrl.get(key);
      const outcomeName = outcome !== undefined ? outcome.name : null;
      reportWithoutStored(key, outcomeName ?? record.product_name, "on the live site, no stored Added record");
    }
  }

  if (category !== "added") {
    for (const { key, record } of liveEntries) {
      if (storedByKey.has(key)) continue;
      const outcome = outcomesByUrl.get(key);
      const outcomeName = outcome !== undefined ? outcome.name : null;
      nextStored.push(record);
      appended.push({ url: key, name: outcomeName ?? record.product_name });
    }
  }

  // ---- Outcomes with no stored record -------------------------------------------
  //
  // Only outcomes of the governing post type are considered.
  // RESOLVED (D28): no-stored-record outcomes without a table row (fetch_error
  // or parse_error in any category; for Added, protected_unlocked,
  // password_rejected or no_password) create and delete nothing. Statuses that
  // place the page in the other product category (Added: public_ok; Published:
  // protected_unlocked, password_rejected, no_password, not_tracked) are not
  // reported here, because every snapshot lists every product URL (D16).
  // Ruling: never created or deleted; reported under couldNotCheck.
  const reportOutcomeWithoutStored = (outcome: RunOutcome): void => {
    const liveRecord = liveByKey.get(outcome.url);
    const name = outcome.name ?? (liveRecord !== undefined ? liveRecord.product_name : outcome.url);
    reportWithoutStored(
      outcome.url,
      name,
      withDetail(`no stored record; outcome ${outcome.status}`, outcome.detail)
    );
  };

  for (const outcome of run.outcomes) {
    if (outcome.post_type !== postType) continue;
    if (storedByKey.has(outcome.url)) continue;

    if (category === "added") {
      if (outcome.status === "not_tracked") {
        // D6: no auto-stubs; listed for a person to act on.
        untrackedProtected.push({ url: outcome.url, name: outcome.name });
      } else if (outcome.status !== "public_ok") {
        // D28: protected_unlocked, password_rejected, no_password, fetch_error, parse_error.
        reportOutcomeWithoutStored(outcome);
      }
      continue;
    }

    if (outcome.status === "public_ok" && !liveByKey.has(outcome.url)) {
      // RESOLVED (D29): the tables say "Append" but the snapshot holds no record to
      // append. Refusing deletes nothing.
      // Ruling: refuse.
      return fail(
        `Outcome for ${outcome.url} is "public_ok" with no stored ${category} record, but the ${category}-live snapshot has no record for it; cannot append.`
      );
    }

    if (category === "vendors" && outcome.status === "protected_vendor") {
      // D22: append nothing; listed as an unscraped protected vendor page.
      unscrapedProtectedVendors.push({ url: outcome.url });
    } else if (outcome.status === "fetch_error" || outcome.status === "parse_error") {
      // D28. Published's protected statuses with no stored record are not reported (see above).
      reportOutcomeWithoutStored(outcome);
    }
  }

  // ---- Password and tracking rows: D5, D7, D14, D20 ----------------------------

  const remainingNames = new Set<string>(input.namesInOtherCategories);
  for (const record of nextStored) remainingNames.add(record.product_name);

  const passwordNames = new Set<string>();
  for (const row of input.passwords) passwordNames.add(row.product_name);
  const trackingNames = new Set<string>();
  for (const row of input.tracking) trackingNames.add(row.product_name);

  const passwordDeletes = new Set<string>();
  const trackingDeletes = new Set<string>();

  // D5: the rejected password belongs to the kept record; D20 does not apply.
  for (const name of rejectedPasswordNames) {
    if (passwordNames.has(name)) passwordDeletes.add(name);
  }

  // D7 / D14 subject to D20: only when no remaining record anywhere has the name.
  for (const name of deletedNames) {
    if (remainingNames.has(name)) continue;
    if (category === "added" && passwordNames.has(name)) passwordDeletes.add(name);
    if (trackingNames.has(name)) trackingDeletes.add(name);
  }

  // ---- Assemble -------------------------------------------------------------------

  const plan: Plan = {
    category,
    runId: run.run_id,
    deletionsAllowed,
    deletionsBlockedReason,
    nextStored,
    passwordNamesToDelete: sortedNames(passwordDeletes),
    trackingNamesToDelete: sortedNames(trackingDeletes),
    report: {
      updated: sortedByUrl(updated),
      appended: sortedByUrl(appended),
      removed: sortedByUrl(removed),
      needsCorrectPassword: sortedByUrl(needsCorrectPassword),
      needsPassword: sortedByUrl(needsPassword),
      couldNotCheck: sortedByUrl(couldNotCheck),
      untrackedProtected: sortedByUrl(untrackedProtected),
      unscrapedProtectedVendors: sortedByUrl(unscrapedProtectedVendors),
    },
  };

  return { ok: true, plan };
}
