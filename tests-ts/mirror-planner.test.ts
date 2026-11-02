/**
 * Tests for frontend/lib/mirror-planner.ts.
 * Run with: node --test tests-ts/
 * (Node 25 strips types; type-only imports are erased.)
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { planPromote } from "../frontend/lib/mirror-planner.ts";
import type {
  Category,
  OutcomeStatus,
  Plan,
  PlanInput,
  PlanReport,
  PlanResult,
  PostType,
  RunOutcome,
  RunRecord,
} from "../frontend/lib/mirror-planner.ts";
import type { PublishedProductRecord } from "../frontend/lib/published-tables.ts";
import type { DirectoryRecord } from "../frontend/lib/directory-schema.ts";
import type { PasswordRecord } from "../frontend/lib/passwords.ts";
import type { TrackingRecord } from "../frontend/lib/tracking.ts";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function P(slug: string): string {
  return `https://ncademi.org/product/${slug}/`;
}

function V(slug: string): string {
  return `https://ncademi.org/vendor/${slug}/`;
}

function slugOf(url: string): string {
  const segments = url.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? url;
}

function product(
  name: string,
  url: string,
  extra?: Partial<PublishedProductRecord>
): PublishedProductRecord {
  return {
    slug: slugOf(url),
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

function vendor(name: string, url: string, extra?: Partial<DirectoryRecord>): DirectoryRecord {
  return {
    kind: "vendor",
    slug: slugOf(url),
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

interface OutcomeOptions {
  post_type?: PostType;
  name?: string | null;
  detail?: string | null;
}

function outcome(url: string, status: OutcomeStatus, opts: OutcomeOptions = {}): RunOutcome {
  return {
    url,
    post_type: opts.post_type ?? (url.includes("/vendor/") ? "vendor" : "product"),
    status,
    name: opts.name === undefined ? null : opts.name,
    detail: opts.detail === undefined ? null : opts.detail,
  };
}

interface RunOptions {
  run_id?: string;
  target?: string;
  productComplete?: boolean;
  vendorComplete?: boolean;
  productError?: string | null;
  vendorError?: string | null;
  productDiscovered?: number;
  vendorDiscovered?: number;
}

function makeRun(outcomes: RunOutcome[], opts: RunOptions = {}): RunRecord {
  const productCount = outcomes.filter((o) => o.post_type === "product").length;
  const vendorCount = outcomes.filter((o) => o.post_type === "vendor").length;
  return {
    run_id: opts.run_id ?? "run-0001",
    started_at: "2026-11-02T14:00:00Z",
    finished_at: "2026-11-02T14:10:00Z",
    target: opts.target ?? "all",
    discovery: {
      product: {
        complete: opts.productComplete ?? true,
        expected_total: productCount,
        discovered: opts.productDiscovered ?? productCount,
        error: opts.productError ?? null,
      },
      vendor: {
        complete: opts.vendorComplete ?? true,
        expected_total: vendorCount,
        discovered: opts.vendorDiscovered ?? vendorCount,
        error: opts.vendorError ?? null,
      },
    },
    outcomes,
  };
}

function pw(name: string): PasswordRecord {
  return { product_name: name, vendor_name: null, password: "x", timestamp: "2026-01-01T00:00:00Z" };
}

function tr(name: string): TrackingRecord {
  return {
    product_name: name,
    tracking_priority: null,
    tracking_status: "gathering",
    tracking_gatherer: null,
    tracking_reviewer: null,
  };
}

type InputOverrides = Partial<PlanInput> & { category: Category; run: RunRecord };

function makeInput(overrides: InputOverrides): PlanInput {
  return {
    stored: [],
    live: [],
    namesInOtherCategories: [],
    passwords: [],
    tracking: [],
    ...overrides,
  };
}

function okPlan(result: PlanResult): Plan {
  if (!result.ok) {
    assert.fail(`expected ok plan, got refusal: ${result.error}`);
  }
  return result.plan;
}

function refused(result: PlanResult): string {
  if (result.ok) {
    assert.fail("expected a refusal, got an ok plan");
  }
  return result.error;
}

const REPORT_KEYS: (keyof PlanReport)[] = [
  "updated",
  "appended",
  "removed",
  "needsCorrectPassword",
  "needsPassword",
  "couldNotCheck",
  "untrackedProtected",
  "unscrapedProtectedVendors",
];

/** Asserts that every report array not named in `except` is empty. */
function assertReportEmptyExcept(report: PlanReport, except: (keyof PlanReport)[]): void {
  for (const key of REPORT_KEYS) {
    if (except.includes(key)) continue;
    assert.deepEqual(report[key], [], `report.${key} should be empty`);
  }
}

// ---------------------------------------------------------------------------
// §3.2 Added — case table
// ---------------------------------------------------------------------------

