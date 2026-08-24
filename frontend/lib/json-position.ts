// frontend/lib/json-position.ts
/**
 * Engine-independent line/column coordinates for JSON syntax errors.
 *
 * WHY THIS EXISTS
 * ---------------
 * The obvious approach -- regex the message off JSON.parse's SyntaxError --
 * does not work. The message text is implementation-defined (ECMA-262 does
 * not specify it) and V8 emits two different shapes depending on the error
 * class. Measured on node v22.22.2:
 *
 *   JSON.parse('{"a":1,}')
 *     -> Expected double-quoted property name in JSON at position 7 (line 1 column 8)
 *
 *   JSON.parse('[1,2,]')
 *     -> Unexpected token ']', "[1,2,]" is not valid JSON
 *
 * The second shape carries NO position and NO line/column, at any input
 * length -- a 531-character input with a trailing comma in an array produces
 * it too. So /position (\d+)/ silently returns null for a whole class of the
 * most common editing mistakes, and any code branching on it reports the
 * wrong location. SpiderMonkey and JavaScriptCore use different wording again.
 *
 * Instead: JSON.parse remains the authority on VALIDITY, and this module's
 * own scanner supplies the COORDINATES. The scanner is a plain recursive
 * descent walk over the RFC 8259 grammar that tracks its own offset, so it
 * behaves identically in every engine.
 *
 * The two are cross-checked. If JSON.parse throws but the scanner finds
 * nothing wrong, we do not invent coordinates -- we surface JSON.parse's
 * message verbatim and report line/column as null. Verified against a
 * 4000-mutation fuzz of the real 117 KB published-tables.json with zero
 * disagreements (see frontend/scripts/verify-json-position.mjs).
 */

const WHITESPACE = new Set([" ", "\t", "\n", "\r"]);
const DIGITS = new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);

/** Max nesting depth the scanner will walk. Guards against a pathological
 *  paste blowing the JS stack; real records nest 3 levels. */
const MAX_DEPTH = 200;

export interface JsonPosition {
  line: number;
  column: number;
}

export interface JsonSyntaxError {
  /** Human-readable, written for an editor rather than a compiler. */
  message: string;
  /** 1-based. Null only when the scanner and JSON.parse disagree. */
  line: number | null;
  /** 1-based, counted in UTF-16 code units. Null under the same condition. */
  column: number | null;
  /** JSON.parse's own message, kept for debugging/telemetry. */
  nativeMessage: string;
}

export type JsonParseResult<T = unknown> =
  | { ok: true; value: T; error: null }
  | { ok: false; value: null; error: JsonSyntaxError };

interface ScanFailure {
  message: string;
  index: number;
}

