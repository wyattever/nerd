// frontend/app/records/(routed)/layout.tsx
//
// Same route-group rationale as frontend/app/editor/(routed)/layout.tsx --
// isolates this shell from the still-live frontend/app/records/page.tsx
// monolith. EditorNavSidebar removed (Phase 2.5 hotfix): IntegratedListPanel
// (rendered further down the tree, inside each category's own layout.tsx)
// now owns the mode/category navigation, so this outer shell no longer
// renders a nav column of its own -- see IntegratedListPanel.tsx's header.

import type { ReactNode } from "react";

export default function RecordsRoutedLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen min-w-[1200px]">
      <main className="flex-1">{children}</main>
    </div>
  );
}
