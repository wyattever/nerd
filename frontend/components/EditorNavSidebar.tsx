// frontend/components/EditorNavSidebar.tsx
"use client";

/**
 * Tab bar for the routed editor/records shells (frontend/app/editor/(routed)
 * and frontend/app/records/(routed)). New and separate from EditorSidebar.tsx
 * -- that component still drives the legacy single-page monolith and is left
 * untouched. Phase 1 scope only: tab links into the three leaf routes. The
 * filter/sort/list UI EditorSidebar currently owns moves here in Phase 2,
 * once each leaf has its own server-fetched data to render.
 *
 * `scroll={false}` on every <Link> is not optional -- Next.js resets scroll
 * to the top of the viewport on every route transition by default, which
 * would defeat the persistent-sidebar UX (the entire point of this shell)
 * on the very first tab click.
 *
 * The tab-icon group stacks vertically (flex-col), not horizontally --
 * each button wide enough to hold a 22px icon plus padding/border needs
 * roughly 40px, which doesn't fit even two across inside this w-20 (80px)
 * rail after its own p-4. A horizontal row here doesn't get clipped or
 * wrapped; flex items don't shrink below their content's intrinsic width
 * by default, so it overflows the <nav>'s box and visually bleeds into
 * whatever sits to its right (the leaf's own filter/list nav) -- the
 * reported "sidebar overlaps the icon rail" bug. Stacked vertically, each
 * button only has to fit the rail's own width, not share a row with two
 * others.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: ReadonlyArray<{ segment: "candidates" | "added" | "published"; icon: string; ariaLabel: string }> = [
  { segment: "candidates", icon: "add_circle", ariaLabel: "View candidate products" },
  { segment: "added", icon: "add_to_queue", ariaLabel: "View added products" },
  { segment: "published", icon: "published_with_changes", ariaLabel: "View published products" },
];

const ICON_STYLE = {
  fontFamily: "'Material Symbols Outlined'",
  fontVariationSettings: "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24",
  fontSize: "22px",
  lineHeight: 1,
} as const;

interface EditorNavSidebarProps {
  base: "/editor" | "/records";
}

export function EditorNavSidebar({ base }: EditorNavSidebarProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Products"
      className="sticky top-6 flex h-[calc(100vh-4rem)] w-20 flex-shrink-0 flex-col gap-3 self-start border-r border-gray-200 p-4"
    >
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&icon_names=add_circle,add_to_queue,published_with_changes,sell&display=swap"
      />

      <div role="group" aria-label="Product source" className="flex flex-col gap-[10px]">
        {TABS.map((tab) => {
          const href = `${base}/${tab.segment}`;
          const isActive = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={tab.segment}
              href={href}
              scroll={false}
              aria-current={isActive ? "page" : undefined}
              aria-label={tab.ariaLabel}
              className={`flex items-center justify-center rounded border p-2 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                isActive
                  ? "border-blue-600 bg-blue-50 text-blue-700"
                  : "border-gray-300 text-gray-600 hover:bg-gray-50"
              }`}
            >
              <span aria-hidden="true" style={ICON_STYLE}>
                {tab.icon}
              </span>
            </Link>
          );
        })}

        {/* Stub -- not wired to a route yet, unlike the TABS above. */}
        <a
          href="#"
          onClick={(e) => e.preventDefault()}
          aria-label="Vendor"
          className="flex items-center justify-center rounded border p-2 border-gray-300 text-gray-600 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <span aria-hidden="true" style={ICON_STYLE}>
            sell
          </span>
        </a>
      </div>
    </nav>
  );
}
