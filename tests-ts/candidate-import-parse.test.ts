/**
 * Unit tests for frontend/lib/candidate-import.ts (bulk Candidate import,
 * step 1: paste parser, normalizers, shared boilerplate auto-fill).
 * Pure: no Firestore. Run from the repo root with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:1 node --experimental-transform-types \
 *     --import ./tests-ts/support/ts-resolve.mjs --test tests-ts/candidate-import-parse.test.ts
 * The unreachable emulator host makes any accidental Firestore call fail.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyBoilerplateDefaults,
  nameKey,
  normalizeSlug,
  normalizeUrlForMatch,
  parsePaste,
} from "../frontend/lib/candidate-import.ts";
import type { PasteEntry } from "../frontend/lib/candidate-import.ts";

const FENCE = "```";

function rec(slug: string): string {
  return JSON.stringify({ slug, name: `Product ${slug}` }, null, 2);
}

function entriesOf(text: string): PasteEntry[] {
  const result = parsePaste(text);
  assert.equal(result.ok, true, result.ok ? "" : `refused: ${result.error}`);
  if (!result.ok) throw new Error("unreachable");
  return result.entries;
}

function refusalOf(text: string): string {
  const result = parsePaste(text);
  assert.equal(result.ok, false, "expected the paste to be refused");
  if (result.ok) throw new Error("unreachable");
  return result.error;
}

function assertThreeInOrder(entries: PasteEntry[]): void {
  assert.equal(entries.length, 3);
  assert.deepEqual(
    entries.map((e) => e.index),
    [1, 2, 3],
  );
  assert.deepEqual(
    entries.map((e) => e.record?.slug),
    ["a", "b", "c"],
  );
  for (const e of entries) assert.equal(e.error, null);
}

test("a. one bare record gives one entry with a record and no error", () => {
  const entries = entriesOf(rec("a"));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].index, 1);
  assert.deepEqual(entries[0].record, { slug: "a", name: "Product a" });
  assert.equal(entries[0].error, null);
});

test("b. three records separated by blank lines give indexes 1, 2, 3 in paste order", () => {
  assertThreeInOrder(entriesOf([rec("a"), rec("b"), rec("c")].join("\n\n")));
});

test("c. the same three records inside json code fences give the same result", () => {
  const text = ["a", "b", "c"].map((s) => `${FENCE}json\n${rec(s)}\n${FENCE}`).join("\n\n");
  assertThreeInOrder(entriesOf(text));
});

test("d. strings containing a closing brace and an escaped quote parse exactly", () => {
  const text = '{"slug": "d", "note": "a } b", "quote": "say \\"hi\\""}';
  const entries = entriesOf(text);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].record?.note, "a } b");
  assert.equal(entries[0].record?.quote, 'say "hi"');
});

test("e. batch envelopes: valid gives products; wrong $version or $format gives one error", () => {
  const ok = entriesOf(
    JSON.stringify({
      $format: "nerd-candidate-batch",
      $version: 1,
      products: [{ slug: "a" }, { slug: "b" }],
    }),
  );
  assert.equal(ok.length, 2);
  assert.deepEqual(
    ok.map((e) => e.record?.slug),
    ["a", "b"],
  );

  const v2 = entriesOf(
    JSON.stringify({ $format: "nerd-candidate-batch", $version: 2, products: [{ slug: "a" }] }),
  );
  assert.equal(v2.length, 1);
  assert.equal(v2[0].record, null);
  assert.ok(v2[0].error?.includes("2"), `error was: ${v2[0].error}`);

  const other = entriesOf(JSON.stringify({ $format: "other", $version: 1, products: [{ slug: "a" }] }));
  assert.equal(other.length, 1);
  assert.equal(other[0].record, null);
  assert.ok(other[0].error?.includes("other"), `error was: ${other[0].error}`);
});

test("f. a bare array of 2 records then 1 record gives 3 entries", () => {
  const text = `${JSON.stringify([{ slug: "a" }, { slug: "b" }])}\n\n${rec("c")}`;
  const entries = entriesOf(text);
  assert.equal(entries.length, 3);
  assert.deepEqual(
    entries.map((e) => e.record?.slug),
    ["a", "b", "c"],
  );
});

test("g. a trailing comma in the second record makes only entry 2 an error", () => {
  const bad = '{\n  "slug": "b",\n  "name": "Product b",\n}';
  const entries = entriesOf([rec("a"), bad, rec("c")].join("\n\n"));
  assert.equal(entries.length, 3);
  assert.equal(entries[0].record?.slug, "a");
  assert.equal(entries[0].error, null);
  assert.equal(entries[1].record, null);
  assert.ok(entries[1].error?.startsWith("not valid JSON"), `error was: ${entries[1].error}`);
  assert.equal(entries[2].record?.slug, "c");
  assert.equal(entries[2].error, null);
});

test("h. a line of prose then a record gives a text error then the record", () => {
  const entries = entriesOf(`Here is the research result you asked for.\n${rec("a")}`);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].index, 1);
  assert.equal(entries[0].record, null);
  assert.equal(entries[0].error, "text that is not JSON");
  assert.equal(entries[1].index, 2);
  assert.equal(entries[1].record?.slug, "a");
  assert.equal(entries[1].error, null);
});

test("i. a record missing its final brace gives one incomplete-JSON error", () => {
  const text = rec("a").replace(/\}\s*$/, "");
  const entries = entriesOf(text);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].record, null);
  assert.equal(
    entries[0].error,
    "incomplete JSON (missing a closing bracket); anything pasted after this point was not read",
  );
});

test("j. refusals: empty, too many records, too large, no records", () => {
  assert.equal(refusalOf(""), "Paste is empty.");
  assert.equal(refusalOf("   "), "Paste is empty.");

  const many = Array.from({ length: 26 }, (_, k) => rec(`r${k}`)).join("\n\n");
  assert.equal(refusalOf(many), "Paste contains 26 records; the limit is 25.");

  const big = `{"slug": "x", "pad": "${"a".repeat(500_001 - '{"slug": "x", "pad": ""}'.length)}"}`;
  assert.equal(new TextEncoder().encode(big).length, 500_001);
  assert.equal(refusalOf(big), "Paste is larger than 500 KB.");

  assert.equal(refusalOf("[]"), "Paste contains no records.");
});

test("k. normalizeSlug", () => {
  assert.equal(normalizeSlug("BrainPOP Jr."), "brainpop-jr");
  assert.equal(normalizeSlug("Google Forms"), "google-forms");
  assert.equal(normalizeSlug("--a__b--"), "a-b");
  assert.equal(normalizeSlug("!!!"), "");
});

test("l. normalizeUrlForMatch", () => {
  assert.equal(normalizeUrlForMatch("https://www.Newsela.com/?utm=x#top"), "newsela.com");
  assert.equal(normalizeUrlForMatch("http://newsela.com/about/"), "newsela.com/about");
  assert.equal(normalizeUrlForMatch("not a url"), null);
  assert.equal(normalizeUrlForMatch(42), null);
});

test("m. nameKey", () => {
  assert.equal(nameKey("BrainPOP Jr."), "brainpopjr");
});

test("n. applyBoilerplateDefaults fills missing fields and keeps present ones", () => {
  const now = new Date("2026-01-02T03:04:05.678Z");

  const sparse: Record<string, unknown> = { slug: "x", ncademi_product_url: null };
  applyBoilerplateDefaults(sparse, now);
  assert.equal(sparse.ncademi_product_url, "https://ncademi.org/provide/directory/products/x/");
  assert.equal(sparse.vendor_directory_url, null);
  assert.equal(sparse.ai_insights, null);
  assert.equal(sparse.last_updated, now.toISOString());

  const full: Record<string, unknown> = {
    slug: "x",
    ncademi_product_url: "https://example.org/real/",
    vendor_directory_url: "https://example.org/vendor/",
    last_updated: "2020-05-06T00:00:00.000Z",
    ai_insights: "kept",
  };
  const before = { ...full };
  applyBoilerplateDefaults(full, now);
  assert.deepEqual(full, before);
});
