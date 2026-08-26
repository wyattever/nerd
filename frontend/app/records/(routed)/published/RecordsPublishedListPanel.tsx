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
 * The Stored/Live toggle is still local `useState`, not a URL query param
 * -- Phase 5 (not yet built) is what's meant to make it a server-side
 * concern. Known gap from that: `RecordsPublishedDetailPage` ([slug]/
 * page.tsx) always looks up the requested slug against the STORED document
 * server-side, with no way to know this client-side toggle is on "Live" --
 * so clicking a row that only exists in live-scraped data (not yet present
 * in the stored snapshot) will render "Record not found" instead of that
 * record. Bounded to that one edge case (this section is read-only, so
 * there's no data-loss risk), not fixed here -- doing so cleanly needs
 * Phase 5's URL-based source anyway.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  const [isLoadingLive, setIsLoadingLive] = useState(false);
  const [hasLiveScrapeData, setHasLiveScrapeData] = useState(false);
  const [isRetrievingLive, setIsRetrievingLive] = useState(false);

  const [filter, setFilter] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [messagesLog, setMessagesLog] = useState<LogEntry[]>([
    { id: "load", text: `Displaying ${initialProducts.length} published product records.` },
  ]);
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

  const handleSelectDataSource = useCallback(
    (next: "stored" | "live") => {
      setDataSource(next);
      if (next === "stored") {
        upsertLogEntry("load", `Displaying ${initialProducts.length} published product records.`);
        return;
      }
      setIsLoadingLive(true);
      fetchLiveProducts()
        .then((fetched) => {
          setLiveProducts(fetched);
          upsertLogEntry("load", `Displaying ${fetched.length} published product records.`);
          upsertLogEntry("load-error", null);
        })
        .catch(() => {
          setLiveProducts([]);
          upsertLogEntry("load-error", "Could not load live published data.");
        })
        .finally(() => setIsLoadingLive(false));
    },
    [initialProducts, upsertLogEntry]
  );

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
            const href = `${base}/${p.slug}`;
            const isActive = pathname === href;
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
            <button
              type="button"
              onClick={() => handleSelectDataSource("stored")}
              className={`rounded border px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 ${dataSource === "stored" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}
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
              disabled={!hasLiveScrapeData || isLoadingLive}
              onClick={() => handleSelectDataSource("live")}
              className={`rounded border px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${dataSource === "live" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}
            >
              {isLoadingLive ? "Loading…" : "Live Data"}
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
