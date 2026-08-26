// frontend/app/records/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorSidebar, type SourceTab } from "@/components/EditorSidebar";
import { USERS, fullName } from "@/lib/users";

/** One row in the Messages log. `id` is a stable key -- upsertLogEntry
 *  below replaces the row with a matching id in place (used for the
 *  "products"/"vendors" milestones' live counters) rather than appending a
 *  new row every time, and adds a new row for any id not already present
 *  (every other milestone, plus the general page-load status). */
type LogEntry = { id: string; text: string };

// Types based on the extracted JSON schema
type Resource = { text: string; url: string };
type ACR = { title: string; url: string | null; version: string | null; date: string | null };
type Contact = { type: string; value: string; label: string | null };

type ProductRecord = {
  slug?: string;
  product_name: string;
  ncademi_product_url: string;
  vendor_name: string | null;
  product_website_url: string | null;
  product_description: string | null;
  vendor_resources: Resource[];
  other_resources: Resource[];
  support_contacts: Contact[];
  acr_reports: ACR[];
  last_updated: string | null;
  is_protected: boolean;
  tracking_priority?: string | null;
  tracking_status?: string | null;
  tracking_gatherer?: string | null;
  tracking_reviewer?: string | null;
};

const ENDPOINT_FOR_TAB: Record<SourceTab, string> = {
  published: "/api/local/published",
  added: "/api/local/added",
  candidate: "/api/local/candidate",
};

const RESEARCHER_NAMES = USERS.filter((u) => u.role === "Researcher").map(fullName);

interface FetchedDocument {
  products: ProductRecord[];
}