test("§3.2 Added: protected_unlocked → Keep, updated from the live page (Updated)", () => {
  const url = P("alpha");
  const stored = product("Alpha", url, { product_description: "old" });
  const live = product("Alpha", url, { product_description: "new" });
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "added",
        stored: [stored],
        live: [live],
        run: makeRun([outcome(url, "protected_unlocked", { name: "Alpha" })]),
        passwords: [pw("Alpha")],
        tracking: [tr("Alpha")],
      })
    )
  );
  assert.equal(plan.deletionsAllowed, true);
  assert.equal(plan.deletionsBlockedReason, null);
  assert.deepEqual(plan.nextStored, [live]);
  assert.deepEqual(plan.report.updated, [{ url, name: "Alpha" }]);
  assertReportEmptyExcept(plan.report, ["updated"]);
  assert.deepEqual(plan.passwordNamesToDelete, []);
  assert.deepEqual(plan.trackingNamesToDelete, []);
});

test("§3.2 Added: password_rejected → Keep the stored record; delete the password row (Needs correct password)", () => {
  const url = P("alpha");
  const stored = product("Alpha", url);
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "added",
        stored: [stored],
        run: makeRun([outcome(url, "password_rejected")]),
        passwords: [pw("Alpha")],
        tracking: [tr("Alpha")],
        // D20 does NOT apply to D5: the row is deleted even though the name remains in use.
        namesInOtherCategories: ["Alpha"],
      })
    )
  );
  assert.deepEqual(plan.nextStored, [stored]);
  assert.deepEqual(plan.report.needsCorrectPassword, [{ url, name: "Alpha" }]);
  assertReportEmptyExcept(plan.report, ["needsCorrectPassword"]);
  assert.deepEqual(plan.passwordNamesToDelete, ["Alpha"]);
  assert.deepEqual(plan.trackingNamesToDelete, []);
});

test("§3.2 Added: no_password → Keep the stored record (Needs password)", () => {
  const url = P("alpha");
  const stored = product("Alpha", url);
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "added",
        stored: [stored],
        run: makeRun([outcome(url, "no_password")]),
        tracking: [tr("Alpha")],
      })
    )
  );
  assert.deepEqual(plan.nextStored, [stored]);
  assert.deepEqual(plan.report.needsPassword, [{ url, name: "Alpha" }]);
  assertReportEmptyExcept(plan.report, ["needsPassword"]);
  assert.deepEqual(plan.passwordNamesToDelete, []);
  assert.deepEqual(plan.trackingNamesToDelete, []);
});

test("§3.2 Added: fetch_error or parse_error → Untouched: record and password unchanged (Could not check)", () => {
  const a = P("alpha");
  const b = P("beta");
  const storedA = product("Alpha", a);
  const storedB = product("Beta", b);
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "added",
        stored: [storedA, storedB],
        run: makeRun([
          outcome(a, "fetch_error", { detail: "HTTP 503" }),
          outcome(b, "parse_error", { detail: "no <article>" }),
        ]),
        passwords: [pw("Alpha"), pw("Beta")],
        tracking: [tr("Alpha"), tr("Beta")],
      })
    )
  );
  assert.deepEqual(plan.nextStored, [storedA, storedB]);
  assert.equal(plan.report.couldNotCheck.length, 2);
  assert.equal(plan.report.couldNotCheck[0]?.url, a);
  assert.equal(plan.report.couldNotCheck[0]?.name, "Alpha");
  assert.match(plan.report.couldNotCheck[0]?.reason ?? "", /^fetch error/);
  assert.match(plan.report.couldNotCheck[0]?.reason ?? "", /HTTP 503/);
  assert.equal(plan.report.couldNotCheck[1]?.url, b);
  assert.match(plan.report.couldNotCheck[1]?.reason ?? "", /^parse error/);
  assertReportEmptyExcept(plan.report, ["couldNotCheck"]);
  assert.deepEqual(plan.passwordNamesToDelete, []);
  assert.deepEqual(plan.trackingNamesToDelete, []);
});

test("§3.2 Added: public_ok → Delete the record, its password row and its tracking row (Removed: now public)", () => {
  const url = P("alpha");
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "added",
        stored: [product("Alpha", url)],
        run: makeRun([outcome(url, "public_ok", { name: "Alpha" })]),
        passwords: [pw("Alpha")],
        tracking: [tr("Alpha")],
      })
    )
  );
  assert.deepEqual(plan.nextStored, []);
  assert.deepEqual(plan.report.removed, [{ url, name: "Alpha", reason: "now public" }]);
  assertReportEmptyExcept(plan.report, ["removed"]);
  assert.deepEqual(plan.passwordNamesToDelete, ["Alpha"]);
  assert.deepEqual(plan.trackingNamesToDelete, ["Alpha"]);
});

test("§3.2 Added: no outcome entry, product discovery complete → Delete (Removed: not on site)", () => {
  const url = P("alpha");
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "added",
        stored: [product("Alpha", url)],
        run: makeRun([outcome(P("other"), "public_ok")]),
        passwords: [pw("Alpha")],
        tracking: [tr("Alpha")],
      })
    )
  );
  assert.deepEqual(plan.nextStored, []);
  assert.deepEqual(plan.report.removed, [{ url, name: "Alpha", reason: "not on site" }]);
  assertReportEmptyExcept(plan.report, ["removed"]);
  assert.deepEqual(plan.passwordNamesToDelete, ["Alpha"]);
  assert.deepEqual(plan.trackingNamesToDelete, ["Alpha"]);
});

