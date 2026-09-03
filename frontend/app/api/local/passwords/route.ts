// frontend/app/api/local/passwords/route.ts
/**
 * Read / get-or-create / delete for vendor-review passwords. See
 * lib/passwords.ts's header for the generation spec and the rationale.
 *
 * Deliberately NOT part of the DataKind ETag system, carried over unchanged
 * from the filesystem version: a password is created once and never edited,
 * so there is no read-modify-write conflict worth guarding against with an
 * If-Match round trip.
 *
 * KNOWN LIMITATION, PRESERVED RATHER THAN SILENTLY CHANGED. POST is a plain
 * read-modify-write. Two simultaneous creates for different products could
 * interleave such that one overwrites the other's append. The filesystem
 * version had exactly this property and it never mattered, because the only
 * caller is CandidateEditor.tsx's handleImport -- one operator, one import at
 * a time. Firestore makes it *possible* to fix (wrap in a transaction) and
 * that is worth doing if this ever gains a second caller, but doing it now
 * would be adding a guarantee the prior code did not make, on a code path
 * nobody has reported a problem with. Flagged here rather than fixed
 * silently or left undocumented.
 *
 * GET returns the whole document -- CandidateEditor.tsx and AddedEditor.tsx
 * fetch once and look up by product_name client-side, the same "read the
 * whole array, filter locally" pattern the other readers use.
 *
 * DELETE is called only from AddedEditor.tsx's handlePromoteToPublished: a
 * password is vendor-review-only metadata for a page that is still gated, so
 * once a product reaches published it is stale. A no-op when nothing matches.
 */

import { assertSession } from "@/lib/server/session";
import { tryReadRaw, saveUnguarded } from "@/lib/server/documents";
import { getOrCreatePassword, type PasswordRecord } from "@/lib/passwords";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PasswordsFile {
  $schema_version: number;
  $meta: Record<string, unknown>;
  passwords: PasswordRecord[];
}

const EMPTY: PasswordsFile = { $schema_version: 1, $meta: {}, passwords: [] };

async function readPasswordsFile(): Promise<PasswordsFile> {
  const found = await tryReadRaw("passwords");
  if (!found) return { ...EMPTY };
  const body = JSON.parse(found.data) as Partial<PasswordsFile>;
  return {
    $schema_version: typeof body.$schema_version === "number" ? body.$schema_version : 1,
    $meta: body.$meta ?? {},
    passwords: Array.isArray(body.passwords) ? body.passwords : [],
  };
}

async function writePasswordsFile(file: PasswordsFile, actor: string): Promise<void> {
  await saveUnguarded({
    key: "passwords",
    bytes: `${JSON.stringify(file, null, 2)}\n`,
    actor,
  });
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function GET(): Promise<Response> {
  const gate = await assertSession();
  if ("response" in gate) return gate.response;

  return jsonResponse(await readPasswordsFile(), 200);
}

export async function POST(request: Request): Promise<Response> {
  const gate = await assertSession();
  if ("response" in gate) return gate.response;

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
    await writePasswordsFile({ ...file, passwords: records }, gate.user.email);
  }

  return jsonResponse({ record, created }, 200);
}

export async function DELETE(request: Request): Promise<Response> {
  const gate = await assertSession();
  if ("response" in gate) return gate.response;

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
  const passwords = file.passwords.filter((r) => r.product_name !== productName);
  const deleted = passwords.length < file.passwords.length;

  if (deleted) {
    await writePasswordsFile({ ...file, passwords }, gate.user.email);
  }

  return jsonResponse({ deleted }, 200);
}
