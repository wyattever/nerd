// frontend/app/records/(routed)/vendors/[slug]/RecordsVendorDetail.tsx
"use client";

/**
 * Read-only Tracking fieldset + preview for one vendor record -- see
 * frontend/app/records/(routed)/candidates/RecordsCandidateDetail.tsx for
 * the shared rationale (root wrapper classes, disabled tracking selects).
 * Unlike the candidates/added/published Detail components (which hand-roll
 * their own <article> markup for the HTML view), the HTML branch here
 * reuses DirectoryPreview.tsx directly -- the same themed iframe preview
 * VendorEditor.tsx already renders -- since that's the vendor schema's
 * existing preview builder; duplicating its markup by hand here would
 * just drift out of sync with it.
 *
 * SourceToggle (imported from ../../published/SourceToggle.tsx) is reused
 * wholesale for the HTML/JSON toggle rather than split into a smaller
 * component: it also renders the Stored/Live "Data" controls.
 * `hasLiveScrapeData` (from page.tsx's getLiveVendors() read) now drives
 * "Live Data" the same way it does for published records, and
 * `category="vendors"` scopes "Retrieve Live Data" to a
 * `{ target: "vendors" }` scrape. "Stored Data" and the two (one still
 * stubbed) action buttons still render since SourceToggle has no prop to
 * hide them.
 */

import { Suspense, useState } from "react";
import type { DirectoryRecord } from "@/lib/directory-schema";
import { DirectoryPreview } from "@/components/DirectoryPreview";
import { SourceToggle } from "../../published/SourceToggle";

interface RecordsVendorDetailProps {
  record: DirectoryRecord;
  hasLiveScrapeData: boolean;
}

export function RecordsVendorDetail({ record, hasLiveScrapeData }: RecordsVendorDetailProps) {
  const [viewMode, setViewMode] = useState<"html" | "json">("html");

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex items-end justify-between">
        <h1 className="text-2xl font-bold text-gray-900 whitespace-nowrap shrink-0">Vendor Records</h1>
      </header>

      <div className="w-full rounded-md border border-gray-300 bg-white mb-2">
        <div className="flex items-center rounded-t-md bg-gray-50 px-4 py-2.5 text-xs font-bold uppercase text-gray-500 border-b border-gray-300">Tracking</div>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <label className="flex flex-col items-start gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Status
            <select
              value={record.tracking_status ?? ""}
              disabled
              className="rounded border border-gray-300 bg-gray-50 px-2 py-1.5 text-sm font-medium text-gray-700 cursor-not-allowed opacity-75 focus:outline-none"
            >
              <option value="">set status</option>
              <option value="ready for site">ready for site</option>
              <option value="published to site">published to site</option>
            </select>
          </label>
        </div>
      </div>

      <Suspense fallback={<div className="h-[74px] w-full animate-pulse rounded-md border border-gray-300 bg-gray-100" />}>
        <SourceToggle category="vendors" hasLiveScrapeData={hasLiveScrapeData} viewMode={viewMode} onViewModeChange={setViewMode} />
      </Suspense>

      <section aria-label="Visual preview" className="rounded border border-gray-200 bg-gray-50 p-4 w-full min-w-0">
        {viewMode === "json" ? (
          <pre className="bg-gray-50 p-4 rounded-md overflow-x-auto text-sm w-full max-w-full whitespace-pre-wrap break-words">
            <code>{JSON.stringify(record, null, 2)}</code>
          </pre>
        ) : (
          <div className="rounded-md border border-gray-200 bg-white p-6 shadow-sm">
            <DirectoryPreview record={record} />
          </div>
        )}
      </section>
    </div>
  );
}
