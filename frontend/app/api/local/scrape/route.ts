// frontend/app/api/local/scrape/route.ts
/**
 * Local-only trigger for the live NCADEMI scrape
 * (scripts/scrape_ncademi_live.py), wired to /records' "Retrieve Live Data"
 * button and its real-time Messages log.
 *
 * Streams via Server-Sent Events instead of the previous execFile-based
 * "block until exit, return one JSON blob" design: execFile only resolves
 * once the child process has already exited, so there is no way to surface
 * progress before the whole ~1-2 minute run finishes. spawn()'s stdout is
 * a live stream instead, so each PROGRESS_JSON: line the script prints
 * (see its own module docstring's "Progress streaming" section) is
 * forwarded to the browser as a `progress` SSE event as soon as it's
 * written, not after the process ends.
 *
 * PYTHONUNBUFFERED=1 is load-bearing here, not cosmetic: Python fully
 * block-buffers stdout when it isn't a TTY (i.e. always, when spawned by
 * Node), so without this env var every print() -- progress lines included
 * -- would sit in a buffer and only reach this route in one lump at
 * process exit, silently defeating the entire point of switching to spawn.
 *
 * This is a POST-based SSE stream, not a GET one, so the browser's native
 * EventSource (GET-only) can't consume it -- /records' handler reads
 * response.body via a ReadableStreamDefaultReader and hand-parses the
 * `event:`/`data:` framing instead. See that file's handleRetrieveLiveData
 * for the matching client-side parser.
 *
 * PYTHON_BIN/SCRIPT_PATH are both fixed, derived from REPO_ROOT. The
 * request body's `target` is the one user-controlled value that reaches the
 * spawned command, passed as its own argv element (not interpolated into a
 * shell string), so it cannot inject additional arguments or commands --
 * the script's own argparse `choices` is what rejects a value outside
 * "all"/"products"/"vendors", surfacing as a normal non-zero exit handled
 * by the child.on("close") branch below.
 *
 * Post-retrieval comparison: once the child exits successfully, this route
 * also diffs the just-written live snapshot against the relevant stored
 * file(s) (published.json/added.json for a "products" run, vendors.json for
 * a "vendors" run) and sends up to two more `progress` events per pair --
 * "X not stored" and "X in your records not retrieved from the site" --
 * using the same stage-keyed `progress` protocol as the script's own
 * milestones (see sendPostRetrievalComparisons below), so the client-side
 * parser needs no changes to display them. A pair is silent when its list
 * is empty, matching the script's own "vendors_missing" convention.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { assertLocalOnly } from "@/lib/local-write";
import {
  getPublishedProducts,
  getAddedProducts,
  getPublishedLiveProducts,
  getVendors,
  getLiveVendors,
} from "@/lib/local-data";
import type { PublishedProductRecord } from "@/lib/published-tables";
import type { DirectoryRecord } from "@/lib/directory-schema";

export const runtime = "nodejs";

// process.cwd() for a Next.js route handler is frontend/ under `next dev`/
// `next start` (matches lib/local-write.ts's pathFor, one level up to repo
// root) -- but NOT under the standalone build nerd_cloud.sh runs in the
// cloud demo: .next/standalone/server.js calls process.chdir(__dirname) at
// startup, so cwd there is .next/standalone/, and "one level up" lands on
// .next/ instead of the real repo root. That's harmless for JSON/JS
// imports (Next's file-tracer copies those into the standalone bundle so
// cwd-relative reads still resolve), but PYTHON_BIN/SCRIPT_PATH point
// outside frontend/ entirely and are invoked via child_process.spawn --
// invisible to that tracer, so there's nothing for a wrong cwd to
// accidentally still find. NERD_REPO_ROOT (set by nerd_cloud.sh) is the
// explicit override for that environment; process.cwd()-based inference
// stays the default for plain dev/start.
const REPO_ROOT = process.env.NERD_REPO_ROOT ?? path.join(process.cwd(), "..");
const PYTHON_BIN = path.join(REPO_ROOT, "venv312", "bin", "python3");
const SCRIPT_PATH = path.join(REPO_ROOT, "scripts", "scrape_ncademi_live.py");

const SCRAPE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes -- a full run is normally ~1-2 min.

// Must match PROGRESS_PREFIX in scripts/scrape_ncademi_live.py -- the one
// thing tying this route's parser to that script's stdout protocol.
const PROGRESS_PREFIX = "PROGRESS_JSON:";

/** Last N lines of a process's output -- used for error payloads only, so
 *  a genuine failure's stderr tail is readable without capping the whole
 *  run's ~100-line stdout log in memory for no reason. */
