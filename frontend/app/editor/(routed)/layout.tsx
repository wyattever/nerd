// frontend/app/editor/(routed)/layout.tsx
//
// Route group `(routed)` isolates this new shell from the still-live
// `frontend/app/editor/page.tsx` monolith -- a layout.tsx placed directly in
// app/editor/ would incorrectly wrap that legacy page too. EditorNavSidebar
// removed (Phase 2.5 hotfix): IntegratedListPanel (rendered further down
// the tree, inside each category's own layout.tsx) now owns the
// mode/category navigation, so this outer shell no longer renders a nav
// column of its own -- see IntegratedListPanel.tsx's header. Server
// Component by default; nothing left underneath it needs a client boundary
// at this level.

import type { ReactNode } from "react";

export default function EditorRoutedLayout({
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
