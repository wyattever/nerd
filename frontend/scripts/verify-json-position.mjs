// frontend/scripts/verify-json-position.mjs
/**
 * Verification harness for lib/json-position.ts.
 *
 * The frontend has no unit-test runner (Playwright e2e only), and adding one
 * for a single pure module is not worth a dependency. This runs under plain
 * node with zero installs:
 *
 *   cd frontend && npx tsc --noEmit lib/json-position.ts   # types
 *   cd frontend && node scripts/verify-json-position.mjs   # behavior
 *
 * The scanner is imported from the real .ts source via Node type stripping,
 * so this tests the shipped file rather than a copy that can drift.
 *
 * Section D is the important one: 4000 single-character mutations of the real
 * published-tables.json, with JSON.parse as the oracle. Any disagreement
 * between JSON.parse and the scanner is a scanner bug.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = join(here, "..");

// --- load the TS module ---------------------------------------------------
// json-position.ts has no imports and uses no TypeScript feature that survives
// type-stripping, so Node can run it directly. Type stripping is on by default
// in Node 23.6+; on Node 22.6-23.5 pass --experimental-strip-types.
let mod;
try {
  mod = await import(join(frontendRoot, "lib", "json-position.ts"));
} catch (error) {
  console.error("Could not import lib/json-position.ts directly.");
  console.error(String(error && error.message ? error.message : error));
  console.error("\nOn Node 22.6-23.5, run:");
  console.error("  node --experimental-strip-types scripts/verify-json-position.mjs");
  process.exit(2);
}

const { parseJsonWithPosition, formatJsonError, scanJson } = mod;

let pass = 0;
let fail = 0;
function check(name, condition, detail) {
  if (condition) {
    pass += 1;
    return;
  }
  fail += 1;
  console.log(`  FAIL: ${name}${detail === undefined ? "" : ` -> ${detail}`}`);
}

console.log("=== A. Exact line/column on hand-built fixtures ===");
const fixtures = [
  ["trailing comma in object", '{\n  "a": 1,\n}', 3, 1],
  ["trailing comma in array", '{\n  "a": [\n    1,\n  ]\n}', 4, 3],
  ["missing closing brace", '{\n  "a": 1', 2, 9],
  ["missing colon", '{\n  "a" 1\n}', 2, 7],
  ["single quotes", "{\n  'a': 1\n}", 2, 3],
  ["unquoted key", '{\n  a: 1\n}', 2, 3],
  ["missing comma between pairs", '{\n  "a": 1\n  "b": 2\n}', 3, 3],
  ["unterminated string", '{\n  "a": "oops\n}', 2, 13],
  ["newline inside string", '{\n  "a": "one\ntwo"\n}', 2, 12],
  ["bad escape", '{\n  "a": "x\\qy"\n}', 2, 10],
  ["bad unicode escape", '{\n  "a": "x\\u12zzy"\n}', 2, 10],
  ["leading zero", '{\n  "a": 01\n}', 2, 9],
  ["bare NaN", '{\n  "a": NaN\n}', 2, 8],
  ["undefined value", '{\n  "a": undefined\n}', 2, 8],
  ["JSON5 comment", '{\n  // note\n  "a": 1\n}', 2, 3],
  ["trailing junk", '{"a":1}\nextra', 2, 1],
  ["empty input", "", 1, 1],
  ["whitespace only", "   \n  ", 2, 3],
];
for (const [label, text, wantLine, wantColumn] of fixtures) {
  const result = parseJsonWithPosition(text);
  check(`${label}: rejected`, result.ok === false, "unexpectedly parsed");
  if (result.ok) continue;
  check(
    `${label}: line ${wantLine} column ${wantColumn}`,
    result.error.line === wantLine && result.error.column === wantColumn,
    `got line ${result.error.line} column ${result.error.column} (${result.error.message})`
  );
}

console.log("\n=== B. Valid JSON is never flagged ===");
const valid = [
  "{}",
  "[]",
  "null",
  "true",
  "false",
  "0",
  "-0",
  "1e10",
  "-1.5E-3",
  '"x"',
  '{"a":{"b":[1,2,{"c":null}]}}',
  '  {"a": 1}  ',
  '{"a":"line\\nbreak \\u00e9 \\" \\\\ \\/"}',
  '{"unicode":"café — ✓ 🎉"}',
  "[[[[[[[[[[1]]]]]]]]]]",
  '{"empty":{},"emptyArr":[]}',
];
for (const text of valid) {
  const result = parseJsonWithPosition(text);
  check(`accepts ${text.slice(0, 36)}`, result.ok === true);
  check(`no false positive ${text.slice(0, 24)}`, scanJson(text) === null);
}

console.log("\n=== C. The real snapshot file ===");
const realPath = join(frontendRoot, "lib", "published-tables.json");
const real = readFileSync(realPath, "utf8");
const started = Date.now();
check("published-tables.json parses", parseJsonWithPosition(real).ok === true);
check("published-tables.json scans clean", scanJson(real) === null);
console.log(
  `  ${(real.length / 1024).toFixed(1)} KB, parse + scan in ${Date.now() - started}ms`
);

console.log("\n=== D. Fuzz: 4000 single-character mutations, JSON.parse as oracle ===");
const replacements = ["", ",", "}", "]", '"', ":", "x", "\n", "{", "["];
let seed = 1234567;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
let disagreements = 0;
let missingCoordinates = 0;
let outOfRange = 0;
for (let n = 0; n < 4000; n += 1) {
  const at = Math.floor(rnd() * real.length);
  const mutated =
    real.slice(0, at) + replacements[Math.floor(rnd() * replacements.length)] + real.slice(at + 1);

  let nativeOk = true;
  try {
    JSON.parse(mutated);
  } catch {
    nativeOk = false;
  }
  const scannerOk = scanJson(mutated) === null;

  if (nativeOk !== scannerOk) {
    disagreements += 1;
    if (disagreements <= 3) {
      console.log(`  DISAGREE at offset ${at}: JSON.parse ok=${nativeOk}, scanner ok=${scannerOk}`);
    }
    continue;
  }
  if (nativeOk) continue;

  const { error } = parseJsonWithPosition(mutated);
  if (error.line === null) {
    missingCoordinates += 1;
    continue;
  }
  const lines = mutated.split("\n");
  const lineOk = error.line >= 1 && error.line <= lines.length;
  const columnOk = lineOk && error.column >= 1 && error.column <= lines[error.line - 1].length + 1;
  if (!lineOk || !columnOk) {
    outOfRange += 1;
    if (outOfRange <= 3) {
      console.log(`  OUT OF RANGE at offset ${at}: line ${error.line} column ${error.column}`);
    }
  }
}
check("scanner agrees with JSON.parse on every mutation", disagreements === 0, `${disagreements}`);
check("every rejection carries coordinates", missingCoordinates === 0, `${missingCoordinates}`);
check("every coordinate resolves inside the text", outOfRange === 0, `${outOfRange}`);

console.log("\n=== E. Why the SyntaxError message cannot be regexed ===");
for (const [label, text] of [
  ["object trailing comma", '{"a":1,}'],
  ["array trailing comma", "[1,2,]"],
]) {
  let nativeMessage = "";
  try {
    JSON.parse(text);
  } catch (error) {
    nativeMessage = error.message;
  }
  const matched = /position (\d+)/.exec(nativeMessage);
  console.log(`  ${label}`);
  console.log(`    JSON.parse : ${nativeMessage}`);
  console.log(
    `    /position/ : ${matched ? `matched ${matched[1]}` : "NO MATCH -- a regex-based reader reports line 1 column 1"}`
  );
  console.log(`    scanner    : ${formatJsonError(parseJsonWithPosition(text).error)}`);
}

console.log(`\nnode ${process.version}`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
