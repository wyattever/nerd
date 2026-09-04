// frontend/app/records/(routed)/added/RecordsAddedDetail.tsx
"use client";

/**
 * Read-only Tracking fieldset (Priority + Status only) + full-schema
 * article for one added record -- see
 * frontend/app/records/(routed)/candidates/RecordsCandidateDetail.tsx for
 * the shared rationale, including the HTML/JSON viewer toggle (Phase 4.6).
 *
 * SourceToggle (imported from ../published/SourceToggle.tsx, same as
 * RecordsVendorDetail.tsx does) replaces this file's own standalone
 * HTML/JSON button row -- adds the Stored/Live data-source toggle plus
 * "Update Stored Data"/"Retrieve Live Data". `category="added"` drives a
 * `{ target: "added" }` scrape, which unlocks each password-protected
 * product page and writes full detail to added-live.json; the ?source=live
 * view reads that file (see [slug]/page.tsx's own header).
 */

import { Suspense, useState } from "react";
import type { PublishedProductRecord } from "@/lib/published-tables";
import { SourceToggle } from "../published/SourceToggle";

interface RecordsAddedDetailProps {
  record: PublishedProductRecord;
  hasLiveScrapeData: boolean;
  lastScraped: string | null;
}

export function RecordsAddedDetail({ record, hasLiveScrapeData, lastScraped }: RecordsAddedDetailProps) {
  const [viewMode, setViewMode] = useState<"html" | "json">("html");

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex items-end justify-between">
        <h1 className="text-2xl font-bold text-gray-900 whitespace-nowrap shrink-0">Added Product Records</h1>
      </header>

      <div className="w-full rounded-md border border-gray-300 bg-white mb-2">
        <div className="flex items-center rounded-t-md bg-gray-50 px-4 py-2.5 text-xs font-bold uppercase text-gray-500 border-b border-gray-300">Tracking</div>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <label className="flex flex-col items-start gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Priority
            <select value={record.tracking_priority ?? ""} disabled className="rounded border border-gray-300 bg-gray-50 px-2 py-1.5 text-sm font-medium text-gray-700 cursor-not-allowed opacity-75 focus:outline-none">
              <option value="">set priority</option>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
          </label>

          <label className="flex flex-col items-start gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Status
            <select value={record.tracking_status ?? ""} disabled className="rounded border border-gray-300 bg-gray-50 px-2 py-1.5 text-sm font-medium text-gray-700 cursor-not-allowed opacity-75 focus:outline-none">
              <option value="">set status</option>
              <option value="contacted vendor">contacted vendor</option>
              <option value="replied back to vendor">replied back to vendor</option>
            </select>
          </label>
        </div>
      </div>

      <Suspense fallback={<div className="h-[74px] w-full animate-pulse rounded-md border border-gray-300 bg-gray-100" />}>
        <SourceToggle category="added" hasLiveScrapeData={hasLiveScrapeData} lastScraped={lastScraped} viewMode={viewMode} onViewModeChange={setViewMode} />
      </Suspense>

      <section aria-label="Visual preview" className="rounded border border-gray-200 bg-gray-50 p-4 w-full min-w-0">
        {viewMode === "json" ? (
          <pre className="bg-gray-50 p-4 rounded-md overflow-x-auto text-sm w-full max-w-full whitespace-pre-wrap break-words">
            <code>{JSON.stringify(record, null, 2)}</code>
          </pre>
        ) : (
        <article className="w-full bg-white shadow-sm border border-gray-200 rounded-lg p-8">
          <header className="mb-8 border-b border-gray-200 pb-6">
            <h2 className="text-3xl font-bold text-gray-900 mb-2">{record.product_name || "Unnamed Product"}</h2>
            {record.product_description && (
              <p className="text-gray-700 leading-relaxed text-lg">{record.product_description}</p>
            )}
          </header>

          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-8">
            <div className="col-span-1 md:col-span-2 bg-gray-50 p-4 rounded-md border border-gray-100">
              <dt className="text-xs font-bold text-gray-500 uppercase tracking-widest">NCADEMI URL</dt>
              <dd className="mt-1 text-sm text-blue-600 break-all">
                <a href={record.ncademi_product_url} target="_blank" rel="noopener noreferrer" className="hover:underline font-mono">
                  {record.ncademi_product_url}
                </a>
              </dd>
            </div>

            <div>
              <dt className="text-xs font-bold text-gray-500 uppercase tracking-widest">Vendor Name</dt>
              <dd className="mt-1 text-lg font-medium text-gray-900">{record.vendor_name || "N/A"}</dd>
            </div>

            <div>
              <dt className="text-xs font-bold text-gray-500 uppercase tracking-widest">Last Updated</dt>
              <dd className="mt-1 text-lg font-medium text-gray-900">{record.last_updated || "N/A"}</dd>
            </div>

            <div className="col-span-1 md:col-span-2 pt-6 border-t border-gray-100">
              <dt className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4">Accessibility Conformance Reports (ACRs)</dt>
              <dd>
                {!record.acr_reports || record.acr_reports.length === 0 ? (
                  <span className="text-gray-400 italic text-sm">No ACRs on file.</span>
                ) : (
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {record.acr_reports.map((acr, idx) => (
                      <li key={idx} className="bg-gray-50 p-4 rounded-md border border-gray-200 shadow-sm">
                        <strong className="block text-gray-900 font-medium mb-2 leading-snug">
                          {acr.url ? (
                            <a href={acr.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{acr.title}</a>
                          ) : (
                            acr.title
                          )}
                        </strong>
                        <div className="text-xs text-gray-600 flex flex-col space-y-1 bg-white p-2 border border-gray-100 rounded">
                          <span className="flex justify-between"><span className="font-semibold text-gray-400 uppercase">Version</span> <span>{acr.version || "N/A"}</span></span>
                          <span className="flex justify-between"><span className="font-semibold text-gray-400 uppercase">Date</span> <span>{acr.date || "N/A"}</span></span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>

            <div className="col-span-1 pt-6 border-t border-gray-100">
              <dt className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Vendor Resources</dt>
              <dd>
                {!record.vendor_resources || record.vendor_resources.length === 0 ? (
                  <span className="text-gray-400 italic text-sm">No resources listed.</span>
                ) : (
                  <ul className="space-y-3 text-sm">
                    {record.vendor_resources.map((res, idx) => (
                      <li key={idx} className="flex items-start">
                        <span className="mr-2 text-blue-300 mt-0.5">•</span>
                        <a href={res.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline leading-snug break-words">
                          {res.text}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>

            <div className="col-span-1 pt-6 border-t border-gray-100">
              <dt className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Support Contacts</dt>
              <dd>
                {!record.support_contacts || record.support_contacts.length === 0 ? (
                  <span className="text-gray-400 italic text-sm">No contacts listed.</span>
                ) : (
                  <ul className="space-y-4 text-sm">
                    {record.support_contacts.map((contact, idx) => (
                      <li key={idx} className="flex flex-col bg-gray-50 p-3 rounded border border-gray-100">
                        {contact.label && <span className="font-semibold text-gray-800 mb-1">{contact.label}</span>}
                        <a
                          href={contact.type === "email" ? `mailto:${contact.value}` : contact.value}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline break-all"
                        >
                          {contact.value}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
          </dl>
        </article>
        )}
      </section>
    </div>
  );
}
