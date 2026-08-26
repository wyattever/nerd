// frontend/app/editor/(routed)/candidates/CandidatesListPanel.tsx
"use client";

/**
 * Candidate tab's filter/sort/list nav, plus the always-visible Messages
 * footer -- the tracking fieldset, field editors, and save/delete/promote
 * handlers live in CandidateEditor.tsx, rendered as `{children}` below.
 *
 * Rendered from candidates/layout.tsx, which persists across navigation
 * between candidates/page.tsx (nothing selected) and candidates/[slug]/
 * page.tsx (the editor) -- that's what keeps this component's own DOM/state
 * (scroll position, filter text) alive across a record selection instead of
 * remounting on every click. Row links use `scroll={false}` for the same
 * reason Phase 1's tab links do -- see EditorNavSidebar.tsx.
 *
 * Highlights the active row via usePathname() rather than a selectedSlug
 * prop: this component has no route param of its own (it lives above the
 * [slug] segment in the tree), but usePathname() reflects the CURRENT URL
 * from any client component regardless of where it's mounted.
 *
 * The Messages footer lives here (not in CandidateEditor) so it stays
 * visible on the "nothing selected" empty state too, matching the legacy
 * monolith's single always-present footer. Its record count comes directly
 * from `products` (this component's own server-provided prop), but the
 * live status/error text comes from CandidateEditor's save/delete/promote/
 * field-editor handlers -- a different subtree, mounted as `{children}`
 * below this list, not a descendant this component can pass props to
 * directly. MessagesContext bridges that gap: CandidateEditor calls
 * useMessages() to report status, this component owns and renders the
 * actual state.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { PublishedProductRecord } from "@/lib/published-tables";

interface MessagesContextValue {
  statusMessage: string;
  saveError: string;
  setStatusMessage: (message: string) => void;
  setSaveError: (message: string) => void;
}

const MessagesContext = createContext<MessagesContextValue | null>(null);

/** Used by CandidateEditor to report save/delete/promote/field-editor
 *  status into this panel's persisting Messages footer -- see this file's
 *  header. Only valid inside CandidatesListPanel's subtree. */
export function useMessages(): MessagesContextValue {
  const ctx = useContext(MessagesContext);
  if (!ctx) throw new Error("useMessages must be used within CandidatesListPanel");
  return ctx;
}

interface CandidatesListPanelProps {
  products: PublishedProductRecord[];
  base: string;
  children: ReactNode;
}

export function CandidatesListPanel({ products, base, children }: CandidatesListPanelProps) {
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

  const filterId = "candidates-filter";

  return (
    <div className="flex min-h-full">
      <nav
        aria-label="Candidate products"
        className="sticky top-6 flex h-[calc(100vh-4rem)] w-72 flex-shrink-0 flex-col gap-3 self-start border-r border-gray-200 p-4"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={filterId} className="text-sm font-medium text-gray-700">
            Filter candidate products
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
          <div role="group" aria-label="Sort products by name" className="flex gap-1">
            <button
              type="button"
              aria-label="Sort A to Z"
              aria-pressed={sortOrder === "asc"}
              onClick={() => setSortOrder("asc")}
              className={`rounded border px-1.5 py-0.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 ${sortOrder === "asc" ? "border-gray-400 bg-gray-200 text-gray-900" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}
            >
              A-Z
            </button>
            <button
              type="button"
              aria-label="Sort Z to A"
              aria-pressed={sortOrder === "desc"}
              onClick={() => setSortOrder("desc")}
              className={`rounded border px-1.5 py-0.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 ${sortOrder === "desc" ? "border-gray-400 bg-gray-200 text-gray-900" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}
            >
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

      <MessagesContext.Provider value={messagesValue}>
        <div className="flex flex-1 flex-col">
          {children}

          <footer className="mt-auto p-6 pt-0">
            <div className="w-full rounded-md border border-gray-300 bg-white">
              <div className="flex items-center rounded-t-md bg-gray-50 px-4 py-2.5 text-xs font-bold uppercase text-gray-500 border-b border-gray-300">Messages</div>
              <div className="flex flex-col gap-1 p-4">
                <p className="text-sm text-gray-600">Displaying {products.length} candidate product records.</p>
                <p role="status" aria-live="polite" className="text-sm text-gray-600 min-h-[1.25rem]">{statusMessage}</p>
                <p role="alert" className="text-sm font-semibold text-red-700 min-h-[1.25rem]">{saveError}</p>
              </div>
            </div>
          </footer>
        </div>
      </MessagesContext.Provider>
    </div>
  );
}
