// frontend/components/RecordsTestSidebar.tsx
"use client";

/**
 * Sidebar layout exploration for /records-test -- based loosely on
 * EditorNavSidebar.tsx's icon-stack pattern (Link + Image, active-state
 * styling via usePathname), but split into a top section (editor/database
 * shell switch) and a bottom section (the four existing product/vendor
 * tabs) separated by a divider, with smaller hit targets so all six icons
 * fit vertically. Preview-only: not wired into any real page's shell yet.
 */

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

const TOP_TABS = [
  { href: "/editor", ariaLabel: "Editor", icon: "/editor.svg" },
  { href: "/records", ariaLabel: "Records", icon: "/database.svg" },
] as const;

const BOTTOM_TABS = [
  { href: "/editor/candidates", ariaLabel: "View candidate products", icon: "/candidates.svg" },
  { href: "/editor/added", ariaLabel: "View added products", icon: "/added.svg" },
  { href: "/editor/published", ariaLabel: "View published products", icon: "/published.svg" },
  { href: "/editor/vendors", ariaLabel: "Vendor", icon: "/vendor.svg" },
] as const;

export function RecordsTestSidebar() {
  const pathname = usePathname();

  const renderTab = (tab: { href: string; ariaLabel: string; icon: string }) => {
    const isActive = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
    return (
      <Link
        key={tab.href}
        href={tab.href}
        scroll={false}
        aria-current={isActive ? "page" : undefined}
        aria-label={tab.ariaLabel}
        className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          isActive
            ? "border-blue-600 bg-blue-50 text-blue-700 shadow-sm"
            : "border-gray-300 text-gray-600 hover:bg-gray-50"
        }`}
      >
        <Image src={tab.icon} alt={tab.ariaLabel} width={16} height={16} className="w-4 h-4" />
      </Link>
    );
  };

  return (
    <nav
      aria-label="Records test navigation"
      className="sticky top-6 flex h-[calc(100vh-4rem)] w-16 flex-shrink-0 flex-col items-center gap-3 self-start border-r border-gray-200 py-4 px-2"
    >
      <div role="group" aria-label="Shell" className="flex flex-col items-center gap-2">
        {TOP_TABS.map(renderTab)}
      </div>

      <hr className="w-10 border-gray-300" />

      <div role="group" aria-label="Product source" className="flex flex-col items-center gap-2">
        {BOTTOM_TABS.map(renderTab)}
      </div>
    </nav>
  );
}
