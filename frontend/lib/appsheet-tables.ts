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

/**
 * Parses the "global" AppSheet table's HTML and returns every product whose
 * Status column exactly matches `status`, as { name, slug } pairs. `slug`
 * is the real NCADEMI product-URL slug when the row has one
 * (nerd-col-aprod-ncademiurl), otherwise a slugified fallback derived from
 * the product name.
 */
export function getProductsByStatus(status: string): { name: string; slug: string }[] {
  const globalTable = getTable("global");
  if (!globalTable) return [];

  const bodyMatch = globalTable.html.match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!bodyMatch) return [];

  const rows = bodyMatch[1].match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
  const results: { name: string; slug: string }[] = [];

  for (const row of rows) {
    const nameMatch = row.match(/<td class="nerd-col-aprod-name">([^<]*)<\/td>/);
    const statusMatch = row.match(/<td class="nerd-col-aprod-status">([^<]*)<\/td>/);
    if (!nameMatch || !statusMatch) continue;

    const rowStatus = decodeEntities(statusMatch[1]).trim();
    if (rowStatus !== status) continue;

    const name = decodeEntities(nameMatch[1]).trim();
    if (!name) continue;

    const urlMatch = row.match(
      /<td class="nerd-col-aprod-ncademiurl"><a href="([^"]*)"/
    );
    const slug =
      (urlMatch ? slugFromNcademiUrl(urlMatch[1]) : null) ?? slugify(name);

    results.push({ name, slug });
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

/* ------------------------------------------------------------------------
 * Generic sortable-row parsing for the /tables page.
 * ---------------------------------------------------------------------- */

export interface AppsheetColumnDef {
  key: string;
  label: string;
  sortable: boolean;
  /**
   * The original AppSheet-recovery CSS class for this column (e.g.
   * "nerd-col-aprod-desc"). Applied to both <th> and <td> so the existing
   * width/wrapping rules in nerd-table.css (keyed off these class names)
   * still apply now that cells are rendered by AppsheetSortableTable
   * instead of dumped as raw HTML.
   */
  className: string;
}

export interface AppsheetCell {
  text: string;
  href?: string;
}

export type AppsheetRow = Record<string, AppsheetCell>;

/** Labels that must never be marked sortable, per product decision. */
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

/**
 * Column definitions per table slug, in display order, matching the class
 * suffix used in appsheet-tables.json's HTML (e.g. "name" for
 * "nerd-col-aprod-name"). sortable is derived from UNSORTABLE_LABELS.
 */
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

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).trim();
}

function extractCell(rowHtml: string, className: string): AppsheetCell {
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

/**
 * Parses a table's HTML into structured, sortable rows using the column
 * definitions above. Returns [] for unrecognized slugs or malformed HTML
 * rather than throwing -- this is display data, not critical-path data.
 */
export function getTableRows(slug: string): AppsheetRow[] {
  const def = TABLE_COLUMN_DEFS[slug];
  const table = getTable(slug);
  if (!def || !table) return [];

  const bodyMatch = table.html.match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!bodyMatch) return [];

  const rowHtmls = bodyMatch[1].match(/<tr>[\s\S]*?<\/tr>/g) ?? [];

  return rowHtmls.map((rowHtml) => {
    const row: AppsheetRow = {};
    for (const col of def.columns) {
      row[col.key] = extractCell(rowHtml, `${def.prefix}${col.key}`);
    }
    return row;
  });
}