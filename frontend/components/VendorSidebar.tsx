// frontend/components/VendorSidebar.tsx
"use client";

/**
 * Left-column vendor picker for /vendors, modeled after EditorSidebar.tsx
 * but simpler: vendors.json is a single flat list, not three parallel
 * candidate/added/published arrays, so there is no source-tab toggle here
 * (EditorSidebar's Material Symbols tab row and its noun-aware filter
 * label are dropped along with it -- there is only one noun, "vendor").
 *
 * There is no slug on VendorRecord, so vendor_name doubles as both the
 * list key and the identity onSelectName reports back -- see
 * vendor-schema.ts's header comment on why vendor_name is already this
 * registry's join key everywhere else (vendor_resources, the promotion
 * pipeline in /editor, etc.).
 *
 * Same fixed width/height and plain-scrollbar rationale as EditorSidebar
 * (see that file's header comment for the full "content jump" writeup):
 * this is a local-only dev tool laid out for a wide desktop window, not a
 * public responsive page.
 */

import { useCallback, useMemo, useState } from "react";
import type { VendorRecord } from "@/lib/vendor-schema";

interface VendorSidebarProps {
  vendors: VendorRecord[];
  selectedName: string;
  onSelectName: (name: string) => void;
}

export function VendorSidebar({ vendors, selectedName, onSelectName }: VendorSidebarProps) {
  const [filter, setFilter] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter((v) => v.vendor_name.toLowerCase().includes(q));
  }, [vendors, filter]);

  // Sorted separately from filtered, same as EditorSidebar: the "N of M
  // shown" count reads off filtered.length/vendors.length, neither of
  // which sorting should touch.
  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) =>
      sortOrder === "asc"
        ? a.vendor_name.localeCompare(b.vendor_name)
        : b.vendor_name.localeCompare(a.vendor_name)
    );
    return copy;
  }, [filtered, sortOrder]);

  const filterId = "vendor-sidebar-filter";

  const handleSelect = useCallback(
    (name: string) => {
      onSelectName(name);
    },
    [onSelectName]
  );

  return (
    <nav
      aria-label="Vendors"
      className="sticky top-6 flex h-[calc(100vh-4rem)] w-80 flex-shrink-0 flex-col gap-3 self-start border-r border-gray-200 p-4"
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

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          {filtered.length} of {vendors.length} shown
        </p>

        <div role="group" aria-label="Sort vendors by name" className="flex gap-1">
          <button
            type="button"
            aria-label="Sort A to Z"
            aria-pressed={sortOrder === "asc"}
            onClick={() => setSortOrder("asc")}
            className={`rounded border px-1.5 py-0.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              sortOrder === "asc"
                ? "border-gray-400 bg-gray-200 text-gray-900"
                : "border-gray-300 text-gray-500 hover:bg-gray-50"
            }`}
          >
            A-Z
          </button>
          <button
            type="button"
            aria-label="Sort Z to A"
            aria-pressed={sortOrder === "desc"}
            onClick={() => setSortOrder("desc")}
            className={`rounded border px-1.5 py-0.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              sortOrder === "desc"
                ? "border-gray-400 bg-gray-200 text-gray-900"
                : "border-gray-300 text-gray-500 hover:bg-gray-50"
            }`}
          >
            Z-A
          </button>
        </div>
      </div>

      <ul className="flex flex-1 flex-col gap-1 overflow-y-scroll">
        {sorted.map((v) => {
          const isActive = v.vendor_name === selectedName;
          return (
            <li key={v.vendor_name}>
              <button
                type="button"
                aria-current={isActive ? "true" : undefined}
                onClick={() => handleSelect(v.vendor_name)}
                className={`w-full rounded-r border-l-4 px-3 py-2 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  isActive ? "border-blue-600 bg-blue-50" : "border-transparent hover:bg-gray-50"
                }`}
              >
                <span className="block text-sm font-medium text-gray-900">{v.vendor_name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
