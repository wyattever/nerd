// frontend/app/api/auth/session/route.ts
/**
 * Mints and clears the `__session` cookie.
 *
 * POST { idToken } -- called by app/login/page.tsx immediately after a
 * successful Firebase popup sign-in, replacing the client-side
 * `document.cookie = "__session=true"` line. The ID token travels in the
 * request body over TLS and is never persisted; what comes back is an
 * HttpOnly cookie the browser will attach to every subsequent request
 * without any client code participating.
 *
 * DELETE -- sign-out. Clears the cookie server-side. Note this does NOT
 * revoke the underlying Firebase refresh token; it ends this browser's
 * session only. Full revocation across devices is
 * auth.revokeRefreshTokens(uid), which is an admin action and deliberately
 * not wired to a self-serve button.
 *
 * This route is the one place in the app that must be reachable WITHOUT a
 * session -- that is what it is for -- so it carries no assertSession()
 * guard. Its own guard is mintSessionCookie(), which verifies the ID token
 * against Firebase and checks the email allowlist before issuing anything.
 *
 * Node runtime declared explicitly: firebase-admin cannot run on Edge.
 */

import { NextResponse } from "next/server";
import { mintSessionCookie, SESSION_COOKIE } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON." }, { status: 400 });
  }

  const idToken = (body as { idToken?: unknown } | null)?.idToken;
  if (typeof idToken !== "string" || idToken === "") {
    return NextResponse.json({ error: '"idToken" must be a non-empty string.' }, { status: 400 });
  }

  const minted = await mintSessionCookie(idToken);
  if (!minted) {
    // One response for both "token did not verify" and "email not on the
    // allowlist". A signed-in Google user who is not on the allowlist
    // should be told they lack access, but not which of the two checks
    // rejected them, and not whether the allowlist exists.
    return NextResponse.json(
      { error: "This account is not authorized for N.E.R.D." },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }

  const response = NextResponse.json(
    { ok: true, email: minted.email },
    { headers: { "Cache-Control": "no-store" } }
  );

  response.cookies.set({
    name: SESSION_COOKIE,
    value: minted.cookie,
    httpOnly: true,
    // Secure is unconditional in production and relaxed only when the
    // request itself arrived over plain HTTP, which on this app means
    // localhost. Keyed off the request rather than NODE_ENV: a production
    // build running locally for a demo would otherwise set a Secure cookie
    // over http:// that the browser silently discards, producing a
    // sign-in that appears to succeed and then immediately bounces back
    // to /login.
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(minted.expiresIn / 1000),
  });

  return response;
}

export async function DELETE(): Promise<Response> {
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set({ name: SESSION_COOKIE, value: "", path: "/", maxAge: 0 });
  return response;
}