test("§3.2 Added: no outcome entry, product discovery incomplete → Untouched (Could not check: discovery incomplete)", () => {
  const url = P("alpha");
  const stored = product("Alpha", url);
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "added",
        stored: [stored],
        run: makeRun([], { productComplete: false }),
        passwords: [pw("Alpha")],
        tracking: [tr("Alpha")],
      })
    )
  );
  assert.equal(plan.deletionsAllowed, false);
  assert.equal(typeof plan.deletionsBlockedReason, "string");
  assert.deepEqual(plan.nextStored, [stored]);
  assert.deepEqual(plan.report.couldNotCheck, [{ url, name: "Alpha", reason: "discovery incomplete" }]);
  assertReportEmptyExcept(plan.report, ["couldNotCheck"]);
  assert.deepEqual(plan.passwordNamesToDelete, []);
  assert.deepEqual(plan.trackingNamesToDelete, []);
});

test("§3.2 Added: (no stored record) not_tracked → Create nothing (Listed as an untracked protected page)", () => {
  const url = P("ghost");
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "added",
        run: makeRun([outcome(url, "not_tracked", { name: "Ghost & Co" }), outcome(P("nameless"), "not_tracked")]),
      })
    )
  );
  assert.deepEqual(plan.nextStored, []);
  assert.deepEqual(plan.report.untrackedProtected, [
    { url, name: "Ghost & Co" },
    { url: P("nameless"), name: null },
  ]);
  assertReportEmptyExcept(plan.report, ["untrackedProtected"]);
});

// ---------------------------------------------------------------------------
// §3.3 Published — case table
// ---------------------------------------------------------------------------

test("§3.3 Published: public_ok → Keep, updated from the live page (Updated)", () => {
  const url = P("alpha");
  const stored = product("Alpha", url, { product_description: "old" });
  const live = product("Alpha", url, { product_description: "new" });
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "published",
        stored: [stored],
        live: [live],
        run: makeRun([outcome(url, "public_ok", { name: "Alpha" })]),
        tracking: [tr("Alpha")],
      })
    )
  );
  assert.deepEqual(plan.nextStored, [live]);
  assert.deepEqual(plan.report.updated, [{ url, name: "Alpha" }]);
  assertReportEmptyExcept(plan.report, ["updated"]);
  assert.deepEqual(plan.trackingNamesToDelete, []);
});

test("§3.3 Published: fetch_error or parse_error → Untouched (Could not check)", () => {
  const a = P("alpha");
  const b = P("beta");
  const storedA = product("Alpha", a);
  const storedB = product("Beta", b);
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "published",
        stored: [storedA, storedB],
        run: makeRun([outcome(a, "fetch_error", { detail: "timeout" }), outcome(b, "parse_error")]),
        tracking: [tr("Alpha"), tr("Beta")],
      })
    )
  );
  assert.deepEqual(plan.nextStored, [storedA, storedB]);
  assert.deepEqual(plan.report.couldNotCheck, [
    { url: a, name: "Alpha", reason: "fetch error: timeout" },
    { url: b, name: "Beta", reason: "parse error" },
  ]);
  assertReportEmptyExcept(plan.report, ["couldNotCheck"]);
  assert.deepEqual(plan.trackingNamesToDelete, []);
});

test("§3.3 Published: protected_unlocked, password_rejected, no_password or not_tracked → Delete (Removed: now protected)", () => {
  const urls = [P("a"), P("b"), P("c"), P("d")];
  const statuses: OutcomeStatus[] = ["protected_unlocked", "password_rejected", "no_password", "not_tracked"];
  const stored = urls.map((url, i) => product(`Name${i}`, url));
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "published",
        stored,
        run: makeRun(urls.map((url, i) => outcome(url, statuses[i] ?? "public_ok"))),
        passwords: [pw("Name0")], // Published records have no password rows to delete
        tracking: [tr("Name0"), tr("Name1"), tr("Name2"), tr("Name3")],
      })
    )
  );
  assert.deepEqual(plan.nextStored, []);
  assert.deepEqual(
    plan.report.removed,
    urls.map((url, i) => ({ url, name: `Name${i}`, reason: "now protected" }))
  );
  assertReportEmptyExcept(plan.report, ["removed"]);
  assert.deepEqual(plan.passwordNamesToDelete, []);
  assert.deepEqual(plan.trackingNamesToDelete, ["Name0", "Name1", "Name2", "Name3"]);
});

test("§3.3 Published: no outcome entry, product discovery complete → Delete (Removed: not on site)", () => {
  const url = P("alpha");
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "published",
        stored: [product("Alpha", url)],
        run: makeRun([]),
        tracking: [tr("Alpha")],
      })
    )
  );
  assert.deepEqual(plan.nextStored, []);
  assert.deepEqual(plan.report.removed, [{ url, name: "Alpha", reason: "not on site" }]);
  assertReportEmptyExcept(plan.report, ["removed"]);
  assert.deepEqual(plan.trackingNamesToDelete, ["Alpha"]);
});

