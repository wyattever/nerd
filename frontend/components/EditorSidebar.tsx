// frontend/components/EditorSidebar.tsx
"use client";

/**
 * Left-column product picker for /editor, replacing the old top-bar
 * <select>. Three source tabs (candidate / added / published) toggle which
 * of three separate arrays the filter and list below operate on. Each
 * tab's list is a genuinely separate prop rather than one array plus a
 * source discriminator, so wiring real data into added/candidate doesn't
 * change this component's shape.
 *
 * activeTab is a controlled prop, not local state: EditorPage's
 * handleSaveToServer needs to know which tab is active to pick the right
 * /api/local/* endpoint and the right in-memory array to save, and
 * switching tabs also has to reset the selection (EditorPage's
 * handleActiveTabChange), so there is a single source of truth for "which
 * tab" rather than two copies that could drift. The default ("published")
 * is EditorPage's initial state value; this component's own responsibility
 * is just rendering it and reporting clicks via onActiveTabChange.
 *
 * Fixed width AND a genuinely fixed height (h-[calc(100vh-4rem)], not just a
 * max-height cap): this page is a local-only dev tool laid out for a wide
 * desktop window, not a public responsive page -- see EditorPage's
 * min-w-[1200px] content column, which makes the same trade-off on the
 * other side of the layout.
 *
 * The height MUST be a hard h-*, not max-h-*. max-height only caps
 * auto-sizing; it doesn't force the box to actually be that tall. With
 * max-h-* here, <ul className="flex-1"> only has "leftover space" to grow
 * into once <nav>'s own height is settled -- and nav's auto height shrinks
 * to fit a short list (e.g. 11 candidate records) and grows toward the cap
 * for a long one (e.g. 31 published records). That made the WHOLE sidebar
 * panel resize per tab, which is the actual "content jump" this was
 * reported against -- a much bigger visual disruption than any scrollbar
 * rendering difference. A hard h-* gives nav a constant height regardless
 * of content, so flex-1 always fills the same leftover space and the panel
 * never resizes when switching tabs.
 *
 * The list intentionally uses plain overflow-y-scroll with no custom
 * ::-webkit-scrollbar / scrollbar-color / scrollbar-width styling -- native
 * scrollbar appearance, not a themed one. On platforms with classic
 * (non-overlay) scrollbars this alone guarantees a permanently reserved,
 * consistently-sized gutter. On macOS's default overlay-scrollbar mode
 * (System Settings -> Appearance -> Show scroll bars -> "Automatically
 * based on mouse or trackpad"), the native overlay scrollbar itself still
 * only paints during an active scroll gesture (plus a short fade) --
 * no CSS can make an unstyled native overlay scrollbar stay permanently
 * painted without either the macOS system setting being "Always" or custom
 * scrollbar theming (which was tried and rejected here for not looking
 * native). What CSS *can* guarantee, and what actually mattered for the
 * reported bug, is that the list's box never changes size -- see above.
 *
 * Material Symbols are loaded via a <link> rendered directly in this
 * component's JSX. React 19 hoists <link> tags to <head> regardless of
 * where in the tree they're rendered, and dedupes by href, so this is safe
 * across remounts. Google's stylesheet only defines the icon font's
 * @font-face, not a helper class, so the font-family and variation
 * settings are applied inline on each icon rather than via an undefined
 * ".material-symbols-outlined" class.
 */

import { useCallback, useMemo, useState } from "react";
import type { PublishedProductRecord } from "@/lib/published-tables";

export type SourceTab = "candidate" | "added" | "published";

interface EditorSidebarProps {
  publishedProducts: PublishedProductRecord[];
  addedProducts: PublishedProductRecord[];
  candidateProducts: PublishedProductRecord[];
  activeTab: SourceTab;
  onActiveTabChange: (tab: SourceTab) => void;
  selectedSlug: string;
  onSelectSlug: (slug: string) => void;
}

