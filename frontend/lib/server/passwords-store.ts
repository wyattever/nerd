// frontend/lib/server/passwords-store.ts
/**
 * Read / parse / serialize for the `passwords` document, plus the one
 * guarded write path (mutatePasswords) built on documents.ts's
 * mutateDocument. Moved out of app/api/local/passwords/route.ts so every
 * password writer can share the same atomic read-modify-write instead of
 * each doing its own unguarded read-then-save.
 */

import "server-only";
import { tryReadRaw, mutateDocument } from "./documents";
import type { PasswordRecord } from "../passwords";

export interface PasswordsFile {
  $schema_version: number;
  $meta: Record<string, unknown>;
  passwords: PasswordRecord[];
}

const EMPTY: PasswordsFile = { $schema_version: 1, $meta: {}, passwords: [] };

/** Pure. Same normalization the route's readPasswordsFile applied: missing
 *  document -> a fresh copy of EMPTY; otherwise each top-level field falls
 *  back to its default when absent or the wrong type. */
export function parsePasswordsFile(bytes: string | null): PasswordsFile {
  if (bytes === null) return { ...EMPTY };
  const body = JSON.parse(bytes) as Partial<PasswordsFile>;
  return {
    $schema_version: typeof body.$schema_version === "number" ? body.$schema_version : 1,
    $meta: body.$meta ?? {},
    passwords: Array.isArray(body.passwords) ? body.passwords : [],
  };
}

/** Pure. Byte-identical to the format writePasswordsFile has always used. */
export function serializePasswordsFile(file: PasswordsFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

export async function readPasswordsFile(): Promise<PasswordsFile> {
  const found = await tryReadRaw("passwords");
  return parsePasswordsFile(found ? found.data : null);
}

/**
 * Atomic read-modify-write of the passwords document. `fn` receives the
 * current parsed file and returns `{ file, result }`: `file` is the
 * complete new document, or null to write nothing; `result` is returned to
 * the caller.
 *
 * `fn` MUST be pure -- it runs inside a Firestore transaction and may be
 * invoked more than once on contention. No I/O, no mutation of captured
 * state, no other side effects; anything it needs (e.g. a timestamp) must
 * be computed by the caller beforehand.
 */
export async function mutatePasswords<R>(
  actor: string,
  fn: (file: PasswordsFile) => { file: PasswordsFile | null; result: R }
): Promise<R> {
  const { result } = await mutateDocument({
    key: "passwords",
    actor,
    mutate: (currentBytes) => {
      const { file, result } = fn(parsePasswordsFile(currentBytes));
      return { bytes: file === null ? null : serializePasswordsFile(file), result };
    },
  });
  return result;
}
