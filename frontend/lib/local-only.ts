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
export function isLocalOnlyAllowed(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_DISABLE_AUTH === "true";
}
