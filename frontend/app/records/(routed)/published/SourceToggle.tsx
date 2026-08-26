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
 * widget markup in. The two data action buttons are stubbed (onClick shows
 * a placeholder alert): their real implementations (a POST to
 * /api/local/scrape with SSE progress streaming, for Retrieve Live Data)
 * lived in RecordsPublishedListPanel.tsx's handleRetrieveLiveData and its
 * messagesLog/isRetrievingLive state, none of which exists anymore.
 * Reimplementing that is a separate, larger change than this phase's UI
 * work.
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

import { useSearchParams, useRouter } from "next/navigation";

const PRIMARY_BUTTON_CLASSES =
  "rounded border border-transparent bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-500";
const SECONDARY_BUTTON_CLASSES =
  "rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500";

interface SourceToggleProps {
  hasLiveScrapeData: boolean;
  viewMode: "html" | "json";
  onViewModeChange: (mode: "html" | "json") => void;
}

export function SourceToggle({ hasLiveScrapeData, viewMode, onViewModeChange }: SourceToggleProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const source: "stored" | "live" = searchParams.get("source") === "live" ? "live" : "stored";

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
          onClick={() => alert("Stubbed")}
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Update Stored Data
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
          onClick={() => alert("Stubbed")}
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Retrieve Live Data
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