test("§3.3 Published: no outcome entry, product discovery incomplete → Untouched (Could not check: discovery incomplete)", () => {
  const url = P("alpha");
  const stored = product("Alpha", url);
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "published",
        stored: [stored],
        run: makeRun([], { productComplete: false, productError: "X-WP-Total mismatch" }),
        tracking: [tr("Alpha")],
      })
    )
  );
  assert.equal(plan.deletionsAllowed, false);
  assert.match(plan.deletionsBlockedReason ?? "", /X-WP-Total mismatch/);
  assert.deepEqual(plan.nextStored, [stored]);
  assert.deepEqual(plan.report.couldNotCheck, [
    { url, name: "Alpha", reason: "discovery incomplete: X-WP-Total mismatch" },
  ]);
  assertReportEmptyExcept(plan.report, ["couldNotCheck"]);
  assert.deepEqual(plan.trackingNamesToDelete, []);
});

test("§3.3 Published: (no stored record) public_ok → Append (Added)", () => {
  const url = P("new");
  const live = product("New Product", url);
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "published",
        live: [live],
        run: makeRun([outcome(url, "public_ok", { name: "New Product" })]),
      })
    )
  );
  assert.deepEqual(plan.nextStored, [live]);
  assert.deepEqual(plan.report.appended, [{ url, name: "New Product" }]);
  assertReportEmptyExcept(plan.report, ["appended"]);
});

// ---------------------------------------------------------------------------
// §3.4 Vendors — case table
// ---------------------------------------------------------------------------

test("§3.4 Vendors: public_ok → Keep, updated from the live page (Updated)", () => {
  const url = V("acme");
  const stored = vendor("Acme", url);
  const live = vendor("Acme", url, { product_website_url: "https://acme.example/" });
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "vendors",
        stored: [stored],
        live: [live],
        run: makeRun([outcome(url, "public_ok", { name: "Acme" })]),
        tracking: [tr("Acme")],
      })
    )
  );
  assert.deepEqual(plan.nextStored, [live]);
  assert.deepEqual(plan.report.updated, [{ url, name: "Acme" }]);
  assertReportEmptyExcept(plan.report, ["updated"]);
  assert.deepEqual(plan.trackingNamesToDelete, []);
});

test("§3.4 Vendors: protected_vendor → Untouched; stub never used (Could not check: protected vendor page)", () => {
  const url = V("acme");
  const stored = vendor("Acme Corporation", url, { product_website_url: "https://acme.example/" });
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "vendors",
        stored: [stored],
        run: makeRun([outcome(url, "protected_vendor")]),
        tracking: [tr("Acme Corporation")],
      })
    )
  );
  assert.deepEqual(plan.nextStored, [stored]);
  assert.equal(plan.nextStored[0], stored);
  assert.deepEqual(plan.report.couldNotCheck, [
    { url, name: "Acme Corporation", reason: "protected vendor page" },
  ]);
  assertReportEmptyExcept(plan.report, ["couldNotCheck"]);
  assert.deepEqual(plan.trackingNamesToDelete, []);
});

test("§3.4 Vendors: fetch_error or parse_error → Untouched (Could not check)", () => {
  const a = V("acme");
  const b = V("bolt");
  const storedA = vendor("Acme", a);
  const storedB = vendor("Bolt", b);
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "vendors",
        stored: [storedA, storedB],
        run: makeRun([outcome(a, "fetch_error", { detail: "HTTP 500" }), outcome(b, "parse_error")]),
      })
    )
  );
  assert.deepEqual(plan.nextStored, [storedA, storedB]);
  assert.deepEqual(plan.report.couldNotCheck, [
    { url: a, name: "Acme", reason: "fetch error: HTTP 500" },
    { url: b, name: "Bolt", reason: "parse error" },
  ]);
  assertReportEmptyExcept(plan.report, ["couldNotCheck"]);
});

test("§3.4 Vendors: no outcome entry, vendor discovery complete → Delete (Removed: not on site)", () => {
  const url = V("acme");
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "vendors",
        stored: [vendor("Acme", url)],
        run: makeRun([]),
        passwords: [pw("Acme")], // vendors have no password rows; must not be listed
        tracking: [tr("Acme")],
      })
    )
  );
  assert.deepEqual(plan.nextStored, []);
  assert.deepEqual(plan.report.removed, [{ url, name: "Acme", reason: "not on site" }]);
  assertReportEmptyExcept(plan.report, ["removed"]);
  assert.deepEqual(plan.passwordNamesToDelete, []);
  assert.deepEqual(plan.trackingNamesToDelete, ["Acme"]);
});

test("§3.4 Vendors: no outcome entry, vendor discovery incomplete → Untouched (Could not check: discovery incomplete)", () => {
  const url = V("acme");
  const stored = vendor("Acme", url);
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "vendors",
        stored: [stored],
        run: makeRun([], { vendorComplete: false }),
        tracking: [tr("Acme")],
      })
    )
  );
  assert.equal(plan.deletionsAllowed, false);
  assert.deepEqual(plan.nextStored, [stored]);
  assert.deepEqual(plan.report.couldNotCheck, [{ url, name: "Acme", reason: "discovery incomplete" }]);
  assertReportEmptyExcept(plan.report, ["couldNotCheck"]);
  assert.deepEqual(plan.trackingNamesToDelete, []);
});

