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
import { readPasswordsFile, mutatePasswords } from "@/lib/server/passwords-store";
import { getOrCreatePassword, setPassword } from "@/lib/passwords";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  // Computed once, outside the transaction, so every retry of the pure
  // mutate function stamps the same timestamp/year.
  const now = new Date();
  const { record, created } = await mutatePasswords(gate.user.email, (file) => {
    const { records, record, created } = getOrCreatePassword(file.passwords, productName, vendorName, now);
    return { file: created ? { ...file, passwords: records } : null, result: { record, created } };
  });

  return jsonResponse({ record, created }, 200);
}

// Sets a product's vendor-review password to the given value, creating the
// row if absent. No write when the value is unchanged. Atomic via
// mutatePasswords.
export async function PUT(request: Request): Promise<Response> {
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

  const passwordRaw = (body as { password?: unknown } | null)?.password;
  if (typeof passwordRaw !== "string") {
    return jsonResponse({ error: '"password" must be a string.' }, 400);
  }
  const password = passwordRaw.trim();
  if (password === "") {
    return jsonResponse({ error: '"password" must be a non-empty string.' }, 400);
  }
  // WordPress stores post_password as varchar(255).
  if (password.length > 255) {
    return jsonResponse({ error: '"password" must be 255 characters or fewer.' }, 400);
  }

  // Computed once, outside the transaction, so every retry of the pure
  // mutate function stamps the same timestamp.
  const now = new Date();
  const { record, created, changed } = await mutatePasswords(gate.user.email, (file) => {
    const out = setPassword(file.passwords, productName, password, vendorName, now);
    return {
      file: out.changed ? { ...file, passwords: out.records } : null,
      result: { record: out.record, created: out.created, changed: out.changed },
    };
  });

  return jsonResponse({ record, created, changed }, 200);
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

  const { deleted } = await mutatePasswords(gate.user.email, (file) => {
    const passwords = file.passwords.filter((r) => r.product_name !== productName);
    const deleted = passwords.length < file.passwords.length;
    return { file: deleted ? { ...file, passwords } : null, result: { deleted } };
  });

  return jsonResponse({ deleted }, 200);
}