async function fetchDocument(url: string): Promise<FetchedDocument> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed with ${res.status}`);
  const body = await res.json();
  return {
    products: Array.isArray(body.products) ? (body.products as ProductRecord[]) : [],
  };
}

export default function RecordsPage() {
  const [activeTab, setActiveTab] = useState<SourceTab>("candidate");
  const [dataSource, setDataSource] = useState<"stored" | "live">("stored");
  const [hasLiveScrapeData, setHasLiveScrapeData] = useState(false);
  const [isRetrievingLive, setIsRetrievingLive] = useState(false);

  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [addedProducts, setAddedProducts] = useState<ProductRecord[]>([]);
  const [candidateProducts, setCandidateProducts] = useState<ProductRecord[]>([]);
  
  const [selectedSlug, setSelectedSlug] = useState("");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [messagesLog, setMessagesLog] = useState<LogEntry[]>([]);
  const messagesLogRef = useRef<HTMLDivElement>(null);

  // Mirrors of activeTab/selectedSlug, read (not written) inside the
  // data-fetch effect below so it can preserve the current selection across
  // a Stored Data <-> Live Data toggle. Refs rather than reading
  // activeTab/selectedSlug directly: that effect's dependency array is
  // deliberately just [dataSource, upsertLogEntry] -- switching tabs or
  // selecting a different record must NOT itself re-trigger a full
  // three-document refetch, only a dataSource change (or mount) should.
  const activeTabRef = useRef(activeTab);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  const selectedSlugRef = useRef(selectedSlug);
  useEffect(() => {
    selectedSlugRef.current = selectedSlug;
  }, [selectedSlug]);

  // Replaces the row with this id in place if one exists (a live counter
  // like the "products"/"vendors" scrape milestones), otherwise appends a
  // new row -- see LogEntry's own comment. A no-op when the text hasn't
  // actually changed, so a redundant call (e.g. two identical counter
  // updates) doesn't cause an extra render. text === null removes the row
  // instead (a no-op if it isn't present) -- used to clear a stale
  // "load-error" row once a later dataSource toggle succeeds.
  const upsertLogEntry = useCallback((id: string, text: string | null) => {
    setMessagesLog((prev) => {
      const idx = prev.findIndex((entry) => entry.id === id);
      if (text === null) {
        if (idx === -1) return prev;
        return prev.filter((entry) => entry.id !== id);
      }
      if (idx === -1) return [...prev, { id, text }];
      if (prev[idx].text === text) return prev;
      const next = [...prev];
      next[idx] = { id, text };
      return next;
    });
  }, []);

  // Concurrent fetch matching /editor/page.tsx
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadState("loading");
      
      const publishedEndpoint = dataSource === "stored"
        ? ENDPOINT_FOR_TAB.published
        : "/api/local/published-live";

      const [publishedResult, addedResult, candidateResult] = await Promise.allSettled([
        fetchDocument(publishedEndpoint),
        fetchDocument(ENDPOINT_FOR_TAB.added),
        fetchDocument(ENDPOINT_FOR_TAB.candidate),
      ]);
      
      if (cancelled) return;

      let nextProducts: ProductRecord[] = [];
      let nextAddedProducts: ProductRecord[] = [];
      let nextCandidateProducts: ProductRecord[] = [];

      if (publishedResult.status === "fulfilled") {
        const doc = publishedResult.value;
        // Normalize ncademi_product_url to slug to make EditorSidebar happy
        nextProducts = doc.products.map(p => ({
          ...p,
          slug: p.slug || p.ncademi_product_url
        }));
        setProducts(nextProducts);

        setLoadState(nextProducts.length > 0 ? "ready" : "unavailable");
        upsertLogEntry("load-error", null);
      } else {
        setLoadState("unavailable");
        upsertLogEntry("load-error", "Could not load published data.");
      }

      if (addedResult.status === "fulfilled") {
        nextAddedProducts = addedResult.value.products.map(p => ({ ...p, slug: p.slug || p.ncademi_product_url }));
        setAddedProducts(nextAddedProducts);
      }

      if (candidateResult.status === "fulfilled") {
        nextCandidateProducts = candidateResult.value.products.map(p => ({ ...p, slug: p.slug || p.ncademi_product_url }));
        setCandidateProducts(nextCandidateProducts);
      }

      // Selection logic. Two cases:
      const previousSlug = selectedSlugRef.current;

      if (!previousSlug) {
        // 1. No previous selection at all -- this is the initial mount, not
        // a dataSource toggle. Same cross-tab fallback chain as before this
        // change: prefer candidate's first record, then published's first
        // record (matching activeTab's own "candidate" default).
        if (nextCandidateProducts.length > 0) {
          const first = nextCandidateProducts[0];
          setSelectedSlug(first.slug || first.ncademi_product_url);
        } else if (nextProducts.length > 0) {
          const first = nextProducts[0];
          setSelectedSlug(first.slug || first.ncademi_product_url);
        }
      } else {
        // 2. A record was already selected -- this is a Stored Data <->
        // Live Data toggle (the only thing that re-triggers this effect
        // after mount; added/candidate never change with dataSource, only
        // the published endpoint does). Try to keep that same record
        // selected in whichever tab is CURRENTLY active, matching by slug
        // OR ncademi_product_url (same lookup selectedRecord itself uses
        // below). Falls back to that tab's first record only if the
        // previously selected one doesn't exist in the freshly loaded
        // array -- e.g. it was only ever in the stored snapshot, not the
        // live one, or vice versa.
        const nextArrayForActiveTab =
          activeTabRef.current === "published"
            ? nextProducts
            : activeTabRef.current === "added"
              ? nextAddedProducts
              : nextCandidateProducts;

        const stillSelected = nextArrayForActiveTab.some(
          (p) => p.slug === previousSlug || p.ncademi_product_url === previousSlug
        );

        if (!stillSelected) {
          setSelectedSlug(nextArrayForActiveTab[0]?.slug || nextArrayForActiveTab[0]?.ncademi_product_url || "");
        }
      }

      // Displays a count for whichever tab is CURRENTLY active (not
      // necessarily "published", even though this fetch always re-reads all
      // three documents) -- matches activeTab's own "candidate" default on
      // the initial mount, and reflects a dataSource toggle's fresh count on
      // whichever tab the user was already looking at.
      const activeArray =
        activeTabRef.current === "published"
          ? nextProducts
          : activeTabRef.current === "added"
            ? nextAddedProducts
            : nextCandidateProducts;
      upsertLogEntry("load", `Displaying ${activeArray.length} ${activeTabRef.current} product records.`);
    })();
    return () => {
      cancelled = true;
    };
  }, [dataSource, upsertLogEntry]);

  // Checks once on mount whether frontend/lib/published-live.json exists yet
  // (it won't until "Retrieve Live Data" -- see handleRetrieveLiveData
  // below -- has been run at least once). This is what makes the Live Data
  // toggle correctly disabled/enabled on a fresh page load without the user
  // touching "Retrieve Live Data" first; that button also flips
  // hasLiveScrapeData true directly on a successful scrape, same effect,
  // just without waiting for a remount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/local/published-live");
        if (!cancelled && res.ok) {
          setHasLiveScrapeData(true);
        }
      } catch {
        // Network failure -- leave hasLiveScrapeData at its default false.
        // Same "missing/unavailable is normal, not an error" stance as the
        // route itself.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Triggers scripts/scrape_ncademi_live.py via a POST /api/local/scrape
  // SSE stream (see that route's header comment for the full protocol).
  // Focus moves to the Messages log synchronously, before the first
  // `await`, so it happens in the same tick as the click rather than after
  // the fetch settles. The log is cleared first so a fresh run starts as a
  // clean A-E progression rather than mixing in whatever the page-load
  // effect above last wrote to the "load" row.
  const handleRetrieveLiveData = useCallback(async () => {
    setIsRetrievingLive(true);
    setMessagesLog([]);
    messagesLogRef.current?.focus();

    try {
      const res = await fetch("/api/local/scrape", { method: "POST" });
      if (!res.ok || !res.body) {
        upsertLogEntry(
          "scrape-error",
          `Retrieve live data failed: unexpected server response (${res.status}).`
        );
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // SSE framing: events are separated by a blank line ("\n\n"); each
      // event is one or more "field: value" lines. Only `event:`/`data:`
      // are used here. A chunk from the reader can contain zero, one, or
      // several complete events, and can also end mid-event -- the while
      // loop drains every complete event currently in `buffer`, leaving any
      // trailing partial event for the next chunk to complete.
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);

          let eventType = "message";
          let dataLine: string | null = null;
          for (const line of rawEvent.split("\n")) {
            if (line.startsWith("event: ")) eventType = line.slice("event: ".length);
            else if (line.startsWith("data: ")) dataLine = line.slice("data: ".length);
          }
          if (dataLine === null) continue;

          let data: { stage?: string; message?: string; error?: string };
          try {
            data = JSON.parse(dataLine);
          } catch {
            continue;
          }

          if (eventType === "progress" && data.stage && data.message) {
            upsertLogEntry(data.stage, data.message);
          } else if (eventType === "done") {
            setHasLiveScrapeData(true);
          } else if (eventType === "error") {
            upsertLogEntry("scrape-error", `Retrieve live data failed: ${data.error ?? "unknown error"}.`);
          }
        }
      }
    } catch {
      upsertLogEntry("scrape-error", "Retrieve live data failed: could not reach the local write API.");
    } finally {
      setIsRetrievingLive(false);
    }
  }, [upsertLogEntry]);

  const activeProducts = useMemo(() => {
    switch (activeTab) {
      case "published": return products;
      case "added": return addedProducts;
      case "candidate": return candidateProducts;
    }
  }, [activeTab, products, addedProducts, candidateProducts]);

  const selectedRecord = useMemo(
    () => activeProducts.find((p) => p.slug === selectedSlug || p.ncademi_product_url === selectedSlug) ?? null,
    [activeProducts, selectedSlug]
  );

  const handleActiveTabChange = useCallback(
    (tab: SourceTab) => {
      setActiveTab(tab);
      const nextArray = tab === "published" ? products : tab === "added" ? addedProducts : candidateProducts;
      setSelectedSlug(nextArray[0]?.slug || nextArray[0]?.ncademi_product_url || "");
      upsertLogEntry("load", `Displaying ${nextArray.length} ${tab} product records.`);
    },
    [products, addedProducts, candidateProducts, upsertLogEntry]
  );

  return (
    <div className="flex min-h-screen overflow-y-scroll">
      
      {/* 3. Side panel exact visual layout via EditorSidebar */}
      <EditorSidebar
        publishedProducts={products as any}
        addedProducts={addedProducts as any}
        candidateProducts={candidateProducts as any}
        activeTab={activeTab}
        onActiveTabChange={handleActiveTabChange}
        selectedSlug={selectedSlug}
        onSelectSlug={setSelectedSlug}
      />

      <div className="flex min-w-[1200px] flex-1 flex-col gap-6 p-6">
        {/* 1. Keep H1 in the same place */}
        <header className="flex items-end justify-between mb-4">
          <div className="flex flex-row items-center gap-4">
            <h1 className="text-2xl font-bold text-gray-900 capitalize whitespace-nowrap shrink-0">
              {activeTab} Product Records
            </h1>
          </div>
        </header>

        {/* Tracking Metadata - Read Only */}
        <div className="w-full rounded-md border border-gray-300 bg-white mb-2">
          <div className="flex items-center rounded-t-md bg-gray-50 px-4 py-2.5 text-xs font-bold uppercase text-gray-500 border-b border-gray-300">
            Tracking
          </div>

          <div className="flex flex-wrap items-center gap-3 p-4">
            <label className="flex flex-col items-start gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Priority
              <select
                value={selectedRecord?.tracking_priority ?? ""}
                disabled
                className="rounded border border-gray-300 bg-gray-50 px-2 py-1.5 text-sm font-medium text-gray-700 cursor-not-allowed opacity-75 focus:outline-none"
              >
                <option value="">set priority</option>
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
              </select>
            </label>

            {/* Status logic matched to /editor-test */}
            {activeTab === "candidate" || activeTab === "added" ? (
              <label className="flex flex-col items-start gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Status
                <select
                  value={selectedRecord?.tracking_status ?? ""}
                  disabled
                  className="rounded border border-gray-300 bg-gray-50 px-2 py-1.5 text-sm font-medium text-gray-700 cursor-not-allowed opacity-75 focus:outline-none"
                >
                  <option value="">set status</option>
                  <optgroup label="Candidate">
                    <option value="Gathering">Gathering</option>
                    <option value="Needs Review">Needs Review</option>
                    <option value="Discussion">Discussion</option>
                    <option value="Ready for Site">Ready for Site</option>
                  </optgroup>
                  <optgroup label="Added">
                    <option value="contacted vendor">contacted vendor</option>
                    <option value="replied back to vendor">replied back to vendor</option>
                  </optgroup>
                </select>
              </label>
            ) : null}

            {/* Gatherer/Reviewer logic matched to /editor-test */}
            {activeTab === "candidate" ? (
              <>
                <label className="flex flex-col items-start gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Gatherer
                  <select
                    value={selectedRecord?.tracking_gatherer ?? ""}
                    disabled
                    className="rounded border border-gray-300 bg-gray-50 px-2 py-1.5 text-sm font-medium text-gray-700 cursor-not-allowed opacity-75 focus:outline-none"
                  >
                    <option value="">set gatherer</option>
                    {RESEARCHER_NAMES.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col items-start gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Reviewer
                  <select
                    value={selectedRecord?.tracking_reviewer ?? ""}
                    disabled
                    className="rounded border border-gray-300 bg-gray-50 px-2 py-1.5 text-sm font-medium text-gray-700 cursor-not-allowed opacity-75 focus:outline-none"
                  >
                    <option value="">set reviewer</option>
                    {RESEARCHER_NAMES.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
          </div>
        </div>

        {/* 2. SITE DATA element styled identically to Tracking/Edit */}
        {activeTab === "published" ? (
          <div className="w-full rounded-md border border-gray-300 bg-white mb-2">
            <div className="flex items-center rounded-t-md bg-gray-50 px-4 py-2.5 text-xs font-bold uppercase text-gray-500 border-b border-gray-300">
              Site Data
            </div>

            <div className="flex flex-wrap items-center gap-3 p-4">
              <button
                type="button"
                onClick={() => setDataSource("stored")}
                className={`rounded border px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  dataSource === "stored"
                    ? "bg-blue-50 text-blue-700 border-blue-200"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                }`}
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
                onClick={() => setDataSource("live")}
                className={`rounded border px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  dataSource === "live"
                    ? "bg-blue-50 text-blue-700 border-blue-200"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                }`}
              >
                Live Data
              </button>

              <button
                type="button"
                disabled={isRetrievingLive}
                onClick={handleRetrieveLiveData}
                className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isRetrievingLive ? "Retrieving…" : "Retrieve Live Data"}
              </button>
            </div>
          </div>
        ) : null}

        {/* 4. Display inside "Visual preview" section */}
        <section aria-label="Visual preview" className="rounded border border-gray-200 bg-gray-50 p-4">
          {loadState === "loading" ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : loadState === "unavailable" ? (
            <p className="text-sm text-gray-500">No records available.</p>
          ) : !selectedRecord ? (
            <div className="flex h-full items-center justify-center text-gray-400 py-12">
              <p className="text-sm">Select a record from the list to view its complete schema.</p>
            </div>
          ) : (
            <article className="w-full bg-white shadow-sm border border-gray-200 rounded-lg p-8">
              <header className="mb-8 border-b border-gray-200 pb-6">
                <h2 className="text-3xl font-bold text-gray-900 mb-2">
                  {selectedRecord.product_name || "Unnamed Product"}
                </h2>
                
                {selectedRecord.is_protected && (
                  <div className="inline-flex items-center bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-md mb-4 text-sm font-medium shadow-sm w-full">
                    <svg className="w-5 h-5 mr-3 text-yellow-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    This record is currently password-protected on NCADEMI (Pending Vendor Review).
                  </div>
                )}
                
                {selectedRecord.product_description && (
                  <p className="text-gray-700 leading-relaxed text-lg">
                    {selectedRecord.product_description}
                  </p>
                )}
              </header>

              <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-8">
                <div className="col-span-1 md:col-span-2 bg-gray-50 p-4 rounded-md border border-gray-100">
                  <dt className="text-xs font-bold text-gray-500 uppercase tracking-widest">NCADEMI URL</dt>
                  <dd className="mt-1 text-sm text-blue-600 break-all">
                    <a href={selectedRecord.ncademi_product_url} target="_blank" rel="noopener noreferrer" className="hover:underline font-mono">
                      {selectedRecord.ncademi_product_url}
                    </a>
                  </dd>
                </div>

                <div>
                  <dt className="text-xs font-bold text-gray-500 uppercase tracking-widest">Vendor Name</dt>
                  <dd className="mt-1 text-lg font-medium text-gray-900">{selectedRecord.vendor_name || "N/A"}</dd>
                </div>

                <div>
                  <dt className="text-xs font-bold text-gray-500 uppercase tracking-widest">Last Updated</dt>
                  <dd className="mt-1 text-lg font-medium text-gray-900">{selectedRecord.last_updated || "N/A"}</dd>
                </div>

                <div className="col-span-1 md:col-span-2 pt-6 border-t border-gray-100">
                  <dt className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4 flex items-center">
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    Accessibility Conformance Reports (ACRs)
                  </dt>
                  <dd>
                    {!selectedRecord.acr_reports || selectedRecord.acr_reports.length === 0 ? (
                      <span className="text-gray-400 italic text-sm">No ACRs on file.</span>
                    ) : (
                      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {selectedRecord.acr_reports.map((acr, idx) => (
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
                    {!selectedRecord.vendor_resources || selectedRecord.vendor_resources.length === 0 ? (
                      <span className="text-gray-400 italic text-sm">No resources listed.</span>
                    ) : (
                      <ul className="space-y-3 text-sm">
                        {selectedRecord.vendor_resources.map((res, idx) => (
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
                    {!selectedRecord.support_contacts || selectedRecord.support_contacts.length === 0 ? (
                      <span className="text-gray-400 italic text-sm">No contacts listed.</span>
                    ) : (
                      <ul className="space-y-4 text-sm">
                        {selectedRecord.support_contacts.map((contact, idx) => (
                          <li key={idx} className="flex flex-col bg-gray-50 p-3 rounded border border-gray-100">
                            {contact.label && <span className="font-semibold text-gray-800 mb-1">{contact.label}</span>}
                            <a 
                              href={contact.type === 'email' ? `mailto:${contact.value}` : contact.value} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              className="text-blue-600 hover:underline break-all flex items-center"
                            >
                              {contact.type === 'email' ? (
                                 <svg className="w-3.5 h-3.5 mr-1.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                              ) : (
                                 <svg className="w-3.5 h-3.5 mr-1.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                              )}
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

        <footer className="mt-auto pt-6">
          <div className="w-full rounded-md border border-gray-300 bg-white">
            <div className="flex items-center rounded-t-md bg-gray-50 px-4 py-2.5 text-xs font-bold uppercase text-gray-500 border-b border-gray-300">
              Messages
            </div>
            {/* Fixed h-28 comfortably fits ~3 lines of text-sm content at a
                time given this p-4 padding; overflow-y-scroll (not -auto)
                keeps the scrollbar gutter permanently visible even with
                zero/one-line content, rather than only appearing once
                there's enough to actually scroll. tabIndex={-1} makes this
                programmatically focusable (see handleRetrieveLiveData's
                messagesLogRef.current?.focus()) without adding it to the
                normal Tab order. */}
            <div
              ref={messagesLogRef}
              role="log"
              aria-live="polite"
              aria-label="Retrieve data progress and status messages"
              tabIndex={-1}
              className="flex h-28 flex-col gap-1 overflow-y-scroll p-4 text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
            >
              {messagesLog.length === 0 ? (
                <p className="text-gray-400">No messages yet.</p>
              ) : (
                messagesLog.map((entry) => <p key={entry.id}>{entry.text}</p>)
              )}
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}