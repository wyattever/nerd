// frontend/app/api/local/candidate-import/route.ts
/**
 * Bulk Candidate import. POST { mode, text, selected?, tokens? } previews or
 * applies one paste of research results. Both modes read the five documents
 * (candidate, tracking, passwords, added, published) in ONE
 * transactDocuments transaction; apply writes only when every version token
 * still matches, otherwise it returns a fresh preview with a conflict notice.
 *
 * Every decision lives in lib/server/candidate-import.ts; this handler only
 * authenticates, parses, runs the transaction and responds.
 */

import { assertSession } from "@/lib/server/session";
import { transactDocuments, DocumentTooLargeError } from "@/lib/server/documents";
import {
  IMPORT_KEYS,
  decideCandidateImport,
  parseCandidateImportRequest,
  type CandidateImportResponseBody,
} from "@/lib/server/candidate-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
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

  const parsed = parseCandidateImportRequest(body);
  if (!parsed.ok) {
    return jsonResponse({ error: parsed.error }, 400);
  }
  const importRequest = parsed.request;

  // Read once, outside decide: a retried transaction must use the same time.
  const now = new Date();

  let outcome: { status: number; body: CandidateImportResponseBody };
  try {
    outcome = await transactDocuments({
      keys: IMPORT_KEYS,
      actor: gate.user.email,
      decide: (docs) => {
        const d = decideCandidateImport(importRequest, docs, now);
        return { writes: d.writes, deletes: [], result: { status: d.status, body: d.body } };
      },
    });
  } catch (err) {
    if (err instanceof DocumentTooLargeError) {
      return jsonResponse({ error: err.message }, 413);
    }
    throw err;
  }

  return jsonResponse(outcome.body, outcome.status);
}
