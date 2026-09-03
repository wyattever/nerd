// frontend/lib/server/local-session.ts
/**
 * PHASE 2 PLACEHOLDER for the Route Handler auth gate.
 *
 * The persistence-tier route handlers were delivered calling
 * assertSession() from lib/server/session.ts -- a real Firebase session
 * cookie check that returns 401. That file is Phase 3 material and is not
 * installed yet: real auth does not exist in this phase, so shipping those
 * routes as-delivered would drop the only access control they have.
 *
 * This module keeps the delivered call sites unchanged in shape -- same
 * `const gate = await assertSession(); if ("response" in gate) return
 * gate.response;` guard, same `gate.user.email` actor -- while enforcing
 * the SAME local-only boundary the rest of the app already uses
 * (isLocalOnlyAllowed(): NODE_ENV plus NEXT_PUBLIC_DISABLE_AUTH, see
 * lib/local-only.ts). Blocked requests get the same bare 404 that
 * assertLocalOnly() returns in local-write.ts -- indistinguishable from a
 * route that does not exist.
 *
 * The actor is the constant string "local-dev": there is no signed-in user
 * to attribute a write to in this phase, and that value lands in the
 * `updated_by` / `replaced_by` audit fields (see lib/server/documents.ts).
 *
 * PHASE 3 removes this file. Each importer's
 * `from "@/lib/server/local-session"` becomes `from "@/lib/server/session"`
 * and the guard starts verifying a real session cookie with no other change
 * to the call sites.
 */

import "server-only";
import { isLocalOnlyAllowed } from "../local-only";

export interface SessionUser {
  email: string;
}

export type SessionGate = { response: Response } | { user: SessionUser };

export async function assertSession(): Promise<SessionGate> {
  if (!isLocalOnlyAllowed()) {
    return { response: new Response(null, { status: 404 }) };
  }
  return { user: { email: "local-dev" } };
}