test("§3.4 Vendors: (no stored record) public_ok → Append (Added)", () => {
  const url = V("newco");
  const live = vendor("NewCo", url);
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "vendors",
        live: [live],
        run: makeRun([outcome(url, "public_ok", { name: "NewCo" })]),
      })
    )
  );
  assert.deepEqual(plan.nextStored, [live]);
  assert.deepEqual(plan.report.appended, [{ url, name: "NewCo" }]);
  assertReportEmptyExcept(plan.report, ["appended"]);
});

test("§3.4 Vendors: (no stored record) protected_vendor → Append nothing (Listed as an unscraped protected vendor page)", () => {
  const url = V("secret");
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "vendors",
        run: makeRun([outcome(url, "protected_vendor")]),
      })
    )
  );
  assert.deepEqual(plan.nextStored, []);
  assert.deepEqual(plan.report.unscrapedProtectedVendors, [{ url }]);
  assertReportEmptyExcept(plan.report, ["unscrapedProtectedVendors"]);
});

// ---------------------------------------------------------------------------
// D15 — deletions require complete discovery
// ---------------------------------------------------------------------------

test("D15 (Added): incomplete product discovery blocks every deletion but allows updates and the D5 password deletion", () => {
  const a = P("a"); // public_ok → would be deleted
  const b = P("b"); // no outcome → would be deleted
  const c = P("c"); // protected_unlocked → updated
  const d = P("d"); // password_rejected → password deleted
  const storedA = product("A", a);
  const storedB = product("B", b);
  const storedC = product("C", c);
  const storedD = product("D", d);
  const liveC = product("C", c, { product_description: "fresh" });
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "added",
        stored: [storedA, storedB, storedC, storedD],
        live: [liveC],
        run: makeRun(
          [outcome(a, "public_ok"), outcome(c, "protected_unlocked"), outcome(d, "password_rejected")],
          { productComplete: false, productError: "HTTP 503 on page 3" }
        ),
        passwords: [pw("A"), pw("B"), pw("D")],
        tracking: [tr("A"), tr("B")],
      })
    )
  );
  assert.equal(plan.deletionsAllowed, false);
  assert.match(plan.deletionsBlockedReason ?? "", /HTTP 503 on page 3/);
  assert.deepEqual(plan.nextStored, [storedA, storedB, liveC, storedD]);
  assert.deepEqual(plan.report.removed, []);
  assert.deepEqual(plan.report.couldNotCheck, [
    { url: a, name: "A", reason: "discovery incomplete: HTTP 503 on page 3" },
    { url: b, name: "B", reason: "discovery incomplete: HTTP 503 on page 3" },
  ]);
  assert.deepEqual(plan.report.updated, [{ url: c, name: "C" }]);
  assert.deepEqual(plan.report.needsCorrectPassword, [{ url: d, name: "D" }]);
  assert.deepEqual(plan.passwordNamesToDelete, ["D"]);
  assert.deepEqual(plan.trackingNamesToDelete, []);
});

test("D15 (Published): incomplete product discovery blocks 'now protected' deletions but still appends", () => {
  const a = P("a");
  const e = P("e");
  const storedA = product("A", a);
  const liveE = product("E", e);
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "published",
        stored: [storedA],
        live: [liveE],
        run: makeRun([outcome(a, "protected_unlocked"), outcome(e, "public_ok", { name: "E" })], {
          productComplete: false,
        }),
        tracking: [tr("A")],
      })
    )
  );
  assert.equal(plan.deletionsAllowed, false);
  assert.deepEqual(plan.nextStored, [storedA, liveE]);
  assert.deepEqual(plan.report.couldNotCheck, [{ url: a, name: "A", reason: "discovery incomplete" }]);
  assert.deepEqual(plan.report.appended, [{ url: e, name: "E" }]);
  assert.deepEqual(plan.report.removed, []);
  assert.deepEqual(plan.trackingNamesToDelete, []);
});

test("D15: only the governing discovery matters (vendor incomplete does not block Published; product incomplete does not block Vendors)", () => {
  const pUrl = P("a");
  const published = okPlan(
    planPromote(
      makeInput({
        category: "published",
        stored: [product("A", pUrl)],
        run: makeRun([], { vendorComplete: false }),
      })
    )
  );
  assert.equal(published.deletionsAllowed, true);
  assert.deepEqual(published.report.removed, [{ url: pUrl, name: "A", reason: "not on site" }]);

  const vUrl = V("acme");
  const vendors = okPlan(
    planPromote(
      makeInput({
        category: "vendors",
        stored: [vendor("Acme", vUrl)],
        run: makeRun([], { productComplete: false }),
      })
    )
  );
  assert.equal(vendors.deletionsAllowed, true);
  assert.deepEqual(vendors.report.removed, [{ url: vUrl, name: "Acme", reason: "not on site" }]);
});

