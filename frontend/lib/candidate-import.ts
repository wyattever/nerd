// frontend/lib/candidate-import.ts

/**
 * Pure helpers for importing Candidate records from pasted research results.
 *
 * - applyBoilerplateDefaults: the boilerplate auto-fill shared by the
 *   single-record Import Candidate modal (ImportJsonModal) and bulk import.
 * - parsePaste: splits a paste holding one or more JSON values (bare
 *   records, arrays of records, or a batch envelope, optionally wrapped in
 *   code fences) into numbered entries, each either a record or an error.
 * - normalizeSlug / normalizeUrlForMatch / nameKey: normalizers for
 *   duplicate checks.
 *
 * Pure: no "server-only" import, no I/O, and no clock reads -- callers pass
 * the current time in.
 */

export const MAX_PASTE_BYTES = 500_000;
export const MAX_RECORDS = 25;
export const BATCH_FORMAT = "nerd-candidate-batch";
export const BATCH_VERSION = 1;

/**
 * Auto-fill boilerplate fields the schema requires but a hand-authored or
 * partial paste commonly omits, before validation runs. Only fields that are
 * missing are touched; anything the record already provides, including an
 * explicit null, is left alone (ncademi_product_url is filled when falsy).
 * Mutates record in place.
 */
export function applyBoilerplateDefaults(record: Record<string, unknown>, now: Date): void {
  // PLACEHOLDER, not a verified live URL -- mirrors the same
  // convention used by the AppSheet migration route
  // (/api/local/migrate-appsheet) for the same reason: a candidate
  // record has no real ncademi.org URL yet, but the field is
  // required non-empty by published-validate.ts.
  if (!record.ncademi_product_url && typeof record.slug === "string" && record.slug) {
    record.ncademi_product_url = `https://ncademi.org/provide/directory/products/${record.slug}/`;
  }
  if (record.vendor_directory_url === undefined) {
    record.vendor_directory_url = null;
  }
  // Represents "when this record was imported," not a real prior
  // update timestamp from a source -- there is no such timestamp to
  // carry over for a hand-pasted record.
  if (record.last_updated === undefined) {
    record.last_updated = now.toISOString();
  }
  // Deprecated field, still required by the schema.
  if (record.ai_insights === undefined) {
    record.ai_insights = null;
  }
}

/** Lowercase; each run of characters other than a-z/0-9 becomes one hyphen; no leading/trailing hyphens. */
export function normalizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Host (lowercase, leading "www." removed) followed by the path without a
 * trailing "/". Scheme, query and fragment are ignored. Null when raw is not
 * a string or not a URL that new URL() accepts.
 */
export function normalizeUrlForMatch(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Not a parseable URL: by contract there is no match key for it.
    return null;
  }
  const host = url.host.toLowerCase().replace(/^www\./, "");
  const path = url.pathname.replace(/\/+$/, "");
  return host + path;
}

/** Lowercase, with every character other than a-z and 0-9 removed. */
export function nameKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** One numbered item from a paste. Exactly one of record and error is non-null. */
export type PasteEntry = {
  /** 1-based, in paste order, after flattening. */
  index: number;
  record: Record<string, unknown> | null;
  error: string | null;
};

export type ParsePasteResult = { ok: false; error: string } | { ok: true; entries: PasteEntry[] };

type Item = { record: Record<string, unknown> } | { error: string };

