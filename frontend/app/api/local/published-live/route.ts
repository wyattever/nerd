// frontend/app/api/local/published-live/route.ts
/**
 * Local-only, read-only existence/content check for the (not-yet-produced)
 * live-scrape snapshot, frontend/lib/published-live.json.
 *
 * Unlike published/added/candidate/vendors (lib/local-write.ts's DataKind),
 * this file has no write path yet -- the live-scrape process that will
 * eventually produce it is still being built (see
 * scripts/scrape_ncademi_live.py, which currently outputs
 * live-products.json/live-vendors.json under a different naming scheme, not
 * yet renamed to match). So this route is deliberately NOT added to
 * DataKind/readPublishedRaw: that pair's whole design is "closed set of
 * documents this app can WRITE" (see local-write.ts's header comment), and
 * there is no writePublishedAtomic("published-live", ...) call anywhere.
 * Reusing assertLocalOnly() is still correct -- it's a standalone gate, not
 * tied to DataKind -- so this route gets the same local-development-only
 * guard every other /api/local/* route has.
 *
 * GET reads frontend/lib/published-live.json fresh from disk on every
 * request (same "never a frozen static import" reasoning as the sibling
 * routes) and returns it verbatim with 200 if present. If the file does not
 * exist yet (the expected case today), returns 404 with an
 * `{ exists: false }` body rather than throwing -- /records' mount-time
 * existence check (see app/records/page.tsx) depends on this NOT crashing,
 * since "no live data yet" is the normal, unsurprising state, not an error.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { assertLocalOnly } from "@/lib/local-write";

export const runtime = "nodejs";

const PUBLISHED_LIVE_PATH = path.join(process.cwd(), "lib", "published-live.json");

export async function GET(): Promise<Response> {
  const blocked = assertLocalOnly();
  if (blocked) return blocked;

  let data: string;
  try {
    data = await fs.readFile(PUBLISHED_LIVE_PATH, "utf8");
  } catch {
    // ENOENT (file doesn't exist yet) is the expected, common case today --
    // any other read failure (permissions, a mid-write partial file, etc.)
    // degrades the same way rather than 500ing, since the only consumer of
    // this route just wants to know "can I show the Live Data toggle," not
    // why not.
    return new Response(JSON.stringify({ exists: false }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(data, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