/** Converts a 0-based character offset into 1-based line/column. */
export function indexToLineColumn(text: string, index: number): JsonPosition {
  const clamped = Math.max(0, Math.min(index, text.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < clamped; i += 1) {
    // charCodeAt is materially faster than text[i] === "\n" over a 100 KB
    // string and this runs on every failed parse.
    if (text.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: clamped - lineStart + 1 };
}

/**
 * Walks `text` as JSON and returns the first structural problem, or null if
 * the text is well-formed. Exported for the verification script; callers in
 * the app should use parseJsonWithPosition.
 */
export function scanJson(text: string): ScanFailure | null {
  let i = 0;

  const fail = (message: string, at?: number): ScanFailure => ({
    message,
    index: at === undefined ? i : at,
  });

  function skipWhitespace(): void {
    while (i < text.length && WHITESPACE.has(text[i])) i += 1;
  }

  function expect(ch: string, what: string): ScanFailure | null {
    if (i >= text.length) return fail(`Unexpected end of input; expected ${what}.`);
    if (text[i] !== ch) return fail(`Expected ${what} but found ${JSON.stringify(text[i])}.`);
    i += 1;
    return null;
  }

  function scanString(): ScanFailure | null {
    const start = i;
    if (text[i] !== '"') return fail("Expected a double-quoted string.");
    i += 1;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '"') {
        i += 1;
        return null;
      }
      if (ch === "\\") {
        const esc = text[i + 1];
        if (esc === undefined) return fail("Unexpected end of input inside a string.", i);
        if (esc === "u") {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            return fail(
              `Invalid \\u escape; expected four hex digits, found ${JSON.stringify(hex)}.`,
              i
            );
          }
          i += 6;
          continue;
        }
        if (!'"\\/bfnrt'.includes(esc)) {
          return fail(`Invalid escape sequence \\${esc} in string.`, i);
        }
        i += 2;
        continue;
      }
      if (ch.charCodeAt(0) < 0x20) {
        const label =
          ch === "\n"
            ? "newline"
            : ch === "\t"
              ? "tab"
              : `control character U+${ch.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()}`;
        return fail(`Unescaped ${label} inside a string; strings must not span lines.`, i);
      }
      i += 1;
    }
    return fail("Unterminated string; no closing double quote.", start);
  }

  function scanNumber(): ScanFailure | null {
    const start = i;
    if (text[i] === "-") i += 1;
    if (text[i] === "0") {
      i += 1;
    } else if (DIGITS.has(text[i])) {
      while (DIGITS.has(text[i])) i += 1;
    } else {
      return fail("Expected a digit in number.", start);
    }
    if (text[i] === ".") {
      i += 1;
      if (!DIGITS.has(text[i])) return fail("Expected a digit after the decimal point.");
      while (DIGITS.has(text[i])) i += 1;
    }
    if (text[i] === "e" || text[i] === "E") {
      i += 1;
      if (text[i] === "+" || text[i] === "-") i += 1;
      if (!DIGITS.has(text[i])) return fail("Expected a digit in the exponent.");
      while (DIGITS.has(text[i])) i += 1;
    }
    return null;
  }

  function scanLiteral(word: string): ScanFailure | null {
    if (text.startsWith(word, i)) {
      i += word.length;
      return null;
    }
    return fail(`Expected ${word}.`);
  }

  function scanValue(depth: number): ScanFailure | null {
    if (depth > MAX_DEPTH) return fail("Nesting is too deep to validate.");
    skipWhitespace();
    if (i >= text.length) return fail("Unexpected end of input; expected a value.");
    const ch = text[i];
    if (ch === "{") return scanObject(depth);
    if (ch === "[") return scanArray(depth);
    if (ch === '"') return scanString();
    if (ch === "-" || DIGITS.has(ch)) return scanNumber();
    if (ch === "t") return scanLiteral("true");
    if (ch === "f") return scanLiteral("false");
    if (ch === "n") return scanLiteral("null");
    return fail(
      `Unexpected ${JSON.stringify(ch)}; expected a value (object, array, string, number, true, false, or null).`
    );
  }

  function scanObject(depth: number): ScanFailure | null {
    i += 1; // consume {
    skipWhitespace();
    if (text[i] === "}") {
      i += 1;
      return null;
    }
    for (;;) {
      skipWhitespace();
      if (text[i] === "}") return fail("Trailing comma before }; JSON does not allow it.");
      if (text[i] !== '"') {
        if (i >= text.length) return fail("Unexpected end of input; expected a property name.");
        return fail(
          `Expected a double-quoted property name but found ${JSON.stringify(text[i])}.`
        );
      }
      const nameErr = scanString();
      if (nameErr) return nameErr;
      skipWhitespace();
      const colonErr = expect(":", "':' after the property name");
      if (colonErr) return colonErr;
      const valueErr = scanValue(depth + 1);
      if (valueErr) return valueErr;
      skipWhitespace();
      if (text[i] === ",") {
        i += 1;
        continue;
      }
      if (text[i] === "}") {
        i += 1;
        return null;
      }
      if (i >= text.length) return fail("Unexpected end of input; expected ',' or '}'.");
      return fail(`Expected ',' or '}' but found ${JSON.stringify(text[i])}.`);
    }
  }

  function scanArray(depth: number): ScanFailure | null {
    i += 1; // consume [
    skipWhitespace();
    if (text[i] === "]") {
      i += 1;
      return null;
    }
    for (;;) {
      skipWhitespace();
      if (text[i] === "]") return fail("Trailing comma before ]; JSON does not allow it.");
      const valueErr = scanValue(depth + 1);
      if (valueErr) return valueErr;
      skipWhitespace();
      if (text[i] === ",") {
        i += 1;
        continue;
      }
      if (text[i] === "]") {
        i += 1;
        return null;
      }
      if (i >= text.length) return fail("Unexpected end of input; expected ',' or ']'.");
      return fail(`Expected ',' or ']' but found ${JSON.stringify(text[i])}.`);
    }
  }

  const err = scanValue(0);
  if (err) return err;
  skipWhitespace();
  if (i < text.length) {
    return {
      message: `Unexpected ${JSON.stringify(text[i])} after the end of the JSON value.`,
      index: i,
    };
  }
  return null;
}

/**
 * JSON.parse with reliable coordinates on failure.
 *
 * The generic is a convenience for call sites; it is NOT a validation claim.
 * The returned value is whatever the text contained -- run it through
 * published-validate before treating it as a PublishedProductRecord.
 */
export function parseJsonWithPosition<T = unknown>(text: string): JsonParseResult<T> {
  try {
    return { ok: true, value: JSON.parse(text) as T, error: null };
  } catch (nativeError) {
    const nativeMessage =
      nativeError instanceof Error ? nativeError.message : String(nativeError);
    const scanned = scanJson(text);
    if (!scanned) {
      // Scanner and JSON.parse disagree. JSON.parse is authoritative on
      // validity, so report its message rather than inventing a location.
      return {
        ok: false,
        value: null,
        error: { message: nativeMessage, line: null, column: null, nativeMessage },
      };
    }
    const { line, column } = indexToLineColumn(text, scanned.index);
    return {
      ok: false,
      value: null,
      error: { message: scanned.message, line, column, nativeMessage },
    };
  }
}

/** One-line form for a live region. Degrades gracefully when line is null. */
export function formatJsonError(error: JsonSyntaxError): string {
  if (error.line === null || error.column === null) return error.message;
  return `Line ${error.line}, column ${error.column}: ${error.message}`;
}
