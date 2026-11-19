/**
 * Unit tests for frontend/lib/promote-ui.ts (plan §3.14, D42–D52, D54).
 * Pure: no Firestore, no DOM. Run from the repo root with the 5.2 harness:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:1 node --experimental-transform-types \
 *     --import ./tests-ts/support/ts-resolve.mjs --test tests-ts/promote-ui.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CATEGORY_LABEL,
  NOT_JSON,
  classifyResponse,
  confirmLabel,
  conflictNotice,
  documentLabel,
  messageLines,
  passwordStatement,
  removedContainsUrl,
  sections,
  summaryLines,
} from "../frontend/lib/promote-ui.ts";
import type { PromoteModalResult, PromoteView } from "../frontend/lib/promote-ui.ts";
import type {
  PromoteConflictBody,
  PromoteErrorBody,
  PromotePlanBody,
  PromoteRefusedBody,
} from "../frontend/lib/server/promote-mirror.ts";
import type { PlanReport } from "../frontend/lib/mirror-planner.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const P = (slug: string): string => `https://ncademi.org/product/${slug}/`;

const TOKENS = {
  published: "etag-published-1",
  added: "etag-added-1",
  candidate: "etag-candidate-1",
  vendors: "etag-vendors-1",
  "published-live": "etag-published-live-1",
  passwords: "etag-passwords-1",
  tracking: "absent",
};

function emptyReport(): PlanReport {
  return {
    updated: [],
    appended: [],
    removed: [],
    needsCorrectPassword: [],
    needsPassword: [],
    couldNotCheck: [],
    untrackedProtected: [],
    unscrapedProtectedVendors: [],
  };
}

function planBody(overrides: Partial<PromotePlanBody> = {}, report: Partial<PlanReport> = {}): PromotePlanBody {
  const r: PlanReport = { ...emptyReport(), ...report };
  const base: PromotePlanBody = {
    outcome: "preview",
    category: "published",
    runId: "run-1",
    runFinishedAt: "2026-11-19T10:05:00Z",
    tokens: TOKENS,
    deletionsAllowed: true,
    deletionsBlockedReason: null,
    report: r,
    passwordNamesToDelete: [],
    trackingNamesToDelete: [],
    counts: {
      storedBefore: 10,
      storedAfter: 10 - r.removed.length + r.appended.length,
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
    },
  };
  return { ...base, ...overrides };
}

function removedEntries(n: number): PlanReport["removed"] {
  return Array.from({ length: n }, (_, i) => ({ url: P(`r${i}`), name: `R${i}`, reason: "not on site" as const }));
}

/** Every list non-empty, for ordering. */
function fullBody(): PromotePlanBody {
  const body = planBody(
    {
      category: "added",
      passwordNamesToDelete: ["Gamma", "Alpha", "Gamma"],
    },
    {
      updated: [{ url: P("u"), name: "U" }],
      appended: [],
      removed: [{ url: P("alpha"), name: "Alpha", reason: "now public" }],
      needsCorrectPassword: [{ url: P("ncp"), name: "NCP" }],
      needsPassword: [{ url: P("np"), name: "NP" }],
      couldNotCheck: [
        { url: P("err"), name: "Err", reason: "fetch error: HTTP 503" },
        { url: "", name: "Draft Co", reason: "not on the site yet (no directory URL)" },
      ],
      untrackedProtected: [
        { url: P("ghost"), name: "Ghost" },
        { url: P("nameless"), name: null },
      ],
      unscrapedProtectedVendors: [{ url: "https://ncademi.org/vendor/secret/" }],
    }
  );
  return { ...body, counts: { ...body.counts, passwordRowsToDelete: 3, trackingRowsToDelete: 2 } };
}

const refusedBody: PromoteRefusedBody = {
  outcome: "refused",
  category: "published",
  error: 'Run "run-1" has target "published"; the mirror promote accepts only full runs (target "all") (D18).',
  runId: "run-1",
  runFinishedAt: "2026-11-19T10:05:00Z",
  tokens: TOKENS,
};

const errorBody: PromoteErrorBody = { error: 'No live data to promote. Run "Retrieve Live Data" first.' };