const TABS: ReadonlyArray<{ key: SourceTab; icon: string; ariaLabel: string; noun: string }> = [
  { key: "candidate", icon: "add_circle", ariaLabel: "View candidate products", noun: "candidate" },
  { key: "added", icon: "add_to_queue", ariaLabel: "View added products", noun: "added" },
  {
    key: "published",
    icon: "published_with_changes",
    ariaLabel: "View published products",
    noun: "published",
  },
];

const ICON_STYLE = {
  fontFamily: "'Material Symbols Outlined'",
  fontVariationSettings: "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24",
  fontSize: "22px",
  lineHeight: 1,
} as const;

export function EditorSidebar({
  publishedProducts,
  addedProducts,
  candidateProducts,
  activeTab,
  onActiveTabChange,
  selectedSlug,
  onSelectSlug,
}: EditorSidebarProps) {
  const [filter, setFilter] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const sourceList = useMemo(() => {
    switch (activeTab) {
      case "candidate":
        return candidateProducts;
      case "added":
        return addedProducts;
      case "published":
        return publishedProducts;
    }
  }, [activeTab, candidateProducts, addedProducts, publishedProducts]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return sourceList;
    return sourceList.filter(
      (p) => p.slug.includes(q) || p.product_name.toLowerCase().includes(q)
    );
  }, [sourceList, filter]);

  // Sorted separately from filtered rather than folded into it: the "N of M
  // shown" count above reads off filtered.length/sourceList.length, neither
  // of which sorting should touch.
  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) =>
      sortOrder === "asc"
        ? a.product_name.localeCompare(b.product_name)
        : b.product_name.localeCompare(a.product_name)
    );
    return copy;
  }, [filtered, sortOrder]);

  const filterId = "editor-sidebar-filter";
  const activeNoun = TABS.find((t) => t.key === activeTab)?.noun ?? activeTab;

  // Filter text from one tab rarely means anything on another (e.g. a slug
  // fragment for a published product has no bearing on the candidate list),
  // so switching tabs starts the filter fresh rather than silently hiding
  // results behind a stale query. Reset inline in the click handler (the
  // actual point of change) rather than reactively in an effect keyed on
  // activeTab, which would cause an avoidable extra render just to clear
  // one field.
  const handleTabClick = useCallback(
    (key: SourceTab) => {
      onActiveTabChange(key);
      setFilter("");
    },
    [onActiveTabChange]
  );

  return (
    <nav
      aria-label="Products"
      className="sticky top-6 flex h-[calc(100vh-4rem)] w-80 flex-shrink-0 flex-col gap-3 self-start border-r border-gray-200 p-4"
    >
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&icon_names=add_circle,add_to_queue,published_with_changes&display=swap"
      />

      <div role="group" aria-label="Product source" className="flex gap-1">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              aria-pressed={isActive}
              aria-label={tab.ariaLabel}
              onClick={() => handleTabClick(tab.key)}
              className={`flex flex-1 items-center justify-center rounded border p-2 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                isActive
                  ? "border-blue-600 bg-blue-50 text-blue-700"
                  : "border-gray-300 text-gray-500 hover:bg-gray-50"
              }`}
            >
              <span aria-hidden="true" style={ICON_STYLE}>
                {tab.icon}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={filterId} className="text-sm font-medium text-gray-700">
          {`Filter ${activeNoun} products`}
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

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          {filtered.length} of {sourceList.length} shown
        </p>

        <div role="group" aria-label="Sort products by name" className="flex gap-1">
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
        {sorted.map((p) => {
          const isActive = p.slug === selectedSlug;
          return (
            <li key={p.slug}>
              <button
                type="button"
                aria-current={isActive ? "true" : undefined}
                onClick={() => onSelectSlug(p.slug)}
                className={`w-full rounded-r border-l-4 px-3 py-2 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  isActive ? "border-blue-600 bg-blue-50" : "border-transparent hover:bg-gray-50"
                }`}
              >
                <span className="block text-sm font-medium text-gray-900">{p.product_name}</span>
                <span className="block font-mono text-xs text-gray-500">{p.slug}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
