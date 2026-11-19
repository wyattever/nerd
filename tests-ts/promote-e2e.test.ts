/**
 * End-to-end emulator test of the mirror promote (plan §4 step 7).
 *
 * Seeds fixture documents in the Firestore EMULATOR and runs preview, then
 * apply, through transactDocuments and decidePromote with the same wiring
 * as app/api/local/promote-live/route.ts. Every expectation is derived from
 * the plan's text (§3.2–3.4 case tables, §3.9, §3.13 and the D-rulings they
 * cite), quoted beside the assertion with its § and line. Expectations were
 * not discovered by running the pipeline.
 *
 * Run (from the repo root, with the Firestore emulator running):
 *   env -u GOOGLE_CLOUD_PROJECT FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *     NERD_FIREBASE_PROJECT_ID=edtech-agent-2026 node --experimental-transform-types \
 *     --import ./tests-ts/support/ts-resolve.mjs --test tests-ts/promote-e2e.test.ts
 *
 * Without FIRESTORE_EMULATOR_HOST, one test is registered as skipped and
 * nothing else is loaded. Any host other than 127.0.0.1:8080 fails at once,
 * before documents.ts is imported.
 *
 * WARNING: this seeds and OVERWRITES all nine nerd_documents keys in the
 * EMULATOR. Afterwards, stop the emulator and restart it from emulator-data:
 *   firebase emulators:start --only firestore --import=emulator-data
 * Never export. Password fixtures are fake ("pw-fixture-…"); assertions
 * about passwords compare row names and counts only.
 *
 * Coverage (plan row → test; each assertion is tagged [row] in this file):
 *   A1 §3.2:99  protected_unlocked → updated ............ E1
 *   A2 §3.2:100 password_rejected → needs correct pw ...... E1, E7
 *   A3 §3.2:101 no_password → needs password .............. E1
 *   A4 §3.2:102 fetch/parse error → untouched ............. E1
 *   A5 §3.2:103 public_ok → removed: now public ........... E1
 *   A6 §3.2:104 no outcome, discovery complete → removed .. E1
 *   A7 §3.2:105 no outcome, discovery incomplete .......... E4
 *   A8 §3.2:106 (no stored) not_tracked → listed .......... E1
 *   P1 §3.3:124 public_ok → updated ........................ E2
 *   P2 §3.3:125 fetch/parse error → untouched ............. E2
 *   P3 §3.3:126 protected statuses → removed: now protected E2
 *   P4 §3.3:127 no outcome, discovery complete → removed .. E2
 *   P5 §3.3:128 no outcome, discovery incomplete .......... E4
 *   P6 §3.3:129 (no stored) public_ok → append ............ E2
 *   V1 §3.4:141 public_ok → updated ........................ E3
 *   V2 §3.4:142 protected_vendor → untouched (D22) ........ E3
 *   V3 §3.4:143 fetch/parse error → untouched ............. E3
 *   V4 §3.4:144 no outcome, discovery complete → removed .. E3
 *   V5 §3.4:145 no outcome, discovery incomplete .......... E3 (vendor-incomplete run)
 *   V6 §3.4:146 (no stored) public_ok → append ............ E3
 *   V7 §3.4:147 (no stored) protected_vendor → listed ..... E3
 *   V8 §3.4:148 no directory URL → untouched (D36a) ....... E3
 *   V9 §3.4:149 live name matches URL-less vendor (D36b) .. E3
 */

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

const SKIP_MESSAGE =
  "FIRESTORE_EMULATOR_HOST is not set; skipping the emulator-backed mirror promote end-to-end tests (step 7)";
const EXPECTED_HOST = "127.0.0.1:8080";
const EXPECTED_PROJECT = "edtech-agent-2026";
const ACTOR = "step7-e2e";
const SEED_ACTOR = "step7-e2e-seed";

const host = process.env.FIRESTORE_EMULATOR_HOST;