function conflictBody(fresh: { status: number; body: unknown }, changed = ["added", "passwords"]): PromoteConflictBody {
  return {
    outcome: "conflict",
    category: "published",
    error: "The stored data changed after the preview. Review the updated preview and confirm again.",
    changed: changed as PromoteConflictBody["changed"],
    fresh: fresh as PromoteConflictBody["fresh"],
  };
}

// ---------------------------------------------------------------------------
// 1. documentLabel
// ---------------------------------------------------------------------------

test("1. documentLabel: the nine D47 labels", () => {
  assert.equal(documentLabel("published"), "stored Published data");
  assert.equal(documentLabel("added"), "stored Added data");
  assert.equal(documentLabel("candidate"), "stored Candidates data");
  assert.equal(documentLabel("vendors"), "stored Vendors data");
  assert.equal(documentLabel("published-live"), "the live Published snapshot");
  assert.equal(documentLabel("added-live"), "the live Added snapshot");
  assert.equal(documentLabel("vendors-live"), "the live Vendors snapshot");
  assert.equal(documentLabel("passwords"), "vendor-review passwords");
  assert.equal(documentLabel("tracking"), "tracking data");
});

test("1. documentLabel: an unknown key returns itself (including prototype names)", () => {
  assert.equal(documentLabel("researcher-records"), "researcher-records");
  assert.equal(documentLabel("toString"), "toString");
});

test("CATEGORY_LABEL", () => {
  assert.deepEqual(CATEGORY_LABEL, { published: "Published", added: "Added", vendors: "Vendors" });
});

// ---------------------------------------------------------------------------
// 2. classifyResponse
// ---------------------------------------------------------------------------

test("2. rule 1: NOT_JSON → unknown", () => {
  assert.deepEqual(classifyResponse(502, NOT_JSON), { kind: "unknown", detail: "HTTP 502; the response was not JSON" });
});

test("2. rule 2: not a plain object → unknown", () => {
  for (const json of [null, "x", 3, [], [planBody()]]) {
    assert.deepEqual(classifyResponse(200, json), { kind: "unknown", detail: "HTTP 200; unexpected response" }, JSON.stringify(json));
  }
});

test("2. rule 3: preview and applied with 200", () => {
  const preview = planBody();
  assert.deepEqual(classifyResponse(200, preview), { kind: "plan", body: preview });
  const applied = planBody({ outcome: "applied", written: { stored: true, passwords: false, tracking: false, liveDeleted: true } });
  assert.deepEqual(classifyResponse(200, applied), { kind: "applied", body: applied });
});

test("2. rule 4: refused with 409", () => {
  assert.deepEqual(classifyResponse(409, refusedBody), { kind: "refused", body: refusedBody });
});

test("2. rule 5: conflict whose fresh is a plan", () => {
  const fresh = planBody();
  const body = conflictBody({ status: 200, body: fresh });
  assert.deepEqual(classifyResponse(409, body), { kind: "conflict", body, fresh: { kind: "plan", body: fresh } });
});

test("2. rule 5: conflict whose fresh is refused", () => {
  const body = conflictBody({ status: 409, body: refusedBody });
  assert.deepEqual(classifyResponse(409, body), { kind: "conflict", body, fresh: { kind: "refused", body: refusedBody } });
});

test("2. rule 5: conflict whose fresh is an error", () => {
  const body = conflictBody({ status: 409, body: errorBody });
  assert.deepEqual(classifyResponse(409, body), {
    kind: "conflict",
    body,
    fresh: { kind: "error", status: 409, error: errorBody.error },
  });
});

test("2. rule 5: conflict whose fresh is a conflict → unknown (nested)", () => {
  const inner = conflictBody({ status: 200, body: planBody() });
  const outer = conflictBody({ status: 409, body: inner });
  assert.deepEqual(classifyResponse(409, outer), { kind: "unknown", detail: "HTTP 409; nested conflict" });
});

test("2. rule 5: conflict without a usable fresh → unknown", () => {
  const noFresh = { ...conflictBody({ status: 200, body: planBody() }) } as Record<string, unknown>;
  delete noFresh.fresh;
  assert.deepEqual(classifyResponse(409, noFresh), { kind: "unknown", detail: "HTTP 409; unexpected response" });
  const badStatus = conflictBody({ status: "200" as unknown as number, body: planBody() });
  assert.deepEqual(classifyResponse(409, badStatus), { kind: "unknown", detail: "HTTP 409; unexpected response" });
});

