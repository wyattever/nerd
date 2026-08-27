// frontend/app/api/local/vendors-live/route.ts
/**
 * Local-only, read-only existence/content check for the live-scrape vendor
 * snapshot, frontend/lib/vendors-live.json -- mirrors
 * app/api/local/published-live/route.ts entirely, but for vendors. See that
 * file's header for the full rationale (not added to DataKind/
 * readPublishedRaw since there is no write path for this file; assertLocalOnly()
 * reused as a standalone gate).
 *
 * GET reads frontend/lib/vendors-live.json fresh from disk on every
 * request. If the file does not exist yet (the expected case today),
 * returns 404 with an `{ exists: false }` body rather than throwing.
 *
 * vendors-live.json's records carry no `slug` field, so this route parses
 * the file and injects a synthesized slug per vendor via
 * lib/local-data.ts's deriveLiveVendorSlug() -- the SAME function
 * getLiveVendors() uses -- rather than a second, independently-maintained
 * copy of that derivation, so a given live record can't end up with two
 * different slugs depending on which of the two read paths served it.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { assertLocalOnly } from "@/lib/local-write";
import { deriveLiveVendorSlug } from "@/lib/local-data";

export const runtime = "nodejs";
// See app/api/local/vendors/route.ts's header comment on `dynamic` --
// without this, GET's fs.readFile-only response can be frozen at
// `next build` time under a production build (e.g. always answering
// `{ exists: false }` even after a live scrape has since written the file).
export const dynamic = "force-dynamic";

const VENDORS_LIVE_PATH = path.join(process.cwd(), "lib", "vendors-live.json");

export async function GET(): Promise<Response> {
  const blocked = assertLocalOnly();
  if (blocked) return blocked;

  let data: string;
  try {
    data = await fs.readFile(VENDORS_LIVE_PATH, "utf8");
  } catch {
    // ENOENT (file doesn't exist yet) is the expected, common case today --
    // any other read failure (permissions, a mid-write partial file, etc.)
    // degrades the same way rather than 500ing, since the only consumer of
    // this route just wants to know "can I show the Live Data toggle," not
    // why not.
    return new Response(JSON.stringify({ exists: false }), {
      status: 404,
      // See app/api/local/vendors/route.ts's GET for why no-store is
      // explicit here -- this route's whole purpose is telling the caller
      // whether a live scrape has landed since the page loaded, so a cached
      // 404 would leave "Live Data" stuck disabled after one actually did.
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  const body = JSON.parse(data) as { vendors?: unknown; [key: string]: unknown };
  const rawVendors = Array.isArray(body.vendors) ? (body.vendors as Array<Record<string, unknown>>) : [];
  const vendors = rawVendors.map((v) => ({
    ...v,
    slug: deriveLiveVendorSlug(v.vendor_directory_url as string),
  }));

  return NextResponse.json({ ...body, vendors }, { headers: { "Cache-Control": "no-store" } });
}
