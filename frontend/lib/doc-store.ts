import "server-only";

import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./firestore-admin";

/**
 * The single code path that touches persistent storage, replacing the
 * filesystem helpers in local-write.ts (libDir/pathFor/atomicWrite/...).
 *
 * Every stored document lives as one Firestore document in COLLECTION, holding
 * the raw bytes as a `content` string (never a parsed map -- the ETag contract
 * is SHA-256 of the exact bytes, and any parse/reserialize could reorder keys),
 * plus a `sha256` field and a server `updated_at` timestamp.
 */
const COLLECTION = "nerd_documents";

/** Thrown by writeDocument when a supplied ifMatch ETag no longer matches the
 *  stored content. Route handlers translate this to HTTP 412. */
export class ETagMismatchError extends Error {
  readonly id: string;
  readonly expected: string;
  readonly actual: string | undefined;

  constructor(id: string, expected: string, actual: string | undefined) {
    super(
      `ETag mismatch for "${id}": expected ${expected}, found ${actual ?? "<no document>"}`,
    );
    this.name = "ETagMismatchError";
    this.id = id;
    this.expected = expected;
    this.actual = actual;
  }
}

function sha256(bytes: string): string {
  return createHash("sha256").update(bytes, "utf8").digest("hex");
}

/**
 * Returns the document's raw content and its ETag (SHA-256 of that content),
 * or null when the document does not exist -- callers that previously caught
 * ENOENT and returned an empty result rely on the null.
 */
export async function readDocument(
  id: string,
): Promise<{ data: string; etag: string } | null> {
  const snap = await db.collection(COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  const data = (snap.get("content") as string | undefined) ?? "";
  return { data, etag: sha256(data) };
}

/**
 * Replaces the document's content with `bytes` inside a Firestore transaction.
 * When `ifMatch` is supplied, the current content's SHA-256 is re-checked
 * inside the transaction and an ETagMismatchError is thrown if it differs
 * (including when the document does not exist). Returns the new ETag.
 */
export async function writeDocument(
  id: string,
  bytes: string,
  ifMatch?: string,
): Promise<string> {
  const digest = sha256(bytes);
  const ref = db.collection(COLLECTION).doc(id);

  await db.runTransaction(async (tx) => {
    if (ifMatch !== undefined) {
      const snap = await tx.get(ref);
      const current = snap.exists
        ? sha256((snap.get("content") as string | undefined) ?? "")
        : undefined;
      if (current !== ifMatch) {
        throw new ETagMismatchError(id, ifMatch, current);
      }
    }
    tx.set(ref, {
      content: bytes,
      sha256: digest,
      updated_at: FieldValue.serverTimestamp(),
    });
  });

  return digest;
}

/** Deletes the document. A no-op if it does not exist (Firestore delete is
 *  idempotent). */
export async function deleteDocument(id: string): Promise<void> {
  await db.collection(COLLECTION).doc(id).delete();
}

/**
 * Copies the current document to `${id}__bak`, then writes `bytes` over `id`.
 * When `id` has no current document there is nothing to back up, so only the
 * write happens. Returns the new ETag of `id`.
 */
export async function backupThenWrite(id: string, bytes: string): Promise<string> {
  const current = await readDocument(id);
  if (current !== null) {
    await writeDocument(`${id}__bak`, current.data);
  }
  return writeDocument(id, bytes);
}

/**
 * Copies the current document to `${id}__bak`, then deletes `id`. When `id`
 * has no current document this does nothing (no stale backup, no error).
 */
export async function backupThenDelete(id: string): Promise<void> {
  const current = await readDocument(id);
  if (current === null) return;
  await writeDocument(`${id}__bak`, current.data);
  await deleteDocument(id);
}
