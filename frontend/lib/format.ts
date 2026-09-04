// frontend/lib/format.ts
/**
 * Shared client-safe formatting helpers. Unlike lib/server/*, this module
 * carries no "server-only" import -- it's imported directly by client
 * components (SourceToggle.tsx, records/page.tsx) as well as any future
 * Server Component that wants the same formatting.
 */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Formats an ISO-8601 UTC timestamp (e.g. a *-live.json document's
 * `$meta.last_scraped`) as MM-DD-YY HH:MM in the VIEWER'S LOCAL time zone,
 * 24-hour clock, no timezone label. Local time, not UTC -- the team is
 * single-timezone, and a scrape run at 4pm Mountain rendering as 22:00
 * would read as wrong (Decision #66).
 *
 * Returns null for null input or an unparseable string, so the caller
 * decides what to render instead of showing "Invalid Date".
 */
export function formatLocalTimestamp(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  const month = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const year = pad2(d.getFullYear() % 100);
  const hours = pad2(d.getHours());
  const minutes = pad2(d.getMinutes());

  return `${month}-${day}-${year} ${hours}:${minutes}`;
}