test("2. rule 6: error bodies, including 401 and 500", () => {
  assert.deepEqual(classifyResponse(401, { error: "Not authenticated." }), {
    kind: "error",
    status: 401,
    error: "Not authenticated.",
  });
  assert.deepEqual(classifyResponse(500, { error: 'The "tracking" document is not a JSON object.' }), {
    kind: "error",
    status: 500,
    error: 'The "tracking" document is not a JSON object.',
  });
  assert.deepEqual(classifyResponse(409, errorBody), { kind: "error", status: 409, error: errorBody.error });
});

test("2. rule 7: outcome/status mismatches and missing fields → unknown", () => {
  assert.deepEqual(classifyResponse(409, planBody()), { kind: "unknown", detail: "HTTP 409; unexpected response" });
  assert.deepEqual(classifyResponse(200, refusedBody), { kind: "unknown", detail: "HTTP 200; unexpected response" });
  assert.deepEqual(classifyResponse(200, conflictBody({ status: 200, body: planBody() })), {
    kind: "unknown",
    detail: "HTTP 200; unexpected response",
  });
  assert.deepEqual(classifyResponse(500, {}), { kind: "unknown", detail: "HTTP 500; unexpected response" });
  assert.deepEqual(classifyResponse(500, { error: 42 }), { kind: "unknown", detail: "HTTP 500; unexpected response" });
  assert.deepEqual(classifyResponse(400, { outcome: "bogus", error: "x" }), { kind: "unknown", detail: "HTTP 400; unexpected response" });
});

// ---------------------------------------------------------------------------
// 3. confirmLabel
// ---------------------------------------------------------------------------

test("3. confirmLabel: removed 0", () => {
  assert.equal(confirmLabel(planBody()), "Update stored Published");
});

test("3. confirmLabel: removed 1 (singular)", () => {
  assert.equal(confirmLabel(planBody({ category: "added" }, { removed: removedEntries(1) })), "Delete 1 record and update stored Added");
});

test("3. confirmLabel: removed 6 with deletions allowed", () => {
  assert.equal(
    confirmLabel(planBody({ category: "vendors" }, { removed: removedEntries(6) })),
    "Delete 6 records and update stored Vendors"
  );
});

test("3. confirmLabel: removed 6 with deletions blocked", () => {
  const body = planBody({ deletionsAllowed: false, deletionsBlockedReason: "product URL discovery was incomplete." }, { removed: removedEntries(6) });
  assert.equal(confirmLabel(body), "Update stored Published");
});

// ---------------------------------------------------------------------------
// 4. sections
// ---------------------------------------------------------------------------

test("4. sections: full D44 ordering, headings and items", () => {
  assert.deepEqual(sections(fullBody()), [
    {
      id: "removed",
      heading: "Records to delete (1)",
      items: [{ primary: "Alpha", secondary: `${P("alpha")} — now public` }],
    },
    {
      id: "passwords",
      heading: "Password rows to delete (3)",
      items: [
        { primary: "Gamma", secondary: null },
        { primary: "Alpha", secondary: null },
      ],
    },
    { id: "needs-correct-password", heading: "Need the correct password (1)", items: [{ primary: "NCP", secondary: P("ncp") }] },
    { id: "needs-password", heading: "Need a password (1)", items: [{ primary: "NP", secondary: P("np") }] },
    {
      id: "could-not-check",
      heading: "Could not check (2)",
      items: [
        { primary: "Err", secondary: `${P("err")} — fetch error: HTTP 503` },
        { primary: "Draft Co", secondary: "not on the site yet (no directory URL)" },
      ],
    },
    {
      id: "untracked-protected",
      heading: "Protected pages not tracked (2)",
      items: [
        { primary: "Ghost", secondary: P("ghost") },
        { primary: P("nameless"), secondary: null },
      ],
    },
    {
      id: "unscraped-vendors",
      heading: "Protected vendor pages not scraped (1)",
      items: [{ primary: "https://ncademi.org/vendor/secret/", secondary: null }],
    },
  ]);
});

test("4. sections: empty lists are omitted", () => {
  assert.deepEqual(sections(planBody()), []);
  const onlyCnc = planBody({}, { couldNotCheck: [{ url: P("x"), name: "X", reason: "parse error" }] });
  assert.deepEqual(
    sections(onlyCnc).map((s) => s.id),
    ["could-not-check"]
  );
});

