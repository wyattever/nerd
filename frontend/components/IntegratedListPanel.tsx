// frontend/components/IntegratedListPanel.tsx
"use client";

/**
 * Shared list panel for the integrated navigation rollout (see
 * docs/integrated_list_panel_rollout_guide.md) -- generalizes the
 * /records-test sandbox's RecordsTestListPanel.tsx into a production
 * component usable from any /editor or /records category route. Same
 * filter/sort/list nav + Messages footer structure as
 * CandidatesListPanel.tsx (see that file for the MessagesContext,
 * scroll={false}, and footer-placement rationale) and the same
 * integrated-icon-navigation layout RecordsTestListPanel.tsx explored,
 * carried over unchanged.
 *
 * Routing is driven entirely by props, not by re-deriving state from the
 * URL: `activeMode`/`activeCategory` tell this component which of the two
 * mode tabs and four category tabs to highlight and where the OTHER tabs
 * should point (a mode tab links to `/${mode}/${activeCategory}`, a
 * category tab links to `/${activeMode}/${category}` -- each switch
 * preserves the axis it didn't change). The one thing still read from
 * `usePathname()` is which `items` row is currently open, since that's a
 * record-level selection this component has no prop for.
 *
 * Layout (Phase 2.5 hotfix): the outer shell is a fixed h-screen/
 * overflow-hidden flex row -- nav and the main content area each manage
 * their own internal scrolling instead of the whole page scrolling. `main`
 * (not `{children}` directly) owns the flex-1/overflow-y-scroll/p-6 that
 * used to live on each editor page's own top-level element, so a page like
 * VendorEditor.tsx no longer needs (and should eventually drop) its own
 * matching wrapper -- left as-is here since that's a separate file. `main`
 * uses `overflow-y-scroll`, not `-auto`, matching the sidebar `<ul>` below
 * -- `-auto` only reserves scrollbar-gutter width when content actually
 * overflows, so switching between a short and a long record visibly
 * shifted the content width as the scrollbar appeared/disappeared.
 * `-scroll` always reserves that space.
 *
 * Sidebar creation footer (Phase 4.14/4.15): category-specific "create"
 * actions ("Import Candidate", "Add Vendor") moved from each editor's own
 * action bar into a sticky footer at the bottom of this nav, which always
 * renders (fixed min-height) so its border/background stay visually
 * present even on categories/modes with no create action. The buttons
 * live here (they need `activeMode`/`activeCategory` to know when to
 * render), but each one's click handler is owned by whichever editor is
 * mounted as `{children}` -- MessagesContextValue's `setCreateAction` is
 * how that handler crosses the boundary. See CandidateEditor.tsx /
 * VendorEditor.tsx for the registering side.
 */

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { DirectoryRecord } from "@/lib/directory-schema";

export interface LiveLogEntry {
  stage: string;
  message: string;
}

export type IntegratedListPanelMode = "editor" | "records";
export type IntegratedListPanelCategory = "candidates" | "added" | "published" | "vendors";

const MODE_TABS: ReadonlyArray<{ mode: IntegratedListPanelMode; ariaLabel: string; icon: string; label: string }> = [
  { mode: "editor", ariaLabel: "Editor", icon: "/editor.svg", label: "Editor" },
  { mode: "records", ariaLabel: "Records", icon: "/database.svg", label: "Records" },
];

const CATEGORY_TABS: ReadonlyArray<{
  category: IntegratedListPanelCategory;
  ariaLabel: string;
  icon: string;
  label: string;
}> = [
  { category: "candidates", ariaLabel: "View candidate products", icon: "/candidates.svg", label: "Candidates" },
  { category: "added", ariaLabel: "View added products", icon: "/added.svg", label: "Added" },
  { category: "published", ariaLabel: "View published products", icon: "/published.svg", label: "Published" },
  { category: "vendors", ariaLabel: "Vendor", icon: "/vendor.svg", label: "Vendor" },
];

