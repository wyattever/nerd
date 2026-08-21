// frontend/lib/appsheet-tables.ts
/**
 * AppSheet recovery tables — read-only reference data for /tables.
 *
 * Source: seven hand-built, WCAG-reviewed HTML fragments recovered from
 * AppSheet (DOM export + CSV), originally authored as standalone pages under
 * frontend/app/tables/*.html. Extracted and id-normalized at build time into
 * appsheet-tables.json rather than regenerated from the raw JSON exports in
 * appsheet_export/ — the HTML already carries manual accessibility work
 * (formatted dates, Yes/No booleans, truncation flags with title attributes)
 * that a fresh render from raw data would risk losing or diverging from.
 *
 * Each entry's `html` is trusted, first-party, build-time content — not user
 * input — so parsing/rendering it carries no injection risk, the same trust
 * model as researcher-records.json.
 */

import data from "./appsheet-tables.json";

export interface AppsheetTableEntry {
  slug: string;
  title: string;
  subtitle: string;
  row_count: number;
  column_count: number | null;
  status_id: string;
  table_id: string;
  html: string;
}

interface AppsheetTablesFile {
  $schema_version: string;
  $meta: Record<string, unknown>;
  tables: AppsheetTableEntry[];
}

const file = data as unknown as AppsheetTablesFile;

/** All seven tables, in display/nav order. */
export const APPSHEET_TABLES: AppsheetTableEntry[] = file.tables;

/** The table shown when no ?table= is specified. */
export const DEFAULT_TABLE_SLUG = "global";

/** Look up a single table by slug. */
export function getTable(slug: string | undefined): AppsheetTableEntry | undefined {
  if (!slug) return getTable(DEFAULT_TABLE_SLUG);
  return APPSHEET_TABLES.find((t) => t.slug === slug);
}

/**
 * Decode the small set of HTML entities that appear in the recovered
 * AppSheet data (e.g. "Barnes &amp; Noble"). Not a general HTML entity
 * decoder -- scoped to what this trusted, known dataset uses.
 */
function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Lowercase, hyphenated fallback slug when no NCADEMI Product URL is present. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Extracts the trailing slug segment from an NCADEMI product URL, e.g.
 * "https://ncademi.org/provide/directory/products/adobe-express/" -> "adobe-express".
 * Falls back to null if the URL doesn't match the expected shape.
 */
function slugFromNcademiUrl(url: string): string | null {
  const match = url.match(/\/products\/([^/"]+)\/?$/);
  return match ? match[1] : null;
}

const GLOBAL_PREFIX = "nerd-col-aprod-";
const VENDORS_PREFIX = "nerd-col-vend-";

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).trim();
}

function extractCell(rowHtml: string, className: string): { text: string; href?: string } {
  const cellMatch = rowHtml.match(
    new RegExp(`<td class="${className}"[^>]*>([\\s\\S]*?)<\\/td>`)
  );
  if (!cellMatch) return { text: "" };
  const inner = cellMatch[1];
  const hrefMatch = inner.match(/<a href="([^"]*)"/);
  return {
    text: stripTags(inner),
    href: hrefMatch ? hrefMatch[1] : undefined,
  };
}

function getTableRowsHtml(slug: string): string[] {
  const table = getTable(slug);
  if (!table) return [];
  const bodyMatch = table.html.match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!bodyMatch) return [];
  return bodyMatch[1].match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
}

/**
 * Parses the "global" AppSheet table's HTML and returns every product whose
 * Status column exactly matches `status`, as { name, slug } pairs. `slug`
 * is the real NCADEMI product-URL slug when the row has one
 * (nerd-col-aprod-ncademiurl), otherwise a slugified fallback derived from
 * the product name.
 */
export function getProductsByStatus(status: string): { name: string; slug: string }[] {
  const results: { name: string; slug: string }[] = [];

  for (const row of getTableRowsHtml("global")) {
    const nameCell = extractCell(row, `${GLOBAL_PREFIX}name`);
    const statusCell = extractCell(row, `${GLOBAL_PREFIX}status`);
    if (!nameCell.text || statusCell.text !== status) continue;

    const ncademiUrl = extractCell(row, `${GLOBAL_PREFIX}ncademiurl`);
    const slug = (ncademiUrl.href ? slugFromNcademiUrl(ncademiUrl.href) : null) ?? slugify(nameCell.text);

    results.push({ name: nameCell.text, slug });
  }

  return results;
}

/** Products with Status exactly "Published" in the AppSheet global table. */
export function getPublishedProducts(): { name: string; slug: string }[] {
  return getProductsByStatus("Published");
}

/** Products with Status exactly "Added to Site" in the AppSheet global table. */
export function getAddedProducts(): { name: string; slug: string }[] {
  return getProductsByStatus("Added to Site");
}

