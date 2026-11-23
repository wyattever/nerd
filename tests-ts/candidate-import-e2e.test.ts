/**
 * End-to-end emulator test of bulk Candidate import.
 *
 * Seeds fixture documents in the Firestore EMULATOR and runs preview and
 * apply through transactDocuments and decideCandidateImport with the same
 * wiring as app/api/local/candidate-import/route.ts. Every expectation comes
 * from the design document "N.E.R.D. Bulk Candidate Import", cited beside
 * the assertion as "design: <section>". Expectations were not discovered by
 * running the code.
 *
 * Run (from the repo root, with the Firestore emulator running):
 *   env -u GOOGLE_CLOUD_PROJECT FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *     NERD_FIREBASE_PROJECT_ID=edtech-agent-2026 node --experimental-transform-types \
 *     --import ./tests-ts/support/ts-resolve.mjs --test tests-ts/candidate-import-e2e.test.ts
 *
 * Without FIRESTORE_EMULATOR_HOST, one test is registered as skipped and
 * nothing else is loaded. Any host other than 127.0.0.1:8080 fails at once,
 * before documents.ts is imported.
 *
 * WARNING: this seeds and OVERWRITES the candidate, tracking, passwords,
 * added and published nerd_documents keys in the EMULATOR. Afterwards, stop
 * the emulator and restart it from emulator-data:
 *   firebase emulators:start --only firestore --import=emulator-data
 * Never export. Password fixtures are fake ("pw-fixture-…"); assertions
 * about passwords compare row names and counts only.
 *
 * Coverage (design section → test):
 *   Proposed design, per-record status: ready / blocked (website duplicate,
 *     empty ACR title); no document changes on preview ............ E1
 *   Proposed design, writes on apply: candidate order, placeholder URL,
 *     no tracking_* keys, "Gathering" row, new password row, added and
 *     published untouched ......................................... E2
 *   Q2, duplicate check: a repeat import is blocked as already in
 *     Candidates .................................................. E5 (runs after E2)
 *   Proposed design, route contract: stale tokens give 409 with a
 *     conflict body and write nothing ............................. E3
 *   Proposed design, per-record status: selecting a blocked slug gives
 *     400 and writes nothing ...................................... E4
 */

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

const SKIP_MESSAGE =
  "FIRESTORE_EMULATOR_HOST is not set; skipping the emulator-backed bulk candidate import end-to-end tests";
const EXPECTED_HOST = "127.0.0.1:8080";
const EXPECTED_PROJECT = "edtech-agent-2026";
const ACTOR = "candidate-import-e2e";
const SEED_ACTOR = "candidate-import-e2e-seed";

const host = process.env.FIRESTORE_EMULATOR_HOST;

