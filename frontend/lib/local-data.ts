// frontend/lib/local-data.ts
/**
 * Server-only readers for candidate/added/published.json, used by the
 * routed editor/records leaves' Server Components (frontend/app/editor/
 * (routed)/*, frontend/app/records/(routed)/*) instead of a client
 * fetch('/api/local/...') round trip -- see docs/
 * UI_ROUTING_MIGRATION_IMPLEMENTATION_GUIDE_v2.md Gate 2 / Phase 2.
 *
 * Deliberately reuses readPublishedRaw() from local-write.ts rather than
 * re-implementing fs.readFile/path resolution here: that function is
 * already the "one code path that touches disk" for these three files
 * (Route Handlers use it too), so a second, independent path-construction
 * routine would be exactly the kind of duplicated boundary condition
 * isLocalOnlyAllowed() was extracted to avoid one level up.
 *
 * The `notFound()` call below is what actually enforces DECISION_LOG #6 for
 * this read path -- see local-only.ts's header and local-data.ts's Route
 * Handler counterpart (assertLocalOnly() in local-write.ts) for why this
 * can't just reuse that Response-returning function directly: a Server
 * Component has no Response to return.
 */

import "server-only";
import { notFound } from "next/navigation";
import { isLocalOnlyAllowed } from "./local-only";
import { readPublishedRaw, type DataKind } from "./local-write";
import type { PublishedProductRecord } from "./published-tables";

export interface SnapshotMeta {
  purpose: string;
  source_listing_url: string;
  snapshot_taken_at: string;
  total_products: number;
  generated_from: string;
}

export interface LocalDocument {
  products: PublishedProductRecord[];
  schemaVersion: number | null;
  meta: SnapshotMeta | null;
  etag: string;
}

async function readLocalDocument(kind: DataKind): Promise<LocalDocument> {
  if (!isLocalOnlyAllowed()) notFound();

  const { data, etag } = await readPublishedRaw(kind);
  const body = JSON.parse(data) as {
    $schema_version?: unknown;
    $meta?: unknown;
    products?: unknown;
  };

  return {
    products: Array.isArray(body.products) ? (body.products as PublishedProductRecord[]) : [],
    schemaVersion: typeof body.$schema_version === "number" ? body.$schema_version : null,
    meta: body.$meta ? (body.$meta as SnapshotMeta) : null,
    etag,
  };
}

export function getCandidates(): Promise<LocalDocument> {
  return readLocalDocument("candidate");
}

export function getAddedProducts(): Promise<LocalDocument> {
  return readLocalDocument("added");
}

export function getPublishedProducts(): Promise<LocalDocument> {
  return readLocalDocument("published");
}
