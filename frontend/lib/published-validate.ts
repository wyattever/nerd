// frontend/lib/published-validate.ts
/**
 * Structural validation for published-tables.json records.
 *
 * Hand-written rather than Zod/Ajv on purpose:
 *   - Ajv JIT-compiles schemas with the Function constructor, which needs
 *     script-src 'unsafe-eval' in any CSP. Not acceptable here.
 *   - Zod v4 is ~5 KB gzipped for a 13-field schema whose rules fit in this
 *     file. The frontend currently ships six runtime dependencies total.
 *
 * The cost of hand-rolling is that these guards can drift from the interfaces
 * in published-tables.ts. The AssertNever aliases below are the mitigation:
 * they are compile-time-only and fail `tsc` if a field is added to or removed
 * from PublishedProductRecord without being handled here.
 *
 * Ground truth as of the 2026-08-21 snapshot (verified against the real file,
 * all 60 records): every record carries all 13 core keys, no extras, no
 * nulls in any array field, no duplicate slugs, and support_contacts.type is
 * only ever "email" (44) or "url" (41). No record deviates from the
 * interface. These rules therefore describe the file as it actually is, not
 * as it might be. The four tracking_* fields added later are genuinely
 * optional and not part of that ground truth -- no record has them yet.
 */

import type {
  PublishedAcrReport,
  PublishedProductRecord,
  PublishedResourceLink,
  PublishedSupportContact,
} from "@/lib/published-tables";

export type Severity = "error" | "warning";

export interface ValidationIssue {
  /** Dotted/bracketed path, e.g. `support_contacts[0].type`. */
  path: string;
  message: string;
  severity: Severity;
}

/** Mirrors published-tables.ts. Kept module-private; exported guards are the API. */
const VALID_SUPPORT_TYPES = new Set<string>(["email", "url"]);

const REQUIRED_STRING_FIELDS = ["slug", "product_name", "ncademi_product_url"] as const;
const NULLABLE_STRING_FIELDS = [
  "vendor_name",
  "vendor_directory_url",
  "product_website_url",
  "product_description",
  "last_updated",
  "ai_insights",
] as const;
const ARRAY_FIELDS = [
  "vendor_resources",
  "other_resources",
  "support_contacts",
  "acr_reports",
] as const;

/**
 * Editor-only workflow metadata (see PublishedProductRecord's own comment
 * in published-tables.ts). Unlike NULLABLE_STRING_FIELDS, these may be
 * MISSING entirely -- no existing record has them yet -- so they get their
 * own category: valid as a string or null when present, never an error
 * when absent.
 */
const OPTIONAL_STRING_FIELDS = [
  "tracking_priority",
  "tracking_status",
  "tracking_gatherer",
  "tracking_reviewer",
] as const;

/**
 * Compile-time drift guard, with no runtime cost.
 *
 * AssertNever<T> only accepts `never`. So if a field is added to
 * PublishedProductRecord and not added to one of the four lists above,
 * Exclude<> is non-empty, the constraint is violated, and `tsc --noEmit`
 * fails the build. The reverse alias catches a field removed from the
 * interface but left behind here.
 *
 * Verified by adding a field to the interface and confirming tsc errors.
 */
type CoveredField =
  | (typeof REQUIRED_STRING_FIELDS)[number]
  | (typeof NULLABLE_STRING_FIELDS)[number]
  | (typeof ARRAY_FIELDS)[number]
  | (typeof OPTIONAL_STRING_FIELDS)[number];