function tail(text: string, lines = 20): string {
  return text.trim().split("\n").slice(-lines).join("\n");
}

/** published-live.json's raw entries carry `is_protected` (see
 *  scrape_ncademi_live.py's make_protected_product_stub/parse_public_product),
 *  but PublishedProductRecord doesn't declare that field -- it's curated
 *  snapshot data (published.json/added.json), which has no protected stubs
 *  to distinguish. The cast here is local to this one read, not a change to
 *  that shared type. */
function isProtectedLiveProduct(product: PublishedProductRecord): boolean {
  return Boolean((product as unknown as { is_protected?: boolean }).is_protected);
}

/** Splits `liveItems` vs. `storedItems` into "in live but not stored" and
 *  "in stored but not live", matched by `keyOf`. Null/empty keys (e.g. a
 *  vendor record with no vendor_directory_url) are skipped on both sides
 *  rather than colliding into a single "" bucket. */
function diffByKey<T>(
  liveItems: T[],
  storedItems: T[],
  keyOf: (item: T) => string | null | undefined,
  nameOf: (item: T) => string
): { notStored: string[]; notRetrieved: string[] } {
  const liveByKey = new Map<string, T>();
  for (const item of liveItems) {
    const key = keyOf(item);
    if (key) liveByKey.set(key, item);
  }
  const storedKeys = new Set<string>();
  for (const item of storedItems) {
    const key = keyOf(item);
    if (key) storedKeys.add(key);
  }

  const notStored: string[] = [];
  for (const [key, item] of liveByKey) {
    if (!storedKeys.has(key)) notStored.push(nameOf(item));
  }

  const notRetrieved: string[] = [];
  for (const item of storedItems) {
    const key = keyOf(item);
    if (key && !liveByKey.has(key)) notRetrieved.push(nameOf(item));
  }

  return { notStored, notRetrieved };
}

/** Sends one `progress` event for a comparison list, or nothing at all when
 *  the list is empty -- same "skip entirely when there's nothing to report"
 *  behavior as the script's own Milestone D (vendors_missing). `stage` must
 *  be unique per message (not reused across calls), since the client
 *  replaces a stage's row in place rather than appending. */
function sendListMessage(
  send: (event: string, data: unknown) => void,
  stage: string,
  prefix: string,
  names: string[]
): void {
  if (names.length === 0) return;
  send("progress", { stage, message: `${prefix}: ${names.join("; ")}.` });
}

/**
 * Runs the post-retrieval stored-vs-live comparisons for whichever
 * category(ies) this run actually scraped, and streams their messages.
 * Errors here (e.g. a stored file failing to parse) are swallowed by the
 * caller -- a comparison bug should never hide that the scrape itself
 * succeeded.
 */
