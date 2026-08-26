// frontend/components/EditorNavSidebar.tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

const TABS = [
  {
    segment: "candidates",
    ariaLabel: "View candidate products",
    icon: "/candidates.svg",
  },
  {
    segment: "added",
    ariaLabel: "View added products",
    icon: "/added.svg",
  },
  {
    segment: "published",
    ariaLabel: "View published products",
    icon: "/published.svg",
  },
] as const;

interface EditorNavSidebarProps {
  base: "/editor" | "/records";
}

export function EditorNavSidebar({ base }: EditorNavSidebarProps) {
  const pathname = usePathname();

  const vendorsHref = "/editor/vendors";
  const isVendorsActive = pathname === vendorsHref || pathname.startsWith(`${vendorsHref}/`);

  return (
    <nav
      aria-label="Products"
      className="sticky top-6 flex h-[calc(100vh-4rem)] w-20 flex-shrink-0 flex-col items-center gap-3 self-start border-r border-gray-200 py-4 px-2"
    >
      <div role="group" aria-label="Product source" className="flex flex-col items-center gap-[10px]">
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
              className={`flex h-11 w-11 items-center justify-center rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                isActive
                  ? "border-blue-600 bg-blue-50 text-blue-700 shadow-sm"
                  : "border-gray-300 text-gray-600 hover:bg-gray-50"
              }`}
            >
              <Image src={tab.icon} alt={tab.segment} width={20} height={20} className="w-5 h-5" />
            </Link>
          );
        })}

        {/* Vendors cross-section shortcut */}
        <Link
          href={vendorsHref}
          scroll={false}
          aria-current={isVendorsActive ? "page" : undefined}
          aria-label="Vendor"
          className={`flex h-11 w-11 items-center justify-center rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            isVendorsActive
              ? "border-blue-600 bg-blue-50 text-blue-700 shadow-sm"
              : "border-gray-300 text-gray-600 hover:bg-gray-50"
          }`}
        >
          <Image src="/vendor.svg" alt="Vendor" width={20} height={20} className="w-5 h-5" />
        </Link>
      </div>
    </nav>
  );
}