// ---------------------------------------------------------------------------
// D18 — full runs only
// ---------------------------------------------------------------------------

test("D18: a run with target 'published' is refused", () => {
  const error = refused(
    planPromote(makeInput({ category: "published", run: makeRun([], { target: "published" }) }))
  );
  assert.match(error, /target "published"/);
  assert.match(error, /D18/);
});

// ---------------------------------------------------------------------------
// §3.9 invariants
// ---------------------------------------------------------------------------

test("invariant: an outcome URL appearing more than once is refused", () => {
  const url = P("dup");
  const error = refused(
    planPromote(
      makeInput({
        category: "published",
        run: makeRun([outcome(url, "public_ok"), outcome(url, "fetch_error")]),
      })
    )
  );
  assert.match(error, /appears more than once/);
  assert.ok(error.includes(url));
});

test("invariant: a product-only status on a vendor outcome is refused", () => {
  const url = V("acme");
  const error = refused(
    planPromote(
      makeInput({
        category: "vendors",
        run: makeRun([outcome(url, "no_password", { post_type: "vendor" })]),
      })
    )
  );
  assert.match(error, /"no_password"/);
  assert.match(error, /not valid for post_type "vendor"/);
});

test("invariant: a vendor-only status on a product outcome is refused", () => {
  const url = P("alpha");
  const error = refused(
    planPromote(
      makeInput({
        category: "published",
        run: makeRun([outcome(url, "protected_vendor", { post_type: "product" })]),
      })
    )
  );
  assert.match(error, /"protected_vendor"/);
  assert.match(error, /not valid for post_type "product"/);
});

test("invariant: an unknown status string is refused", () => {
  const url = P("alpha");
  const bad = { ...outcome(url, "public_ok"), status: "bogus" } as unknown as RunOutcome;
  const error = refused(planPromote(makeInput({ category: "published", run: makeRun([bad]) })));
  assert.match(error, /unknown status "bogus"/);
});

test("invariant: a live record whose key has no outcome entry is refused", () => {
  const url = P("orphan");
  const error = refused(
    planPromote(
      makeInput({
        category: "published",
        live: [product("Orphan", url)],
        run: makeRun([]),
      })
    )
  );
  assert.match(error, /has no outcome entry/);
  assert.ok(error.includes(url));
});

test("invariant: a live Added record whose outcome is not protected_unlocked is refused", () => {
  const url = P("alpha");
  const error = refused(
    planPromote(
      makeInput({
        category: "added",
        live: [product("Alpha", url)],
        run: makeRun([outcome(url, "public_ok")]),
      })
    )
  );
  assert.match(error, /status "public_ok"/);
  assert.match(error, /must have status "protected_unlocked"/);
});

test("invariant: a live Published record whose outcome is not public_ok is refused", () => {
  const url = P("alpha");
  const error = refused(
    planPromote(
      makeInput({
        category: "published",
        live: [product("Alpha", url)],
        run: makeRun([outcome(url, "protected_unlocked")]),
      })
    )
  );
  assert.match(error, /must have status "public_ok"/);
});

test("invariant: a protected-vendor stub present in vendors-live is refused (§3.9 snapshot contents)", () => {
  const url = V("acme");
  const error = refused(
    planPromote(
      makeInput({
        category: "vendors",
        stored: [vendor("Acme", url)],
        live: [vendor("acme", url, { product_website_url: null })],
        run: makeRun([outcome(url, "protected_vendor")]),
      })
    )
  );
  assert.match(error, /status "protected_vendor"/);
  assert.match(error, /must have status "public_ok"/);
});

test("invariant: an update whose live record is missing is refused rather than guessed", () => {
  const url = P("alpha");
  const error = refused(
    planPromote(
      makeInput({
        category: "added",
        stored: [product("Alpha", url)],
        live: [],
        run: makeRun([outcome(url, "protected_unlocked")]),
      })
    )
  );
  assert.match(error, /has no record for it/);
  assert.match(error, /cannot update "Alpha"/);
});

test("invariant: an append whose live record is missing is refused", () => {
  const url = P("new");
  const error = refused(
    planPromote(
      makeInput({
        category: "published",
        run: makeRun([outcome(url, "public_ok")]),
      })
    )
  );
  assert.match(error, /cannot append/);
  assert.ok(error.includes(url));
});

test("invariant: outcome count not matching discovery.*.discovered is refused", () => {
  const error = refused(
    planPromote(
      makeInput({
        category: "published",
        run: makeRun([outcome(P("a"), "public_ok")], { productDiscovered: 2 }),
      })
    )
  );
  assert.match(error, /1 product outcome entries/);
  assert.match(error, /discovered is 2/);
});

test("invariant: a stored record matching an outcome of the other post type is refused", () => {
  const url = P("weird");
  const error = refused(
    planPromote(
      makeInput({
        category: "published",
        stored: [product("Weird", url)],
        run: makeRun([outcome(url, "public_ok", { post_type: "vendor" })]),
      })
    )
  );
  assert.match(error, /matches a "vendor" outcome/);
});

