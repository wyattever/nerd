// frontend/app/api/local/published/route.ts
/**
 * Local-only server-side write path for published.json.
 *
 * Gated to development (see assertLocalOnly in lib/local-write.ts). GET
 * reads fresh from disk on every request -- never the frozen static import
 * used by the public /tables/published viewer -- so a save is reflected
 * immediately without depending on Turbopack watcher/HMR behavior. POST
 * validates before writing and uses a whole-file SHA-256 ETag with
 * If-Match/412 to catch a save racing an out-of-band edit (IDE, git
 * checkout) of the same file. See docs/NERD_System_Architecture.md.
 *
 * Node runtime is the default for App Router route handlers, but it is
 * declared explicitly here: fs is unavailable on Edge, and this guards
 * against an accidental edge opt-in or a future default change.
 *
 * Sibling routes app/api/local/added and app/api/local/candidate mirror
 * this file exactly, differing only in the DataKind passed to
 * readPublishedRaw/writePublishedAtomic.
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

  const { data, etag } = await readPublishedRaw("published");
  return new Response(data, {
    status: 200,
    headers: { "Content-Type": "application/json", ETag: etag },
  });
}

export async function POST(request: Request): Promise<Response> {
  const blocked = assertLocalOnly();
  if (blocked) return blocked;

  const { etag: currentEtag } = await readPublishedRaw("published");
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
  await writePublishedAtomic("published", bytes);

  const { etag: newEtag } = await readPublishedRaw("published");
  return jsonResponse({ ok: true, etag: newEtag }, 200, { ETag: newEtag });
}