if (host === undefined || host === "") {
  test("mirror promote end to end (emulator)", { skip: SKIP_MESSAGE }, () => {});
} else if (host !== EXPECTED_HOST) {
  throw new Error(
    `FIRESTORE_EMULATOR_HOST is "${host}"; these tests run only against ${EXPECTED_HOST}. Refusing to load documents.ts.`
  );
} else {
  const documents = await import("../frontend/lib/server/documents.ts");
  const admin = await import("../frontend/lib/server/firebase-admin.ts");
  const mirror = await import("../frontend/lib/server/promote-mirror.ts");
  const { transactDocuments, saveUnguarded, deleteDocument, tryReadRaw } = documents;
  const { parsePromoteRequest, decidePromote, promoteDocumentKeys } = mirror;
  type DocumentKey = import("../frontend/lib/server/documents.ts").DocumentKey;
  type PlanBody = import("../frontend/lib/server/promote-mirror.ts").PromotePlanBody;
  type Category = "published" | "added" | "vendors";
  type Rec = Record<string, unknown>;

  const ALL_KEYS: DocumentKey[] = [
    "published",
    "added",
    "candidate",
    "vendors",
    "published-live",
    "added-live",
    "vendors-live",
    "passwords",
    "tracking",
  ];
  const STORED_KEYS: DocumentKey[] = ["published", "added", "candidate", "vendors"];
  const LIVE_KEY: Record<Category, DocumentKey> = {
    published: "published-live",
    added: "added-live",
    vendors: "vendors-live",
  };
  // §3.12 D35 (plan:277): `generated_from` is `mirror promote via /records ("Update Stored Data")`.
  const GENERATED_FROM = 'mirror promote via /records ("Update Stored Data")';
  // §3.13 Processing step 3 (plan:335).
  const NO_LIVE_DATA = 'No live data to promote. Run "Retrieve Live Data" first.';

  // -------------------------------------------------------------------------
  // Fixture builders
  // -------------------------------------------------------------------------

  const P = (slug: string): string => `https://ncademi.org/provide/directory/products/${slug}/`;
  const V = (slug: string): string => `https://ncademi.org/provide/directory/vendors/${slug}/`;
  const slugOf = (url: string): string => url.split("/").filter(Boolean).pop() ?? url;

  function product(name: string, url: string, extra: Rec = {}): Rec {
    return {
      slug: slugOf(url),
      product_name: name,
      ncademi_product_url: url,
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

  /** A scraped product record as the scraper writes it: no slug, no ai_insights, with is_protected. */
  function liveProduct(name: string, url: string, isProtected: boolean, extra: Rec = {}): Rec {
    return {
      product_name: name,
      ncademi_product_url: url,
      vendor_name: null,
      vendor_directory_url: null,
      product_website_url: null,
      product_description: `live ${name}`,
      vendor_resources: [],
      other_resources: [],
      support_contacts: [],
      acr_reports: [],
      last_updated: null,
      is_protected: isProtected,
      ...extra,
    };
  }

  function vendor(name: string, url: string | null, extra: Rec = {}): Rec {
    return {
      kind: "vendor",
      slug: name.toLowerCase().replace(/\s+/g, "-"),
      product_name: name,
      vendor_name: name,
      vendor_directory_url: url,
      product_website_url: null,
      product_description: `stored ${name}`,
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

  type Outcome = { url: string; post_type: "product" | "vendor"; status: string; name: string | null; detail: string | null };

  function outcome(url: string, status: string, name: string | null = null, detail: string | null = null): Outcome {
    return { url, post_type: url.includes("/vendors/") ? "vendor" : "product", status, name, detail };
  }

  interface RunOptions {
    runId?: string;
    target?: string;
    productComplete?: boolean;
    vendorComplete?: boolean;
    productError?: string | null;
    vendorError?: string | null;
  }

  /** A §3.9 run record: one outcome per discovered URL; discovered = outcome count per post type. */
  function makeRun(outcomes: Outcome[], opts: RunOptions = {}): Rec {
    const productCount = outcomes.filter((o) => o.post_type === "product").length;
    const vendorCount = outcomes.filter((o) => o.post_type === "vendor").length;
    const productComplete = opts.productComplete ?? true;
    const vendorComplete = opts.vendorComplete ?? true;
    return {
      run_id: opts.runId ?? "run-step7",
      started_at: "2026-11-19T20:00:00Z",
      finished_at: "2026-11-19T20:07:00Z",
      target: opts.target ?? "all",
      discovery: {
        product: {
          complete: productComplete,
          expected_total: productComplete ? productCount : productCount + 3,
          discovered: productCount,
          error: opts.productError ?? null,
        },
        vendor: {
          complete: vendorComplete,
          expected_total: vendorComplete ? vendorCount : vendorCount + 2,
          discovered: vendorCount,
          error: opts.vendorError ?? null,
        },
      },
      outcomes,
    };
  }

  const STORED_META = {
    purpose: "step7 fixture",
    custom_key: "keep-me",
    snapshot_taken_at: "2026-01-01T00:00:00Z",
    generated_from: "fixture",
  };

  function storedProducts(records: Rec[]): Rec {
    return { $schema_version: 3, $meta: { ...STORED_META, total_products: records.length }, products: records };
  }
  function storedVendors(records: Rec[]): Rec {
    return { $schema_version: 3, $meta: { ...STORED_META, total_vendors: records.length }, vendors: records };
  }
  function liveDoc(category: Category, records: Rec[], run: Rec): Rec {
    return {
      $meta: {
        last_scraped: run.finished_at,
        total_records: records.length,
        generated_by: "scrape_ncademi_live.py",
        run,
      },
      [category === "vendors" ? "vendors" : "products"]: records,
    };
  }

  let pwCounter = 0;
  function passwordsDoc(names: string[]): Rec {
    return {
      $schema_version: 1,
      $meta: { purpose: "step7 fixture" },
      passwords: names.map((name) => ({
        product_name: name,
        vendor_name: null,
        password: `pw-fixture-${++pwCounter}`,
        timestamp: "2026-01-01T00:00:00Z",
      })),
    };
  }
  function trackingDoc(names: string[]): Rec {
    return {
      $schema_version: 1,
      $meta: { purpose: "step7 fixture" },
      tracking: names.map((name) => ({
        product_name: name,
        tracking_priority: "High",
        tracking_status: "gathering",
        tracking_gatherer: null,
        tracking_reviewer: null,
      })),
    };
  }

  const serialize = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

  // -------------------------------------------------------------------------
  // Emulator helpers
  // -------------------------------------------------------------------------

  const ref = (key: DocumentKey) => admin.db().collection("nerd_documents").doc(key);
  const backupRef = (key: DocumentKey) => ref(key).collection("backups").doc("latest");

  /** Seeds every one of the nine keys: an object is written, null makes it absent. */
  async function seedAll(spec: Record<string, Rec | null>): Promise<Record<string, string | null>> {
    const bytes: Record<string, string | null> = {};
    for (const key of ALL_KEYS) {
      if (!(key in spec)) throw new Error(`seedAll: no spec for "${key}"`);
      const value = spec[key];
      if (value === null) {
        await deleteDocument(key, SEED_ACTOR);
        bytes[key] = null;
      } else {
        const b = serialize(value);
        await saveUnguarded({ key, bytes: b, actor: SEED_ACTOR });
        bytes[key] = b;
      }
    }
    return bytes;
  }

  async function etags(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const key of ALL_KEYS) {
      const snap = await ref(key).get();
      out[key] = snap.exists ? (snap.get("etag") as string) : "absent";
    }
    return out;
  }

  async function bytesOf(key: DocumentKey): Promise<string | null> {
    const found = await tryReadRaw(key);
    return found ? found.data : null;
  }
  async function parsed(key: DocumentKey): Promise<Rec | null> {
    const b = await bytesOf(key);
    return b === null ? null : (JSON.parse(b) as Rec);
  }
  async function backupBytes(key: DocumentKey): Promise<string | null> {
    const snap = await backupRef(key).get();
    return snap.exists ? (snap.get("bytes") as string) : null;
  }
  async function passwordNames(): Promise<string[]> {
    const doc = await parsed("passwords");
    return doc === null ? [] : (doc.passwords as Rec[]).map((r) => r.product_name as string);
  }
  async function trackingNames(): Promise<string[]> {
    const doc = await parsed("tracking");
    return doc === null ? [] : (doc.tracking as Rec[]).map((r) => r.product_name as string).sort();
  }

  /** The route's wiring: parsePromoteRequest, then one transactDocuments call around decidePromote. */
  async function promote(body: Rec): Promise<{ status: number; body: Rec }> {
    const parsedRequest = parsePromoteRequest(body);
    if (!parsedRequest.ok) return { status: 400, body: { error: parsedRequest.error } };
    const req = parsedRequest.request;
    return transactDocuments({
      keys: promoteDocumentKeys(req.category),
      actor: ACTOR,
      decide: (docs) => {
        const d = decidePromote(req, docs);
        return { writes: d.writes, deletes: d.deletes, result: { status: d.status, body: d.body as unknown as Rec } };
      },
    });
  }
  const preview = (category: Category) => promote({ category, mode: "preview" });
  const apply = (category: Category, tokens: unknown) => promote({ category, mode: "apply", tokens });

  function planOf(r: { status: number; body: Rec }, outcomeName: "preview" | "applied"): PlanBody {
    assert.equal(r.status, 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
    assert.equal(r.body.outcome, outcomeName);
    return r.body as unknown as PlanBody;
  }

  /** Preview, then apply with the preview's tokens (§3.13 "For step 6"). */
  async function previewThenApply(category: Category): Promise<{ preview: PlanBody; applied: PlanBody }> {
    const p = planOf(await preview(category), "preview");
    const a = planOf(await apply(category, p.tokens), "applied");
    return { preview: p, applied: a };
  }

  const byUrl = (records: Rec[], key: string, url: string): Rec | undefined => records.find((r) => r[key] === url);
  const hasEntry = (list: Rec[] | { url: string }[], url: string): boolean => list.some((e) => (e as Rec).url === url);

  /**
   * §3.12 D35 (plan:274-280) envelope, §3.13 step 9 (plan:342-347) backups, and
   * D30 (plan:264): only the category's stored document, passwords, tracking and
   * the live deletion may change; the other three stored documents are untouched.
   */
  async function assertApplyEffects(
    category: Category,
    before: Record<string, string | null>,
    run: Rec,
    applied: PlanBody
  ): Promise<Rec[]> {
    const arrayKey = category === "vendors" ? "vendors" : "products";
    const totalKey = category === "vendors" ? "total_vendors" : "total_products";
    const doc = (await parsed(category)) as Rec;
    const records = doc[arrayKey] as Rec[];
    const meta = doc.$meta as Rec;
    // D35 (plan:275): `snapshot_taken_at` is `run.finished_at`.
    assert.equal(meta.snapshot_taken_at, run.finished_at);
    // D35 (plan:276): `total_products` or `total_vendors` is the length of the new stored array.
    assert.equal(meta[totalKey], records.length);
    // D35 (plan:277): `generated_from`.
    assert.equal(meta.generated_from, GENERATED_FROM);
    // D35 (plan:278): `run_id` is `run.run_id`.
    assert.equal(meta.run_id, run.run_id);
    // D35 (plan:280): "Other `$meta` keys and `$schema_version` are carried over unchanged."
    assert.equal(meta.purpose, STORED_META.purpose);
    assert.equal(meta.custom_key, STORED_META.custom_key);
    assert.equal(doc.$schema_version, 3);
    // §3.13 plan:356: counts.storedAfter is the new array length.
    assert.equal(applied.counts.storedAfter, records.length);
    // §3.13 plan:345: "The live snapshot is deleted, after its rolling backup is refreshed."
    const liveKey = LIVE_KEY[category];
    assert.equal(await bytesOf(liveKey), null, `${liveKey} is gone`);
    assert.equal(await backupBytes(liveKey), before[liveKey], `${liveKey} backup = pre-apply live bytes`);
    // §3.13 plan:347: "Every written document gets its rolling backup (`stageWrite`)."
    assert.equal(await backupBytes(category), before[category], `${category} backup = pre-apply stored bytes`);
    // D30 (plan:264): the other three stored documents are only read.
    for (const key of STORED_KEYS.filter((k) => k !== category)) {
      assert.equal(await bytesOf(key), before[key], `${key} byte-identical`);
    }
    return records;
  }

  // -------------------------------------------------------------------------
  // Tests
  // -------------------------------------------------------------------------

  describe("mirror promote end to end (emulator)", () => {
    before(() => {
      const projectId = admin.db().projectId;
      console.log(`projectId: ${projectId}`);
      assert.equal(projectId, EXPECTED_PROJECT, "refusing to run against any other project");
    });

    after(async () => {
      await admin.db().terminate();
    });

    test("E1 Added, every row (§3.2)", async () => {
      const a = P("alpha"), b = P("bravo"), c = P("charlie"), d = P("delta"), e = P("echo"),
        f = P("foxtrot"), g = P("golf"), h = P("hotel");
      const stored = [
        product("Alpha", a), product("Bravo", b), product("Charlie", c), product("Delta", d),
        product("Echo", e), product("Foxtrot", f), product("Golf", g),
      ];
      const run = makeRun([
        outcome(a, "protected_unlocked", "Alpha"),
        outcome(b, "password_rejected", "Bravo"),
        outcome(c, "no_password", "Charlie"),
        outcome(d, "fetch_error", "Delta", "HTTP 503"),
        outcome(e, "parse_error", "Echo", "no <article>"),
        outcome(f, "public_ok", "Foxtrot"),
        outcome(h, "not_tracked", "Hotel & Co"),
      ]);
      const before = await seedAll({
        published: storedProducts([product("Zulu", P("zulu"))]),
        added: storedProducts(stored),
        // "Bravo" is also a candidate name, to show that D20 does not protect A2's password row.
        candidate: storedProducts([product("Bravo", P("bravo-candidate"))]),
        vendors: storedVendors([vendor("Acme", V("acme"))]),
        "published-live": null,
        "added-live": liveDoc("added", [liveProduct("Alpha", a, true, { product_description: "live alpha" })], run),
        "vendors-live": null,
        passwords: passwordsDoc(["Alpha", "Bravo", "Delta", "Echo", "Foxtrot", "Golf"]),
        tracking: trackingDoc(["Alpha", "Bravo", "Delta", "Foxtrot", "Golf"]),
      });

      const { preview: pv, applied } = await previewThenApply("added");
      assert.equal(pv.deletionsAllowed, true);
      const records = await assertApplyEffects("added", before, run, applied);
      const rec = (url: string) => byUrl(records, "ncademi_product_url", url);
      const pwAfter = await passwordNames();
      const trAfter = await trackingNames();

      // [A1] §3.2:99 | `protected_unlocked` | Keep, updated from the live page | Updated |
      const alpha = rec(a) as Rec;
      assert.equal(alpha.product_description, "live alpha"); // [A1] updated from the live page
      assert.equal(alpha.slug, "alpha"); // [A1] D33 (plan:270): the derived slug
      assert.equal("is_protected" in alpha, false); // [A1] D33: is_protected stripped
      assert.equal(alpha.ai_insights, null); // [A1] D33: PRODUCT_FIELD_DEFAULTS backfill
      assert.ok(hasEntry(applied.report.updated, a)); // [A1] reported as Updated
      assert.ok(pwAfter.includes("Alpha") && trAfter.includes("Alpha")); // [A1] rows untouched

      // [A2] §3.2:100 | `password_rejected` | Keep the stored record; delete the password row (D20 does not apply) | Needs correct password |
      assert.deepEqual(rec(b), stored[1]); // [A2] stored record kept unchanged
      assert.ok(hasEntry(applied.report.needsCorrectPassword, b)); // [A2] Needs correct password
      assert.equal(pwAfter.includes("Bravo"), false); // [A2] password row deleted despite candidate "Bravo" (D20 does not apply)
      assert.ok(trAfter.includes("Bravo")); // [A2] tracking row untouched

      // [A3] §3.2:101 | `no_password` | Keep the stored record | Needs password |
      assert.deepEqual(rec(c), stored[2]); // [A3] kept
      assert.ok(hasEntry(applied.report.needsPassword, c)); // [A3] Needs password

      // [A4] §3.2:102 | `fetch_error` or `parse_error` | Untouched: record and password unchanged | Could not check |
      assert.deepEqual(rec(d), stored[3]); // [A4] fetch_error: untouched
      assert.deepEqual(rec(e), stored[4]); // [A4] parse_error: untouched
      assert.ok(hasEntry(applied.report.couldNotCheck, d) && hasEntry(applied.report.couldNotCheck, e)); // [A4] Could not check
      assert.ok(pwAfter.includes("Delta") && pwAfter.includes("Echo")); // [A4] password unchanged

      // [A5] §3.2:103 | `public_ok` | Delete the record, its password row and its tracking row (subject to D20) | Removed: now public |
      assert.equal(rec(f), undefined); // [A5] deleted
      assert.ok(applied.report.removed.some((x) => x.url === f && x.name === "Foxtrot" && x.reason === "now public")); // [A5]
      assert.equal(pwAfter.includes("Foxtrot"), false); // [A5] password row deleted (name used nowhere else)
      assert.equal(trAfter.includes("Foxtrot"), false); // [A5] tracking row deleted

      // [A6] §3.2:104 | No outcome entry, and product discovery complete | Delete the record, its password row and its tracking row (subject to D20) | Removed: not on site |
      assert.equal(rec(g), undefined); // [A6] deleted
      assert.ok(applied.report.removed.some((x) => x.url === g && x.name === "Golf" && x.reason === "not on site")); // [A6]
      assert.equal(pwAfter.includes("Golf"), false); // [A6] password row deleted
      assert.equal(trAfter.includes("Golf"), false); // [A6] tracking row deleted

      // [A8] §3.2:106 | *(No stored record)* `not_tracked` | Create nothing | Listed as an untracked protected page |
      assert.equal(rec(h), undefined); // [A8] nothing created
      assert.deepEqual(applied.report.untrackedProtected, [{ url: h, name: "Hotel & Co" }]); // [A8] listed

      // Totals implied by the rows above.
      assert.equal(records.length, 5);
      assert.deepEqual(pwAfter, ["Alpha", "Delta", "Echo"]);
      assert.deepEqual(trAfter, ["Alpha", "Bravo", "Delta"]);
    });

    test("E2 Published, every row (§3.3)", async () => {
      const papa = P("papa"), quebec = P("quebec"), romeo = P("romeo"), sierra = P("sierra"),
        tango = P("tango"), uniform = P("uniform"), victor = P("victor"), whiskey = P("whiskey"), xray = P("xray");
      const stored = [
        product("Papa", papa), product("Quebec", quebec), product("Romeo", romeo), product("Sierra", sierra),
        product("Tango", tango), product("Uniform", uniform), product("Victor", victor), product("Whiskey", whiskey),
      ];
      const run = makeRun([
        outcome(papa, "public_ok", "Papa"),
        outcome(quebec, "fetch_error", "Quebec", "timeout"),
        outcome(romeo, "parse_error", "Romeo"),
        outcome(sierra, "protected_unlocked", "Sierra"),
        outcome(tango, "password_rejected", "Tango"),
        outcome(uniform, "no_password", "Uniform"),
        outcome(victor, "not_tracked", "Victor"),
        outcome(xray, "public_ok", "Xray"),
      ]);
      const before = await seedAll({
        published: storedProducts(stored),
        added: storedProducts([product("Yankee", P("yankee"))]),
        candidate: storedProducts([product("Zulu", P("zulu"))]),
        vendors: storedVendors([vendor("Acme", V("acme"))]),
        "published-live": liveDoc(
          "published",
          [liveProduct("Papa", papa, false, { product_description: "live papa" }), liveProduct("Xray", xray, false)],
          run
        ),
        "added-live": null,
        "vendors-live": null,
        passwords: passwordsDoc(["Sierra", "Tango"]),
        tracking: trackingDoc(["Papa", "Sierra", "Tango", "Uniform", "Victor", "Whiskey"]),
      });
      const etagsBefore = await etags();

      const { applied } = await previewThenApply("published");
      const records = await assertApplyEffects("published", before, run, applied);
      const rec = (url: string) => byUrl(records, "ncademi_product_url", url);
      const trAfter = await trackingNames();

      // [P1] §3.3:124 | `public_ok` | Keep, updated from the live page | Updated |
      assert.equal((rec(papa) as Rec).product_description, "live papa"); // [P1]
      assert.equal("is_protected" in (rec(papa) as Rec), false); // [P1] D33
      assert.ok(hasEntry(applied.report.updated, papa)); // [P1] Updated

      // [P2] §3.3:125 | `fetch_error` or `parse_error` | Untouched | Could not check |
      assert.deepEqual(rec(quebec), stored[1]); // [P2] fetch_error untouched
      assert.deepEqual(rec(romeo), stored[2]); // [P2] parse_error untouched
      assert.ok(hasEntry(applied.report.couldNotCheck, quebec) && hasEntry(applied.report.couldNotCheck, romeo)); // [P2]

      // [P3] §3.3:126 | `protected_unlocked`, `password_rejected`, `no_password` or `not_tracked` | Delete the record and its tracking row (subject to D20) | Removed: now protected |
      for (const [url, name] of [[sierra, "Sierra"], [tango, "Tango"], [uniform, "Uniform"], [victor, "Victor"]]) {
        assert.equal(rec(url), undefined, `${name} deleted`); // [P3]
        assert.ok(applied.report.removed.some((x) => x.url === url && x.name === name && x.reason === "now protected"), name); // [P3]
        assert.equal(trAfter.includes(name), false, `${name} tracking row deleted`); // [P3]
      }
      // [P3] the row deletes the record and its tracking row only: no password row is touched.
      assert.deepEqual(applied.passwordNamesToDelete, []); // [P3]
      assert.equal((await etags()).passwords, etagsBefore.passwords); // [P3] passwords document unchanged

      // [P4] §3.3:127 | No outcome entry, and product discovery complete | Delete the record and its tracking row (subject to D20) | Removed: not on site |
      assert.equal(rec(whiskey), undefined); // [P4]
      assert.ok(applied.report.removed.some((x) => x.url === whiskey && x.reason === "not on site")); // [P4]
      assert.equal(trAfter.includes("Whiskey"), false); // [P4] tracking row deleted

      // [P6] §3.3:129 | *(No stored record)* `public_ok` | Append | Added |
      const x = rec(xray) as Rec;
      assert.ok(x, "Xray appended"); // [P6]
      assert.equal(x.slug, "xray"); // [P6] D33 slug
      assert.equal(x.ai_insights, null); // [P6] D33 defaults
      assert.ok(hasEntry(applied.report.appended, xray)); // [P6] reported as Added

      assert.equal(records.length, 4);
      assert.deepEqual(trAfter, ["Papa"]);
    });

    test("E3 Vendors, every row (§3.4), with D22 and both D36 cases", async () => {
      const acme = V("acme"), beta = V("beta-corp"), gamma = V("gamma"), deltav = V("delta-v"), echov = V("echo-v"),
        newco = V("newco"), secret = V("secret"), draftSite = V("draft-co");
      const draft = vendor("Draft Co", null);
      const emptyUrl = vendor("Empty Url Co", "");
      const blankUrl = vendor("Blank Url Co", "   ");
      const betaStored = vendor("Beta Corp", beta, { product_website_url: "https://beta.example/" });
      const stored = [
        vendor("Acme", acme), betaStored, vendor("Gamma", gamma), vendor("Delta V", deltav),
        vendor("Echo V", echov), draft, emptyUrl, blankUrl,
      ];
      const run = makeRun([
        outcome(acme, "public_ok", "Acme"),
        outcome(beta, "protected_vendor"),
        outcome(gamma, "fetch_error", "Gamma", "HTTP 500"),
        outcome(deltav, "parse_error", "Delta V"),
        outcome(newco, "public_ok", "NewCo"),
        outcome(secret, "protected_vendor"),
        outcome(draftSite, "public_ok", "Draft Co Site"),
      ]);
      const liveAcme = vendor("Acme", acme, { product_website_url: "https://acme.example/" });
      delete liveAcme.slug;
      const liveNewco = vendor("NewCo", newco);
      delete liveNewco.slug;
      // D36(b): the live vendor_name differs from the stored "Draft Co" only in case and spacing.
      const liveDraft = vendor("DRAFT  co", draftSite, { vendor_name: "  draft   CO " });
      delete liveDraft.slug;
      const before = await seedAll({
        published: storedProducts([product("Zulu", P("zulu"))]),
        added: storedProducts([product("Yankee", P("yankee"))]),
        candidate: storedProducts([]),
        vendors: storedVendors(stored),
        "published-live": null,
        "added-live": null,
        "vendors-live": liveDoc("vendors", [liveAcme, liveNewco, liveDraft], run),
        passwords: passwordsDoc(["Echo V"]),
        tracking: trackingDoc(["Acme", "Beta Corp", "Echo V", "Draft Co"]),
      });

      const { preview: pv, applied } = await previewThenApply("vendors");
      assert.equal(pv.deletionsAllowed, true);
      const records = await assertApplyEffects("vendors", before, run, applied);
      const rec = (url: string) => byUrl(records, "vendor_directory_url", url);
      const named = (name: string) => records.find((r) => r.product_name === name);
      const trAfter = await trackingNames();
      const cnc = applied.report.couldNotCheck;

      // [V1] §3.4:141 | `public_ok` | Keep, updated from the live page | Updated |
      assert.equal((rec(acme) as Rec).product_website_url, "https://acme.example/"); // [V1]
      assert.equal((rec(acme) as Rec).slug, "acme"); // [V1] D33 slug
      assert.ok(hasEntry(applied.report.updated, acme)); // [V1]

      // [V2] §3.4:142 | `protected_vendor` | Untouched; the scraper's stub is **never** used to update the stored record | Could not check: protected vendor page |
      assert.deepEqual(rec(beta), betaStored); // [V2] untouched (D22)
      assert.ok(cnc.some((x) => x.url === beta && x.reason === "protected vendor page")); // [V2]

      // [V3] §3.4:143 | `fetch_error` or `parse_error` | Untouched | Could not check |
      assert.deepEqual(rec(gamma), stored[2]); // [V3]
      assert.deepEqual(rec(deltav), stored[3]); // [V3]
      assert.ok(hasEntry(cnc, gamma) && hasEntry(cnc, deltav)); // [V3]

      // [V4] §3.4:144 | No outcome entry, and vendor discovery complete | Delete the record and its tracking row (subject to D20) | Removed: not on site |
      assert.equal(rec(echov), undefined); // [V4]
      assert.ok(applied.report.removed.some((x) => x.url === echov && x.reason === "not on site")); // [V4]
      assert.equal(trAfter.includes("Echo V"), false); // [V4] tracking row deleted
      assert.deepEqual(applied.passwordNamesToDelete, []); // [V4] the row names the tracking row only

      // [V6] §3.4:146 | *(No stored record)* `public_ok` | Append | Added |
      assert.ok(rec(newco)); // [V6]
      assert.ok(hasEntry(applied.report.appended, newco)); // [V6]

      // [V7] §3.4:147 | *(No stored record)* `protected_vendor` | Append nothing | Listed as an unscraped protected vendor page |
      assert.equal(rec(secret), undefined); // [V7]
      assert.deepEqual(applied.report.unscrapedProtectedVendors, [{ url: secret }]); // [V7]

      // [V8] §3.4:148 | *(Stored record with no `vendor_directory_url`: null, empty or whitespace-only)* | Untouched, never deleted, does not block the promote (D36) | Could not check: not on the site yet (no directory URL) |
      for (const v of [draft, emptyUrl, blankUrl]) {
        assert.deepEqual(named(v.product_name as string), v, `${v.product_name} untouched`); // [V8]
        // [V8] D36(a) (plan:293): { url: "", name: <stored product_name>, reason: "not on the site yet (no directory URL)" }
        assert.ok(cnc.some((x) => x.url === "" && x.name === v.product_name && x.reason === "not on the site yet (no directory URL)")); // [V8]
      }
      assert.ok(trAfter.includes("Draft Co")); // [V8] never deleted, so its tracking row stays

      // [V9] §3.4:149 | *(No stored record with this URL)* `public_ok`, and the live `vendor_name` matches a stored vendor that has no URL (D36) | Append nothing | Could not check: possible match for that vendor; add its directory URL to link them |
      assert.equal(rec(draftSite), undefined); // [V9] not appended
      assert.equal(hasEntry(applied.report.appended, draftSite), false); // [V9]
      // [V9] D36(b) (plan:294): { url: <live vendor_directory_url>, name: <outcome name, else live product_name>, reason: "possible match for \"<stored product_name>\"; add its directory URL to link them" }
      assert.ok(
        cnc.some(
          (x) => x.url === draftSite && x.name === "Draft Co Site" && x.reason === 'possible match for "Draft Co"; add its directory URL to link them'
        )
      ); // [V9]

      assert.equal(records.length, 8);
      assert.deepEqual(trAfter, ["Acme", "Beta Corp", "Draft Co"]);
    });

    test("E3b Vendors, vendor discovery incomplete (§3.4 V5)", async () => {
      const acme = V("acme"), hotelv = V("hotel-v");
      const hotel = vendor("Hotel V", hotelv);
      const run = makeRun([outcome(acme, "public_ok", "Acme")], { vendorComplete: false, vendorError: "HTTP 503 on page 2" });
      const liveAcme = vendor("Acme", acme, { product_description: "live acme" });
      delete liveAcme.slug;
      await seedAll({
        published: storedProducts([]),
        added: storedProducts([]),
        candidate: storedProducts([]),
        vendors: storedVendors([vendor("Acme", acme), hotel]),
        "published-live": null,
        "added-live": null,
        "vendors-live": liveDoc("vendors", [liveAcme], run),
        passwords: null,
        tracking: trackingDoc(["Hotel V"]),
      });
      const etagsBefore = await etags();

      const pv = planOf(await preview("vendors"), "preview");
      // D15 (plan:78): "the planner proposes **no deletions** ... and the modal states why."
      assert.equal(pv.deletionsAllowed, false); // [V5]
      assert.equal(typeof pv.deletionsBlockedReason, "string"); // [V5]
      assert.deepEqual(pv.report.removed, []); // [V5]
      // [V5] §3.4:145 | No outcome entry, and vendor discovery incomplete | Untouched | Could not check: discovery incomplete |
      assert.ok(pv.report.couldNotCheck.some((x) => x.url === hotelv && x.reason.startsWith("discovery incomplete"))); // [V5]
      assert.ok(hasEntry(pv.report.updated, acme)); // D15: "Updates, additions and password changes still proceed."
      assert.deepEqual(pv.trackingNamesToDelete, []); // [V5] untouched: no tracking row deleted
      assert.deepEqual(await etags(), etagsBefore); // preview writes nothing (§3.13 plan:332)
    });

    test("E4 Incomplete product discovery (D15): no deletions; updates, additions and password flags proceed", async () => {
      const alpha = P("alpha"), bravo = P("bravo"), foxtrot = P("foxtrot"), golf = P("golf"),
        papa = P("papa"), whiskey = P("whiskey"), tango = P("tango"), xray = P("xray");
      const addedStored = [product("Alpha", alpha), product("Bravo", bravo), product("Foxtrot", foxtrot), product("Golf", golf)];
      const publishedStored = [product("Papa", papa), product("Whiskey", whiskey), product("Tango", tango)];
      const run = makeRun(
        [
          outcome(alpha, "protected_unlocked", "Alpha"),
          outcome(bravo, "password_rejected", "Bravo"),
          outcome(foxtrot, "public_ok", "Foxtrot"),
          outcome(papa, "public_ok", "Papa"),
          outcome(xray, "public_ok", "Xray"),
          outcome(tango, "no_password", "Tango"),
        ],
        { productComplete: false, productError: "HTTP 503 on page 2" }
      );
      const before = await seedAll({
        published: storedProducts(publishedStored),
        added: storedProducts(addedStored),
        candidate: storedProducts([]),
        vendors: storedVendors([vendor("Acme", V("acme"))]),
        "published-live": liveDoc(
          "published",
          [liveProduct("Foxtrot", foxtrot, false), liveProduct("Papa", papa, false, { product_description: "live papa" }), liveProduct("Xray", xray, false)],
          run
        ),
        "added-live": liveDoc("added", [liveProduct("Alpha", alpha, true, { product_description: "live alpha" })], run),
        "vendors-live": null,
        passwords: passwordsDoc(["Bravo", "Foxtrot", "Golf"]),
        tracking: trackingDoc(["Foxtrot", "Golf", "Whiskey", "Tango"]),
      });
      const etagsBefore = await etags();

      // D15 (plan:78): "If discovery for a post type was not complete, the planner proposes **no deletions** in the categories that depend on it, and the modal states why. Added and Published depend on `product`. Updates, additions and password changes still proceed."
      const ap = planOf(await preview("added"), "preview");
      assert.equal(ap.deletionsAllowed, false);
      assert.equal(typeof ap.deletionsBlockedReason, "string");
      assert.match(ap.deletionsBlockedReason as string, /HTTP 503 on page 2/);
      assert.deepEqual(ap.report.removed, []);
      // [A7] §3.2:105 | No outcome entry, and product discovery incomplete | Untouched | Could not check: discovery incomplete |
      assert.ok(ap.report.couldNotCheck.some((x) => x.url === golf && x.reason.startsWith("discovery incomplete"))); // [A7]
      assert.ok(hasEntry(ap.report.updated, alpha)); // D15: updates proceed
      assert.ok(hasEntry(ap.report.needsCorrectPassword, bravo)); // D15: password flags proceed
      assert.deepEqual(ap.passwordNamesToDelete, ["Bravo"]); // D15 + A2: the rejected password is still deleted

      const pp = planOf(await preview("published"), "preview");
      assert.equal(pp.deletionsAllowed, false);
      assert.deepEqual(pp.report.removed, []);
      // [P5] §3.3:128 | No outcome entry, and product discovery incomplete | Untouched | Could not check: discovery incomplete |
      assert.ok(pp.report.couldNotCheck.some((x) => x.url === whiskey && x.reason.startsWith("discovery incomplete"))); // [P5]
      assert.ok(hasEntry(pp.report.updated, papa)); // D15: updates proceed
      assert.ok(hasEntry(pp.report.appended, xray) && hasEntry(pp.report.appended, foxtrot)); // D15: additions proceed
      assert.deepEqual(await etags(), etagsBefore); // previews wrote nothing

      // Apply Added: nothing is deleted.
      const applied = planOf(await apply("added", ap.tokens), "applied");
      const records = await assertApplyEffects("added", before, run, applied);
      assert.deepEqual(applied.report.removed, []);
      assert.deepEqual(
        records.map((r) => r.product_name),
        ["Alpha", "Bravo", "Foxtrot", "Golf"]
      ); // no record deleted
      assert.deepEqual(byUrl(records, "ncademi_product_url", golf), addedStored[3]); // [A7] Golf untouched after apply
      assert.equal((byUrl(records, "ncademi_product_url", alpha) as Rec).product_description, "live alpha"); // update applied
      assert.deepEqual(await passwordNames(), ["Foxtrot", "Golf"]); // only Bravo's rejected password removed
      assert.deepEqual(await trackingNames(), ["Foxtrot", "Golf", "Tango", "Whiskey"]); // no tracking row deleted
    });

    test("E5 Shared names (D20): a name still used in candidate keeps its tracking row", async () => {
      const keep = P("keep"), shared = P("shared"), lonely = P("lonely");
      const run = makeRun([outcome(keep, "public_ok", "Keep")]);
      const before = await seedAll({
        published: storedProducts([product("Keep", keep), product("Shared", shared), product("Lonely", lonely)]),
        added: storedProducts([]),
        candidate: storedProducts([product("Shared", P("shared-candidate"))]),
        vendors: storedVendors([]),
        "published-live": liveDoc("published", [liveProduct("Keep", keep, false)], run),
        "added-live": null,
        "vendors-live": null,
        passwords: null,
        tracking: trackingDoc(["Keep", "Shared", "Lonely"]),
      });

      const { applied } = await previewThenApply("published");
      await assertApplyEffects("published", before, run, applied);
      // P4 rows: both deleted as "not on site".
      assert.ok(applied.report.removed.some((x) => x.url === shared && x.reason === "not on site"));
      assert.ok(applied.report.removed.some((x) => x.url === lonely && x.reason === "not on site"));
      // D20 (plan:91): "A password or tracking row is therefore deleted only if, after the plan is applied, **no remaining record in any category (published, added, candidate, vendors) has that `product_name`**."
      assert.deepEqual(applied.trackingNamesToDelete, ["Lonely"]);
      assert.deepEqual(await trackingNames(), ["Keep", "Shared"]);
      // D40 (plan:306): a document is "never created when absent".
      assert.equal(await bytesOf("passwords"), null);
    });

    describe("E6 Refusals write nothing", () => {
      async function assertRefusedNoWrites(category: Category, match: RegExp): Promise<void> {
        const etagsBefore = await etags();
        const pv = await preview(category);
        // §3.13 plan:359: "**Refused body** (status 409): { outcome: "refused", category, error, ... }. `error` is the planner's text, verbatim."
        assert.equal(pv.status, 409);
        assert.equal(pv.body.outcome, "refused");
        assert.match(pv.body.error as string, match);
        assert.deepEqual(await etags(), etagsBefore, "preview wrote nothing");
        const ap = await apply(category, pv.body.tokens);
        assert.equal(ap.status, 409);
        assert.equal(ap.body.outcome, "refused");
        assert.deepEqual(await etags(), etagsBefore, "apply wrote nothing");
      }

      test("E6a not a full run (D18)", async () => {
        const papa = P("papa");
        const run = makeRun([outcome(papa, "public_ok", "Papa")], { target: "published" });
        await seedAll({
          published: storedProducts([product("Papa", papa)]),
          added: storedProducts([]),
          candidate: storedProducts([]),
          vendors: storedVendors([]),
          "published-live": liveDoc("published", [liveProduct("Papa", papa, false)], run),
          "added-live": null,
          "vendors-live": null,
          passwords: null,
          tracking: null,
        });
        // D18 (plan:89): "The mirror promote accepts only a snapshot whose run record shows target `all`."
        await assertRefusedNoWrites("published", /target "published".*\(D18\)/);
      });

      test("E6b public_ok with no stored and no live record (D29)", async () => {
        const papa = P("papa"), ghost = P("ghost");
        const run = makeRun([outcome(papa, "public_ok", "Papa"), outcome(ghost, "public_ok", "Ghost")]);
        await seedAll({
          published: storedProducts([product("Papa", papa)]),
          added: storedProducts([]),
          candidate: storedProducts([]),
          vendors: storedVendors([]),
          "published-live": liveDoc("published", [liveProduct("Papa", papa, false)], run),
          "added-live": null,
          "vendors-live": null,
          passwords: null,
          tracking: null,
        });
        // D29 (plan:258): "the live snapshot can hold no record to append. Ruling: refuse."
        await assertRefusedNoWrites("published", new RegExp(`${ghost.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}.*cannot append`));
      });

      test("E6c stored record matches an outcome of the other post type (D26)", async () => {
        const weird = P("weird");
        const run = makeRun([{ url: weird, post_type: "vendor", status: "public_ok", name: "Weird", detail: null }]);
        await seedAll({
          published: storedProducts([product("Weird", weird)]),
          added: storedProducts([]),
          candidate: storedProducts([]),
          vendors: storedVendors([]),
          "published-live": liveDoc("published", [], run),
          "added-live": null,
          "vendors-live": null,
          passwords: null,
          tracking: null,
        });
        // D26 (plan:252): "a stored record's URL matches an outcome of the other post type. Ruling: refuse."
        await assertRefusedNoWrites("published", /matches a "vendor" outcome/);
      });
    });

    test("E7 Empty-but-present snapshot (D53): a plan, not 'No live data'", async () => {
      const bravo = P("bravo"), charlie = P("charlie");
      const stored = [product("Bravo", bravo), product("Charlie", charlie)];
      const run = makeRun([outcome(bravo, "password_rejected", "Bravo"), outcome(charlie, "password_rejected", "Charlie")]);
      const before = await seedAll({
        published: storedProducts([]),
        added: storedProducts(stored),
        candidate: storedProducts([]),
        vendors: storedVendors([]),
        "published-live": null,
        "added-live": liveDoc("added", [], run),
        "vendors-live": null,
        passwords: passwordsDoc(["Bravo", "Charlie", "Other"]),
        tracking: null,
      });

      // D53 (plan:399): "an empty snapshot can still carry deletions, password flags and refusals (for example, every protected Added page rejected its password)."
      const pv = planOf(await preview("added"), "preview");
      // [A2] §3.2:100 password_rejected → Keep the stored record; delete the password row | Needs correct password |
      assert.ok(hasEntry(pv.report.needsCorrectPassword, bravo) && hasEntry(pv.report.needsCorrectPassword, charlie)); // [A2]
      const applied = planOf(await apply("added", pv.tokens), "applied");
      const records = await assertApplyEffects("added", before, run, applied);
      assert.deepEqual(records, stored); // [A2] both kept unchanged
      assert.deepEqual(await passwordNames(), ["Other"]); // [A2] both password rows deleted
    });

    test("E8 Idempotence: after a Published apply, a second preview finds no live data", async () => {
      const papa = P("papa");
      const run = makeRun([outcome(papa, "public_ok", "Papa")]);
      await seedAll({
        published: storedProducts([product("Papa", papa)]),
        added: storedProducts([]),
        candidate: storedProducts([]),
        vendors: storedVendors([]),
        "published-live": liveDoc("published", [liveProduct("Papa", papa, false)], run),
        "added-live": null,
        "vendors-live": null,
        passwords: null,
        tracking: null,
      });
      await previewThenApply("published");
      const again = await preview("published");
      // §3.13 plan:335: "Live snapshot absent: 409 { error: 'No live data to promote. Run "Retrieve Live Data" first.' }."
      assert.equal(again.status, 409);
      assert.deepEqual(again.body, { error: NO_LIVE_DATA });
    });
  });
}
