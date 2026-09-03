// frontend/lib/server/gcp-identity.ts
/**
 * Fetches a Google-signed OIDC identity token for calling another Cloud Run
 * service that is deployed --no-allow-unauthenticated.
 *
 * WHY THIS IS HAND-ROLLED RATHER THAN google-auth-library. The library
 * pulls in a substantial dependency tree for a capability that, in this
 * one narrow case, is a single HTTP GET against the instance metadata
 * server. The frontend deliberately carries very few runtime dependencies
 * (this migration adds exactly one, firebase-admin, and that one buys both
 * persistence and auth). Trading ~20 lines of well-documented code for
 * that tree is the right side of the line here. It would NOT be the right
 * side of the line for anything involving key material or signature
 * verification -- this code neither signs nor verifies anything; it asks
 * the platform for a token and forwards it.
 *
 * The endpoint is stable and documented: the metadata server is reachable
 * only from inside the instance, requires the Metadata-Flavor: Google
 * header (which defeats cross-origin browser requests), and returns a raw
 * JWT as text.
 *
 * OUTSIDE CLOUD RUN there is no metadata server and getIdentityToken()
 * returns null rather than throwing. The caller then sends no
 * Authorization header, which is correct for local development against a
 * Python service running unauthenticated on localhost. A missing token in
 * a deployed environment surfaces as a 403 from the callee -- a loud,
 * traceable failure -- rather than as a silent unauthenticated call, since
 * the callee is the thing enforcing.
 */

import "server-only";

const METADATA_HOST = "http://metadata.google.internal";
const IDENTITY_PATH = "/computeMetadata/v1/instance/service-accounts/default/identity";

/** Refresh this far before nominal expiry so a token is never used in the
 *  last moments of its life across a slow call. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

interface CachedToken {
  token: string;
  expiresAt: number;
}

const cache = new Map<string, CachedToken>();

function expiryOf(jwt: string): number | null {
  // Reads the `exp` claim without verifying the signature. Verification is
  // the receiving service's job, and this value is used only to decide when
  // to ask the metadata server for a fresh token -- a wrong value costs an
  // extra fetch or a 401 that triggers one, never a security decision.
  const payload = jwt.split(".")[1];
  if (!payload) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: unknown;
    };
    return typeof decoded.exp === "number" ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * An identity token whose `aud` claim is `audience` -- which for Cloud Run
 * must be the exact base URL of the service being called, with no trailing
 * path and no trailing slash.
 *
 * Returns null when no metadata server is reachable (local development).
 */
export async function getIdentityToken(audience: string): Promise<string | null> {
  const cached = cache.get(audience);
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
    return cached.token;
  }

  const url = `${METADATA_HOST}${IDENTITY_PATH}?audience=${encodeURIComponent(audience)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "Metadata-Flavor": "Google" },
      cache: "no-store",
      // Short timeout: off Google infrastructure this host does not resolve
      // and the fetch should fail fast rather than stalling a request.
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  const token = (await response.text()).trim();
  if (!token) return null;

  const exp = expiryOf(token);
  cache.set(audience, { token, expiresAt: exp ?? Date.now() + 30 * 60 * 1000 });
  return token;
}
