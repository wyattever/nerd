// frontend/lib/server/session.ts
/**
 * Real server-side authentication, replacing two things at once: the
 * unsigned `document.cookie = "__session=true"` flag set client-side in
 * app/login/page.tsx (settable by anyone from devtools) and the
 * isLocalOnlyAllowed() gate that kept the whole editor suite 404'd in
 * production because there was nothing better to gate it with.
 *
 * ---------------------------------------------------------------------------
 * WHERE ENFORCEMENT ACTUALLY HAPPENS -- READ THIS BEFORE CHANGING proxy.ts
 * ---------------------------------------------------------------------------
 * Next's proxy (middleware) runs on the Edge runtime. firebase-admin cannot
 * run there: no Node crypto, no gRPC. So proxy.ts CANNOT verify a session
 * cookie -- it can only observe that one is present. Any design that treats
 * the proxy as the security boundary is therefore relying on a check that
 * does not exist, which is precisely the flaw in the cookie it replaces.
 *
 * The boundary is here instead, in the Node runtime, co-located with the
 * data access it protects:
 *
 *   - Route Handlers call assertSession() and return its 401 when blocked.
 *   - Server Components call requireSessionUser(), which redirects to
 *     /login.
 *   - proxy.ts keeps a presence-only check, documented there as UX
 *     (redirect an obviously-signed-out visitor straight to /login rather
 *     than into a page that will 401 its own data fetch). It is not, and
 *     must not be described as, a security control.
 *
 * ---------------------------------------------------------------------------
 * WHY A SESSION COOKIE RATHER THAN A BEARER TOKEN
 * ---------------------------------------------------------------------------
 * Firebase ID tokens live in client memory and expire hourly, which is why
 * the old design needed getIdToken() at every call site and an Authorization
 * header on every request. Server Components cannot read client memory, so
 * that pattern cannot cover the editor's server-rendered read path at all.
 * A session cookie minted by firebase-admin is HttpOnly (invisible to
 * script, so XSS cannot exfiltrate it), sent automatically on both fetches
 * and navigations, and verifiable server-side without a network round trip.
 *
 * The cookie is named `__session` -- unchanged from the flag it replaces, so
 * nothing else has to move, and it is also the one cookie name Firebase
 * Hosting's CDN will forward to a backend, which keeps that deployment
 * option open at no cost.
 *
 * ---------------------------------------------------------------------------
 * ALLOWLIST
 * ---------------------------------------------------------------------------
 * NERD_ALLOWED_EMAILS is a comma-separated list, checked at BOTH ends: when
 * the session is minted, and again on every request that verifies it.
 * Re-checking on every request is what makes removing someone take effect
 * immediately rather than whenever their session happens to expire -- worth
 * the string comparison. Comparison is case-insensitive and trimmed;
 * Google account emails are not case-sensitive and a stray space in an env
 * var should not lock someone out.
 *
 * An empty or unset allowlist DENIES EVERYONE. Fail closed: the alternative
 * (empty means allow all) turns a typo'd deploy into an open instance.
 *
 * checkRevoked is false on the verify path. Passing true costs a network
 * round trip to the Firebase Auth backend on every single request, to catch
 * a case -- token revoked mid-session -- that for three named internal
 * accounts is already covered by the per-request allowlist check plus the
 * session lifetime. Judgment call, flagged rather than buried; if the user
 * set ever grows past a handful of trusted people, revisit it.
 */

import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminAuth } from "./firebase-admin";

export const SESSION_COOKIE = "__session";

/** 8 hours. Long enough for a working day without a re-login, short enough
 *  that an abandoned session on a shared machine is not a standing grant.
 *  Firebase permits 5 minutes to 14 days. */
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export interface SessionUser {
  uid: string;
  email: string;
}

function allowlist(): Set<string> {
  const raw = process.env.NERD_ALLOWED_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isAllowed(email: string | undefined | null): boolean {
  if (!email) return false;
  const allowed = allowlist();
  if (allowed.size === 0) return false; // fail closed -- see module header
  return allowed.has(email.trim().toLowerCase());
}

/**
 * The single underlying condition, in the same spirit as the
 * isLocalOnlyAllowed() it replaces: a plain value, not a Response and not a
 * throw, so both call-site shapes below can build their own enforcement on
 * top of one implementation rather than each restating it.
 *
 * Returns null for every failure mode -- no cookie, malformed cookie,
 * expired cookie, valid cookie for a de-allowlisted account. Callers do not
 * get to distinguish these, and neither does the client: an attacker
 * probing with a forged cookie learns nothing from the response about why
 * it failed.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const cookie = store.get(SESSION_COOKIE)?.value;
  if (!cookie) return null;

  try {
    const decoded = await adminAuth().verifySessionCookie(cookie, false);
    const email = typeof decoded.email === "string" ? decoded.email : null;
    if (!isAllowed(email)) return null;
    return { uid: decoded.uid, email: email as string };
  } catch {
    return null;
  }
}

export function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "Not authenticated." }), {
    status: 401,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * Route Handler guard. Mirrors assertLocalOnly()'s call shape exactly, so
 * the ported handlers keep the same two-line preamble they already have:
 *
 *   const gate = await assertSession();
 *   if ("response" in gate) return gate.response;
 *
 * Returns 401, not 404. The old gate returned 404 to hide the route's
 * existence in an environment where it was never meant to be reachable;
 * these routes are now a deployed, intended part of the app, and 401 is the
 * honest and correct answer for a client that simply needs to sign in.
 */
export async function assertSession(): Promise<{ user: SessionUser } | { response: Response }> {
  const user = await getSessionUser();
  if (!user) return { response: unauthorized() };
  return { user };
}

/** Server Component guard. Redirects to /login rather than throwing
 *  notFound() -- the page exists and the visitor is one sign-in away from
 *  it, which is what the redirect says and what a 404 would not. */
export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Exchanges a freshly-minted Firebase ID token for a session cookie.
 * Called only by app/api/auth/session/route.ts.
 *
 * checkRevoked is TRUE here. This is the one place the extra round trip is
 * worth paying for: it happens once per sign-in, not once per request, and
 * it is the moment at which a revoked or disabled account should be caught.
 */
export async function mintSessionCookie(
  idToken: string
): Promise<{ cookie: string; email: string; expiresIn: number } | null> {
  const auth = adminAuth();

  let email: string | null;
  try {
    const decoded = await auth.verifyIdToken(idToken, true);
    email = typeof decoded.email === "string" ? decoded.email : null;
  } catch {
    return null;
  }

  if (!isAllowed(email)) return null;

  const cookie = await auth.createSessionCookie(idToken, { expiresIn: SESSION_TTL_MS });
  return { cookie, email: email as string, expiresIn: SESSION_TTL_MS };
}
