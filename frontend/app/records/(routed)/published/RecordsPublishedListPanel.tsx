// frontend/app/records/(routed)/published/RecordsPublishedListPanel.tsx
"use client";

/**
 * Published records list nav + Site Data controls + Messages footer --
 * mirrors frontend/app/editor/(routed)/published/PublishedListPanel.tsx's
 * split (list here, selected-record view in RecordsPublishedDetail.tsx,
 * rendered as `{children}` via published/[slug]/page.tsx). Site Data
 * (Stored/Live toggle, Retrieve Live Data) stays here rather than moving to
 * the Detail component: it's list-level state -- which array feeds the
 * list and which record a row link resolves against -- not something
 * scoped to one already-selected record. No MessagesContext is needed
 * (unlike the editor side): the Detail component has nothing to report up,
 * since this section is read-only and the scrape/live-data status
 * originates here already.
 *
 * The Stored/Live source itself now lives in the URL (`?source=live`), via
 * SourceToggle.tsx -- see that file's header for why it's split out and
 * Suspense-wrapped here rather than in this file's parent page.tsx (the
 * component that actually calls useSearchParams() is what needs the
 * boundary, and that's the toggle, not this list). `dataSource` here is
 * still `useState`, but now driven by SourceToggle's onSourceChange rather
 * than by a click handler owned here -- both a click AND a direct deep
 * link to ?source=live end up going through the same path (SourceToggle
 * resolves the URL on mount too, not only after a click), which is what
 * makes `/records/published?source=live` work as a deep link.
 *
 * Known gap, unchanged from before this phase: `RecordsPublishedDetailPage`
 * ([slug]/page.tsx) always looks up the requested slug against the STORED
 * document server-side -- it has no access to this client-only fetched
 * liveProducts array. A row that only exists in live-scraped data (not yet
 * present in the stored snapshot) still renders "Record not found" when
 * clicked. Read-only section, so no data-loss risk; a real fix would need
 * the *record* lookup to also become source-aware, which is a separate
 * change from this phase's URL-state migration for the toggle itself.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SourceToggle } from "./SourceToggle";
import type { PublishedProductRecord } from "@/lib/published-tables";

type LogEntry = { id: string; text: string };

interface RecordsPublishedListPanelProps {
  initialProducts: PublishedProductRecord[];
  base: string;
  children: ReactNode;
}

async function fetchLiveProducts(): Promise<PublishedProductRecord[]> {
  const res = await fetch("/api/local/published-live");
  if (!res.ok) throw new Error(`GET /api/local/published-live failed with ${res.status}`);
  const body = (await res.json()) as { products?: unknown };
  const rawProducts = Array.isArray(body.products) ? (body.products as Array<Record<string, unknown>>) : [];
  return rawProducts.map((p) => ({
    ...p,
    slug: (p.slug as string | undefined) || (p.ncademi_product_url as string),
  })) as PublishedProductRecord[];
}

export function RecordsPublishedListPanel({ initialProducts, base, children }: RecordsPublishedListPanelProps) {
  const pathname = usePathname();
  const [dataSource, setDataSource] = useState<"stored" | "live">("stored");
  const [liveProducts, setLiveProducts] = useState<PublishedProductRecord[] | null>(null);
  // Derived, not separate state: liveProducts is null exactly while a
  // "live" fetch is in flight (the catch branch below resolves it to `[]`
  // on failure, never leaves it null), so there's nothing to synchronize
  // via an effect -- see the fetch effect below for why that matters here
  // (this repo's eslint-plugin-react-hooks config errors on a synchronous
  // setState call directly in an effect body).
  const isLoadingLive = dataSource === "live" && liveProducts === null;
  const [hasLiveScrapeData, setHasLiveScrapeData] = useState(false);
  const [isRetrievingLive, setIsRetrievingLive] = useState(false);

  const [filter, setFilter] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  // Scrape progress/error entries only -- the record count is a derived
  // render value (see the footer below), not state, for the same reason
  // isLoadingLive is derived above.
  const [messagesLog, setMessagesLog] = useState<LogEntry[]>([]);
  const messagesLogRef = useRef<HTMLDivElement>(null);

  const products = useMemo(
    () => (dataSource === "live" ? (liveProducts ?? []) : initialProducts),
    [dataSource, liveProducts, initialProducts]
  );

  const upsertLogEntry = useCallback((id: string, text: string | null) => {
    setMessagesLog((prev) => {
      const idx = prev.findIndex((entry) => entry.id === id);
      if (text === null) return idx === -1 ? prev : prev.filter((entry) => entry.id !== id);
      if (idx === -1) return [...prev, { id, text }];
      if (prev[idx].text === text) return prev;
      const next = [...prev];
      next[idx] = { id, text };
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/local/published-live");
        if (!cancelled && res.ok) setHasLiveScrapeData(true);
      } catch {
        // Missing/unavailable is normal, not an error -- see the route.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fires whenever the resolved source (from SourceToggle, itself driven by
  // the URL) becomes "live" and nothing's been fetched yet -- covers BOTH a
  // click on the "Live Data" button and a direct deep-link/refresh landing
  // on ?source=live, since SourceToggle reports its resolved value on
  // mount too, not only after a click. Every setState call here is inside
  // a .then()/.catch() callback, never directly in the effect body --
  // see isLoadingLive's own comment above for why that's load-bearing.
  useEffect(() => {
    if (dataSource !== "live" || liveProducts !== null) return;
    let cancelled = false;
    fetchLiveProducts()
      .then((fetched) => {
        if (cancelled) return;
        setLiveProducts(fetched);
        upsertLogEntry("load-error", null);
      })
      .catch(() => {
        if (cancelled) return;
        setLiveProducts([]);
        upsertLogEntry("load-error", "Could not load live published data.");
      });
    return () => {
      cancelled = true;
    };
  }, [dataSource, liveProducts, upsertLogEntry]);

  const handleRetrieveLiveData = useCallback(async () => {
    setIsRetrievingLive(true);
    setMessagesLog([]);
    messagesLogRef.current?.focus();

    try {
      const res = await fetch("/api/local/scrape", { method: "POST" });
      if (!res.ok || !res.body) {
        upsertLogEntry("scrape-error", `Retrieve live data failed: unexpected server response (${res.status}).`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

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

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.slug.includes(q) || p.product_name.toLowerCase().includes(q));
  }, [products, filter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) =>
      sortOrder === "asc"
        ? a.product_name.localeCompare(b.product_name)
        : b.product_name.localeCompare(a.product_name)
    );
    return copy;
  }, [filtered, sortOrder]);

  const filterId = "records-published-filter";

  return (
    <div className="flex min-h-full">
      <nav
        aria-label="Published records"
        className="sticky top-6 flex h-[calc(100vh-4rem)] w-72 flex-shrink-0 flex-col gap-3 self-start border-r border-gray-200 p-4"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={filterId} className="text-sm font-medium text-gray-700">
            Filter published records
          </label>
          <input
            id={filterId}
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="slug or name"
            className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center justify-end">
          <div role="group" aria-label="Sort records by name" className="flex gap-1">
            <button type="button" aria-label="Sort A to Z" aria-pressed={sortOrder === "asc"} onClick={() => setSortOrder("asc")} className={`rounded border px-1.5 py-0.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 ${sortOrder === "asc" ? "border-gray-400 bg-gray-200 text-gray-900" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
              A-Z
            </button>
            <button type="button" aria-label="Sort Z to A" aria-pressed={sortOrder === "desc"} onClick={() => setSortOrder("desc")} className={`rounded border px-1.5 py-0.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 ${sortOrder === "desc" ? "border-gray-400 bg-gray-200 text-gray-900" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
              Z-A
            </button>
          </div>
        </div>

        <ul className="flex flex-1 flex-col gap-1 overflow-y-scroll">
          {sorted.map((p) => {
            // Carries the live source forward into record-to-record
            // navigation -- otherwise selecting a different row while
            // viewing Live Data would silently drop back to Stored for the
            // new record, since [slug]/page.tsx has no other way to know
            // which source was active. Reuses `dataSource` (already local
            // state, kept in sync by SourceToggle's onSourceChange) rather
            // than calling useSearchParams() here directly, which would
            // pull this whole list panel into the CSR-bailout Suspense
            // requirement -- see this file's header.
            const href = dataSource === "live" ? `${base}/${p.slug}?source=live` : `${base}/${p.slug}`;
            const isActive = pathname === `${base}/${p.slug}`;
            return (
              <li key={p.slug}>
                <Link
                  href={href}
                  scroll={false}
                  aria-current={isActive ? "true" : undefined}
                  className={`block w-full rounded-r border-l-4 px-3 py-2 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 ${isActive ? "border-blue-600 bg-blue-50" : "border-transparent hover:bg-gray-50"}`}
                >
                  <span className="block text-sm font-medium text-gray-900">{p.product_name}</span>
                  <span className="block font-mono text-xs text-gray-600">{p.slug}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex flex-1 flex-col gap-6 p-6">
        <div className="w-full rounded-md border border-gray-300 bg-white mb-2">
          <div className="flex items-center rounded-t-md bg-gray-50 px-4 py-2.5 text-xs font-bold uppercase text-gray-500 border-b border-gray-300">Site Data</div>
          <div className="flex flex-wrap items-center gap-3 p-4">
            <Suspense fallback={<div className="h-10 w-32 animate-pulse rounded bg-gray-200" />}>
              <SourceToggle hasLiveScrapeData={hasLiveScrapeData} isLoadingLive={isLoadingLive} onSourceChange={setDataSource} />
            </Suspense>
            <button
              type="button"
              onClick={() => alert("Stubbed")}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Update Stored Data
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

        {children}

        <footer className="mt-auto">
          <div className="w-full rounded-md border border-gray-300 bg-white">
            <div className="flex items-center rounded-t-md bg-gray-50 px-4 py-2.5 text-xs font-bold uppercase text-gray-500 border-b border-gray-300">Messages</div>
            <p className="px-4 pt-4 text-sm text-gray-600">Displaying {products.length} published product records.</p>
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