test("4. sections: duplicate password names listed once; heading shows the row count", () => {
  const body = planBody({ passwordNamesToDelete: ["G", "G", "H"] });
  const withCount = { ...body, counts: { ...body.counts, passwordRowsToDelete: 5 } };
  const [s] = sections(withCount);
  assert.equal(s?.heading, "Password rows to delete (5)");
  assert.deepEqual(s?.items, [
    { primary: "G", secondary: null },
    { primary: "H", secondary: null },
  ]);
});

test("4. sections: couldNotCheck with url '' (D36) shows the reason alone", () => {
  const body = planBody({ category: "vendors" }, { couldNotCheck: [{ url: "", name: "Another Test", reason: "not on the site yet (no directory URL)" }] });
  assert.deepEqual(sections(body)[0]?.items, [{ primary: "Another Test", secondary: "not on the site yet (no directory URL)" }]);
});

test("4. sections: untrackedProtected with a null name uses the url as primary", () => {
  const body = planBody({ category: "added" }, { untrackedProtected: [{ url: P("n"), name: null }] });
  assert.deepEqual(sections(body)[0]?.items, [{ primary: P("n"), secondary: null }]);
});

// ---------------------------------------------------------------------------
// 5–7. summaryLines, passwordStatement, conflictNotice
// ---------------------------------------------------------------------------

test("5. summaryLines without tracking rows", () => {
  const body = planBody({}, { updated: [{ url: P("a"), name: "A" }], appended: [{ url: P("e"), name: "E" }] });
  assert.deepEqual(summaryLines(body), ["Updated: 1", "Added: 1", "Stored records: 10 → 11"]);
});

test("5. summaryLines with tracking rows", () => {
  assert.deepEqual(summaryLines(fullBody()), [
    "Updated: 1",
    "Added: 0",
    "Stored records: 10 → 9",
    "Tracking rows to delete: 2",
  ]);
});

test("6. passwordStatement: 0, 1 and more than 1", () => {
  const body = planBody();
  assert.equal(passwordStatement(body), null);
  assert.equal(
    passwordStatement({ ...body, counts: { ...body.counts, passwordRowsToDelete: 1 } }),
    "1 vendor-review password row will be removed."
  );
  assert.equal(
    passwordStatement({ ...body, counts: { ...body.counts, passwordRowsToDelete: 16 } }),
    "16 vendor-review password rows will be removed."
  );
});

test("7. conflictNotice with changed ['added', 'passwords']", () => {
  const body = conflictBody({ status: 200, body: planBody() }, ["added", "passwords"]);
  assert.equal(
    conflictNotice(body),
    "The stored data changed after the preview. Review the updated preview and confirm again. Changed: stored Added data, vendor-review passwords."
  );
});

// ---------------------------------------------------------------------------
// 8. messageLines (D49)
// ---------------------------------------------------------------------------

function appliedBody(blocked = false): PromotePlanBody {
  const body = planBody(
    {
      outcome: "applied",
      category: "added",
      written: { stored: true, passwords: true, tracking: false, liveDeleted: true },
      ...(blocked ? { deletionsAllowed: false, deletionsBlockedReason: "product URL discovery was incomplete (discovered 99 of 100). No records are deleted (D15)." } : {}),
    },
    {
      updated: [{ url: P("a"), name: "A" }],
      removed: blocked ? [] : removedEntries(16),
    }
  );
  return { ...body, counts: { ...body.counts, passwordRowsToDelete: blocked ? 0 : 16 } };
}

test("8. messageLines: applied", () => {
  assert.deepEqual(messageLines({ kind: "applied", body: appliedBody() }, "added", "11-19-26 12:23"), [
    "Updated stored Added from the live run of 11-19-26 12:23: 1 updated, 0 added, 16 removed; 16 password rows removed. Live snapshot cleared.",
  ]);
});

test("8. messageLines: applied with deletions blocked", () => {
  assert.deepEqual(messageLines({ kind: "applied", body: appliedBody(true) }, "added", "11-19-26 12:23"), [
    "Updated stored Added from the live run of 11-19-26 12:23: 1 updated, 0 added, 0 removed; 0 password rows removed. Live snapshot cleared.",
    "Deletions were not applied: product URL discovery was incomplete (discovered 99 of 100). No records are deleted (D15).",
  ]);
});

