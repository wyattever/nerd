// frontend/app/api/local/vendors/route.ts
/**
 * Server-side read/write path for the `vendors` document (the global vendors
 * registry -- see lib/directory-schema.ts, which superseded vendor-schema.ts
 * in Decision #47).
 *
 * Mirrors app/api/local/published/route.ts. See that file's header for the
 * full rationale behind the gate, the single-transaction compare-and-swap,
 * and the validate-before-guard ordering. Two differences, both carried over
 * unchanged from the filesystem version:
 *
 *   - The array key is `vendors`, not `products`.
 *   - POST validation is deliberately lightweight: a top-level `vendors`
 *     array whose entries each carry a string `vendor_name`. No dispatch has
 *     asked for field-by-field enforcement on this registry, and inventing
 *     one now would mean validating fields the /vendors page does not let
 *     anyone edit.
 *
 * A vendor record's `product_name` is its vendor name, which is the key
 * tracking.json is indexed by -- so the tracking split and merge work here
 * identically to the product routes with no special casing.
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KIND = "vendors" as const;
const ARRAY_KEY = "vendors" as const;

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

  // `$etag` is echoed into the body as well as the header. A compressing
  // intermediary can strip a custom response header without touching the
  // body -- verified against the nerd_cloud.sh Cloudflare tunnel, where the
  // header survived until the client negotiated compression, which every
  // real browser does. VendorEditor.tsx's saveToServer falls back to this.
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
  for (const vendor of records) {
    if (typeof (vendor as { vendor_name?: unknown })?.vendor_name !== "string") {
      return jsonResponse(
        {
          error:
            "One or more vendor records is missing a string vendor_name. No changes were written.",
        },
        400
      );
    }
  }

  const { records: stripped, tracking, scopeNames } = splitTracking(
    records as Array<Record<string, unknown>>
  );

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
