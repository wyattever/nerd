// frontend/app/api/local/vendors/route.ts
/**
 * Local-only server-side write path for vendors.json (the global vendors
 * registry, see lib/vendor-schema.ts).
 *
 * Modeled exactly after app/api/local/published/route.ts, differing only in
 * the DataKind ("vendors") and the shape validated on POST -- see that
 * file's header comment and docs/NERD_System_Architecture.md for the full
 * rationale (gating, ETag concurrency, atomic writes).
 *
 * POST validation here is deliberately lightweight (top-level
 * `vendors` array + each entry's `vendor_name` is a string) rather than a
 * full field-by-field validator like published-validate.ts's
 * validateProductRecord -- no dispatch has asked for that level of
 * enforcement on this registry yet, and inventing one now would be
 * validating fields the /vendors page doesn't even let anyone edit.
 *
 * Node runtime is the default for App Router route handlers, but it is
 * declared explicitly here: fs is unavailable on Edge, and this guards
 * against an accidental edge opt-in or a future default change.
 */

import { assertLocalOnly, readPublishedRaw, writePublishedAtomic } from "@/lib/local-write";

export const runtime = "nodejs";

function jsonResponse(body: unknown, status: number, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

export async function GET(): Promise<Response> {
  const blocked = assertLocalOnly();
  if (blocked) return blocked;

  const { data, etag } = await readPublishedRaw("vendors");
  return new Response(data, {
    status: 200,
    headers: { "Content-Type": "application/json", ETag: etag },
  });
}

export async function POST(request: Request): Promise<Response> {
  const blocked = assertLocalOnly();
  if (blocked) return blocked;

  const { etag: currentEtag } = await readPublishedRaw("vendors");
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

  const vendors = (body as { vendors?: unknown } | null)?.vendors;
  if (!Array.isArray(vendors)) {
    return jsonResponse({ error: '"vendors" must be an array.' }, 400);
  }
  for (const vendor of vendors) {
    if (typeof (vendor as { vendor_name?: unknown })?.vendor_name !== "string") {
      return jsonResponse(
        { error: "One or more vendor records is missing a string vendor_name. No changes were written." },
        400
      );
    }
  }

  const bytes = `${JSON.stringify(body, null, 2)}\n`;
  await writePublishedAtomic("vendors", bytes);

  const { etag: newEtag } = await readPublishedRaw("vendors");
  return jsonResponse({ ok: true, etag: newEtag }, 200, { ETag: newEtag });
}