async function sendPostRetrievalComparisons(
  target: string,
  send: (event: string, data: unknown) => void
): Promise<void> {
  if (target === "products" || target === "all") {
    const [{ products: storedPublished }, { products: storedAdded }, { products: liveProducts }] = await Promise.all([
      getPublishedProducts(),
      getAddedProducts(),
      getPublishedLiveProducts(),
    ]);

    // A protected live product page only ever produced a stub (name/URL/
    // is_protected) during the scrape -- that's what "added" (not yet
    // publicly viewable) means here, so it's compared against added.json,
    // not published.json.
    const livePublished = liveProducts.filter((p) => !isProtectedLiveProduct(p));
    const liveAdded = liveProducts.filter((p) => isProtectedLiveProduct(p));

    const keyOf = (p: PublishedProductRecord) => p.ncademi_product_url;
    const nameOf = (p: PublishedProductRecord) => p.product_name;

    const published = diffByKey(livePublished, storedPublished, keyOf, nameOf);
    sendListMessage(send, "published_not_stored", "The following published products are not stored in your records", published.notStored);
    sendListMessage(
      send,
      "published_not_retrieved",
      "The following published products in your records were not retrieved from the site",
      published.notRetrieved
    );

    const added = diffByKey(liveAdded, storedAdded, keyOf, nameOf);
    sendListMessage(send, "added_not_stored", "The following added products are not stored in your records", added.notStored);
    sendListMessage(
      send,
      "added_not_retrieved",
      "The following added products in your records were not retrieved from the site",
      added.notRetrieved
    );
  }

  if (target === "vendors" || target === "all") {
    const [{ vendors: storedVendors }, { vendors: liveVendors }] = await Promise.all([getVendors(), getLiveVendors()]);

    // Unlike products, vendors have no separate "added" file -- vendors.json
    // already carries protected and non-protected records together (see
    // its own is_protected field), so this is a single, unfiltered
    // comparison.
    const vendorDiff = diffByKey(
      liveVendors,
      storedVendors,
      (v: DirectoryRecord) => v.vendor_directory_url,
      (v: DirectoryRecord) => v.product_name
    );
    sendListMessage(send, "vendors_not_stored", "The following vendors are not stored in your records", vendorDiff.notStored);
    sendListMessage(
      send,
      "vendors_not_retrieved",
      "The following vendors in your records were not retrieved from the site",
      vendorDiff.notRetrieved
    );
  }
}

export async function POST(req: Request): Promise<Response> {
  const blocked = assertLocalOnly();
  if (blocked) return blocked;

  const { target = "all" } = await req.json().catch(() => ({}));
  // scripts/scrape_ncademi_live.py's argparse only accepts
  // "all"/"products"/"vendors" (its output files are published-live.json/
  // vendors-live.json, not "published") -- the frontend's category is
  // "published", so that value is remapped here before it reaches argv, or
  // argparse rejects it and exits 2.
  const mappedTarget = target === "published" ? "products" : target;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };

      const child = spawn(PYTHON_BIN, [SCRIPT_PATH, "--target", mappedTarget], {
        cwd: REPO_ROOT,
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });

      const timeoutHandle = setTimeout(() => {
        child.kill("SIGKILL");
      }, SCRAPE_TIMEOUT_MS);

      // Line-buffered: a PROGRESS_JSON: line is not guaranteed to arrive in
      // one 'data' chunk, and one chunk can contain more than one line (the
      // ~100 per-URL human-readable prints are frequent and small) -- both
      // need reassembling/splitting on '\n' rather than treating each
      // 'data' event as exactly one line.
      let stdoutBuffer = "";
      let stderrTail = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBuffer += chunk.toString("utf8");
        let newlineIndex: number;
        while ((newlineIndex = stdoutBuffer.indexOf("\n")) !== -1) {
          const line = stdoutBuffer.slice(0, newlineIndex);
          stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
          if (!line.startsWith(PROGRESS_PREFIX)) continue; // ordinary human-readable log line
          try {
            const payload = JSON.parse(line.slice(PROGRESS_PREFIX.length));
            send("progress", payload);
          } catch {
            // Malformed progress line -- drop it rather than crash the
            // whole stream over one bad line.
          }
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderrTail = tail(stderrTail + chunk.toString("utf8"));
      });

      child.on("error", (err) => {
        clearTimeout(timeoutHandle);
        send("error", { error: err.message });
        close();
      });

      child.on("close", (code, signal) => {
        clearTimeout(timeoutHandle);
        if (code === 0) {
          sendPostRetrievalComparisons(mappedTarget, send)
            .catch(() => {
              // See sendPostRetrievalComparisons's own doc comment -- the
              // scrape itself still succeeded, so "done" still fires below.
            })
            .then(() => {
              send("done", { ok: true });
              close();
            });
        } else {
          send("error", {
            error: signal
              ? `Scrape timed out or was killed (signal ${signal}).`
              : `Scrape exited with code ${code}.`,
            stderr: stderrTail || undefined,
          });
          close();
        }
      });
    },
    cancel() {
      // Client disconnected before the scrape finished -- nothing to clean
      // up beyond letting the child process run to completion on its own;
      // it still writes published-live.json/vendors-live.json either way.
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
