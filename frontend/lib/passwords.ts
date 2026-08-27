// frontend/lib/passwords.ts
/**
 * Temporary vendor-review passwords for Added product pages -- see
 * lib/passwords.json's own $meta for the full rationale. Deliberately kept
 * separate from local-write.ts's DataKind system: this file is not one of
 * the four main documents (published/added/candidate/vendors) that system
 * guards with ETag concurrency, and doesn't need that guarantee -- a
 * password, once assigned, is never edited, only ever read or created, so
 * a plain read-modify-write (see app/api/local/passwords/route.ts) is
 * enough for a local, single-operator tool.
 *
 * Generation pattern (exact spec): the first four letters of the product
 * name, spaces stripped and lowercased, immediately followed by the
 * two-digit current year (no separator), e.g. "MLC Number Chart" ->
 * "mlcn26". A second product colliding on that same base (e.g. "MLC
 * Number Pieces" -> also "mlcn") gets a numeric suffix starting at 1
 * ("mlcn26-1"), incrementing past any suffix that's already taken too --
 * the FIRST record to claim a base keeps it unsuffixed forever; later
 * collisions never renumber it.
 */

export interface PasswordRecord {
  product_name: string;
  vendor_name: string | null;
  password: string;
  timestamp: string;
}

/** First four letters of `productName` with spaces stripped and
 *  lowercased, e.g. "MLC Number Chart" -> "mlcn". Non-space characters
 *  only are counted toward the four -- punctuation/digits in a product
 *  name still consume a slot, matching "first four letters" read as
 *  "first four characters of the space-stripped name" rather than
 *  filtering to strictly alphabetic characters, since the spec's own
 *  example product names are plain words with no such characters to
 *  disambiguate against. */
function baseSlug(productName: string): string {
  return productName.replace(/\s+/g, "").toLowerCase().slice(0, 4);
}

function twoDigitYear(now: Date): string {
  return String(now.getFullYear() % 100).padStart(2, "0");
}

/** Finds the next unused password for `base` (e.g. "mlcn26") against
 *  `existingPasswords` -- `base` itself if free, else `${base}-1`,
 *  `${base}-2`, ... incrementing past whatever's already taken. */
function nextAvailablePassword(base: string, existingPasswords: Set<string>): string {
  if (!existingPasswords.has(base)) return base;
  let suffix = 1;
  while (existingPasswords.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

/**
 * Returns the password for `productName`, creating and appending one to
 * `records` if none exists yet. Matched by exact `product_name` string --
 * the same field/matching convention the rest of this app uses for
 * cross-referencing a product to its global vendor entry (see
 * CandidateEditor.tsx's VENDORS_REGISTRY lookup). Pure function: callers
 * (the API route) own persisting `records` back to disk when `created` is
 * true.
 */
export function getOrCreatePassword(
  records: PasswordRecord[],
  productName: string,
  vendorName: string | null,
  now: Date = new Date()
): { records: PasswordRecord[]; record: PasswordRecord; created: boolean } {
  const existing = records.find((r) => r.product_name === productName);
  if (existing) {
    return { records, record: existing, created: false };
  }

  const base = `${baseSlug(productName)}${twoDigitYear(now)}`;
  const existingPasswords = new Set(records.map((r) => r.password));
  const password = nextAvailablePassword(base, existingPasswords);

  const record: PasswordRecord = {
    product_name: productName,
    vendor_name: vendorName,
    password,
    timestamp: now.toISOString(),
  };

  return { records: [...records, record], record, created: true };
}
