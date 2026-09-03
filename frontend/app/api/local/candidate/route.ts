// frontend/app/api/local/candidate/route.ts
/**
 * Server-side read/write path for the `candidate` document.
 *
 * PORTED FROM THE FILESYSTEM VERSION. Deliberately unchanged: the HTTP
 * contract. GET still returns the document plus a strong ETag, in both the
 * header and the body's `$etag` (a compressing intermediary can strip the
 * header without touching the body -- verified against the nerd_cloud.sh
 * Cloudflare tunnel -- so every client-side reader falls back to the body
 * value). POST still requires If-Match and still answers 412 on mismatch.
 * tracking_* fields are still merged in on read and split back out on
 * write. No client component changes because of this file.
 *
 * TWO THINGS DID CHANGE, plus one deliberate non-change:
 *
 * 1. Read-compare-write is now ONE transaction. The old sequence read the
 *    ETag, compared it, wrote, then re-read -- four operations, safe only
 *    because one local disk had one writer. saveGuarded() folds the
 *    comparison and the write into a single Firestore transaction, so two
 *    concurrent saves can no longer both pass the check and both write.
 *    See lib/server/documents.ts.
 *
 * 2. Validation now runs BEFORE the ETag check rather than after. Forced by
 *    (1): the comparison no longer happens in this file. The visible effect
 *    is that a save which is both stale AND invalid now reports the
 *    validation problems instead of only the 412. That is more useful, and
 *    it is the only behavioral difference a user can observe.
 *
 * 3. The gate is UNCHANGED in effect: local-only (NODE_ENV plus
 *    NEXT_PUBLIC_DISABLE_AUTH), returning a bare 404. This file was
 *    delivered with it swapped for a Phase 3 assertSession() Firebase
 *    session-cookie check; that was reverted because real auth does not
 *    exist yet in this phase. The call site still reads assertSession() --
 *    it now resolves to the local-only shim in lib/server/local-session.ts,
 *    which Phase 3 replaces with the real check.
 *
 * The `dynamic = "force-dynamic"` declaration is retained and still
 * necessary. Its original reason (a GET with no request input can be frozen
 * at build time by Next's caching heuristic, serving a stale ETag that
 * breaks every subsequent save) applies to a Firestore read exactly as it
 * did to an fs.readFile. `runtime = "nodejs"` is likewise retained:
 * firebase-admin cannot run on Edge.
 *
 * This file mirrors app/api/local/published/route.ts exactly, differing
 * only in the DataKind ("candidate"). See that file's header for the full
 * rationale behind every decision in it -- the gate, the single-transaction
 * compare-and-swap, the validate-before-guard ordering, and why `dynamic`
 * and `runtime` are declared explicitly. Keep the two in step.
 */

import { assertSession } from "@/lib/server/local-session";
import {
  readRaw,
  saveGuarded,
  readTrackingRecords,
  DocumentNotFoundError,
  DocumentTooLargeError,
} from "@/lib/server/documents";
import { splitTracking, mergeTracking } from "@/lib/tracking";
import { hasBlockingError, validateProductRecord } from "@/lib/published-validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KIND = "candidate" as const;
const ARRAY_KEY = "products" as const;

function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders },
  });
}

export async function GET(): Promise<Response> {
  const gate = await assertSession();
  if ("response" in gate) return gate.response;

  let data: string;
  let etag: string;
  try {
    ({ data, etag } = await readRaw(KIND));
  } catch (err) {
    if (err instanceof DocumentNotFoundError) {
      // Distinct from "not authorized" and distinct from a crash: the
      // document has not been seeded. In practice this means the migration
      // has not run against this database, which is worth saying plainly
      // rather than surfacing as a 500 with a stack trace.
      return jsonResponse(
        { error: `The "${KIND}" document has not been initialized in this database.` },
        503
      );
    }
    throw err;
  }

  const parsed = JSON.parse(data) as Record<string, unknown>;
  parsed[ARRAY_KEY] = mergeTracking(
    Array.isArray(parsed[ARRAY_KEY]) ? (parsed[ARRAY_KEY] as Array<Record<string, unknown>>) : [],
    await readTrackingRecords()
  );

  // The ETag hashes the STORED bytes, which do not contain tracking -- so
  // the merge above is display-only and a later If-Match POST comparing
  // against this value can never be spuriously rejected.
  return jsonResponse({ ...parsed, $etag: etag }, 200, { ETag: etag });
}

export async function POST(request: Request): Promise<Response> {
  const gate = await assertSession();
  if ("response" in gate) return gate.response;

  const ifMatch = request.headers.get("If-Match");
  if (!ifMatch) {
    return jsonResponse({ error: "If-Match header is required." }, 428);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Request body is not valid JSON." }, 400);
  }

  const records = (body as Record<string, unknown> | null)?.[ARRAY_KEY];
  if (!Array.isArray(records)) {
    return jsonResponse({ error: `"${ARRAY_KEY}" must be an array.` }, 400);
  }

  // tracking_* is persisted to its own document, never this one.
  const { records: stripped, tracking, scopeNames } = splitTracking(
    records as Array<Record<string, unknown>>
  );

  for (const record of stripped) {
    const issues = validateProductRecord(record);
    if (hasBlockingError(issues)) {
      return jsonResponse(
        { error: "One or more records failed validation. No changes were written.", issues },
        400
      );
    }
  }

  const bytes = `${JSON.stringify(
    { ...(body as Record<string, unknown>), [ARRAY_KEY]: stripped },
    null,
    2
  )}\n`;

  let result;
  try {
    result = await saveGuarded({
      key: KIND,
      ifMatch,
      bytes,
      actor: gate.user.email,
      tracking: { scopeNames, rows: tracking },
    });
  } catch (err) {
    if (err instanceof DocumentTooLargeError) {
      return jsonResponse({ error: err.message }, 413);
    }
    throw err;
  }

  if (!result.ok) {
    return jsonResponse(
      {
        error:
          "ETag mismatch. This document has changed since your copy was read -- re-fetch before saving.",
      },
      412
    );
  }

  return jsonResponse({ ok: true, etag: result.etag }, 200, { ETag: result.etag });
}
