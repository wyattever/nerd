/**
 * Unit tests for frontend/lib/server/candidate-import.ts (bulk Candidate
 * import, step 2: request parsing and the pure preview/apply decision).
 * Pure: no Firestore. Run from the repo root with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:1 node --experimental-transform-types \
 *     --import ./tests-ts/support/ts-resolve.mjs --test tests-ts/candidate-import-decide.test.ts
 * The unreachable emulator host makes any accidental Firestore call fail.
 * Password fixtures are fake ("pw-fixture-N").
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  IMPORT_KEYS,
  decideCandidateImport,
  parseCandidateImportRequest,
} from "../frontend/lib/server/candidate-import.ts";
import type {
  CandidateImportAppliedBody,
  CandidateImportConflictBody,
  CandidateImportErrorBody,
  CandidateImportPreviewBody,
  CandidateImportRequest,
} from "../frontend/lib/server/candidate-import.ts";
import type { DocumentKey, TransactionDocs } from "../frontend/lib/server/documents.ts";

const NOW = new Date("2026-11-23T12:00:00.000Z");

type Rec = Record<string, unknown>;

/** A complete stored product record. */
function stored(slug: string, name: string, extra: Rec = {}): Rec {
  return {
    slug,
    product_name: name,
    vendor_name: `${name} Inc.`,
    vendor_directory_url: null,
    product_website_url: null,
    product_description: null,
    last_updated: null,
    ai_insights: null,
    ncademi_product_url: `https://ncademi.org/provide/directory/products/${slug}/`,
    vendor_resources: [],
    other_resources: [],
    support_contacts: [],
    acr_reports: [],
    ...extra,
  };
}

/** A pasted record as the research Project sends it: boilerplate left out or null. */
function pasted(slug: string, name: string, extra: Rec = {}): Rec {
  return {
    slug,
    product_name: name,
    vendor_name: `${name} Inc.`,
    product_website_url: null,
    product_description: `About ${name}.`,
    ncademi_product_url: null,
    vendor_resources: [],
    other_resources: [],
    support_contacts: [],
    acr_reports: [],
    ...extra,
  };
}

function paste(...records: Rec[]): string {
  return records.map((r) => JSON.stringify(r, null, 2)).join("\n\n");
}

interface Fixture {
  candidate?: Rec[] | null;
  added?: Rec[] | null;
  published?: Rec[] | null;
  tracking?: Rec[] | null;
  passwords?: Rec[] | null;
}

const DEFAULT_CANDIDATE = [stored("alpha-reader", "Alpha Reader")];
const DEFAULT_ADDED = [stored("bravo-math", "Bravo Math")];
const DEFAULT_PUBLISHED = [
  stored("charlie-science", "Charlie Science", { product_website_url: "http://x.example" }),
];
const DEFAULT_TRACKING = [
  {
    product_name: "Alpha Reader",
    tracking_priority: "High",
    tracking_status: "Reviewing",
    tracking_gatherer: null,
    tracking_reviewer: null,
  },
];
const DEFAULT_PASSWORDS = [
  { product_name: "Alpha Reader", vendor_name: "Alpha Reader Inc.", password: "pw-fixture-1", timestamp: "2026-01-01T00:00:00.000Z" },
];

function pick<T>(value: T | null | undefined, fallback: T): T | null {
  return value === undefined ? fallback : value;
}

function makeDocs(fixture: Fixture = {}): TransactionDocs {
  const docs = new Map<DocumentKey, { bytes: string; etag: string } | null>();
  const put = (key: DocumentKey, body: Rec | null): void => {
    docs.set(key, body === null ? null : { bytes: `${JSON.stringify(body, null, 2)}\n`, etag: `etag-${key}-1` });
  };
  const products = (rows: Rec[] | null): Rec | null =>
    rows === null ? null : { $schema_version: 1, $meta: { note: "fixture" }, products: rows };

  put("candidate", products(pick(fixture.candidate, DEFAULT_CANDIDATE)));
  const tracking = pick(fixture.tracking, DEFAULT_TRACKING);
  put("tracking", tracking === null ? null : { $schema_version: 1, $meta: {}, tracking });
  const passwords = pick(fixture.passwords, DEFAULT_PASSWORDS);
  put("passwords", passwords === null ? null : { $schema_version: 1, $meta: {}, passwords });
  put("added", products(pick(fixture.added, DEFAULT_ADDED)));
  put("published", products(pick(fixture.published, DEFAULT_PUBLISHED)));
  return docs;
}

