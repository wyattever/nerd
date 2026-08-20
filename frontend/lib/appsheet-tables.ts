/**
 * AppSheet recovery tables — read-only reference data for /tables.
 *
 * Source: seven hand-built, WCAG-reviewed HTML fragments recovered from
 * AppSheet (DOM export + CSV), originally authored as standalone pages under
 * frontend/app/tables/*.html. Extracted and id-normalized at build time into
 * appsheet-tables.json (see the extraction script noted in that file's
 * $meta) rather than regenerated from the raw JSON exports in
 * appsheet_export/ — the HTML already carries manual accessibility work
 * (formatted dates, Yes/No booleans, truncation flags with title attributes)
 * that a fresh render from raw data would risk losing or diverging from.
 *
 * Each entry's `html` is trusted, first-party, build-time content — not user
 * input — so rendering it via dangerouslySetInnerHTML carries no injection
 * risk, the same trust model as researcher-records.json.
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