type AssertNever<T extends never> = T;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _NoUncoveredFields = AssertNever<Exclude<keyof PublishedProductRecord, CoveredField>>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _NoStaleFields = AssertNever<Exclude<CoveredField, keyof PublishedProductRecord>>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isNullableString(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

// --- Nested shapes ---------------------------------------------------------

export function isPublishedResourceLink(v: unknown): v is PublishedResourceLink {
  return isPlainObject(v) && typeof v.text === "string" && typeof v.url === "string";
}

export function isPublishedSupportContact(v: unknown): v is PublishedSupportContact {
  if (!isPlainObject(v)) return false;
  if (typeof v.value !== "string") return false;
  if (typeof v.type !== "string" || !VALID_SUPPORT_TYPES.has(v.type)) return false;
  if (v.label !== undefined && !isNullableString(v.label)) return false;
  return true;
}

export function isPublishedAcrReport(v: unknown): v is PublishedAcrReport {
  if (!isPlainObject(v)) return false;
  if (typeof v.title !== "string") return false;
  for (const f of ["url", "version", "date", "auditor_name", "auditor_url"]) {
    if (!isNullableString(v[f])) return false;
  }
  return true;
}

// --- Record-level validation ----------------------------------------------

function validateResourceArray(
  arr: unknown[],
  field: string,
  issues: ValidationIssue[]
): void {
  arr.forEach((item, i) => {
    if (isPublishedResourceLink(item)) {
      if (!isNonEmptyString(item.text)) {
        issues.push({
          path: `${field}[${i}].text`,
          message: "Link text is empty; the listing would render a blank link.",
          severity: "warning",
        });
      }
      if (!isNonEmptyString(item.url)) {
        issues.push({
          path: `${field}[${i}].url`,
          message: "URL is empty.",
          severity: "error",
        });
      }
      return;
    }
    issues.push({
      path: `${field}[${i}]`,
      message: 'Must be an object with string "text" and string "url".',
      severity: "error",
    });
  });
}

/**
 * Validates one record against PublishedProductRecord.
 *
 * `error` blocks saving. `warning` does not -- it flags data that will render
 * but is probably wrong, so the reviewer can decide.
 */
export function validateProductRecord(candidate: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!isPlainObject(candidate)) {
    return [
      {
        path: "(root)",
        message: Array.isArray(candidate)
          ? "This is an array. A single product record must be a JSON object."
          : "A product record must be a JSON object.",
        severity: "error",
      },
    ];
  }

  for (const f of REQUIRED_STRING_FIELDS) {
    if (!isNonEmptyString(candidate[f])) {
      issues.push({
        path: f,
        message:
          candidate[f] === undefined
            ? `Required field "${f}" is missing.`
            : `"${f}" must be a non-empty string.`,
        severity: "error",
      });
    }
  }

  for (const f of NULLABLE_STRING_FIELDS) {
    if (!(f in candidate)) {
      issues.push({
        path: f,
        message: `Field "${f}" is missing. Use null rather than omitting it.`,
        severity: "error",
      });
    } else if (!isNullableString(candidate[f])) {
      issues.push({
        path: f,
        message: `"${f}" must be a string or null.`,
        severity: "error",
      });
    }
  }

  for (const f of ARRAY_FIELDS) {
    if (!Array.isArray(candidate[f])) {
      issues.push({
        path: f,
        message:
          candidate[f] === null
            ? `"${f}" is null. Use [] for an empty list -- null will crash the listing generators.`
            : `"${f}" must be an array.`,
        severity: "error",
      });
    }
  }

  // Genuinely optional -- unlike NULLABLE_STRING_FIELDS, absence is never an
  // error. Only checked when the key is actually present.
  for (const f of OPTIONAL_STRING_FIELDS) {
    if (f in candidate && !isNullableString(candidate[f])) {
      issues.push({
        path: f,
        message: `"${f}" must be a string or null.`,
        severity: "error",
      });
    }
  }

  const extras = Object.keys(candidate).filter(
    (k) =>
      !(REQUIRED_STRING_FIELDS as readonly string[]).includes(k) &&
      !(NULLABLE_STRING_FIELDS as readonly string[]).includes(k) &&
      !(ARRAY_FIELDS as readonly string[]).includes(k) &&
      !(OPTIONAL_STRING_FIELDS as readonly string[]).includes(k)
  );
  for (const k of extras) {
    issues.push({
      path: k,
      message: `Unrecognized field "${k}". It will be preserved on export but nothing reads it.`,
      severity: "warning",
    });
  }

  if (Array.isArray(candidate.vendor_resources)) {
    validateResourceArray(candidate.vendor_resources, "vendor_resources", issues);
  }
  if (Array.isArray(candidate.other_resources)) {
    validateResourceArray(candidate.other_resources, "other_resources", issues);
  }

  if (Array.isArray(candidate.support_contacts)) {
    candidate.support_contacts.forEach((c: unknown, i: number) => {
      if (isPublishedSupportContact(c)) return;
      const t = isPlainObject(c) ? c.type : undefined;
      if (typeof t === "string" && !VALID_SUPPORT_TYPES.has(t)) {
        // This is the important one. published-tables.ts's
        // sanitizeSupportContacts drops these SILENTLY at render time --
        // console.warn only. Surfacing it here is the whole point of the
        // editor: the reviewer sees it instead of losing a contact.
        issues.push({
          path: `support_contacts[${i}].type`,
          message: `Type ${JSON.stringify(t)} is not "email" or "url". This contact will be dropped silently when the listing renders.`,
          severity: "error",
        });
        return;
      }
      issues.push({
        path: `support_contacts[${i}]`,
        message:
          'Must be an object with "type" of "email" or "url", a string "value", and an optional string-or-null "label".',
        severity: "error",
      });
    });
  }

  if (Array.isArray(candidate.acr_reports)) {
    candidate.acr_reports.forEach((a: unknown, i: number) => {
      if (!isPublishedAcrReport(a)) {
        issues.push({
          path: `acr_reports[${i}]`,
          message:
            'Must be an object with a string "title" and string-or-null "url", "version", "date", "auditor_name", "auditor_url".',
          severity: "error",
        });
        return;
      }
      if (!isNonEmptyString(a.title)) {
        issues.push({
          path: `acr_reports[${i}].title`,
          message: "ACR title is empty.",
          severity: "error",
        });
      }
      // WordPress prefixes password-protected post titles with "Protected: ".
      // Two records in the 2026-08-21 snapshot carry it (book-creator,
      // wayground); it is a scrape artifact, not part of the title.
      if (a.title.startsWith("Protected: ")) {
        issues.push({
          path: `acr_reports[${i}].title`,
          message:
            'Title starts with "Protected: " -- a WordPress password-protection artifact from the scrape, not part of the real title.',
          severity: "warning",
        });
      }
    });
  }

  return issues;
}