function tokensOf(docs: TransactionDocs): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const key of IMPORT_KEYS) {
    const doc = docs.get(key);
    tokens[key] = doc ? doc.etag : "absent";
  }
  return tokens;
}

function preview(text: string, docs: TransactionDocs = makeDocs()): CandidateImportPreviewBody {
  const result = decideCandidateImport({ mode: "preview", text }, docs, NOW);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(result.writes, []);
  return result.body as CandidateImportPreviewBody;
}

function applyRequest(text: string, selected: string[], docs: TransactionDocs): CandidateImportRequest {
  return { mode: "apply", text, selected, tokens: tokensOf(docs) };
}

function writeOf(writes: Array<{ key: string; bytes: string }>, key: string): Rec {
  const write = writes.find((w) => w.key === key);
  assert.ok(write, `no write for ${key}`);
  return JSON.parse(write.bytes) as Rec;
}

const THREE_NEW = paste(
  pasted("delta-writer", "Delta Writer"),
  pasted("echo-maps", "Echo Maps"),
  pasted("foxtrot-music", "Foxtrot Music", { tracking_status: "Done" }),
);

test("a. preview of three new valid records: all ready, no writes, fixture tokens", () => {
  const docs = makeDocs();
  const result = decideCandidateImport({ mode: "preview", text: THREE_NEW }, docs, NOW);
  assert.equal(result.status, 200);
  assert.deepEqual(result.writes, []);
  const body = result.body as CandidateImportPreviewBody;
  assert.deepEqual(body.summary, { total: 3, ready: 3, warning: 0, blocked: 0 });
  assert.deepEqual(
    body.records.map((r) => r.status),
    ["ready", "ready", "ready"],
  );
  assert.deepEqual(body.tokens, {
    candidate: "etag-candidate-1",
    tracking: "etag-tracking-1",
    passwords: "etag-passwords-1",
    added: "etag-added-1",
    published: "etag-published-1",
  });
});

test("b. a website matching a Published record after normalization is blocked", () => {
  const body = preview(paste(pasted("x-tool", "X Tool", { product_website_url: "https://www.x.example/" })));
  const record = body.records[0];
  assert.equal(record.status, "blocked");
  assert.ok(
    record.issues.some((i) => i.includes("Published") && i.includes("website")),
    JSON.stringify(record.issues),
  );
});

test("c. same slug as a stored candidate, or same name as an Added record, is blocked", () => {
  const bySlug = preview(paste(pasted("alpha-reader", "Alpha Reader Two"))).records[0];
  assert.equal(bySlug.status, "blocked");
  assert.ok(
    bySlug.issues.some((i) => i.includes("Candidates") && i.includes("slug")),
    JSON.stringify(bySlug.issues),
  );

  const byName = preview(paste(pasted("bravo-math-2", "Bravo Math"))).records[0];
  assert.equal(byName.status, "blocked");
  assert.ok(
    byName.issues.some((i) => i.includes("Added") && i.includes("name")),
    JSON.stringify(byName.issues),
  );
});

test("d. two records in one paste with the same name: the second is blocked", () => {
  const body = preview(paste(pasted("golf-one", "Golf Tool"), pasted("golf-two", "Golf Tool")));
  assert.equal(body.records[0].status, "ready");
  assert.equal(body.records[1].status, "blocked");
  assert.ok(body.records[1].issues.includes("Same product as record 1 (same name)."), JSON.stringify(body.records[1].issues));
});

