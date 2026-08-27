// frontend/app/api/local/candidate/route.ts
/**
 * Local-only server-side write path for candidate.json.
 *
 * Mirrors app/api/local/published/route.ts exactly, differing only in the
 * DataKind ("candidate") passed to readPublishedRaw/writePublishedAtomic.
 * See that file's header comment and docs/NERD_System_Architecture.md for the
 * full rationale (gating, ETag concurrency, atomic writes, and the
 * tracking.json split/merge).
 *
 * Node runtime is the default for App Router route handlers, but it is
 * declared explicitly here: fs is unavailable on Edge, and this guards
 * against an accidental edge opt-in or a future default change.
 */

import {
  assertLocalOnly,
  readPublishedRaw,
  writePublishedAtomic,
  readTrackingRecords,
  writeTrackingRecords,
} from "@/lib/local-write";
import { splitTracking, mergeTracking } from "@/lib/tracking";
import { hasBlockingError, validateProductRecord } from "@/lib/published-validate";

export const runtime = "nodejs";
// See app/api/local/vendors/route.ts's header comment on `dynamic` --
// without this, GET's fs.readFile-only response (body AND ETag) can be
// frozen at `next build` time under a production build, breaking every save
// that depends on a fresh ETag.
export const dynamic = "force-dynamic";

function jsonResponse(body: unknown, status: number, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

export async function GET(): Promise<Response> {
  const blocked = assertLocalOnly();
  if (blocked) return blocked;

  const { data, etag } = await readPublishedRaw("candidate");
  const parsed = JSON.parse(data) as Record<string, unknown>;
  // tracking_* fields live in tracking.json (see lib/tracking.ts) -- merged
  // back into `products` here so this route's shape is unchanged for callers.
  parsed.products = mergeTracking(
    Array.isArray(parsed.products) ? (parsed.products as Array<Record<string, unknown>>) : [],
    await readTrackingRecords()
  );
  // Echoed into the body as `$etag` too -- see app/api/local/vendors/
  // route.ts's GET for why (a compressing intermediary can strip the ETag
  // header without touching the body; every client-side reader must fall
  // back to this). The ETag still hashes the on-disk bytes, which never
  // contain tracking, so a later If-Match POST never spuriously 412s.
  const body = { ...parsed, $etag: etag };
  return new Response(JSON.stringify(body), {
    status: 200,
    // See app/api/local/vendors/route.ts's GET for why no-store is explicit
    // here rather than left to browser cache heuristics.
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ETag: etag },
  });
}

export async function POST(request: Request): Promise<Response> {
  const blocked = assertLocalOnly();
  if (blocked) return blocked;

  const { etag: currentEtag } = await readPublishedRaw("candidate");
  const ifMatch = request.headers.get("If-Match");
  if (ifMatch !== currentEtag) {
    return jsonResponse(
      {
        error:
          "ETag mismatch. The file on disk has changed since this copy was read -- re-fetch before saving.",
      },
      412
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Request body is not valid JSON." }, 400);
  }

  const products = (body as { products?: unknown } | null)?.products;
  if (!Array.isArray(products)) {
    return jsonResponse({ error: '"products" must be an array.' }, 400);
  }

  // tracking_* is persisted to tracking.json, never this file -- split it
  // out before validating and writing (see lib/tracking.ts).
  const {
    records: strippedProducts,
    tracking,
    scopeNames,
  } = splitTracking(products as Array<Record<string, unknown>>);

  for (const product of strippedProducts) {
    const issues = validateProductRecord(product);
    if (hasBlockingError(issues)) {
      return jsonResponse(
        { error: "One or more records failed validation. No changes were written.", issues },
        400
      );
    }
  }

  const bytes = `${JSON.stringify({ ...(body as Record<string, unknown>), products: strippedProducts }, null, 2)}\n`;
  await writePublishedAtomic("candidate", bytes);
  // After the main document is safely on disk -- a rejected save above must
  // not leave a half-applied tracking write behind.
  await writeTrackingRecords(scopeNames, tracking);

  const { etag: newEtag } = await readPublishedRaw("candidate");
  return jsonResponse({ ok: true, etag: newEtag }, 200, { ETag: newEtag });
}