interface MessagesContextValue {
  statusMessage: string;
  saveError: string;
  setStatusMessage: (message: string) => void;
  setSaveError: (message: string) => void;
  /** Lets the currently-mounted editor (CandidateEditor.tsx today; the
   *  only one with a create action) register the handler for this panel's
   *  sidebar "create" footer button (Phase 4.14) -- see this file's
   *  render below. Pass `null` to unregister (e.g. on unmount) so a
   *  stale handler from a previous record can't linger. */
  setCreateAction: (action: (() => void) | null) => void;
  /** SSE progress log for a live scrape (SourceToggle.tsx) -- one entry per
   *  stage, replaced in place by stage as new progress lines arrive rather
   *  than appended, matching scrape_ncademi_live.py's own "replace this
   *  stage's row" progress protocol (see that script's emit_progress). */
  liveLog: LiveLogEntry[];
  setLiveLog: (log: LiveLogEntry[] | ((prev: LiveLogEntry[]) => LiveLogEntry[])) => void;
  /** Moves focus to the Messages footer -- called when a live scrape starts
   *  so a screen-reader/keyboard user lands on the log as it begins
   *  updating instead of it silently changing off-screen. */
  focusMessages: () => void;
  /** Whether a live scrape is currently streaming -- lifted up from
   *  SourceToggle.tsx (rather than kept as that component's own local
   *  state) so this panel's liveLog render below can tell which entry, if
   *  any, is still "in progress" and should carry the ellipsis-animation
   *  class (globals.css) instead of every entry animating forever. */
  isRetrievingLive: boolean;
  setIsRetrievingLive: (value: boolean) => void;
}

const MessagesContext = createContext<MessagesContextValue | null>(null);

/** Used by a nested editor to report save/delete/field-editor status into
 *  this panel's persisting Messages footer -- see this file's header.
 *  Only valid inside IntegratedListPanel's subtree. */
export function useMessages(): MessagesContextValue {
  const ctx = useContext(MessagesContext);
  if (!ctx) throw new Error("useMessages must be used within IntegratedListPanel");
  return ctx;
}

interface IntegratedListPanelProps {
  items: DirectoryRecord[];
  /** Base path row links are built from: `${baseRoute}/${item.slug}` (e.g.
   *  "/editor/candidates"). */
  baseRoute: string;
  activeMode: IntegratedListPanelMode;
  activeCategory: IntegratedListPanelCategory;
  children: ReactNode;
}