/** Products with Status exactly "Candidate" in the AppSheet global table. */
export function getCandidateProducts(): { name: string; slug: string }[] {
  return getProductsByStatus("Candidate");
}

/* ------------------------------------------------------------------------
 * Generic sortable-row parsing for the /tables page.
 * ---------------------------------------------------------------------- */

export interface AppsheetColumnDef {
  key: string;
  label: string;
  sortable: boolean;
  className: string;
}

export interface AppsheetCell {
  text: string;
  href?: string;
}

export type AppsheetRow = Record<string, AppsheetCell>;

const UNSORTABLE_LABELS = new Set([
  "Product Description",
  "Notes",
  "Platforms",
  "ACR IDs",
  "Resource IDs",
  "Support IDs",
  "Information",
  "Temp: Contact Information",
]);

const TABLE_COLUMN_DEFS: Record<string, { prefix: string; columns: { key: string; label: string }[] }> = {
  global: {
    prefix: "nerd-col-aprod-",
    columns: [
      { key: "row", label: "Row #" },
      { key: "name", label: "Product Name" },
      { key: "vendor", label: "Vendor" },
      { key: "website", label: "Product Website" },
      { key: "desc", label: "Product Description" },
      { key: "priority", label: "Priority" },
      { key: "platforms", label: "Platforms" },
      { key: "notes", label: "Notes" },
      { key: "status", label: "Status" },
      { key: "lastupdated", label: "Last Updated" },
      { key: "ncademiurl", label: "NCADEMI Product URL" },
      { key: "gatherer", label: "Gatherer" },
      { key: "reviewer", label: "Reviewer" },
      { key: "acrids", label: "ACR IDs" },
      { key: "resourceids", label: "Resource IDs" },
      { key: "supportids", label: "Support IDs" },
    ],
  },
  vendors: {
    prefix: "nerd-col-vend-",
    columns: [
      { key: "row", label: "Row #" },
      { key: "name", label: "Vendor Name" },
      { key: "website", label: "Vendor Website" },
      { key: "lastupdated", label: "Last Updated" },
      { key: "added", label: "Added to Site" },
      { key: "notes", label: "Notes" },
      { key: "ncademiurl", label: "NCADEMI Vendor URL" },
    ],
  },
  acrs: {
    prefix: "nerd-col-acr-",
    columns: [
      { key: "row", label: "Row #" },
      { key: "rowid", label: "Row ID" },
      { key: "name", label: "ACR Name" },
      { key: "product", label: "Product" },
      { key: "url", label: "ACR URL" },
      { key: "datepub", label: "Date Published" },
      { key: "version", label: "Version" },
      { key: "preparedby", label: "Prepared By" },
      { key: "completedby", label: "Completed By" },
      { key: "completedbyurl", label: "Completed By URL" },
      { key: "information", label: "Information" },
      { key: "tempcontact", label: "Temp: Contact Information" },
      { key: "lastupdated", label: "ACR Last Updated" },
      { key: "added", label: "Added to Site" },
    ],
  },
  "product-resources": {
    prefix: "nerd-col-pres-",
    columns: [
      { key: "row", label: "Row #" },
      { key: "name", label: "Resource Name" },
      { key: "product", label: "Product" },
      { key: "url", label: "URL" },
      { key: "source", label: "Source" },
      { key: "label", label: "Label" },
      { key: "date", label: "Date" },
      { key: "added", label: "Added to Site" },
      { key: "notes", label: "Notes" },
    ],
  },
  "product-supports": {
    prefix: "nerd-col-psup-",
    columns: [
      { key: "row", label: "Row #" },
      { key: "type", label: "Support Type" },
      { key: "websitename", label: "Website Name" },
      { key: "websiteurl", label: "Website URL" },
      { key: "email", label: "Email" },
      { key: "info", label: "Information" },
      { key: "product", label: "Product" },
      { key: "date", label: "Date" },
      { key: "added", label: "Added to Site" },
    ],
  },
  "vendor-resources": {
    prefix: "nerd-col-vres-",
    columns: [
      { key: "row", label: "Row #" },
      { key: "rowid", label: "Row ID" },
      { key: "name", label: "Resource Name" },
      { key: "vendor", label: "Vendor" },
      { key: "url", label: "URL" },
      { key: "source", label: "Source" },
      { key: "label", label: "Label" },
      { key: "date", label: "Date" },
      { key: "added", label: "Added to Site" },
    ],
  },
  "vendor-supports": {
    prefix: "nerd-col-vsup-",
    columns: [
      { key: "row", label: "Row #" },
      { key: "type", label: "Support Type" },
      { key: "websitename", label: "Website Name" },
      { key: "websiteurl", label: "Website URL" },
      { key: "email", label: "Email" },
      { key: "info", label: "Information" },
      { key: "vendor", label: "Vendor" },
      { key: "date", label: "Date" },
      { key: "checkbox", label: "Unnamed Checkbox" },
      { key: "col9", label: "Column 9 (Unread?)" },
    ],
  },
};

