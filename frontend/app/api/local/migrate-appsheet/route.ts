// frontend/app/api/local/migrate-appsheet/route.ts
/**
 * One-off migration: bootstraps added-tables.json and candidate-tables.json
 * from the legacy AppSheet global table, so the /editor visual editor's
 * "added" and "candidate" tabs have real records instead of staying
 * permanently empty (see EditorSidebar.tsx / EditorPage's file headers).
 *
 * Local-only (assertLocalOnly()), POST only -- this route has a write side
 * effect, so GET would violate HTTP semantics. Unlike the /api/local/added
 * and /api/local/candidate save routes, there is no If-Match/ETag check
 * here: this is a bootstrap/overwrite operation run deliberately by a
 * developer, not the concurrent-edit path those routes guard.
 *
 * Field mapping, and what could NOT be carried over faithfully:
 *   - product_name, vendor_name, vendor_directory_url, product_description,
 *     product_website_url, last_updated all come directly from
 *     getAddedProductHeader/getCandidateProductHeader (already structured
 *     data, not raw HTML -- see lib/appsheet-tables.ts's ProductHeaderData).
 *     Empty strings from the legacy source map to null, matching this
 *     schema's nullable-string convention elsewhere.
 *   - slug comes from getAddedProducts/getCandidateProducts, which already
 *     guarantees a non-empty slug (falls back to a slugified product name
 *     when the AppSheet row has no ncademi.org URL to derive one from).
 *     This route re-slugifies defensively if a slug is ever empty, but
 *     that path should be unreachable given the legacy guarantee.
 *   - ncademi_product_url is REQUIRED non-empty by PublishedProductRecord /
 *     published-validate.ts, but candidates and added-but-not-yet-published
 *     products don't have a real live ncademi.org URL by definition, and
 *     no exported legacy function returns the raw AppSheet "ncademiurl"
 *     cell (only its already-consumed slug derivation is exported). Rather
 *     than leave this field empty -- which would fail validation on every
 *     migrated record and block every future save through
 *     /api/local/added or /api/local/candidate -- this route constructs a
 *     placeholder using the same URL shape used elsewhere in this codebase
 *     (https://ncademi.org/provide/directory/products/{slug}/). This is a
 *     PLACEHOLDER, not a verified live URL; flagged here and in the
 *     response summary rather than asserted as fact.
 *   - vendor_resources, other_resources, support_contacts, and acr_reports
 *     are initialized empty per the dispatch instructions. Note for a
 *     follow-up: lib/appsheet-tables.ts also exports
 *     getVendorResourcesForProduct/getOtherResourcesForProduct/
 *     getSupportContactsForProduct/getAcrReportsForProduct, which return
 *     already-structured (non-HTML) data keyed by product name and could
 *     populate these arrays in a later pass -- they were not wired in here
 *     because this dispatch's instructions specified empty arrays.
 *   - ai_insights has no legacy equivalent and is always null.
 *
 * Node runtime is the default for App Router route handlers, but it is
 * declared explicitly here: fs is unavailable on Edge, and this guards
 * against an accidental edge opt-in or a future default change.
 */

import { createHash } from "node:crypto";
import {
  getAddedProductHeader,
  getAddedProducts,
  getCandidateProductHeader,
  getCandidateProducts,
} from "@/lib/appsheet-tables";
import { assertLocalOnly, writePublishedAtomic } from "@/lib/local-write";
import { hasBlockingError, validateProductRecord } from "@/lib/published-validate";
import type { PublishedProductRecord } from "@/lib/published-tables";

export const runtime = "nodejs";

const SCHEMA_VERSION = 1;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toNullable(value: string): string | null {
  return value.trim() === "" ? null : value;
}

/** Placeholder only -- see the PLACEHOLDER note in the file header comment. */
function placeholderNcademiUrl(slug: string): string {
  return `https://ncademi.org/provide/directory/products/${slug}/`;
}

interface MigrationResult {
  written: number;
  skippedInvalid: number;
  missingHeader: number;
  etag: string;
}

function buildRecord(
  ref: { name: string; slug: string },
  header: ReturnType<typeof getAddedProductHeader>
): PublishedProductRecord {
  const slug = ref.slug.trim() === "" ? slugify(ref.name) : ref.slug;
  return {
    slug,
    product_name: header?.product_name || ref.name,
    ncademi_product_url: placeholderNcademiUrl(slug),
    vendor_name: header ? toNullable(header.vendor_name) : null,
    vendor_directory_url: header ? toNullable(header.vendor_directory_url) : null,
    product_website_url: header ? toNullable(header.product_website_url) : null,
    product_description: header ? toNullable(header.product_description) : null,
    vendor_resources: [],
    other_resources: [],
    support_contacts: [],
    acr_reports: [],
    last_updated: header ? toNullable(header.last_updated) : null,
    ai_insights: null,
  };
}

async function migrate(
  kind: "added" | "candidate",
  refs: { name: string; slug: string }[],
  getHeader: (slug: string) => ReturnType<typeof getAddedProductHeader>,
  purpose: string
): Promise<MigrationResult> {
  let missingHeader = 0;
  let skippedInvalid = 0;
  const products: PublishedProductRecord[] = [];

  for (const ref of refs) {
    const header = getHeader(ref.slug);
    if (!header) missingHeader += 1;

    const record = buildRecord(ref, header);
    if (hasBlockingError(validateProductRecord(record))) {
      skippedInvalid += 1;
      continue;
    }
    products.push(record);
  }

  const file = {
    $schema_version: SCHEMA_VERSION,
    $meta: {
      purpose,
      source_listing_url: "n/a (migrated from the AppSheet global table, not a single live listing page)",
      snapshot_taken_at: new Date().toISOString(),
      total_products: products.length,
      generated_from: "POST /api/local/migrate-appsheet (one-off AppSheet migration)",
    },
    products,
  };

  const bytes = `${JSON.stringify(file, null, 2)}\n`;
  await writePublishedAtomic(kind, bytes);

  const etag = createHash("sha256").update(bytes).digest("hex");
  return { written: products.length, skippedInvalid, missingHeader, etag };
}

export async function POST(): Promise<Response> {
  const blocked = assertLocalOnly();
  if (blocked) return blocked;

  const added = await migrate(
    "added",
    getAddedProducts(),
    getAddedProductHeader,
    "One-off migration snapshot of AppSheet 'Added to Site' products, for the /editor visual editor's Added tab."
  );

  const candidate = await migrate(
    "candidate",
    getCandidateProducts(),
    getCandidateProductHeader,
    "One-off migration snapshot of AppSheet 'Candidate' products, for the /editor visual editor's Candidate tab."
  );

  return jsonResponse(
    {
      ok: true,
      note: "ncademi_product_url on every migrated record is a constructed placeholder, not a verified live URL -- see this route's file header comment.",
      added,
      candidate,
    },
    200
  );
}