export function IntegratedListPanel({ items, baseRoute, activeMode, activeCategory, children }: IntegratedListPanelProps) {
  const pathname = usePathname();
  const [filter, setFilter] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [statusMessage, setStatusMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [createAction, setCreateAction] = useState<(() => void) | null>(null);
  const [liveLog, setLiveLog] = useState<LiveLogEntry[]>([]);
  const [isRetrievingLive, setIsRetrievingLive] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const focusMessages = () => messagesRef.current?.focus();

  const messagesValue = useMemo(
    () => ({
      statusMessage,
      saveError,
      setStatusMessage,
      setSaveError,
      setCreateAction,
      liveLog,
      setLiveLog,
      focusMessages,
      isRetrievingLive,
      setIsRetrievingLive,
    }),
    [statusMessage, saveError, liveLog, isRetrievingLive]
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => item.slug.includes(q) || item.product_name.toLowerCase().includes(q));
  }, [items, filter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) =>
      sortOrder === "asc"
        ? a.product_name.localeCompare(b.product_name)
        : b.product_name.localeCompare(a.product_name)
    );
    return copy;
  }, [filtered, sortOrder]);

  const filterId = "integrated-list-filter";

  const renderModeLink = (tab: (typeof MODE_TABS)[number]) => {
    const href = `/${tab.mode}/${activeCategory}`;
    const isActive = tab.mode === activeMode;
    return (
      <div key={tab.mode} className="flex flex-col items-center">
        <Link
          href={href}
          scroll={false}
          aria-current={isActive ? "page" : undefined}
          aria-label={tab.ariaLabel}
          className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            isActive
              ? "border-blue-600 bg-blue-50 text-blue-700 shadow-sm"
              : "border-gray-300 text-gray-600 hover:bg-gray-50"
          }`}
        >
          <Image src={tab.icon} alt={tab.ariaLabel} width={18} height={18} className="w-4 h-4" />
        </Link>
        <span className="text-xs font-medium text-gray-600 mt-1">{tab.label}</span>
      </div>
    );
  };

  // Four columns instead of the mode row's two -- text-xs ("Candidates",
  // "Published") doesn't consistently fit alongside three siblings at this
  // width, so this row uses the smaller text-[10px] utility (carried over
  // from RecordsTestListPanel.tsx's own resolution of the same issue).
  const renderCategoryLink = (tab: (typeof CATEGORY_TABS)[number]) => {
    const href = `/${activeMode}/${tab.category}`;
    const isActive = tab.category === activeCategory;
    return (
      <div key={tab.category} className="flex flex-col items-center">
        <Link
          href={href}
          scroll={false}
          aria-current={isActive ? "page" : undefined}
          aria-label={tab.ariaLabel}
          className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            isActive
              ? "border-blue-600 bg-blue-50 text-blue-700 shadow-sm"
              : "border-gray-300 text-gray-600 hover:bg-gray-50"
          }`}
        >
          <Image src={tab.icon} alt={tab.ariaLabel} width={18} height={18} className="w-4 h-4" />
        </Link>
        <span className="text-[10px] font-medium text-gray-600 mt-1">{tab.label}</span>
      </div>
    );
  };

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <nav
        aria-label="Directory navigation and records"
        // w-56 (224px), down from w-72 (288px) -- reclaims 64px of the
        // ~352px of fixed app chrome (sidebar + main's p-6 padding + the
        // reserved scrollbar gutter) that was pushing the Visual Preview
        // iframe near Bootstrap's 992px lg breakpoint at ordinary window
        // widths, causing the Support/ACR sidebar cards to flip between
        // stacked and two-column layout on small zoom changes. Doesn't
        // touch the mirrored NCADEMI markup/CSS itself (DirectoryPreview.tsx,
        // lib/ncademiPreview.ts) -- that breakpoint is a faithful copy of
        // the live site's own, confirmed against its page source, so
        // overriding it directly would be the actual deviation.
        className="flex h-full w-56 flex-shrink-0 flex-col gap-3 self-start overflow-y-auto border-r border-gray-200 p-4"
      >
        <div role="group" aria-label="Shell" className="flex justify-evenly w-full">
          {MODE_TABS.map(renderModeLink)}
        </div>

        <hr className="my-3 border-gray-200" />

        <div role="group" aria-label="Product source" className="flex justify-between w-full mb-5">
          {CATEGORY_TABS.map(renderCategoryLink)}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={filterId} className="text-sm font-medium text-gray-700">
            Filter records
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

        <div className="flex items-center justify-center">
          <div role="group" aria-label="Sort records by name" className="flex gap-5">
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
          {sorted.map((item) => {
            const href = `${baseRoute}/${item.slug}`;
            const isActive = pathname === href;
            return (
              <li key={item.slug}>
                <Link
                  href={href}
                  scroll={false}
                  aria-current={isActive ? "true" : undefined}
                  className={`block w-full rounded-r border-l-4 px-3 py-2 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 ${isActive ? "border-blue-600 bg-blue-50" : "border-transparent hover:bg-gray-50"}`}
                >
                  <span className="block text-sm font-medium text-gray-900">{item.product_name}</span>
                  <span className="block font-mono text-xs text-gray-600">{item.slug}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Category-specific creation actions (Phase 4.14/4.15) -- the
            handler itself is registered by whichever editor is currently
            mounted via setCreateAction (see MessagesContextValue above),
            since the modal and its state belong to that editor, not this
            panel. Renders unconditionally (Phase 4.15) with a fixed
            min-height so the border/background stay visually present even
            when neither action applies (e.g. /records/*, /editor/added,
            /editor/published) -- only the button inside is conditional. */}
        <div className="sticky bottom-0 mt-auto min-h-[68px] border-t border-gray-200 bg-white p-4">
          {activeMode === "editor" && activeCategory === "candidates" && (
            <button
              type="button"
              disabled={!createAction}
              onClick={() => createAction?.()}
              className="w-full rounded border border-transparent bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Import Candidate
            </button>
          )}
          {activeMode === "editor" && activeCategory === "vendors" && (
            <button
              type="button"
              disabled={!createAction}
              onClick={() => createAction?.()}
              className="w-full rounded border border-transparent bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Add Vendor
            </button>
          )}
        </div>
      </nav>

      <MessagesContext.Provider value={messagesValue}>
        <div className="flex h-full flex-1 flex-col overflow-hidden">
          <main className="flex-1 h-full overflow-y-scroll p-6">{children}</main>

          <footer className="flex-shrink-0 border-t border-gray-200 p-6">
            <div className="w-full rounded-md border border-gray-300 bg-white">
              <div className="flex items-center rounded-t-md bg-gray-50 px-4 py-2.5 text-xs font-bold uppercase text-gray-500 border-b border-gray-300">Messages</div>
              <div ref={messagesRef} tabIndex={-1} role="log" className="flex flex-col gap-1 p-4 focus:outline-none">
                <p className="text-sm text-gray-600">Displaying {items.length} records.</p>
                <p role="status" aria-live="polite" className="text-sm text-gray-600 min-h-[1.25rem]">{statusMessage}</p>
                <p role="alert" className="text-sm font-semibold text-red-700 min-h-[1.25rem]">{saveError}</p>
                {liveLog.map((entry, index) => {
                  const isActive = isRetrievingLive && index === liveLog.length - 1;
                  return (
                    <p key={entry.stage} className={`text-sm text-gray-600${isActive ? " ellipsis-animation" : ""}`}>
                      {entry.message}
                    </p>
                  );
                })}
              </div>
            </div>
          </footer>
        </div>
      </MessagesContext.Provider>
    </div>
  );
}
