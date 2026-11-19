// frontend/app/api/local/promote-live/route.ts
/**
 * "Update Stored Data": the mirror promote (docs/mirror-promote-plan-11-02-26.md
 * §3.12–3.13). POST { category, mode, tokens } previews or applies one
 * category. Both modes read the seven documents of D30 in ONE
 * transactDocuments transaction (D8); apply writes only when every version
 * token still matches (D17, D32), otherwise it returns a fresh preview.
 *
 * Every decision lives in lib/server/promote-mirror.ts (D41); this handler
 * only authenticates, parses, runs the transaction and responds. The D13
 * Added guard is gone, and untracked protected pages no longer get
 * auto-created records or passwords (D34).
 *
 * SourceToggle's "Update Stored Data" still sends { category } with no mode,
 * so it gets a 400 on this branch until step 6 (D37).
 */

import { assertSession } from "@/lib/server/session";
import { transactDocuments, DocumentTooLargeError } from "@/lib/server/documents";
import {
  decidePromote,
  parsePromoteRequest,
  promoteDocumentKeys,
  type PromoteResponseBody,
} from "@/lib/server/promote-mirror";

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

  const parsed = parsePromoteRequest(body);
  if (!parsed.ok) {
    return jsonResponse({ error: parsed.error }, 400);
  }
  const promoteRequest = parsed.request;

  let outcome: { status: number; body: PromoteResponseBody };
  try {
    outcome = await transactDocuments({
      keys: promoteDocumentKeys(promoteRequest.category),
      actor: gate.user.email,
      decide: (docs) => {
        const d = decidePromote(promoteRequest, docs);
        return { writes: d.writes, deletes: d.deletes, result: { status: d.status, body: d.body } };
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
