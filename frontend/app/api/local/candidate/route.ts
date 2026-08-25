// frontend/app/api/local/candidate/route.ts
/**
 * Local-only server-side write path for candidate-tables.json.
 *
 * Mirrors app/api/local/published/route.ts exactly, differing only in the
 * DataKind ("candidate") passed to readPublishedRaw/writePublishedAtomic.
 * See that file's header comment and docs/NERD_System_Architecture.md for the
 * full rationale (gating, ETag concurrency, atomic writes).
 *
 * Node runtime is the default for App Router route handlers, but it is
 * declared explicitly here: fs is unavailable on Edge, and this guards
 * against an accidental edge opt-in or a future default change.
 */

import { assertLocalOnly, readPublishedRaw, writePublishedAtomic } from "@/lib/local-write";
import { hasBlockingError, validateProductRecord } from "@/lib/published-validate";

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

  const { data, etag } = await readPublishedRaw("candidate");
  return new Response(data, {
    status: 200,
    headers: { "Content-Type": "application/json", ETag: etag },
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
  await writePublishedAtomic("candidate", bytes);

  const { etag: newEtag } = await readPublishedRaw("candidate");
  return jsonResponse({ ok: true, etag: newEtag }, 200, { ETag: newEtag });
}
