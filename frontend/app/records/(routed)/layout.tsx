// frontend/app/records/(routed)/layout.tsx
//
// Same route-group rationale as frontend/app/editor/(routed)/layout.tsx --
// isolates this shell from the still-live frontend/app/records/page.tsx
// monolith. Reuses EditorNavSidebar (base="/records") rather than a
// duplicate component, since the tab bar itself has no /editor-specific
// behavior.

import type { ReactNode } from "react";
import { EditorNavSidebar } from "@/components/EditorNavSidebar";

export default function RecordsRoutedLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen min-w-[1200px]">
      <EditorNavSidebar base="/records" />
      <main className="flex-1">{children}</main>
    </div>
  );
}