/**
 * Cross-record checks that a single record cannot see. Run before export.
 * `slugs` is every slug in the draft, in order.
 */
export function validateSlugIntegrity(
  editedSlug: string,
  originalSlug: string,
  allSlugs: readonly string[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (editedSlug === originalSlug) return issues;

  issues.push({
    path: "slug",
    message: `Slug changed from "${originalSlug}" to "${editedSlug}". getPublishedProduct() and the Viewer's data-source toggle both key on this.`,
    severity: "warning",
  });
  if (allSlugs.filter((s) => s === editedSlug).length > 1) {
    issues.push({
      path: "slug",
      message: `"${editedSlug}" is already used by another record. Slugs build a Map, so one record would silently shadow the other.`,
      severity: "error",
    });
  }
  return issues;
}

export function hasBlockingError(issues: readonly ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

/**
 * Summary line for a live region. Deliberately terse -- the per-issue detail
 * is rendered as a list the user can read at their own pace, and repeating it
 * all in the alert would make a screen reader read every message twice.
 */
export function summarizeIssues(issues: readonly ValidationIssue[]): string {
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  if (errors === 0 && warnings === 0) return "No problems found.";
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
  return `${parts.join(" and ")} found.`;
}

/** Narrowing helper for code that has already validated. */
export function isPublishedProductRecord(v: unknown): v is PublishedProductRecord {
  return !hasBlockingError(validateProductRecord(v));
}
