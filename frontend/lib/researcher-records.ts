/**
 * Researcher records — types and accessors.
 *
 * Data lives in researcher-records.json alongside this file. That file is
 * build-time data: it is bundled into the client and CANNOT be written back
 * to at runtime. It satisfies "populate the table" today, and serves as the
 * seed for a datastore when editing and row creation are wired up.
 *
 * The shape below is the contract both sides agree on. Keeping it here means
 * the table, the future edit form, and the future API client all validate
 * against one definition rather than three drifting copies.
 */

import data from "./researcher-records.json";

export const PRIORITIES = ["High", "Medium", "Low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const STATUSES = [
  "Published",
  "Added to Site",
  "Needs Review",
  "Discussion",
] as const;
export type Status = (typeof STATUSES)[number];

export const PLATFORMS = [
  "Web Application",
  "Mobile Application",
  "Web Content",
  "Browser Extension",
  "Desktop Application",
] as const;
export type Platform = (typeof PLATFORMS)[number];

/**
 * One row of the Researcher table.
 *
 * Every field except `id` and `product_name` is nullable, because a row can
 * be created from a product name alone and filled in over time. `platforms`
 * is never null — an empty array means "none selected", which is a different
 * statement from "not yet known".
 */
export interface ResearcherRecord {
  /** Stable primary key. Unique, required, never derived from array position. */
  id: string;
  /** Provenance only. Null for records created after the AppSheet export. */
  appsheet_row_id: string | null;

  product_name: string;
  /** Vendor NAME, not an opaque id. "NULL" and "CANDIDATE" are sentinels. */
  vendor_id: string | null;
  product_website: string | null;
  product_description: string | null;
  priority: Priority | null;
  platforms: Platform[];
  notes: string | null;
  status: Status | null;
  /** ISO 8601. Null when the source had no value. */
  last_updated: string | null;
  /** Original source string, preserved for audit. */
  last_updated_raw: string | null;
  ncademi_product_url: string | null;
  gatherer: string | null;
  reviewer: string | null;

  /** Provenance metadata. Not user-editable; drop before writing to a backend. */
  _source?: "appsheet_html" | "csv_export";
  _platforms_confidence?: "high" | "low";
  _platforms_may_be_incomplete?: boolean;
}

interface ResearcherRecordsFile {
  $schema_version: string;
  $meta: Record<string, unknown>;
  records: ResearcherRecord[];
}

const file = data as unknown as ResearcherRecordsFile;

/** All seeded records, in source order. */
export const RESEARCHER_RECORDS: ResearcherRecord[] = file.records;

/** Provenance and gap documentation. Useful for an "about this data" panel. */
export const RESEARCHER_META = file.$meta;

/** Look up a single record by its stable id. */
export function getRecord(id: string): ResearcherRecord | undefined {
  return RESEARCHER_RECORDS.find((r) => r.id === id);
}

/**
 * Build an empty record for a new row.
 *
 * The `local-` prefix marks an id minted client-side, distinguishing it from
 * an AppSheet row id. A backend should replace it on first save.
 */
export function newRecord(productName: string): ResearcherRecord {
  const slug = productName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return {
    id: `local-${slug}-${Date.now()}`,
    appsheet_row_id: null,
    product_name: productName,
    vendor_id: null,
    product_website: null,
    product_description: null,
    priority: null,
    platforms: [],
    notes: null,
    status: null,
    last_updated: null,
    last_updated_raw: null,
    ncademi_product_url: null,
    gatherer: null,
    reviewer: null,
  };
}

/** Strip provenance metadata before sending a record to an API. */
export function toPayload(record: ResearcherRecord) {
  const {
    _source,
    _platforms_confidence,
    _platforms_may_be_incomplete,
    last_updated_raw,
    ...payload
  } = record;
  return payload;
}