test("e. slug \"BrainPOP Jr.\" is normalized with a warning and drives ncademi_product_url", () => {
  const docs = makeDocs();
  const text = paste(pasted("BrainPOP Jr.", "BrainPOP Jr."));
  const record = preview(text, docs).records[0];
  assert.equal(record.status, "warning");
  assert.equal(record.slug, "brainpop-jr");
  assert.ok(
    record.issues.some((i) => i.includes('Slug changed from "BrainPOP Jr." to "brainpop-jr"')),
    JSON.stringify(record.issues),
  );

  const applied = decideCandidateImport(applyRequest(text, ["brainpop-jr"], docs), docs, NOW);
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  const products = writeOf(applied.writes, "candidate").products as Rec[];
  const imported = products.find((p) => p.slug === "brainpop-jr");
  assert.ok(imported);
  assert.ok(String(imported.ncademi_product_url).endsWith("/brainpop-jr/"), String(imported.ncademi_product_url));
});

test("f. a support contact of type phone is blocked at support_contacts[0]", () => {
  const record = preview(
    paste(pasted("hotel-app", "Hotel App", { support_contacts: [{ type: "phone", value: "555-0100", label: null }] })),
  ).records[0];
  assert.equal(record.status, "blocked");
  assert.ok(
    record.issues.some((i) => i.startsWith("support_contacts[0]")),
    JSON.stringify(record.issues),
  );
});

test("g. a pasted name containing a stored name gives a near-name warning", () => {
  const docs = makeDocs({ published: [stored("newsela", "Newsela")] });
  const record = preview(paste(pasted("newsela-ela", "Newsela ELA")), docs).records[0];
  assert.equal(record.status, "warning");
  assert.ok(
    record.issues.some((i) => i.includes("Newsela") && i.includes("resembles")),
    JSON.stringify(record.issues),
  );
});

test("h. apply two of three ready records: candidate, tracking and passwords writes", () => {
  const docs = makeDocs();
  const result = decideCandidateImport(applyRequest(THREE_NEW, ["foxtrot-music", "delta-writer"], docs), docs, NOW);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(
    result.writes.map((w) => w.key),
    ["candidate", "tracking", "passwords"],
  );

  const candidate = writeOf(result.writes, "candidate");
  assert.deepEqual(candidate.$meta, { note: "fixture" });
  const products = candidate.products as Rec[];
  assert.deepEqual(
    products.map((p) => p.product_name),
    ["Alpha Reader", "Delta Writer", "Foxtrot Music"],
  );
  for (const p of products) {
    assert.ok(!Object.keys(p).some((k) => k.startsWith("tracking_")), JSON.stringify(p));
  }

  const tracking = writeOf(result.writes, "tracking").tracking as Rec[];
  for (const name of ["Delta Writer", "Foxtrot Music"]) {
    const row = tracking.find((r) => r.product_name === name);
    assert.ok(row, `no tracking row for ${name}`);
    assert.equal(row.tracking_status, "Gathering");
  }
  assert.ok(tracking.some((r) => r.product_name === "Alpha Reader"), "existing tracking row kept");

  const passwords = writeOf(result.writes, "passwords").passwords as Rec[];
  assert.equal(passwords.length, DEFAULT_PASSWORDS.length + 2);

  const body = result.body as CandidateImportAppliedBody;
  assert.equal(body.mode, "apply");
  assert.equal(body.passwordsCreated, 2);
  assert.deepEqual(body.imported, [
    { slug: "delta-writer", product_name: "Delta Writer" },
    { slug: "foxtrot-music", product_name: "Foxtrot Music" },
  ]);
});

