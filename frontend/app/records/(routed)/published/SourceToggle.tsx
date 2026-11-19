// frontend/app/records/(routed)/published/SourceToggle.tsx
"use client";

/**
 * VIEWER widget for the /records record views: the Stored/Live data-source
 * toggle, "Update Stored Data", and the HTML/JSON view-mode toggle.
 *
 * "Update Stored Data" opens the D9 confirmation modal (PromoteConfirmModal),
 * which previews and applies the mirror promote and reports how it closed.
 * This component then writes the Messages lines (D49), moves focus (D51),
 * and after an apply navigates away from a deleted record or refreshes (D52).
 *
 * Two gates (D53): "Update Stored Data" is enabled whenever the category's
 * live snapshot document exists, even with zero records; "Live Data" only
 * when the snapshot has records. Both come from page.tsx's server-side read.
 */

import { useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useMessages } from "@/components/IntegratedListPanel";
import { PromoteConfirmModal } from "@/components/PromoteConfirmModal";
import { formatLocalTimestamp } from "@/lib/format";
import { messageLines, removedContainsUrl, type PromoteModalResult } from "@/lib/promote-ui";

const PRIMARY_BUTTON_CLASSES =
  "rounded border border-transparent bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-blue-700";
const SECONDARY_BUTTON_CLASSES =
  "rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500";

/** Stage names for the Messages panel; the panel assigns the keys (D50). */
const RESULT_STAGE: Record<PromoteModalResult["kind"], string> = {
  applied: "promote-applied",
  cancelled: "promote-cancelled",
  failed: "promote-failed",
  unknown: "promote-unknown",
};

/** What to do once the dialog has closed and React has committed. */
type AfterClose = {
  focus: "button" | "messages";
  navigateTo: string | null;
  refresh: boolean;
};

interface SourceToggleProps {
  category: "published" | "added" | "vendors";
  hasLiveScrapeData: boolean;
  liveSnapshotExists: boolean;
  /** The open record's own URL (ncademi_product_url or vendor_directory_url), for D52. */
  recordUrl: string | null;
  lastScraped: string | null;
  viewMode: "html" | "json";
  onViewModeChange: (mode: "html" | "json") => void;
}

export function SourceToggle({
  category,
  hasLiveScrapeData,
  liveSnapshotExists,
  recordUrl,
  lastScraped,
  viewMode,
  onViewModeChange,
}: SourceToggleProps) {
  const formattedLastScraped = formatLocalTimestamp(lastScraped);
  const searchParams = useSearchParams();
  const router = useRouter();
  const source: "stored" | "live" = searchParams.get("source") === "live" ? "live" : "stored";
  const { appendLog, focusMessages } = useMessages();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const updateButtonRef = useRef<HTMLButtonElement>(null);
  const afterCloseRef = useRef<AfterClose | null>(null);

  // D51/D52, deferred until the modal has unmounted: the native <dialog>
  // restores focus to "Update Stored Data" as it closes, so focus moved any
  // earlier would be overridden. This effect runs after the commit that
  // removes the modal.
  useEffect(() => {
    if (isModalOpen) return;
    const pending = afterCloseRef.current;
    if (pending === null) return;
    afterCloseRef.current = null;

    const button = updateButtonRef.current;
    if (pending.focus === "button" && button && !button.disabled) button.focus();
    else focusMessages();

    if (pending.navigateTo === "?") router.replace("?", { scroll: false });
    else if (pending.navigateTo !== null) router.replace(pending.navigateTo);
    if (pending.refresh) router.refresh();
  }, [isModalOpen, focusMessages, router]);

  function handleClosed(result: PromoteModalResult) {
    const formattedRunTime =
      result.kind === "applied" ? formatLocalTimestamp(result.body.runFinishedAt) : null;
    for (const line of messageLines(result, category, formattedRunTime)) {
      appendLog(RESULT_STAGE[result.kind], line);
    }

    switch (result.kind) {
      case "applied":
        // D52: leave a deleted record for the category index, which redirects
        // to the first remaining record; otherwise leave the live view.
        afterCloseRef.current = {
          focus: "messages",
          navigateTo: removedContainsUrl(result.body, recordUrl) ? `/records/${category}` : "?",
          refresh: true,
        };
        break;
      case "cancelled":
      case "failed":
        afterCloseRef.current = { focus: "button", navigateTo: null, refresh: false };
        break;
      case "unknown":
        // Refresh so the button gate shows whether the apply landed (D54).
        afterCloseRef.current = { focus: "messages", navigateTo: null, refresh: true };
        break;
    }
    setIsModalOpen(false);
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
          ref={updateButtonRef}
          type="button"
          disabled={!liveSnapshotExists}
          onClick={() => setIsModalOpen(true)}
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
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

      {isModalOpen && <PromoteConfirmModal category={category} onClosed={handleClosed} />}
    </div>
  );
}
