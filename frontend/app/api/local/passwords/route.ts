// frontend/app/api/local/passwords/route.ts
/**
 * Local-only read/create path for lib/passwords.json -- see that file's
 * own $meta and lib/passwords.ts's header for the full rationale.
 * Deliberately NOT routed through local-write.ts's DataKind/ETag system:
 * passwords.json isn't one of the four main documents that system guards
 * concurrent writes for, and doesn't need that guarantee (a password is
 * only ever created once, never edited) -- a plain read-modify-write is
 * enough for a local, single-operator tool.
 *
 * GET returns the whole file -- CandidateEditor.tsx/AddedEditor.tsx fetch
 * it once and look up by product_name client-side, the same "read the
 * whole array, filter locally" pattern local-data.ts's readers use.
 *
 * POST is get-or-create, called only from CandidateEditor.tsx's
 * handleImport (per this feature's own spec: passwords are generated
 * during the Import Candidate process, not lazily on every view -- a
 * pre-existing candidate imported before this feature shipped gets its
 * password from a one-off backfill script instead, not from viewing it in
 * either editor). Returns the existing record unchanged if one already
 * exists for that product_name.
 *
 * DELETE removes the record for one product_name, called only from
 * AddedEditor.tsx's handlePromoteToPublished -- a password is
 * vendor-review-only metadata for a page that's still gated ("Added to
 * Site"), so once a product is promoted to published.json (publicly live,
 * no more review gate) it's stale, kept around for no reason. Silently a
 * no-op if no record matches (nothing to clean up).
 *
 * Node runtime is the default for App Router route handlers, but it is
 * declared explicitly here: fs is unavailable on Edge, and this guards
 * against an accidental edge opt-in or a future default change.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { assertLocalOnly, libDir } from "@/lib/local-write";
import { getOrCreatePassword, type PasswordRecord } from "@/lib/passwords";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// See local-write.ts's libDir() for why process.cwd() alone isn't reliable
// here under the standalone build.
const PASSWORDS_PATH = path.join(libDir(), "passwords.json");

interface PasswordsFile {
  $schema_version: number;
  $meta: Record<string, unknown>;
  passwords: PasswordRecord[];
}

async function readPasswordsFile(): Promise<PasswordsFile> {
  const raw = await fs.readFile(PASSWORDS_PATH, "utf8");
  const body = JSON.parse(raw) as Partial<PasswordsFile>;
  return {
    $schema_version: typeof body.$schema_version === "number" ? body.$schema_version : 1,
    $meta: body.$meta ?? {},
    passwords: Array.isArray(body.passwords) ? body.passwords : [],
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function GET(): Promise<Response> {
  const blocked = assertLocalOnly();
  if (blocked) return blocked;

  const file = await readPasswordsFile();
  return jsonResponse(file, 200);
}

export async function POST(request: Request): Promise<Response> {
  const blocked = assertLocalOnly();
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Request body is not valid JSON." }, 400);
  }

  const productName = (body as { product_name?: unknown } | null)?.product_name;
  if (typeof productName !== "string" || productName.trim() === "") {
    return jsonResponse({ error: '"product_name" must be a non-empty string.' }, 400);
  }
  const vendorNameRaw = (body as { vendor_name?: unknown } | null)?.vendor_name;
  const vendorName = typeof vendorNameRaw === "string" ? vendorNameRaw : null;

  const file = await readPasswordsFile();
  const { records, record, created } = getOrCreatePassword(file.passwords, productName, vendorName);

  if (created) {
    const bytes = `${JSON.stringify({ ...file, passwords: records }, null, 2)}\n`;
    await fs.writeFile(PASSWORDS_PATH, bytes, "utf8");
  }

  return jsonResponse({ record, created }, 200);
}

export async function DELETE(request: Request): Promise<Response> {
  const blocked = assertLocalOnly();
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Request body is not valid JSON." }, 400);
  }

  const productName = (body as { product_name?: unknown } | null)?.product_name;
  if (typeof productName !== "string" || productName.trim() === "") {
    return jsonResponse({ error: '"product_name" must be a non-empty string.' }, 400);
  }

  const file = await readPasswordsFile();
  const before = file.passwords.length;
  const passwords = file.passwords.filter((r) => r.product_name !== productName);
  const deleted = passwords.length < before;

  if (deleted) {
    const bytes = `${JSON.stringify({ ...file, passwords }, null, 2)}\n`;
    await fs.writeFile(PASSWORDS_PATH, bytes, "utf8");
  }

  return jsonResponse({ deleted }, 200);
}