test("post_type scoping: vendor outcomes never append into Published, and product outcomes never affect Vendors", () => {
  const vUrl = V("acme");
  const pUrl = P("alpha");
  const published = okPlan(
    planPromote(
      makeInput({
        category: "published",
        run: makeRun([outcome(vUrl, "public_ok"), outcome(pUrl, "not_tracked")]),
      })
    )
  );
  assert.deepEqual(published.nextStored, []);
  assertReportEmptyExcept(published.report, []);

  const vendors = okPlan(
    planPromote(
      makeInput({
        category: "vendors",
        run: makeRun([outcome(pUrl, "public_ok"), outcome(pUrl + "x/", "fetch_error")]),
      })
    )
  );
  assert.deepEqual(vendors.nextStored, []);
  assertReportEmptyExcept(vendors.report, []);
});

// ---------------------------------------------------------------------------
// D20 — shared-name rows
// ---------------------------------------------------------------------------

test("D20 (a): a deleted Added record whose name is also a vendor name keeps its tracking (and password) row", () => {
  const url = P("kami");
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "added",
        stored: [product("Kami", url)],
        run: makeRun([outcome(url, "public_ok")]),
        namesInOtherCategories: ["Kami"], // the vendor named Kami
        passwords: [pw("Kami")],
        tracking: [tr("Kami")],
      })
    )
  );
  assert.deepEqual(plan.report.removed, [{ url, name: "Kami", reason: "now public" }]);
  assert.deepEqual(plan.passwordNamesToDelete, []);
  assert.deepEqual(plan.trackingNamesToDelete, []);
});

test("D20 (b): a deleted record whose name is used by a candidate keeps both rows", () => {
  const url = P("alpha");
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "added",
        stored: [product("Alpha", url)],
        run: makeRun([]),
        namesInOtherCategories: ["Alpha"], // a candidate named Alpha
        passwords: [pw("Alpha")],
        tracking: [tr("Alpha")],
      })
    )
  );
  assert.deepEqual(plan.report.removed, [{ url, name: "Alpha", reason: "not on site" }]);
  assert.deepEqual(plan.passwordNamesToDelete, []);
  assert.deepEqual(plan.trackingNamesToDelete, []);
});

test("D20 (c): a deleted record whose name is unused elsewhere loses both rows", () => {
  const url = P("alpha");
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "added",
        stored: [product("Alpha", url), product("Beta", P("beta"))],
        live: [product("Beta", P("beta"))],
        run: makeRun([outcome(url, "public_ok"), outcome(P("beta"), "protected_unlocked")]),
        namesInOtherCategories: ["Beta", "Gamma"],
        passwords: [pw("Alpha"), pw("Beta")],
        tracking: [tr("Alpha"), tr("Beta")],
      })
    )
  );
  assert.deepEqual(plan.passwordNamesToDelete, ["Alpha"]);
  assert.deepEqual(plan.trackingNamesToDelete, ["Alpha"]);
});

test("D20 (d): names absent from passwords/tracking are not listed", () => {
  const url = P("alpha");
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "added",
        stored: [product("Alpha", url), product("Rejected", P("rej"))],
        run: makeRun([outcome(url, "public_ok"), outcome(P("rej"), "password_rejected")]),
        passwords: [pw("Someone Else")],
        tracking: [tr("Someone Else")],
      })
    )
  );
  assert.deepEqual(plan.report.removed, [{ url, name: "Alpha", reason: "now public" }]);
  assert.deepEqual(plan.report.needsCorrectPassword, [{ url: P("rej"), name: "Rejected" }]);
  assert.deepEqual(plan.passwordNamesToDelete, []);
  assert.deepEqual(plan.trackingNamesToDelete, []);
});

test("D20: a name still present in nextStored (same category) keeps its rows", () => {
  const a = P("a");
  const b = P("b");
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "published",
        stored: [product("Same", a), product("Same", b)],
        live: [product("Same", b)],
        run: makeRun([outcome(b, "public_ok")]),
        tracking: [tr("Same")],
      })
    )
  );
  assert.deepEqual(plan.report.removed, [{ url: a, name: "Same", reason: "not on site" }]);
  assert.deepEqual(plan.trackingNamesToDelete, []);
});

// ---------------------------------------------------------------------------
// D22 — protected vendor pages
// ---------------------------------------------------------------------------

test("D22: a stored vendor with protected_vendor is untouched and never replaced by a stub", () => {
  const url = V("acme");
  const stored = vendor("Acme Corporation", url, {
    product_website_url: "https://acme.example/",
    products: [{ product_name: "Acme Reader", ncademi_product_url: P("acme-reader") }],
  });
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "vendors",
        stored: [stored],
        live: [],
        run: makeRun([outcome(url, "protected_vendor")]),
        tracking: [tr("Acme Corporation")],
      })
    )
  );
  assert.equal(plan.nextStored.length, 1);
  assert.equal(plan.nextStored[0], stored);
  assert.equal(plan.nextStored[0]?.product_name, "Acme Corporation");
  assert.deepEqual(plan.report.updated, []);
  assert.deepEqual(plan.report.removed, []);
  assert.deepEqual(plan.report.couldNotCheck, [
    { url, name: "Acme Corporation", reason: "protected vendor page" },
  ]);
  assert.deepEqual(plan.trackingNamesToDelete, []);
});

