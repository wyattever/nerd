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
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { assertLocalOnly } from "@/lib/local-write";

export const runtime = "nodejs";

// process.cwd() for a Next.js route handler is frontend/ (matches
// lib/local-write.ts's pathFor) -- repo root is one level up.
const REPO_ROOT = path.join(process.cwd(), "..");
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
          send("done", { ok: true });
        } else {
          send("error", {
            error: signal
              ? `Scrape timed out or was killed (signal ${signal}).`
              : `Scrape exited with code ${code}.`,
            stderr: stderrTail || undefined,
          });
        }
        close();
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
