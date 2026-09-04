// frontend/app/records/(routed)/published/SourceToggle.tsx
"use client";

/**
 * VIEWER widget for the published record view -- bordered panel with a
 * "VIEWER" header bar, holding the Stored/Live data-source toggle and the
 * "Update Stored Data" action on the left, and the HTML/JSON view-mode
 * toggle right-aligned on the same row (Phase 4.9 -- previously a separate
 * standalone button row above the viewer in RecordsPublishedDetail.tsx, now
 * folded into this one widget).
 *
 * This widget markup used to live in the now-deleted
 * RecordsPublishedListPanel.tsx (Phase 3 removed it in favor of
 * IntegratedListPanel), NOT in this file -- this file only ever rendered
 * the two bare Stored/Live buttons before Phase 4.5 moved the rest of the
 * widget markup in.
 *
 * There is no "Retrieve Live Data" button here any more. The scrape runs
 * locally, from a terminal (DECISION_LOG.md #66), so this component only
 * consumes live snapshots something else produced -- it never starts one.
 *
 * "Update Stored Data" (enabled only while `hasLiveScrapeData`, the same
 * gate as "Live Data") confirms first, then POSTs `{ category }` to
 * /api/local/promote-live, which backs up the stored document, MERGES the
 * live snapshot into it (live records update their stored counterparts,
 * stored-only records are kept -- see that route's header for why merge,
 * not replace), and deletes the snapshot. On success this leaves the live
 * view (`router.replace("?")`); either way `router.refresh()` runs in the
 * finally block, so both it and "Live Data" fall back to disabled once the
 * snapshot is gone.
 *
 * Its outcome -- one `promote` entry, or one `promote-error` entry -- is
 * pushed into IntegratedListPanel's shared `liveLog` via useMessages(),
 * because the Messages footer (not this component) is what renders that
 * log. Those two are now `liveLog`'s only writer, and they are the only
 * user-visible confirmation that "Update Stored Data" did anything.
 * focusMessages() moves focus there first, so the result is not announced
 * somewhere the user is not looking.
 *
 * `hasLiveScrapeData` is a prop, computed server-side in page.tsx. With no
 * in-app trigger left, nothing flips it mid-session: a scrape run in a
 * terminal is picked up only on the next load or refresh of this route.
 *
 * useSearchParams()/router.replace() for the Stored/Live toggle itself --
 * see git history (or an earlier revision of this file) for the full
 * rationale on why this needs its own <Suspense> boundary at the call
 * site, and why `router.replace` (never `push`) with `scroll: false`.
 * viewMode/onViewModeChange are plain controlled props, owned by
 * RecordsPublishedDetail.tsx (the record content they switch lives there,
 * not here) -- this component only renders the two buttons and reports
 * clicks upward.
 */

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useMessages } from "@/components/IntegratedListPanel";
import { formatLocalTimestamp } from "@/lib/format";

const PRIMARY_BUTTON_CLASSES =
  "rounded border border-transparent bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-500";
const SECONDARY_BUTTON_CLASSES =
  "rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500";

interface SourceToggleProps {
  category: "published" | "added" | "vendors";
  hasLiveScrapeData: boolean;
  lastScraped: string | null;
  viewMode: "html" | "json";
  onViewModeChange: (mode: "html" | "json") => void;
}

export function SourceToggle({ category, hasLiveScrapeData, lastScraped, viewMode, onViewModeChange }: SourceToggleProps) {
  const formattedLastScraped = formatLocalTimestamp(lastScraped);
  const searchParams = useSearchParams();
  const router = useRouter();
  const source: "stored" | "live" = searchParams.get("source") === "live" ? "live" : "stored";
  const { setLiveLog, focusMessages } = useMessages();
  const [isPromoting, setIsPromoting] = useState(false);

  async function handleUpdateStoredData() {
    const confirmed = window.confirm(
      `Merge the retrieved live ${category} data into your stored ${category} records?\n\n` +
        `Live records update their stored counterparts; stored records not in the live ` +
        `snapshot are kept. The previous stored version is saved as a backup first, ` +
        `then the live snapshot is cleared.`
    );
    if (!confirmed) return;

    focusMessages();
    setIsPromoting(true);
    try {
      const response = await fetch("/api/local/promote-live", {
        method: "POST",
        body: JSON.stringify({ category }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        updated?: number;
        keptFromStored?: number;
        addedNew?: number;
        addedProducts?: string[];
        total?: number;
        error?: string;
      };

      if (!response.ok) {
        setLiveLog((prev) => [
          ...prev,
          {
            stage: "promote-error",
            message: `Update Stored Data failed: ${result.error ?? `server responded ${response.status}`}.`,
          },
        ]);
        return;
      }

      setLiveLog((prev) => [
        ...prev,
        {
          stage: "promote",
          message:
            `Merged live ${category} data into your stored ${category} records ` +
            `(${result.updated ?? 0} updated, ${result.keptFromStored ?? 0} kept, ${result.addedNew ?? 0} new; ` +
            `${result.total ?? 0} total). Previous version backed up; live snapshot cleared.`,
        },
      ]);
      // Separate entry (distinct `stage`, since LiveLogEntry.stage doubles as
      // this list's React key) so the count summary above and the name list
      // read as two distinct lines, not one runon. Only pushed when there's
      // something to say -- no "no new products" noise line.
      if (result.addedProducts && result.addedProducts.length > 0) {
        setLiveLog((prev) => [
          ...prev,
          {
            stage: "promote-added",
            message: `New records created for the following products: ${result.addedProducts!.join(", ")}.`,
          },
        ]);
      }
      // The live snapshot is gone -- leave the live view so the refresh
      // below doesn't try to render a record from a document that no longer
      // exists.
      router.replace("?", { scroll: false });
    } finally {
      setIsPromoting(false);
      // Re-run the Server Component tree so `hasLiveScrapeData` reflects the
      // now-deleted snapshot (disabling "Live Data" and this button) and the
      // Stored view shows the just-promoted records.
      router.refresh();
    }
  }

  return (
    <div className="w-full rounded-md border border-gray-300 bg-white">
      <div className="flex items-center rounded-t-md bg-gray-50 px-4 py-2.5 text-xs font-bold uppercase text-gray-500 border-b border-gray-300">
        Viewer
      </div>
      <div className="flex flex-wrap items-center gap-3 p-4">
        <button
          type="button"
          onClick={() => router.replace("?", { scroll: false })}
          className={`rounded border px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 ${source === "stored" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}
        >
          Stored Data
        </button>
        <button
          type="button"
          disabled={!hasLiveScrapeData || isPromoting}
          onClick={handleUpdateStoredData}
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPromoting ? "Updating..." : "Update Stored Data"}
        </button>
        <button
          type="button"
          disabled={!hasLiveScrapeData}
          onClick={() => router.replace("?source=live", { scroll: false })}
          className={`rounded border px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${source === "live" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}
        >
          Live Data
        </button>
        {formattedLastScraped && (
          <span className="text-base" style={{ color: "#333" }}>Last update: {formattedLastScraped}</span>
        )}

        <div className="ml-auto flex gap-3">
          <button
            type="button"
            onClick={() => onViewModeChange("html")}
            className={viewMode === "html" ? PRIMARY_BUTTON_CLASSES : SECONDARY_BUTTON_CLASSES}
          >
            HTML
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange("json")}
            className={viewMode === "json" ? PRIMARY_BUTTON_CLASSES : SECONDARY_BUTTON_CLASSES}
          >
            JSON
          </button>
        </div>
      </div>
    </div>
  );
}
