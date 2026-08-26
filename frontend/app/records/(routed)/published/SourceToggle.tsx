// frontend/app/records/(routed)/published/SourceToggle.tsx
"use client";

/**
 * Stored/Live data-source toggle, reading and writing `?source=live` via
 * useSearchParams()/router.replace() -- see docs/
 * UI_ROUTING_MIGRATION_IMPLEMENTATION_GUIDE_v2.md Phase 5. Deliberately its
 * own small component, not inlined into RecordsPublishedListPanel.tsx:
 * Next.js requires a <Suspense> boundary around any useSearchParams() call
 * site specifically (a hard build-time "Missing Suspense boundary" error,
 * independent of whether the surrounding page is otherwise static) --
 * keeping the hook call isolated here means the Suspense fallback only
 * ever covers these two buttons, not the whole list panel.
 *
 * `router.replace`, never `push` -- a display toggle shouldn't add history
 * entries. Relative "?"-only hrefs (`?source=live`, `?`) resolve against
 * the current pathname on their own, so this needs no usePathname() call.
 * `scroll: false` for consistency with every other intra-shell navigation
 * in this app (see EditorNavSidebar.tsx).
 *
 * This component owns the URL, not the fetch -- it doesn't know how to
 * load live data, only how to ask for it. RecordsPublishedListPanel.tsx
 * (the parent) is told the resolved source via onSourceChange and reacts
 * to it (including on first mount / a direct deep-link to ?source=live,
 * not just a click here) by fetching /api/local/published-live itself.
 */

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect } from "react";

interface SourceToggleProps {
  hasLiveScrapeData: boolean;
  isLoadingLive: boolean;
  onSourceChange: (source: "stored" | "live") => void;
}

export function SourceToggle({ hasLiveScrapeData, isLoadingLive, onSourceChange }: SourceToggleProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const source: "stored" | "live" = searchParams.get("source") === "live" ? "live" : "stored";

  useEffect(() => {
    onSourceChange(source);
  }, [source, onSourceChange]);

  return (
    <>
      <button
        type="button"
        onClick={() => router.replace("?", { scroll: false })}
        className={`rounded border px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 ${source === "stored" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}
      >
        Stored Data
      </button>
      <button
        type="button"
        disabled={!hasLiveScrapeData || isLoadingLive}
        onClick={() => router.replace("?source=live", { scroll: false })}
        className={`rounded border px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${source === "live" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}
      >
        {isLoadingLive ? "Loading…" : "Live Data"}
      </button>
    </>
  );
}