test("i. apply when every selected product already has a password: no passwords write", () => {
  const docs = makeDocs({
    passwords: [
      ...DEFAULT_PASSWORDS,
      { product_name: "Delta Writer", vendor_name: null, password: "pw-fixture-2", timestamp: "2026-01-01T00:00:00.000Z" },
      { product_name: "Foxtrot Music", vendor_name: null, password: "pw-fixture-3", timestamp: "2026-01-01T00:00:00.000Z" },
    ],
  });
  const result = decideCandidateImport(applyRequest(THREE_NEW, ["delta-writer", "foxtrot-music"], docs), docs, NOW);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(
    result.writes.map((w) => w.key),
    ["candidate", "tracking"],
  );
  assert.equal((result.body as CandidateImportAppliedBody).passwordsCreated, 0);
});

test("j. apply with one changed token is a conflict with a preview and no writes", () => {
  const docs = makeDocs();
  const request = applyRequest(THREE_NEW, ["delta-writer"], docs);
  if (request.mode !== "apply") throw new Error("unreachable");
  request.tokens = { ...request.tokens, tracking: "etag-tracking-0" };
  const result = decideCandidateImport(request, docs, NOW);
  assert.equal(result.status, 409);
  assert.deepEqual(result.writes, []);
  const body = result.body as CandidateImportConflictBody;
  assert.equal(body.conflict, true);
  assert.equal(typeof body.notice, "string");
  assert.equal(body.preview.mode, "preview");
  assert.equal(body.preview.summary.total, 3);
});

test("k. apply selecting a blocked slug or a slug not in the paste is refused", () => {
  const docs = makeDocs();
  const text = paste(pasted("alpha-reader", "Alpha Reader Two"), pasted("delta-writer", "Delta Writer"));

  const blocked = decideCandidateImport(applyRequest(text, ["alpha-reader"], docs), docs, NOW);
  assert.equal(blocked.status, 400);
  assert.deepEqual(blocked.writes, []);
  assert.ok((blocked.body as CandidateImportErrorBody).error.includes("alpha-reader"));

  const missing = decideCandidateImport(applyRequest(text, ["delta-writer", "zulu"], docs), docs, NOW);
  assert.equal(missing.status, 400);
  assert.deepEqual(missing.writes, []);
  assert.ok((missing.body as CandidateImportErrorBody).error.includes("zulu"));
});

test("l. candidate absent is a 500; added absent still previews", () => {
  const noCandidate = makeDocs({ candidate: null });
  const result = decideCandidateImport({ mode: "preview", text: THREE_NEW }, noCandidate, NOW);
  assert.equal(result.status, 500);
  assert.deepEqual(result.writes, []);

  const noAdded = makeDocs({ added: null });
  const body = preview(THREE_NEW, noAdded);
  assert.equal(body.tokens.added, "absent");
  assert.equal(body.summary.ready, 3);
});

test("m. purity: the same inputs give deep-equal results on two calls", () => {
  const docs = makeDocs();
  const previewRequest: CandidateImportRequest = { mode: "preview", text: THREE_NEW };
  assert.deepEqual(
    decideCandidateImport(previewRequest, docs, NOW),
    decideCandidateImport(previewRequest, docs, NOW),
  );
  const apply = applyRequest(THREE_NEW, ["delta-writer", "echo-maps"], docs);
  assert.deepEqual(decideCandidateImport(apply, docs, NOW), decideCandidateImport(apply, docs, NOW));
});

test("n. parseCandidateImportRequest refuses malformed apply requests and unknown modes", () => {
  const tokens = Object.fromEntries(IMPORT_KEYS.map((k) => [k, `etag-${k}-1`]));
  const ok = parseCandidateImportRequest({ mode: "apply", text: "x", selected: ["a"], tokens });
  assert.equal(ok.ok, true);

  assert.equal(parseCandidateImportRequest({ mode: "apply", text: "x", selected: ["a"] }).ok, false);

  const four = { ...tokens };
  delete four.published;
  assert.equal(parseCandidateImportRequest({ mode: "apply", text: "x", selected: ["a"], tokens: four }).ok, false);

  assert.equal(parseCandidateImportRequest({ mode: "apply", text: "x", selected: ["a", "a"], tokens }).ok, false);

  assert.equal(parseCandidateImportRequest({ mode: "delete", text: "x" }).ok, false);
});