export function getColumnDefs(slug: string): AppsheetColumnDef[] {
  const def = TABLE_COLUMN_DEFS[slug];
  if (!def) return [];
  return def.columns.map((c) => ({
    key: c.key,
    label: c.label,
    sortable: !UNSORTABLE_LABELS.has(c.label),
    className: `${def.prefix}${c.key}`,
  }));
}

export function getTableRows(slug: string): AppsheetRow[] {
  const def = TABLE_COLUMN_DEFS[slug];
  if (!def) return [];

  return getTableRowsHtml(slug).map((rowHtml) => {
    const row: AppsheetRow = {};
    for (const col of def.columns) {
      row[col.key] = extractCell(rowHtml, `${def.prefix}${col.key}`);
    }
    return row;
  });
}

/* ------------------------------------------------------------------------
 * Header data for a single product, by global-table Status (Viewer wiring).
 * ---------------------------------------------------------------------- */

export interface ProductHeaderData {
  product_name: string;
  vendor_name: string;
  vendor_directory_url: string;
  product_description: string;
  product_website_url: string;
  last_updated: string;
}

/**
 * Finds the global-table row matching `status` and `slug` (same slug
 * derivation as getProductsByStatus) and returns the fields genHeaderHtml
 * needs. vendor_name is looked up by exact name match against the
 * "vendors" table; if that vendor row has a Vendor Website value,
 * vendor_directory_url is set to it (making the vendor a link), otherwise
 * it stays empty (vendor renders as plain text).
 */
export function getProductHeaderByStatus(status: string, slug: string): ProductHeaderData | null {
  for (const row of getTableRowsHtml("global")) {
    const statusCell = extractCell(row, `${GLOBAL_PREFIX}status`);
    if (statusCell.text !== status) continue;

    const nameCell = extractCell(row, `${GLOBAL_PREFIX}name`);
    if (!nameCell.text) continue;

    const ncademiUrl = extractCell(row, `${GLOBAL_PREFIX}ncademiurl`);
    const rowSlug = (ncademiUrl.href ? slugFromNcademiUrl(ncademiUrl.href) : null) ?? slugify(nameCell.text);
    if (rowSlug !== slug) continue;

    const vendorCell = extractCell(row, `${GLOBAL_PREFIX}vendor`);
    const descCell = extractCell(row, `${GLOBAL_PREFIX}desc`);
    const websiteCell = extractCell(row, `${GLOBAL_PREFIX}website`);
    // Raw AppSheet timestamp, e.g. "4/7/2026 10:16:32 AM" -- NOT reformatted
    // to match the live page's "March 6, 2026" style. Reformatting wasn't
    // part of this fix; flagging rather than silently inventing a date
    // formatter. genHeaderHtml renders this value as-is.
    const lastUpdatedCell = extractCell(row, `${GLOBAL_PREFIX}lastupdated`);

    let vendorDirectoryUrl = "";
    const vendorName = vendorCell.text;
    if (vendorName) {
      for (const vRow of getTableRowsHtml("vendors")) {
        const vNameCell = extractCell(vRow, `${VENDORS_PREFIX}name`);
        if (vNameCell.text !== vendorName) continue;
        const vWebsiteCell = extractCell(vRow, `${VENDORS_PREFIX}website`);
        if (vWebsiteCell.href) vendorDirectoryUrl = vWebsiteCell.href;
        break;
      }
    }

    return {
      product_name: nameCell.text,
      vendor_name: vendorName,
      vendor_directory_url: vendorDirectoryUrl,
      product_description: descCell.text,
      product_website_url: websiteCell.href ?? "",
      last_updated: lastUpdatedCell.text,
    };
  }

  return null;
}

/** Header data for a "Published" product, looked up by slug. */
export function getPublishedProductHeader(slug: string): ProductHeaderData | null {
  return getProductHeaderByStatus("Published", slug);
}

/** Header data for an "Added to Site" product, looked up by slug. */
export function getAddedProductHeader(slug: string): ProductHeaderData | null {
  return getProductHeaderByStatus("Added to Site", slug);
}

/** Header data for a "Candidate" product, looked up by slug. */
export function getCandidateProductHeader(slug: string): ProductHeaderData | null {
  return getProductHeaderByStatus("Candidate", slug);
}

/* ------------------------------------------------------------------------
 * Vendor / Other Resources for a product (Viewer wiring).
 * ---------------------------------------------------------------------- */

const PRODUCT_RESOURCES_PREFIX = "nerd-col-pres-";

/**
 * Parses the "product-resources" AppSheet table's HTML and returns every
 * resource row where Product exactly matches `productName`, Source exactly
 * matches `source`, and Added to Site is exactly "Yes". Used to build both
 * Vendor Resources ("Internal") and Other Resources ("External") for the
 * Viewer header-only injection paths.
 */
