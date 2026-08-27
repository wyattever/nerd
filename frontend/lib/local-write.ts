// frontend/lib/local-write.ts
/**
 * Local-only filesystem access for the raw JSON editor's server-side save
 * path. See docs/NERD_System_Architecture.md for the full architecture rationale.
 *
 * This module is deliberately narrow:
 *   - Every path this module ever touches comes from the FILE_NAMES lookup
 *     below, keyed by one of exactly three literal DataKind values -- never
 *     built from request input. That is what eliminates the path-traversal
 *     vector rather than sanitizing it: readPublishedRaw/writePublishedAtomic
 *     take a `kind: DataKind` parameter, not a filename, so there is no
 *     string to sanitize in the first place.
 *   - readPublishedRaw() reads fresh from disk on every call rather than
 *     relying on the static `import data from "./published.json"`
 *     used elsewhere in the app. That static import is frozen in process
 *     memory at build/first-load time; writing new bytes to disk does not
 *     mutate it, so the editor's read path cannot use it.
 *   - writePublishedAtomic() hand-rolls temp-file + fsync + rename + parent
 *     dir fsync rather than depending on write-file-atomic. fs.writeFile
 *     alone is NOT atomic (truncate-then-write; a crash mid-write leaves a
 *     partial file), and a bare rename without fsync can still lose the
 *     write on a crash between rename and the OS flushing the directory
 *     entry to disk.
 */

import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { isLocalOnlyAllowed } from "./local-only";

/**
 * The JSON documents the /editor and /vendors pages' local write APIs can
 * read and write. A closed union rather than a free-form filename -- see
 * the module header above.
 */
export type DataKind = "published" | "added" | "candidate" | "vendors";

const FILE_NAMES: Record<DataKind, string> = {
  published: "published.json",
  added: "added.json",
  candidate: "candidate.json",
  vendors: "vendors.json",
};

/**
 * frontend/lib/ under `next dev`/`next start` (process.cwd() there is
 * frontend/, matching every other reader/writer's assumption) -- but NOT
 * under the standalone build nerd_cloud.sh runs in the cloud demo:
 * .next/standalone/server.js calls process.chdir(__dirname) at startup, so
 * process.cwd() there is .next/standalone/, and this would resolve to
 * .next/standalone/lib/ -- a BUILD-TIME COPY Next's file-tracer makes for
 * static JSON imports elsewhere in the app, not the real source file.
 * Reads/writes against that copy appear to work within one server process
 * (the copy is a real, writable file) but silently diverge from
 * frontend/lib/ and get clobbered by the next `next build`'s fresh copy --
 * confirmed in production: an "Added" product deleted mid-session
 * reappeared after the next nerd_cloud.sh restart, because the delete only
 * ever reached .next/standalone/lib/added.json, never the real file.
 * NERD_REPO_ROOT (set by nerd_cloud.sh, same env var app/api/local/
 * scrape/route.ts's REPO_ROOT already uses) is the explicit override for
 * that environment.
 */
export function libDir(): string {
  return process.env.NERD_REPO_ROOT
    ? path.join(process.env.NERD_REPO_ROOT, "frontend", "lib")
    : path.join(process.cwd(), "lib");
}

function pathFor(kind: DataKind): string {
  return path.join(libDir(), FILE_NAMES[kind]);
}

/**
 * Gates every handler in this route to local development only. Returns 404
 * (never 403) so the route is indistinguishable from "does not exist" if
 * somehow reached in production -- leaking nothing about its purpose.
 *
 * Two conditions, both required to allow the request through: NODE_ENV must
 * not be "production" (set by `next start`/standalone, hard to flip by
 * accident) AND NEXT_PUBLIC_DISABLE_AUTH must be exactly "true" (the
 * existing local-mode flag used elsewhere in this app). Either one failing
 * blocks the request -- defense in depth, not either-or.
 *
 * Returns the 404 Response to send when blocked, or null when the request
 * may proceed. Delegates the actual condition to isLocalOnlyAllowed() --
 * see that module's header -- so Route Handlers and the Server Component
 * readers in local-data.ts enforce the exact same boundary rather than two
 * independently maintained copies of it.
 */
export function assertLocalOnly(): Response | null {
  if (!isLocalOnlyAllowed()) {
    return new Response(null, { status: 404 });
  }
  return null;
}

/**
 * Reads the given document fresh from disk and returns its raw bytes (as a
 * UTF-8 string) alongside a strong ETag: the SHA-256 hash of the exact
 * bytes read. The hash is computed over the Buffer, before any string
 * decoding, so it reflects what is actually on disk.
 */
export async function readPublishedRaw(kind: DataKind): Promise<{ data: string; etag: string }> {
  const buffer = await fs.readFile(pathFor(kind));
  const etag = createHash("sha256").update(buffer).digest("hex");
  return { data: buffer.toString("utf8"), etag };
}

/**
 * Replaces the given document with `bytes`, atomically and durably.
 *
 * 1. Write the new content to a temp file in the SAME directory as the
 *    target (a sibling, never /tmp) -- fs.rename() is only atomic within a
 *    single filesystem, and fails with EXDEV across devices.
 * 2. Open that temp file and fsync it, so its bytes are flushed to disk
 *    before it becomes the target's new name.
 * 3. fs.rename() the temp file over the target. On the same filesystem this
 *    is atomic: a concurrent reader sees the old bytes or the new bytes,
 *    never a partial file.
 * 4. Open the parent directory and fsync it too. Without this, the rename
 *    itself can survive a crash while the directory entry pointing at it
 *    does not, and the old file reappears on an unclean reboot.
 */
export async function writePublishedAtomic(kind: DataKind, bytes: string): Promise<void> {
  const targetPath = pathFor(kind);
  const dir = path.dirname(targetPath);
  const tempPath = `${targetPath}.tmp`;

  await fs.writeFile(tempPath, bytes, "utf8");

  const fileHandle = await fs.open(tempPath, "r+");
  try {
    await fileHandle.sync();
  } finally {
    await fileHandle.close();
  }

  await fs.rename(tempPath, targetPath);

  const dirHandle = await fs.open(dir, "r");
  try {
    await dirHandle.sync();
  } finally {
    await dirHandle.close();
  }
}
