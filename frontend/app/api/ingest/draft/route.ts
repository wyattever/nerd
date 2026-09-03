// frontend/app/api/ingest/draft/route.ts
/**
 * Server-side proxy to the Python service's POST /ingest/draft -- the
 * parse-and-validate step behind the "Import Data" modal, and after the
 * Generate Listing removal the ONLY thing the Python service still does for
 * the live application.
 *
 * WHAT THIS REPLACES. ImportDataModal.tsx previously called the Python
 * service directly from the browser:
 *
 *   fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/ingest/draft`, {
 *     headers: { Authorization: `Bearer ${await getIdToken()}` } })
 *
 * That shape is what forced almost every piece of cloud complexity this
 * migration removes. A browser-to-Python call means: a public,
 * --allow-unauthenticated Python service; CORS, and therefore the
 * FRONTEND_URL env var that deploy.sh has to patch back on after the
 * frontend URL resolves (finding F23's entire failure mode); Firebase token
 * verification duplicated into Python; and NEXT_PUBLIC_API_BASE_URL baked
 * into the JS bundle at build time, which is the specific misconfiguration
 * the 2026-08-27 live audit found still shipping in production.
 *
 * Routing the call server-side deletes all four at once. The browser talks
 * only to its own origin. The Python service can be deployed
 * --no-allow-unauthenticated and reached with an OIDC token from this
 * service's runtime service account, which is strictly more locked down
 * than a public endpoint checking a Firebase token. And the Python URL
 * becomes an ordinary runtime env var, changeable with --update-env-vars
 * and no rebuild.
 *
 * ImportDataModal.tsx's corresponding change is to drop getIdToken() and
 * the Authorization header and post to "/api/ingest/draft" -- a same-origin
 * relative URL, so nothing about the API host is compiled into the bundle
 * any more.
 *
 * Node runtime declared explicitly: the session check needs firebase-admin.
 */

import { NextResponse } from "next/server";
import { assertSession } from "@/lib/server/session";
import { getIdentityToken } from "@/lib/server/gcp-identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Base URL of the Python service, no trailing slash. Runtime env var, NOT
 *  NEXT_PUBLIC_ -- it is read on the server and must never be inlined into
 *  the client bundle. */
const PY_SERVICE_URL = process.env.NERD_PY_SERVICE_URL ?? "http://localhost:8080";

/**
 * The `aud` claim the Python service will require. For Cloud Run this is
 * the service's own base URL, and it is normally identical to
 * PY_SERVICE_URL -- kept separately overridable because they diverge behind
 * a custom domain or a load balancer, and a mismatched audience produces a
 * 403 whose cause is not obvious from either side.
 */
const PY_SERVICE_AUDIENCE = process.env.NERD_PY_SERVICE_AUDIENCE ?? PY_SERVICE_URL;

/**
 * Matches the 60s AbortController the modal already applies on its own
 * side, minus a small margin so this proxy times out FIRST. If the client
 * aborted first, the user would see a generic timeout while this request
 * kept running and its result was discarded -- the failure the modal's
 * message describes ("a linked site may be unreachable") is one this side
 * can actually report.
 */
const UPSTREAM_TIMEOUT_MS = 55_000;

export async function POST(request: Request): Promise<Response> {
  const gate = await assertSession();
  if ("response" in gate) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "Request body is not valid JSON." }, { status: 400 });
  }

  const draft = (body as { draft_markdown?: unknown } | null)?.draft_markdown;
  if (typeof draft !== "string" || draft.trim() === "") {
    return NextResponse.json(
      { detail: '"draft_markdown" must be a non-empty string.' },
      { status: 400 }
    );
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const identity = await getIdentityToken(PY_SERVICE_AUDIENCE);
  if (identity) headers.Authorization = `Bearer ${identity}`;

  let upstream: Response;
  try {
    upstream = await fetch(`${PY_SERVICE_URL}/ingest/draft`, {
      method: "POST",
      headers,
      body: JSON.stringify({ draft_markdown: draft }),
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    return NextResponse.json(
      {
        detail: timedOut
          ? "The draft parser did not respond in time. The draft may be very large, or a linked site may be unreachable."
          : "Could not reach the draft parser service.",
      },
      { status: 504, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Pass the upstream body and status through unchanged. FastAPI already
  // returns `{ detail: ... }` for its 422/502 cases, which is exactly the
  // shape ImportDataModal.tsx reads, so no translation layer is needed or
  // wanted -- one would only be a place for the two error vocabularies to
  // drift apart.
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