test("D22: a protected_vendor URL with no stored record is reported, not appended", () => {
  const url = V("secret");
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "vendors",
        stored: [vendor("Other", V("other"))],
        live: [vendor("Other", V("other"))],
        run: makeRun([outcome(V("other"), "public_ok"), outcome(url, "protected_vendor")]),
      })
    )
  );
  assert.equal(plan.nextStored.length, 1);
  assert.equal(plan.nextStored[0]?.product_name, "Other");
  assert.deepEqual(plan.report.unscrapedProtectedVendors, [{ url }]);
  assert.deepEqual(plan.report.appended, []);
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

test("purity: inputs are deep-equal before and after planPromote", () => {
  const a = P("a");
  const b = P("b");
  const c = P("c");
  const d = P("d");
  const input = makeInput({
    category: "added",
    stored: [product("A", a), product("B", b), product("C", c), product("D", d)],
    live: [product("B", b, { product_description: "new" })],
    run: makeRun([
      outcome(a, "public_ok"),
      outcome(b, "protected_unlocked"),
      outcome(c, "password_rejected"),
      outcome(P("ghost"), "not_tracked", { name: "Ghost" }),
      outcome(V("acme"), "protected_vendor"),
    ]),
    namesInOtherCategories: ["D"],
    passwords: [pw("A"), pw("C")],
    tracking: [tr("A"), tr("D")],
  });
  const before = structuredClone(input);
  const result = planPromote(input);
  assert.equal(result.ok, true);
  assert.deepEqual(input, before);

  // Mutating the plan's arrays must not reach back into the inputs either.
  const plan = okPlan(result);
  plan.nextStored.pop();
  plan.report.removed.pop();
  plan.passwordNamesToDelete.pop();
  assert.deepEqual(input, before);
});

test("purity: a refusal does not mutate inputs", () => {
  const input = makeInput({
    category: "published",
    stored: [product("A", P("a"))],
    run: makeRun([], { target: "added" }),
  });
  const before = structuredClone(input);
  refused(planPromote(input));
  assert.deepEqual(input, before);
});

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

test("ordering: nextStored keeps stored order then appends in live order; report arrays are sorted by url", () => {
  const a = P("a");
  const b = P("b");
  const c = P("c");
  const d = P("d");
  const e = P("e");
  const f = P("f");
  const storedC = product("C", c);
  const storedA = product("A", a);
  const storedB = product("B", b);
  const storedF = product("F", f);
  const liveB = product("B", b, { product_description: "b2" });
  const liveC = product("C", c, { product_description: "c2" });
  const liveE = product("E", e);
  const liveD = product("D", d);
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "published",
        stored: [storedC, storedA, storedB, storedF],
        live: [liveB, liveC, liveE, liveD],
        run: makeRun([
          outcome(e, "public_ok", { name: "E" }),
          outcome(c, "public_ok"),
          outcome(a, "fetch_error"),
          outcome(d, "public_ok", { name: "D" }),
          outcome(b, "public_ok"),
          outcome(f, "no_password"),
        ]),
        tracking: [tr("F"), tr("A")],
      })
    )
  );
  // Kept/updated in stored order (C, A, B; F deleted), then appended in live order (E, D).
  assert.deepEqual(plan.nextStored, [liveC, storedA, liveB, liveE, liveD]);
  assert.deepEqual(plan.report.updated, [
    { url: b, name: "B" },
    { url: c, name: "C" },
  ]);
  assert.deepEqual(plan.report.appended, [
    { url: d, name: "D" },
    { url: e, name: "E" },
  ]);
  assert.deepEqual(plan.report.removed, [{ url: f, name: "F", reason: "now protected" }]);
  assert.deepEqual(plan.report.couldNotCheck, [{ url: a, name: "A", reason: "fetch error" }]);
  assert.deepEqual(plan.trackingNamesToDelete, ["F"]);
});

test("ordering: name lists are de-duplicated and sorted ascending", () => {
  const plan = okPlan(
    planPromote(
      makeInput({
        category: "added",
        stored: [product("Zeta", P("z")), product("Alpha", P("a")), product("Mid", P("m"))],
        run: makeRun([outcome(P("m"), "password_rejected")]),
        passwords: [pw("Zeta"), pw("Alpha"), pw("Mid")],
        tracking: [tr("Zeta"), tr("Alpha")],
      })
    )
  );
  assert.deepEqual(plan.passwordNamesToDelete, ["Alpha", "Mid", "Zeta"]);
  assert.deepEqual(plan.trackingNamesToDelete, ["Alpha", "Zeta"]);
});

test("plan metadata: category and runId are echoed", () => {
  const plan = okPlan(planPromote(makeInput({ category: "vendors", run: makeRun([], { run_id: "abc-123" }) })));
  assert.equal(plan.category, "vendors");
  assert.equal(plan.runId, "abc-123");
});
