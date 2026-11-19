/**
 * Unit tests for frontend/lib/server/promote-mirror.ts (plan §3.13, D41).
 * Pure: no Firestore. Run from the repo root with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:1 node --experimental-transform-types \
 *     --import ./tests-ts/support/ts-resolve.mjs --test tests-ts/promote-mirror.test.ts
 * The unreachable emulator host makes any accidental Firestore call fail.
 * Password fixtures are fake ("pw-fixture-N") and must never appear in a body.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ABSENT_TOKEN,
  decidePromote,
  parsePromoteRequest,
  promoteDocumentKeys,
  reshapeLiveRecords,
} from "../frontend/lib/server/promote-mirror.ts";
import type {
  PromoteDecision,
  PromotePlanBody,
  PromoteRefusedBody,
  PromoteConflictBody,
  PromoteRequest,
} from "../frontend/lib/server/promote-mirror.ts";
import { serializeTracking } from "../frontend/lib/server/documents.ts";
import type { DocumentKey, TransactionDocs } from "../frontend/lib/server/documents.ts";
import { serializePasswordsFile } from "../frontend/lib/server/passwords-store.ts";
import type { Category, RunOutcome, RunRecord } from "../frontend/lib/mirror-planner.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const P = (slug: string): string => `https://ncademi.org/product/${slug}/`;
const V = (slug: string): string => `https://ncademi.org/vendor/${slug}/`;

function product(name: string, url: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug: url.split("/").filter(Boolean).pop(),
    product_name: name,
    ncademi_product_url: url,
    vendor_name: null,
    vendor_directory_url: null,
    product_website_url: null,
    product_description: null,
    vendor_resources: [],
    other_resources: [],
    support_contacts: [],
    acr_reports: [],
    last_updated: null,
    ai_insights: null,
    ...extra,
  };
}

function vendor(name: string, url: string | null, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "vendor",
    slug: name.toLowerCase(),
    product_name: name,
    vendor_name: name,
    vendor_directory_url: url,
    product_website_url: null,
    product_description: null,
    vendor_resources: [],
    other_resources: [],
    support_contacts: [],
    acr_reports: [],
    products: [],
    last_updated: null,
    ai_insights: null,
    ...extra,
  };
}

function outcome(url: string, status: RunOutcome["status"], name: string | null = null): RunOutcome {
  return { url, post_type: url.includes("/vendor/") ? "vendor" : "product", status, name, detail: null };
}

function makeRun(outcomes: RunOutcome[], extra: Partial<RunRecord> = {}): RunRecord {
  const product = outcomes.filter((o) => o.post_type === "product").length;
  const vendorCount = outcomes.filter((o) => o.post_type === "vendor").length;
  return {
    run_id: "run-1",
    started_at: "2026-11-19T10:00:00Z",
    finished_at: "2026-11-19T10:05:00Z",
    target: "all",
    discovery: {
      product: { complete: true, expected_total: product, discovered: product, error: null },
      vendor: { complete: true, expected_total: vendorCount, discovered: vendorCount, error: null },
    },
    outcomes,
    ...extra,
  };
}

function pwRow(name: string, password: string): Record<string, unknown> {
  return { product_name: name, vendor_name: null, password, timestamp: "2026-01-01T00:00:00Z" };
}

function trRow(name: string): Record<string, unknown> {
  return {
    product_name: name,
    tracking_priority: "high",
    tracking_status: "gathering",
    tracking_gatherer: null,
    tracking_reviewer: null,
  };
}

const serialize = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

type DocSpec = unknown | null | { raw: string };

/**
 * The seven documents for `category`, in promoteDocumentKeys order. A spec
 * value of null means absent; { raw } is used as the bytes verbatim; any
 * other value is serialized. Unspecified keys get an empty default (stored
 * and live) or are absent (passwords, tracking). Etags are "etag-<key>-1"
 * unless overridden.
 */
