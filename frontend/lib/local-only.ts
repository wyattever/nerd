// frontend/lib/local-only.ts
/**
 * Single source of truth for the DECISION_LOG #6 local-only boundary: two
 * conditions, both required, mirroring the original assertLocalOnly() check
 * this was extracted from (see local-write.ts). Kept as a plain boolean --
 * not a Response, not a throw -- so both call-site shapes (the Route
 * Handlers' `Response | null` wrapper in local-write.ts, and local-data.ts's
 * `notFound()`-throwing wrapper for Server Components) can build their own
 * enforcement on top of the same underlying condition instead of each
 * re-stating it.
 */
/**
 * NERD_CLOUD_DEMO_LOCAL_WRITE is a server-only escape valve (never
 * NEXT_PUBLIC_, never present in any Dockerfile/cloudbuild.yaml/deploy
 * config) that widens only the NODE_ENV half of this check. It's set
 * exclusively by nerd_cloud.sh on a developer's own machine, to let a
 * production build's local-write routes work during a tunneled demo
 * session. NEXT_PUBLIC_DISABLE_AUTH === "true" remains required in all
 * cases -- this addition does not weaken that half of the check.
 */
export function isLocalOnlyAllowed(): boolean {
  const isDevLike =
    process.env.NODE_ENV !== "production" ||
    process.env.NERD_CLOUD_DEMO_LOCAL_WRITE === "true";
  return isDevLike && process.env.NEXT_PUBLIC_DISABLE_AUTH === "true";
}