export function getProductResourcesBySource(
  productName: string,
  source: string
): { text: string; url: string }[] {
  const results: { text: string; url: string }[] = [];

  for (const row of getTableRowsHtml("product-resources")) {
    const productCell = extractCell(row, `${PRODUCT_RESOURCES_PREFIX}product`);
    if (productCell.text !== productName) continue;

    const sourceCell = extractCell(row, `${PRODUCT_RESOURCES_PREFIX}source`);
    if (sourceCell.text !== source) continue;

    const addedCell = extractCell(row, `${PRODUCT_RESOURCES_PREFIX}added`);
    if (addedCell.text !== "Yes") continue;

    const nameCell = extractCell(row, `${PRODUCT_RESOURCES_PREFIX}name`);
    const urlCell = extractCell(row, `${PRODUCT_RESOURCES_PREFIX}url`);
    if (!nameCell.text || !urlCell.href) continue;

    results.push({ text: nameCell.text, url: urlCell.href });
  }

  return results;
}

/** Vendor Resources ("Internal" source) for a product, by exact product name. */
export function getVendorResourcesForProduct(productName: string): { text: string; url: string }[] {
  return getProductResourcesBySource(productName, "Internal");
}

/** Other Resources ("External" source) for a product, by exact product name. */
export function getOtherResourcesForProduct(productName: string): { text: string; url: string }[] {
  return getProductResourcesBySource(productName, "External");
}
/* ------------------------------------------------------------------------
 * Support Contacts for a product (Viewer wiring).
 * ---------------------------------------------------------------------- */

const PRODUCT_SUPPORTS_PREFIX = "nerd-col-psup-";

export interface SupportContact {
  type: "email" | "url";
  value: string;
  label?: string;
}

/**
 * Parses the "product-supports" AppSheet table's HTML and returns Support
 * section contacts for `productName`: website items first (Website Name
 * linked to Website URL), then email items (mailto:), across every row
 * where Product matches and Added to Site is exactly "Yes". Matches
 * genSupportHtml's expected shape in ncademiPreview.ts.
 */
export function getSupportContactsForProduct(productName: string): SupportContact[] {
  const websiteContacts: SupportContact[] = [];
  const emailContacts: SupportContact[] = [];

  for (const row of getTableRowsHtml("product-supports")) {
    const productCell = extractCell(row, `${PRODUCT_SUPPORTS_PREFIX}product`);
    if (productCell.text !== productName) continue;

    const addedCell = extractCell(row, `${PRODUCT_SUPPORTS_PREFIX}added`);
    if (addedCell.text !== "Yes") continue;

    const websiteNameCell = extractCell(row, `${PRODUCT_SUPPORTS_PREFIX}websitename`);
    const websiteUrlCell = extractCell(row, `${PRODUCT_SUPPORTS_PREFIX}websiteurl`);
    if (websiteNameCell.text && websiteUrlCell.href) {
      websiteContacts.push({ type: "url", value: websiteUrlCell.href, label: websiteNameCell.text });
    }

    const emailCell = extractCell(row, `${PRODUCT_SUPPORTS_PREFIX}email`);
    if (emailCell.text) {
      emailContacts.push({ type: "email", value: emailCell.text });
    }
  }

  return [...websiteContacts, ...emailContacts];
}


const ACRS_PREFIX = "nerd-col-acr-";

export interface AcrReport {
  title: string;
  url: string | null;
  version: string | null;
  date: string | null;
  auditor_name: string | null;
  auditor_url: string | null;
}

export function getAcrReportsForProduct(productName: string): AcrReport[] {
  const reports: AcrReport[] = [];

  for (const row of getTableRowsHtml("acrs")) {
    const productCell = extractCell(row, `${ACRS_PREFIX}product`);
    if (productCell.text !== productName) continue;

    const addedCell = extractCell(row, `${ACRS_PREFIX}added`);
    if (addedCell.text !== "Yes") continue;

    const nameCell = extractCell(row, `${ACRS_PREFIX}name`);
    const urlCell = extractCell(row, `${ACRS_PREFIX}url`);
    const dateCell = extractCell(row, `${ACRS_PREFIX}datepub`);
    const versionCell = extractCell(row, `${ACRS_PREFIX}version`);
    const completedByCell = extractCell(row, `${ACRS_PREFIX}completedby`);
    const completedByUrlCell = extractCell(row, `${ACRS_PREFIX}completedbyurl`);

    reports.push({
      title: nameCell.text || "Available on Request",
      url: urlCell.href || null,
      version: versionCell.text || null,
      date: dateCell.text || null,
      auditor_name: completedByCell.text || null,
      auditor_url: completedByUrlCell.href || null,
    });
  }

  return reports;
}
