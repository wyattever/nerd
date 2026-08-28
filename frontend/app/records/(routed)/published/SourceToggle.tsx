// frontend/app/records/(routed)/published/SourceToggle.tsx
"use client";

/**
 * VIEWER widget for the published record view -- bordered panel with a
 * "VIEWER" header bar, holding the Stored/Live data-source toggle plus two
 * action buttons (Update Stored Data, Retrieve Live Data) on the left, and
 * the HTML/JSON view-mode toggle right-aligned on the same row (Phase
 * 4.9 -- previously a separate standalone button row above the viewer in
 * RecordsPublishedDetail.tsx, now folded into this one widget).
 *
 * This widget markup used to live in the now-deleted
 * RecordsPublishedListPanel.tsx (Phase 3 removed it in favor of
 * IntegratedListPanel), NOT in this file -- this file only ever rendered
 * the two bare Stored/Live buttons before Phase 4.5 moved the rest of the
 * widget markup in.
 *
 * "Update Stored Data" (enabled only while `hasLiveScrapeData`, the same
 * gate as "Live Data") POSTs `{ category }` to /api/local/promote-live,
 * which backs up the stored file, MERGES the live snapshot into it (live
 * records update their stored counterparts, stored-only records are kept --
 * see that route's header for why merge, not replace), and deletes the
 * snapshot. On success this leaves the live view (`router.replace("?")`)
 * and refreshes, so both it and "Live Data" fall back to disabled until the
 * next retrieve.
 *
 * "Retrieve Live Data" POSTs to /api/local/scrape with
 * `{ target: category }` and reads the SSE stream that route returns (see
 * that route's own header for the event framing), pushing each `progress`
 * event into IntegratedListPanel's shared `liveLog` state (via
 * useMessages()) rather than a placeholder alert -- restoring the log UI
 * RecordsPublishedListPanel.tsx's handleRetrieveLiveData used to render,
 * now hosted in the panel's persisting Messages footer instead of locally.
 * Once the stream ends (success or error), `router.refresh()` re-runs the
 * enclosing Server Component so `hasLiveScrapeData` (computed server-side
 * in page.tsx) picks up the file this run just wrote, without which "Live
 * Data" would stay disabled until a manual page reload.
 *
 * `isRetrievingLive` lives in IntegratedListPanel's MessagesContext, not as
 * local state here -- the Messages footer (not this component) is what
 * renders `liveLog`, and it needs to know whether a scrape is still running
 * to animate only the newest/in-progress row (globals.css's
 * ellipsis-animation) instead of every past row animating forever.
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

const PRIMARY_BUTTON_CLASSES =
  "rounded border border-transparent bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-500";
const SECONDARY_BUTTON_CLASSES =
  "rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500";

interface SourceToggleProps {
  category: "published" | "added" | "vendors";
  hasLiveScrapeData: boolean;
  viewMode: "html" | "json";
  onViewModeChange: (mode: "html" | "json") => void;
}

export function SourceToggle({ category, hasLiveScrapeData, viewMode, onViewModeChange }: SourceToggleProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const source: "stored" | "live" = searchParams.get("source") === "live" ? "live" : "stored";
  const { setLiveLog, focusMessages, isRetrievingLive, setIsRetrievingLive } = useMessages();
  const [isPromoting, setIsPromoting] = useState(false);

  async function handleUpdateStoredData() {
    const confirmed = window.confirm(
      `Merge the retrieved live ${category} data into stored ${category}.json?\n\n` +
        `Live records update their stored counterparts; stored records not in the live ` +
        `snapshot are kept. ${category}.json is backed up to ${category}.json.bak first, ` +
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
            `Merged live ${category} data into stored ${category}.json ` +
            `(${result.updated ?? 0} updated, ${result.keptFromStored ?? 0} kept, ${result.addedNew ?? 0} new; ` +
            `${result.total ?? 0} total). Backup saved to ${category}.json.bak; live data cleared.`,
        },
      ]);
      // The live snapshot is gone -- leave the live view so the refresh
      // below doesn't try to render a record from a file that no longer
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

  async function handleRetrieveLiveData() {
    focusMessages();
    setLiveLog([]);
    setIsRetrievingLive(true);
    try {
      const response = await fetch("/api/local/scrape", {
        method: "POST",
        body: JSON.stringify({ target: category }),
      });
      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      readLoop: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let separatorIndex: number;
        while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);

          let eventName = "message";
          let dataLine = "";
          for (const line of rawEvent.split("\n")) {
            if (line.startsWith("event: ")) eventName = line.slice("event: ".length);
            else if (line.startsWith("data: ")) dataLine = line.slice("data: ".length);
          }
          if (!dataLine) continue;

          if (eventName === "progress") {
            const payload = JSON.parse(dataLine) as { stage: string; message: string };
            setLiveLog((prev) => {
              const index = prev.findIndex((entry) => entry.stage === payload.stage);
              if (index === -1) return [...prev, payload];
              const next = [...prev];
              next[index] = payload;
              return next;
            });
          } else if (eventName === "error") {
            const payload = JSON.parse(dataLine) as { error: string };
            setLiveLog((prev) => [...prev, { stage: "error", message: payload.error }]);
            break readLoop;
          } else if (eventName === "done" || eventName === "end") {
            break readLoop;
          }
        }
      }
    } finally {
      setIsRetrievingLive(false);
      // Re-runs the Server Component tree for this route so the
      // `hasLiveScrapeData` prop (a fresh getLiveVendors()/
      // getPublishedLiveProducts() read in page.tsx) reflects the file this
      // run just wrote, un-disabling "Live Data" without a manual reload.
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
          disabled={!hasLiveScrapeData || isPromoting || isRetrievingLive}
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
        <button
          type="button"
          disabled={isRetrievingLive || isPromoting}
          onClick={handleRetrieveLiveData}
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isRetrievingLive ? "Retrieving..." : "Retrieve Live Data"}
        </button>

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