function makeDocs(
  category: Category,
  specs: Partial<Record<DocumentKey, DocSpec>>,
  etags: Partial<Record<DocumentKey, unknown>> = {}
): TransactionDocs {
  const docs = new Map<DocumentKey, { bytes: string; etag: string } | null>();
  for (const key of promoteDocumentKeys(category)) {
    let spec: DocSpec;
    if (key in specs) spec = specs[key];
    else if (key === "passwords" || key === "tracking") spec = null;
    else if (key === "vendors") spec = { $schema_version: 1, $meta: {}, vendors: [] };
    else if (key.endsWith("-live")) {
      spec = { $meta: { run: makeRun([]) }, [key === "vendors-live" ? "vendors" : "products"]: [] };
    } else spec = { $schema_version: 1, $meta: {}, products: [] };

    if (spec === null) {
      docs.set(key, null);
      continue;
    }
    const bytes =
      typeof spec === "object" && spec !== null && "raw" in spec && typeof (spec as { raw: unknown }).raw === "string"
        ? (spec as { raw: string }).raw
        : serialize(spec);
    const etag = key in etags ? etags[key] : `etag-${key}-1`;
    docs.set(key, { bytes, etag: etag as string });
  }
  return docs;
}

function tokensOf(docs: TransactionDocs, category: Category): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const key of promoteDocumentKeys(category)) {
    const doc = docs.get(key);
    tokens[key] = doc ? doc.etag : ABSENT_TOKEN;
  }
  return tokens;
}

const preview = (category: Category): PromoteRequest => ({ category, mode: "preview", tokens: null });
const apply = (category: Category, tokens: Record<string, string>): PromoteRequest => ({
  category,
  mode: "apply",
  tokens,
});

/** Every body produced, for case 18. */
const seenBodies: string[] = [];

function run(request: PromoteRequest, docs: TransactionDocs): PromoteDecision {
  const decision = decidePromote(request, docs);
  seenBodies.push(JSON.stringify(decision.body));
  return decision;
}

function assertNoWrites(decision: PromoteDecision): void {
  assert.deepEqual(decision.writes, []);
  assert.deepEqual(decision.deletes, []);
}

function planBody(decision: PromoteDecision): PromotePlanBody {
  assert.equal(decision.status, 200, `expected 200, got ${decision.status}: ${JSON.stringify(decision.body)}`);
  return decision.body as PromotePlanBody;
}

function writeFor(decision: PromoteDecision, key: DocumentKey): string | undefined {
  return decision.writes.find((w) => w.key === key)?.bytes;
}