if (host === undefined || host === "") {
  test("bulk candidate import end to end (emulator)", { skip: SKIP_MESSAGE }, () => {});
} else if (host !== EXPECTED_HOST) {
  throw new Error(
    `FIRESTORE_EMULATOR_HOST is "${host}"; these tests run only against ${EXPECTED_HOST}. Refusing to load documents.ts.`
  );
} else {
  const documents = await import("../frontend/lib/server/documents.ts");
  const admin = await import("../frontend/lib/server/firebase-admin.ts");
  const importer = await import("../frontend/lib/server/candidate-import.ts");
  const { transactDocuments, saveUnguarded, tryReadRaw } = documents;
  const { IMPORT_KEYS, parseCandidateImportRequest, decideCandidateImport } = importer;
  type DocumentKey = import("../frontend/lib/server/documents.ts").DocumentKey;
  type PreviewBody = import("../frontend/lib/server/candidate-import.ts").CandidateImportPreviewBody;
  type Rec = Record<string, unknown>;

  // -------------------------------------------------------------------------
  // Fixtures (invented)
  // -------------------------------------------------------------------------

  const P = (slug: string): string => `https://ncademi.org/provide/directory/products/${slug}/`;

  function product(slug: string, name: string, extra: Rec = {}): Rec {
    return {
      slug,
      product_name: name,
      ncademi_product_url: P(slug),
      vendor_name: null,
      vendor_directory_url: null,
      product_website_url: null,
      product_description: `stored ${name}`,
      vendor_resources: [],
      other_resources: [],
      support_contacts: [],
      acr_reports: [],
      last_updated: null,
      ai_insights: null,
      ...extra,
    };
  }

  /** A pasted record as the research Project sends it: placeholder fields null or left out. */
  function pasted(slug: string, name: string, extra: Rec = {}): Rec {
    return {
      slug,
      product_name: name,
      vendor_name: `${name} Co.`,
      product_website_url: null,
      product_description: `research result for ${name}`,
      ncademi_product_url: null,
      vendor_resources: [],
      other_resources: [],
      support_contacts: [],
      acr_reports: [],
      ...extra,
    };
  }

  const products = (rows: Rec[]): Rec => ({ $schema_version: 1, $meta: { purpose: "e2e fixture" }, products: rows });

  const SEED: Record<string, Rec> = {
    candidate: products([product("alpha-reader", "Alpha Reader"), product("beta-math", "Beta Math")]),
    added: products([product("gamma-science", "Gamma Science")]),
    published: products([
      product("delta-writing", "Delta Writing", { product_website_url: "https://delta.example/" }),
    ]),
    tracking: { $schema_version: 1, $meta: {}, tracking: [] },
    passwords: {
      $schema_version: 1,
      $meta: {},
      passwords: [
        {
          product_name: "Alpha Reader",
          vendor_name: null,
          password: "pw-fixture-1",
          timestamp: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
  };

  const EPSILON = pasted("epsilon-art", "Epsilon Art", { tracking_status: "Done" });
  const DELTA_PLUS = pasted("delta-writing-plus", "Delta Writing Plus", {
    product_website_url: "http://www.delta.example",
  });
  const ZETA = pasted("zeta", "Zeta", {
    acr_reports: [{ title: "", url: null, version: null, date: null, auditor_name: null, auditor_url: null }],
  });

  const serialize = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
  const paste = (...records: Rec[]): string => records.map((r) => JSON.stringify(r, null, 2)).join("\n\n");
  const E1_TEXT = paste(EPSILON, DELTA_PLUS, ZETA);

  // -------------------------------------------------------------------------
  // Emulator helpers
  // -------------------------------------------------------------------------

  /** Seeds the five import documents through the documents layer. */
  async function seed(): Promise<void> {
    for (const key of IMPORT_KEYS) {
      await saveUnguarded({ key, bytes: serialize(SEED[key]), actor: SEED_ACTOR });
    }
  }

  async function etags(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const key of IMPORT_KEYS) {
      const found = await tryReadRaw(key);
      out[key] = found ? found.etag : "absent";
    }
    return out;
  }

  async function bytesOf(key: DocumentKey): Promise<string | null> {
    const found = await tryReadRaw(key);
    return found ? found.data : null;
  }
  async function parsed(key: DocumentKey): Promise<Rec> {
    const b = await bytesOf(key);
    assert.ok(b !== null, `${key} exists`);
    return JSON.parse(b) as Rec;
  }

  /** The route's wiring: parseCandidateImportRequest, then one transactDocuments call around decideCandidateImport. */
  async function run(body: Rec): Promise<{ status: number; body: Rec }> {
    const parsedRequest = parseCandidateImportRequest(body);
    if (!parsedRequest.ok) return { status: 400, body: { error: parsedRequest.error } };
    const req = parsedRequest.request;
    const now = new Date();
    return transactDocuments({
      keys: IMPORT_KEYS,
      actor: ACTOR,
      decide: (docs) => {
        const d = decideCandidateImport(req, docs, now);
        return { writes: d.writes, deletes: [], result: { status: d.status, body: d.body as unknown as Rec } };
      },
    });
  }
  const preview = (text: string) => run({ mode: "preview", text });
  const apply = (text: string, selected: string[], tokens: unknown) => run({ mode: "apply", text, selected, tokens });

  function previewOf(r: { status: number; body: Rec }): PreviewBody {
    assert.equal(r.status, 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
    assert.equal(r.body.mode, "preview");
    return r.body as unknown as PreviewBody;
  }

  // -------------------------------------------------------------------------
  // Tests (E5 runs right after E2 because it depends on E2's import;
  // E3 and E4 reseed)
  // -------------------------------------------------------------------------

  describe("bulk candidate import end to end (emulator)", () => {
    let e1Tokens: Record<string, string> = {};

    before(async () => {
      const projectId = admin.db().projectId;
      console.log(`projectId: ${projectId}`);
      assert.equal(projectId, EXPECTED_PROJECT, "refusing to run against any other project");
      await seed();
    });

    after(async () => {
      await admin.db().terminate();
    });

    test("E1 preview: ready, blocked (website), blocked (empty ACR title); nothing written", async () => {
      const before = await etags();
      const body = previewOf(await preview(E1_TEXT));
      e1Tokens = body.tokens;

      // design: Proposed design, per-record status
      assert.deepEqual(
        body.records.map((r) => [r.slug, r.status]),
        [
          ["epsilon-art", "ready"],
          ["delta-writing-plus", "blocked"],
          ["zeta", "blocked"],
        ],
        JSON.stringify(body.records)
      );
      // design: Proposed design, per-record status (duplicate of Published by website)
      assert.ok(
        body.records[1].issues.some((i) => i.includes("Published") && i.includes("website")),
        JSON.stringify(body.records[1].issues)
      );
      // design: Proposed design, per-record status (empty ACR title)
      assert.ok(
        body.records[2].issues.some((i) => i.startsWith("acr_reports[0]")),
        JSON.stringify(body.records[2].issues)
      );
      // design: Proposed design, per-record status (a preview writes nothing)
      assert.deepEqual(await etags(), before);
      assert.deepEqual(body.tokens, before);
    });

    test("E2 apply epsilon-art with E1's tokens: candidate, tracking and passwords written", async () => {
      const before = await etags();
      const r = await apply(E1_TEXT, ["epsilon-art"], e1Tokens);
      // design: Proposed design, writes on apply
      assert.equal(r.status, 200, JSON.stringify(r.body));

      const candidate = (await parsed("candidate")).products as Rec[];
      // design: Proposed design, writes on apply (candidate sorted by product_name)
      assert.deepEqual(
        candidate.map((p) => p.product_name),
        ["Alpha Reader", "Beta Math", "Epsilon Art"]
      );
      const epsilon = candidate.find((p) => p.slug === "epsilon-art");
      assert.ok(epsilon, "epsilon-art stored");
      // design: Proposed design, writes on apply (placeholder ncademi_product_url)
      assert.ok(String(epsilon.ncademi_product_url).endsWith("/epsilon-art/"), String(epsilon.ncademi_product_url));
      // design: Proposed design, writes on apply (tracking fields live in the tracking document)
      assert.deepEqual(
        Object.keys(epsilon).filter((k) => k.startsWith("tracking_")),
        []
      );

      const tracking = (await parsed("tracking")).tracking as Rec[];
      const row = tracking.find((t) => t.product_name === "Epsilon Art");
      // design: Proposed design, writes on apply ("Gathering" tracking row)
      assert.ok(row, "Epsilon Art tracking row");
      assert.equal(row.tracking_status, "Gathering");

      const passwords = (await parsed("passwords")).passwords as Rec[];
      // design: Proposed design, writes on apply (one new password row)
      assert.equal(passwords.length, 2);
      assert.deepEqual(
        passwords.map((p) => p.product_name).sort(),
        ["Alpha Reader", "Epsilon Art"]
      );

      const afterTags = await etags();
      // design: Proposed design, writes on apply (added and published only read)
      assert.equal(afterTags.added, before.added);
      assert.equal(afterTags.published, before.published);
    });

    test("E5 (after E2) a repeat preview of Epsilon Art is blocked as already in Candidates", async () => {
      const body = previewOf(await preview(paste(EPSILON)));
      // design: Q2, duplicate check
      assert.equal(body.records[0].status, "blocked");
      assert.ok(
        body.records[0].issues.some((i) => i.includes("Already in Candidates")),
        JSON.stringify(body.records[0].issues)
      );
    });

    test("E3 stale tokens: 409 conflict, nothing written", async () => {
      await seed();
      const tokens = previewOf(await preview(E1_TEXT)).tokens;
      const before = await etags();

      const changed = serialize(
        products([
          product("alpha-reader", "Alpha Reader"),
          product("beta-math", "Beta Math"),
          product("theta-music", "Theta Music"),
        ])
      );
      await saveUnguarded({ key: "candidate", bytes: changed, actor: SEED_ACTOR });

      const r = await apply(E1_TEXT, ["epsilon-art"], tokens);
      // design: Proposed design, route contract
      assert.equal(r.status, 409, JSON.stringify(r.body));
      assert.equal(r.body.conflict, true);
      assert.equal(typeof r.body.notice, "string");
      assert.equal((r.body.preview as Rec).mode, "preview");
      // design: Proposed design, route contract (a conflict writes nothing)
      assert.equal(await bytesOf("candidate"), changed);
      const afterTags = await etags();
      assert.equal(afterTags.tracking, before.tracking);
      assert.equal(afterTags.passwords, before.passwords);
    });

    test("E4 selecting a blocked slug: 400, nothing written", async () => {
      await seed();
      const tokens = previewOf(await preview(E1_TEXT)).tokens;
      const before = await etags();

      const r = await apply(E1_TEXT, ["delta-writing-plus"], tokens);
      // design: Proposed design, per-record status
      assert.equal(r.status, 400, JSON.stringify(r.body));
      assert.deepEqual(await etags(), before);
    });
  });
}
