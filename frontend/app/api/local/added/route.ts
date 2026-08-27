// frontend/app/api/local/added/route.ts
/**
 * Local-only server-side write path for added.json.
 *
 * Mirrors app/api/local/published/route.ts exactly, differing only in the
 * DataKind ("added") passed to readPublishedRaw/writePublishedAtomic. See
 * that file's header comment and docs/NERD_System_Architecture.md for the full
 * rationale (gating, ETag concurrency, atomic writes).
 *
 * Node runtime is the default for App Router route handlers, but it is
 * declared explicitly here: fs is unavailable on Edge, and this guards
 * against an accidental edge opt-in or a future default change.
 */

import { assertLocalOnly, readPublishedRaw, writePublishedAtomic } from "@/lib/local-write";
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

  const { data, etag } = await readPublishedRaw("added");
  // Echoed into the body as `$etag` too -- see app/api/local/vendors/
  // route.ts's GET for why (a compressing intermediary can strip the ETag
  // header without touching the body; every client-side reader must fall
  // back to this).
  const body = { ...(JSON.parse(data) as Record<string, unknown>), $etag: etag };
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

  const { etag: currentEtag } = await readPublishedRaw("added");
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

  for (const product of products) {
    const issues = validateProductRecord(product);
    if (hasBlockingError(issues)) {
      return jsonResponse(
        { error: "One or more records failed validation. No changes were written.", issues },
        400
      );
    }
  }

  const bytes = `${JSON.stringify(body, null, 2)}\n`;
  await writePublishedAtomic("added", bytes);

  const { etag: newEtag } = await readPublishedRaw("added");
  return jsonResponse({ ok: true, etag: newEtag }, 200, { ETag: newEtag });
}