/** Published happy path: A updated, E appended, F removed (not on site). */
function publishedHappyDocs(overrides: Partial<Record<DocumentKey, DocSpec>> = {}): TransactionDocs {
  return makeDocs("published", {
    published: { $schema_version: 1, $meta: {}, products: [product("A", P("a")), product("F", P("f"))] },
    "published-live": {
      $meta: {
        run: makeRun([outcome(P("a"), "public_ok", "A"), outcome(P("e"), "public_ok", "E")]),
      },
      products: [
        { product_name: "A", ncademi_product_url: P("a"), product_description: "new" },
        { product_name: "E", ncademi_product_url: P("e") },
      ],
    },
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// 1. promoteDocumentKeys
// ---------------------------------------------------------------------------

test("1. promoteDocumentKeys returns the seven keys in the fixed order", () => {
  assert.deepEqual(promoteDocumentKeys("published"), [
    "published", "added", "candidate", "vendors", "published-live", "passwords", "tracking",
  ]);
  assert.deepEqual(promoteDocumentKeys("added"), [
    "added", "published", "candidate", "vendors", "added-live", "passwords", "tracking",
  ]);
  assert.deepEqual(promoteDocumentKeys("vendors"), [
    "vendors", "published", "added", "candidate", "vendors-live", "passwords", "tracking",
  ]);
});

// ---------------------------------------------------------------------------
// 2. parsePromoteRequest
// ---------------------------------------------------------------------------

const CATEGORY_ERROR = '"category" must be one of "published", "added", "vendors".';
const MODE_ERROR = '"mode" must be "preview" or "apply".';

function validTokens(category: Category): Record<string, string> {
  return Object.fromEntries(promoteDocumentKeys(category).map((k) => [k, `etag-${k}`]));
}

test("2. parsePromoteRequest: non-object bodies give the category error", () => {
  for (const body of [null, undefined, "published", 42, ["published"]]) {
    assert.deepEqual(parsePromoteRequest(body), { ok: false, error: CATEGORY_ERROR }, JSON.stringify(body));
  }
});

test("2. parsePromoteRequest: category candidate, missing or unknown", () => {
  for (const body of [{ category: "candidate", mode: "preview" }, { mode: "preview" }, { category: "bogus", mode: "preview" }]) {
    assert.deepEqual(parsePromoteRequest(body), { ok: false, error: CATEGORY_ERROR }, JSON.stringify(body));
  }
});

test("2. parsePromoteRequest: mode missing (pre-step-6 body) or unknown", () => {
  assert.deepEqual(parsePromoteRequest({ category: "published" }), { ok: false, error: MODE_ERROR });
  assert.deepEqual(parsePromoteRequest({ category: "published", mode: "dry-run" }), { ok: false, error: MODE_ERROR });
});

test("2. parsePromoteRequest: apply token errors list the seven keys", () => {
  const keys = promoteDocumentKeys("added");
  const missing = validTokens("added");
  delete missing.tracking;
  const extra = { ...validTokens("added"), other: "x" };
  const nonString = { ...validTokens("added"), passwords: 5 };
  const empty = { ...validTokens("added"), candidate: "" };
  for (const tokens of [undefined, null, "x", [], missing, extra, nonString, empty]) {
    const result = parsePromoteRequest({ category: "added", mode: "apply", tokens });
    assert.equal(result.ok, false, JSON.stringify(tokens));
    if (!result.ok) {
      assert.match(result.error, /^"tokens" must be an object/);
      for (const key of keys) assert.ok(result.error.includes(key), `${key} listed`);
    }
  }
});

test("2. parsePromoteRequest: valid preview (tokens ignored) and valid apply", () => {
  assert.deepEqual(parsePromoteRequest({ category: "vendors", mode: "preview", tokens: { junk: 1 } }), {
    ok: true,
    request: { category: "vendors", mode: "preview", tokens: null },
  });
  const tokens = validTokens("published");
  const result = parsePromoteRequest({ category: "published", mode: "apply", tokens });
  assert.deepEqual(result, { ok: true, request: { category: "published", mode: "apply", tokens } });
  if (result.ok) assert.deepEqual(Object.keys(result.request.tokens ?? {}), promoteDocumentKeys("published"));
});

// ---------------------------------------------------------------------------
// 3. reshapeLiveRecords
// ---------------------------------------------------------------------------

test("3. reshapeLiveRecords: product defaults, live wins, slug from URL, is_protected removed, input untouched", () => {
  const input = [
    { product_name: "A", ncademi_product_url: P("alpha"), product_description: "live", is_protected: true, slug: "wrong" },
  ];
  const before = structuredClone(input);
  const [out] = reshapeLiveRecords("published", input);
  assert.equal(out?.product_description, "live");
  assert.equal(out?.vendor_name, null);
  assert.equal(out?.ai_insights, null);
  assert.deepEqual(out?.acr_reports, []);
  assert.equal(out?.slug, "alpha");
  assert.equal("is_protected" in (out ?? {}), false);
  assert.deepEqual(input, before);
});

test("3. reshapeLiveRecords: vendors get the slug and no product defaults", () => {
  const input = [{ product_name: "Acme", vendor_directory_url: V("acme-co"), is_protected: false }];
  const before = structuredClone(input);
  const out = reshapeLiveRecords("vendors", input);
  assert.deepEqual(out, [{ product_name: "Acme", vendor_directory_url: V("acme-co"), slug: "acme-co" }]);
  assert.deepEqual(input, before);
});

// ---------------------------------------------------------------------------
// 4–5. Preview
// ---------------------------------------------------------------------------

test("4. preview (published): 200, no writes, absent token, counts, run fields", () => {
  const docs = publishedHappyDocs();
  const decision = run(preview("published"), docs);
  const body = planBody(decision);
  assertNoWrites(decision);
  assert.equal(body.outcome, "preview");
  assert.equal(body.category, "published");
  assert.deepEqual(body.tokens, tokensOf(docs, "published"));
  assert.deepEqual(Object.keys(body.tokens), promoteDocumentKeys("published"));
  assert.equal(body.tokens.tracking, "absent");
  assert.equal(body.tokens.passwords, "absent");
  assert.equal(body.runId, "run-1");
  assert.equal(body.runFinishedAt, "2026-11-19T10:05:00Z");
  const r = body.report;
  assert.deepEqual(body.counts, {
    storedBefore: 2,
    storedAfter: 2,
    updated: r.updated.length,
    appended: r.appended.length,
    removed: r.removed.length,
    needsCorrectPassword: r.needsCorrectPassword.length,
    needsPassword: r.needsPassword.length,
    couldNotCheck: r.couldNotCheck.length,
    untrackedProtected: r.untrackedProtected.length,
    unscrapedProtectedVendors: r.unscrapedProtectedVendors.length,
    passwordRowsToDelete: 0,
    trackingRowsToDelete: 0,
  });
  assert.equal(r.updated.length, 1);
  assert.equal(r.appended.length, 1);
  assert.deepEqual(r.removed, [{ url: P("f"), name: "F", reason: "not on site" }]);
  assert.equal(body.written, undefined);
});

test("5. D20 through the route input: a name used in stored candidate keeps its tracking row", () => {
  const docs = makeDocs("published", {
    published: { $schema_version: 1, $meta: {}, products: [product("X", P("x")), product("Y", P("y"))] },
    candidate: { $schema_version: 1, $meta: {}, products: [product("X", P("x-candidate"))] },
    tracking: { $schema_version: 1, $meta: {}, tracking: [trRow("X"), trRow("Y")] },
  });
  const body = planBody(run(preview("published"), docs));
  assert.equal(body.report.removed.length, 2);
  assert.deepEqual(body.trackingNamesToDelete, ["Y"]);
  assert.equal(body.counts.trackingRowsToDelete, 1);
});

// ---------------------------------------------------------------------------
// 6–10, 15. Errors and refusals
// ---------------------------------------------------------------------------

test("6. live snapshot absent → 409 no live data; no writes", () => {
  const decision = run(preview("published"), makeDocs("published", { "published-live": null }));
  assert.equal(decision.status, 409);
  assert.deepEqual(decision.body, { error: 'No live data to promote. Run "Retrieve Live Data" first.' });
  assertNoWrites(decision);
});

test("7. a stored document absent → 503 naming it; no writes", () => {
  for (const key of ["published", "candidate"] as const) {
    const decision = run(preview("published"), makeDocs("published", { [key]: null }));
    assert.equal(decision.status, 503, key);
    assert.match((decision.body as { error: string }).error, new RegExp(`"${key}"`));
    assertNoWrites(decision);
  }
});

test("8. invalid or misshapen documents → 500 naming the key; no writes", () => {
  const cases: [Category, DocumentKey, DocSpec][] = [
    ["published", "published", { raw: "{not json" }],
    ["published", "published-live", { raw: "{not json" }],
    ["added", "candidate", { raw: "null" }],
    ["published", "added", { raw: "[1, 2]" }],
    ["published", "published", { $schema_version: 1, $meta: {} }],
    ["vendors", "vendors-live", { $meta: { run: makeRun([]) }, vendors: { not: "an array" } }],
  ];
  for (const [category, key, spec] of cases) {
    const decision = run(preview(category), makeDocs(category, { [key]: spec }));
    assert.equal(decision.status, 500, `${category}/${key}`);
    assert.ok((decision.body as { error: string }).error.includes(`"${key}"`), `${key} named`);
    assertNoWrites(decision);
  }
});

test("9. planner refusal → 409 refused with the planner text verbatim; tokens present; no writes", () => {
  const docs = makeDocs("published", {
    "published-live": { $meta: { run: makeRun([], { target: "published" }) }, products: [] },
  });
  const decision = run(preview("published"), docs);
  assert.equal(decision.status, 409);
  const body = decision.body as PromoteRefusedBody;
  assert.equal(body.outcome, "refused");
  assert.equal(
    body.error,
    'Run "run-1" has target "published"; the mirror promote accepts only full runs (target "all") (D18).'
  );
  assert.equal(body.runId, "run-1");
  assert.deepEqual(body.tokens, tokensOf(docs, "published"));
  assertNoWrites(decision);
});

test("10. run.finished_at missing → 409 refused; no writes", () => {
  const runRecord = makeRun([]) as Partial<RunRecord>;
  delete runRecord.finished_at;
  const docs = makeDocs("published", { "published-live": { $meta: { run: runRecord }, products: [] } });
  const decision = run(apply("published", tokensOf(docs, "published")), docs);
  assert.equal(decision.status, 409);
  const body = decision.body as PromoteRefusedBody;
  assert.equal(body.outcome, "refused");
  assert.match(body.error, /finished_at/);
  assert.equal(body.runId, "run-1");
  assert.equal(body.runFinishedAt, null);
  assertNoWrites(decision);
});

test("15. a present document whose etag is not a string → 500", () => {
  const decision = run(preview("published"), makeDocs("published", {}, { candidate: 42 }));
  assert.equal(decision.status, 500);
  assert.match((decision.body as { error: string }).error, /"candidate"/);
  assertNoWrites(decision);
});

// ---------------------------------------------------------------------------
// 11–13. Apply
// ---------------------------------------------------------------------------

/** Added: A updated (protected_unlocked), G removed (now public). */
function addedDocs(overrides: Partial<Record<DocumentKey, DocSpec>> = {}): TransactionDocs {
  return makeDocs("added", {
    added: {
      $schema_version: 3,
      $meta: { purpose: "stored added", custom_key: "keep-me", snapshot_taken_at: "old", total_products: 2, generated_from: "old" },
      products: [product("A", P("a")), product("G", P("g"))],
    },
    "added-live": {
      $meta: { run: makeRun([outcome(P("a"), "protected_unlocked", "A"), outcome(P("g"), "public_ok", "G")]) },
      products: [{ product_name: "A", ncademi_product_url: P("a"), product_description: "fresh", is_protected: true }],
    },
    ...overrides,
  });
}

test("11. apply (added): stored bytes are the serialized envelope; live deleted; written flags", () => {
  const docs = addedDocs();
  const decision = run(apply("added", tokensOf(docs, "added")), docs);
  const body = planBody(decision);
  assert.equal(body.outcome, "applied");
  assert.deepEqual(decision.deletes, ["added-live"]);
  assert.deepEqual(decision.writes.map((w) => w.key), ["added"]);
  assert.deepEqual(body.written, { stored: true, passwords: false, tracking: false, liveDeleted: true });

  const bytes = writeFor(decision, "added") ?? "";
  assert.ok(bytes.endsWith("}\n"));
  const doc = JSON.parse(bytes) as { $schema_version: number; $meta: Record<string, unknown>; products: unknown[] };
  assert.equal(doc.$schema_version, 3);
  assert.equal(doc.$meta.custom_key, "keep-me");
  assert.equal(doc.$meta.purpose, "stored added");
  assert.equal(doc.$meta.snapshot_taken_at, "2026-11-19T10:05:00Z");
  assert.equal(doc.$meta.total_products, 1);
  assert.equal(doc.$meta.generated_from, 'mirror promote via /records ("Update Stored Data")');
  assert.equal(doc.$meta.run_id, "run-1");
  assert.equal(doc.products.length, 1);
  const promoted = doc.products[0] as Record<string, unknown>;
  assert.equal(promoted.product_description, "fresh");
  assert.equal(promoted.slug, "a");
  assert.equal("is_protected" in promoted, false);
  assert.equal(bytes, `${JSON.stringify(doc, null, 2)}\n`);
});

test("12. apply passwords: duplicates removed, near-matches kept, order kept", () => {
  const passwordsDoc = {
    $schema_version: 1,
    $meta: { note: "fixture" },
    passwords: [
      pwRow("G", "pw-fixture-1"),
      pwRow("Other", "pw-fixture-2"),
      pwRow("G", "pw-fixture-3"),
      pwRow("g", "pw-fixture-4"),
      pwRow(" G ", "pw-fixture-5"),
      pwRow("Zed", "pw-fixture-6"),
    ],
  };
  const docs = addedDocs({ passwords: passwordsDoc });
  const decision = run(apply("added", tokensOf(docs, "added")), docs);
  const body = planBody(decision);
  assert.deepEqual(body.passwordNamesToDelete, ["G"]);
  assert.equal(body.counts.passwordRowsToDelete, 2);
  assert.equal(body.written?.passwords, true);
  const expected = serializePasswordsFile({
    $schema_version: 1,
    $meta: { note: "fixture" },
    passwords: [
      pwRow("Other", "pw-fixture-2"),
      pwRow("g", "pw-fixture-4"),
      pwRow(" G ", "pw-fixture-5"),
      pwRow("Zed", "pw-fixture-6"),
    ] as never,
  });
  assert.equal(writeFor(decision, "passwords"), expected);
});

test("12. apply passwords: nothing matches → no write; absent → never written", () => {
  const docs = addedDocs({
    passwords: { $schema_version: 1, $meta: {}, passwords: [pwRow("Other", "pw-fixture-7")] },
  });
  const decision = run(apply("added", tokensOf(docs, "added")), docs);
  assert.equal(writeFor(decision, "passwords"), undefined);
  assert.equal(planBody(decision).written?.passwords, false);

  const absentDocs = addedDocs({ passwords: null });
  const absentDecision = run(apply("added", tokensOf(absentDocs, "added")), absentDocs);
  assert.equal(writeFor(absentDecision, "passwords"), undefined);
  assert.equal(planBody(absentDecision).written?.passwords, false);
});

test("13. apply tracking: removed through reconcile; nothing to delete → no write; absent → never written", () => {
  const withRows = publishedHappyDocs({
    tracking: { $schema_version: 1, $meta: {}, tracking: [trRow("Keep"), trRow("F")] },
  });
  const decision = run(apply("published", tokensOf(withRows, "published")), withRows);
  const body = planBody(decision);
  assert.deepEqual(body.trackingNamesToDelete, ["F"]);
  assert.equal(body.counts.trackingRowsToDelete, 1);
  assert.equal(body.written?.tracking, true);
  assert.equal(
    writeFor(decision, "tracking"),
    serializeTracking([trRow("Keep")] as never)
  );

  const nothing = publishedHappyDocs({ tracking: { $schema_version: 1, $meta: {}, tracking: [trRow("Keep")] } });
  const nothingDecision = run(apply("published", tokensOf(nothing, "published")), nothing);
  assert.equal(writeFor(nothingDecision, "tracking"), undefined);
  assert.equal(planBody(nothingDecision).written?.tracking, false);

  const absent = publishedHappyDocs({ tracking: null });
  const absentDecision = run(apply("published", tokensOf(absent, "published")), absent);
  assert.equal(writeFor(absentDecision, "tracking"), undefined);
});

// ---------------------------------------------------------------------------
// 14. Conflicts
// ---------------------------------------------------------------------------

function assertConflict(
  decision: PromoteDecision,
  changed: DocumentKey[],
  docs: TransactionDocs,
  category: Category
): PromoteConflictBody {
  assert.equal(decision.status, 409);
  assertNoWrites(decision);
  const body = decision.body as PromoteConflictBody;
  assert.equal(body.outcome, "conflict");
  assert.equal(body.category, category);
  assert.equal(
    body.error,
    "The stored data changed after the preview. Review the updated preview and confirm again."
  );
  assert.deepEqual(body.changed, changed);
  const fresh = decidePromote(preview(category), docs);
  assert.deepEqual(body.fresh, { status: fresh.status, body: fresh.body });
  return body;
}

test("14. conflict: present → different etag", () => {
  const docs = publishedHappyDocs({ tracking: { $schema_version: 1, $meta: {}, tracking: [] } });
  const tokens = { ...tokensOf(docs, "published"), published: "etag-published-0" };
  const body = assertConflict(run(apply("published", tokens), docs), ["published"], docs, "published");
  assert.equal(body.fresh.status, 200);
  assert.equal((body.fresh.body as PromotePlanBody).outcome, "preview");
});

test("14. conflict: present → absent, absent → present, and fixed order", () => {
  const absentNow = publishedHappyDocs({ tracking: null });
  const claimedPresent = { ...tokensOf(absentNow, "published"), tracking: "etag-tracking-1" };
  assertConflict(run(apply("published", claimedPresent), absentNow), ["tracking"], absentNow, "published");

  const presentNow = publishedHappyDocs({ tracking: { $schema_version: 1, $meta: {}, tracking: [] } });
  const claimedAbsent = { ...tokensOf(presentNow, "published"), tracking: "absent" };
  assertConflict(run(apply("published", claimedAbsent), presentNow), ["tracking"], presentNow, "published");

  const both = { ...claimedAbsent, published: "etag-published-0" };
  assertConflict(run(apply("published", both), presentNow), ["published", "tracking"], presentNow, "published");
});

test("14. conflict whose fresh result is the no-live-data error or a refusal carries that status and body", () => {
  const noLive = makeDocs("vendors", { "vendors-live": null });
  const tokens = { ...tokensOf(noLive, "vendors"), "vendors-live": "etag-vendors-live-1" };
  const body = assertConflict(run(apply("vendors", tokens), noLive), ["vendors-live"], noLive, "vendors");
  assert.deepEqual(body.fresh, {
    status: 409,
    body: { error: 'No live data to promote. Run "Retrieve Live Data" first.' },
  });

  const refusing = makeDocs("added", {
    "added-live": { $meta: { run: makeRun([], { target: "added" }) }, products: [] },
  });
  const refusingTokens = { ...tokensOf(refusing, "added"), candidate: "etag-candidate-0" };
  const refusedConflict = assertConflict(
    run(apply("added", refusingTokens), refusing),
    ["candidate"],
    refusing,
    "added"
  );
  assert.equal(refusedConflict.fresh.status, 409);
  assert.equal((refusedConflict.fresh.body as PromoteRefusedBody).outcome, "refused");
});

// ---------------------------------------------------------------------------
// 16. D36 through the route
// ---------------------------------------------------------------------------

test("16. vendors: a URL-less stored vendor is reported and written back unchanged", () => {
  const draft = vendor("Draft Co", null);
  const docs = makeDocs("vendors", {
    vendors: { $schema_version: 1, $meta: {}, vendors: [draft, vendor("Acme", V("acme"))] },
    "vendors-live": {
      $meta: { run: makeRun([outcome(V("acme"), "public_ok", "Acme")]) },
      vendors: [vendor("Acme", V("acme"), { product_description: "live" })],
    },
  });
  const previewBody = planBody(run(preview("vendors"), docs));
  assert.ok(
    previewBody.report.couldNotCheck.some(
      (e) => e.url === "" && e.name === "Draft Co" && e.reason === "not on the site yet (no directory URL)"
    )
  );
  const decision = run(apply("vendors", tokensOf(docs, "vendors")), docs);
  planBody(decision);
  const written = JSON.parse(writeFor(decision, "vendors") ?? "{}") as { vendors: unknown[] };
  assert.deepEqual(written.vendors[0], draft);
  assert.deepEqual(decision.deletes, ["vendors-live"]);
});

// ---------------------------------------------------------------------------
// 17–18. Purity, determinism, no password values
// ---------------------------------------------------------------------------

test("17. purity and determinism: inputs unchanged; repeated calls deep-equal", () => {
  const docs = addedDocs({
    passwords: { $schema_version: 1, $meta: {}, passwords: [pwRow("G", "pw-fixture-8")] },
    tracking: { $schema_version: 1, $meta: {}, tracking: [trRow("G")] },
  });
  for (const request of [preview("added"), apply("added", tokensOf(docs, "added"))]) {
    const docsBefore = structuredClone(docs);
    const requestBefore = structuredClone(request);
    const first = run(request, docs);
    const second = run(request, docs);
    assert.deepEqual(docs, docsBefore);
    assert.deepEqual(request, requestBefore);
    assert.deepEqual(first, second);
  }
});

test("18. no fixture password value appears in any response body", () => {
  assert.ok(seenBodies.length > 20, `bodies collected: ${seenBodies.length}`);
  for (const body of seenBodies) {
    assert.equal(/pw-fixture-/.test(body), false);
  }
});
