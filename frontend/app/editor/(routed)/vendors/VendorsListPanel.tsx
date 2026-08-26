// frontend/app/editor/(routed)/vendors/VendorsListPanel.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { DirectoryRecord } from "@/lib/directory-schema";

interface MessagesContextValue {
  statusMessage: string;
  saveError: string;
  setStatusMessage: (message: string) => void;
  setSaveError: (message: string) => void;
}

const MessagesContext = createContext<MessagesContextValue | null>(null);

export function useMessages(): MessagesContextValue {
  const ctx = useContext(MessagesContext);
  if (!ctx) throw new Error("useMessages must be used within VendorsListPanel");
  return ctx;
}

interface VendorsListPanelProps {
  vendors: DirectoryRecord[];
  base: string;
  children: ReactNode;
}

export function VendorsListPanel({ vendors: directoryVendors, base, children }: VendorsListPanelProps) {
  const pathname = usePathname();

  const [filter, setFilter] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const [statusMessage, setStatusMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const messagesValue = useMemo(
    () => ({ statusMessage, saveError, setStatusMessage, setSaveError }),
    [statusMessage, saveError]
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return directoryVendors;
    return directoryVendors.filter((v) => v.product_name.toLowerCase().includes(q));
  }, [directoryVendors, filter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) =>
      sortOrder === "asc"
        ? a.product_name.localeCompare(b.product_name)
        : b.product_name.localeCompare(a.product_name)
    );
    return copy;
  }, [filtered, sortOrder]);

  const filterId = "vendors-filter";

  return (
    <div className="flex min-h-full">
      <nav
        aria-label="Vendors"
        className="sticky top-6 flex h-[calc(100vh-4rem)] w-72 flex-shrink-0 flex-col gap-3 self-start border-r border-gray-200 p-4"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={filterId} className="text-sm font-medium text-gray-700">
            Filter vendors
          </label>
          <input
            id={filterId}
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="vendor name"
            className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center justify-end">
          <div role="group" aria-label="Sort vendors by name" className="flex gap-1">
            <button type="button" aria-label="Sort A to Z" aria-pressed={sortOrder === "asc"} onClick={() => setSortOrder("asc")} className={`rounded border px-1.5 py-0.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 ${sortOrder === "asc" ? "border-gray-400 bg-gray-200 text-gray-900" : "border-gray-300 text-gray-500 hover:bg-gray-50"}`}>
              A-Z
            </button>
            <button type="button" aria-label="Sort Z to A" aria-pressed={sortOrder === "desc"} onClick={() => setSortOrder("desc")} className={`rounded border px-1.5 py-0.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 ${sortOrder === "desc" ? "border-gray-400 bg-gray-200 text-gray-900" : "border-gray-300 text-gray-500 hover:bg-gray-50"}`}>
              Z-A
            </button>
          </div>
        </div>

        <ul className="flex flex-1 flex-col gap-1 overflow-y-scroll">
          {sorted.map((v) => {
            const href = `${base}/${encodeURIComponent(v.slug)}`;
            const isActive = pathname === href;
            return (
              <li key={v.slug}>
                <Link
                  href={href}
                  scroll={false}
                  aria-current={isActive ? "true" : undefined}
                  className={`block w-full rounded-r border-l-4 px-3 py-2 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 ${isActive ? "border-blue-600 bg-blue-50" : "border-transparent hover:bg-gray-50"}`}
                >
                  <span className="block text-sm font-medium text-gray-900">{v.product_name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <MessagesContext.Provider value={messagesValue}>
        <div className="flex flex-1 flex-col">
          {children}

          <footer className="mt-auto p-6 pt-0">
            <div className="w-full rounded-md border border-gray-300 bg-white">
              <div className="flex items-center rounded-t-md bg-gray-50 px-4 py-2.5 text-xs font-bold uppercase text-gray-500 border-b border-gray-300">Messages</div>
              <div className="flex flex-col gap-1 p-4">
                <p role="status" aria-live="polite" className="text-sm text-gray-600 min-h-[1.25rem]">
                  {statusMessage || `Displaying ${directoryVendors.length} vendor records.`}
                </p>
                <p role="alert" className="text-sm font-semibold text-red-700 min-h-[1.25rem]">{saveError}</p>
              </div>
            </div>
          </footer>
        </div>
      </MessagesContext.Provider>
    </div>
  );
}