test("8. messageLines: applied with a null formattedRunTime falls back to runFinishedAt", () => {
  assert.deepEqual(messageLines({ kind: "applied", body: appliedBody() }, "added", null), [
    "Updated stored Added from the live run of 2026-11-19T10:05:00Z: 1 updated, 0 added, 16 removed; 16 password rows removed. Live snapshot cleared.",
  ]);
});

test("8. messageLines: cancelled", () => {
  assert.deepEqual(messageLines({ kind: "cancelled" }, "published", null), ["Update Stored Data cancelled; nothing was changed."]);
});

test("8. messageLines: failed refused", () => {
  assert.deepEqual(messageLines({ kind: "failed", view: { kind: "refused", body: refusedBody } }, "published", null), [
    `Update Stored Data failed: ${refusedBody.error}`,
  ]);
});

test("8. messageLines: failed error 500", () => {
  assert.deepEqual(
    messageLines({ kind: "failed", view: { kind: "error", status: 500, error: 'The "tracking" document is not a JSON object.' } }, "vendors", null),
    ['Update Stored Data failed: The "tracking" document is not a JSON object.']
  );
});

test("8. messageLines: failed error 401", () => {
  assert.deepEqual(messageLines({ kind: "failed", view: { kind: "error", status: 401, error: "Not authenticated." } }, "vendors", null), [
    "Update Stored Data failed: your session has expired; sign in again.",
  ]);
});

test("8. messageLines: unknown", () => {
  assert.deepEqual(messageLines({ kind: "unknown", detail: "network error: Failed to fetch" }, "published", null), [
    "Update Stored Data: the result is unknown (network error: Failed to fetch); review a fresh preview.",
  ]);
});

// ---------------------------------------------------------------------------
// 9. removedContainsUrl (D52)
// ---------------------------------------------------------------------------

test("9. removedContainsUrl: match, no match, null, empty", () => {
  const body = planBody({}, { removed: removedEntries(2) });
  assert.equal(removedContainsUrl(body, P("r1")), true);
  assert.equal(removedContainsUrl(body, P("other")), false);
  assert.equal(removedContainsUrl(body, null), false);
  assert.equal(removedContainsUrl(body, ""), false);
  assert.equal(removedContainsUrl(planBody({}, { removed: [{ url: "", name: "X", reason: "not on site" }] }), ""), false);
});

// ---------------------------------------------------------------------------
// 10. Purity
// ---------------------------------------------------------------------------

test("10. purity: no exported function mutates its inputs", () => {
  const plans = [planBody(), fullBody(), appliedBody(), appliedBody(true), planBody({}, { removed: removedEntries(6) })];
  const conflicts = [
    conflictBody({ status: 200, body: planBody() }),
    conflictBody({ status: 409, body: refusedBody }),
    conflictBody({ status: 409, body: conflictBody({ status: 200, body: planBody() }) }),
  ];
  const results: PromoteModalResult[] = [
    { kind: "applied", body: appliedBody(true) },
    { kind: "cancelled" },
    { kind: "failed", view: { kind: "refused", body: refusedBody } },
    { kind: "failed", view: { kind: "error", status: 401, error: "Not authenticated." } },
    { kind: "unknown", detail: "x" },
  ];
  const before = structuredClone({ plans, conflicts, results, refusedBody, errorBody });

  for (const body of plans) {
    confirmLabel(body);
    sections(body);
    summaryLines(body);
    passwordStatement(body);
    removedContainsUrl(body, P("r0"));
    classifyResponse(200, body);
  }
  for (const body of conflicts) {
    conflictNotice(body);
    classifyResponse(409, body);
  }
  for (const result of results) messageLines(result, "added", "11-19-26 12:23");
  classifyResponse(409, refusedBody);
  classifyResponse(409, errorBody);
  documentLabel("published");

  assert.deepEqual({ plans, conflicts, results, refusedBody, errorBody }, before);
});

test("PromoteView kinds are exhaustive over the fixtures (type check only)", () => {
  const views: PromoteView[] = [
    classifyResponse(200, planBody()),
    classifyResponse(409, refusedBody),
    classifyResponse(409, errorBody),
    classifyResponse(502, NOT_JSON),
  ];
  assert.deepEqual(
    views.map((v) => v.kind),
    ["plan", "refused", "error", "unknown"]
  );
});