const FENCE_LINE = /^```(?:json)?$/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v";
}

/** End index (exclusive) of the line containing position i, not including the "\n". */
function lineEnd(text: string, i: number): number {
  const nl = text.indexOf("\n", i);
  return nl === -1 ? text.length : nl;
}

/** True when the line starting at i (a line start) is only a code fence, ignoring surrounding whitespace. */
function isFenceLineAt(text: string, lineStart: number): boolean {
  return FENCE_LINE.test(text.slice(lineStart, lineEnd(text, lineStart)).trim());
}

/**
 * Scan a JSON value starting at text[start] ("{" or "["). Returns the end
 * index (exclusive) once bracket depth returns to zero, or -1 when the text
 * ends first. Brackets inside strings are ignored; inside a string a
 * backslash escapes the next character.
 */
function findValueEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") {
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{" || ch === "[") {
      depth++;
    } else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Index of the start of the next line (after position i) that starts with
 * "{" or "[" or is a fence line; text.length when there is none.
 */
function findNextValueLine(text: string, i: number): number {
  let pos = lineEnd(text, i);
  while (pos < text.length) {
    const lineStart = pos + 1; // skip the "\n"
    if (lineStart >= text.length) return text.length;
    const first = text[lineStart];
    if (first === "{" || first === "[" || isFenceLineAt(text, lineStart)) return lineStart;
    pos = lineEnd(text, lineStart);
  }
  return text.length;
}

function describeFound(value: unknown): string {
  return value === undefined ? "missing" : JSON.stringify(value);
}

function flatten(value: unknown, out: Item[]): void {
  const pushElement = (el: unknown): void => {
    out.push(isPlainObject(el) ? { record: el } : { error: "not a product record" });
  };

  if (Array.isArray(value)) {
    for (const el of value) pushElement(el);
    return;
  }
  if (isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, "$format")) {
    const format = value.$format;
    const version = value.$version;
    const products = value.products;
    if (format === BATCH_FORMAT && version === BATCH_VERSION && Array.isArray(products)) {
      for (const el of products) pushElement(el);
    } else {
      out.push({
        error:
          `unrecognized batch envelope: $format ${describeFound(format)}, $version ${describeFound(version)}` +
          ` (expected $format "${BATCH_FORMAT}", $version ${BATCH_VERSION}, and a products array)`,
      });
    }
    return;
  }
  pushElement(value);
}

/**
 * Split pasted text into numbered entries. Refuses the whole paste (ok:
 * false) when it is empty, larger than MAX_PASTE_BYTES, holds no records,
 * or holds more than MAX_RECORDS entries.
 */
export function parsePaste(text: string): ParsePasteResult {
  if (text.trim() === "") return { ok: false, error: "Paste is empty." };
  if (new TextEncoder().encode(text).length > MAX_PASTE_BYTES) {
    return { ok: false, error: "Paste is larger than 500 KB." };
  }

  const items: Item[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (isWhitespace(ch)) {
      i++;
      continue;
    }
    // A fence line: only whitespace before i on this line, and the line is only a fence.
    if (ch === "`") {
      const lineStart = text.lastIndexOf("\n", i - 1) + 1;
      if (text.slice(lineStart, i).trim() === "" && isFenceLineAt(text, lineStart)) {
        i = lineEnd(text, i);
        continue;
      }
    }
    if (ch === "{" || ch === "[") {
      const end = findValueEnd(text, i);
      if (end === -1) {
        items.push({ error: "incomplete JSON (missing a closing bracket)" });
        break;
      }
      let parsed: unknown;
      let parseError: string | null = null;
      try {
        parsed = JSON.parse(text.slice(i, end));
      } catch (err) {
        parseError = `not valid JSON: ${err instanceof Error ? err.message : String(err)}`;
      }
      if (parseError !== null) {
        items.push({ error: parseError });
      } else {
        flatten(parsed, items);
      }
      i = end;
      continue;
    }
    items.push({ error: "text that is not JSON" });
    i = findNextValueLine(text, i);
  }

  const n = items.length;
  if (n === 0) return { ok: false, error: "Paste contains no records." };
  if (n > MAX_RECORDS) {
    return { ok: false, error: `Paste contains ${n} records; the limit is ${MAX_RECORDS}.` };
  }

  const entries: PasteEntry[] = items.map((item, k) =>
    "record" in item
      ? { index: k + 1, record: item.record, error: null }
      : { index: k + 1, record: null, error: item.error },
  );
  return { ok: true, entries };
}
