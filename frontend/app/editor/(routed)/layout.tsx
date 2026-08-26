// frontend/app/editor/(routed)/layout.tsx
//
// Route group `(routed)` isolates this new shell from the still-live
// `frontend/app/editor/page.tsx` monolith -- a layout.tsx placed directly in
// app/editor/ would incorrectly wrap that legacy page too. Server Component
// by default; EditorNavSidebar is the only client boundary underneath it.

import type { ReactNode } from "react";
import { EditorNavSidebar } from "@/components/EditorNavSidebar";

export default function EditorRoutedLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen min-w-[1200px]">
      <EditorNavSidebar base="/editor" />
      <main className="flex-1">{children}</main>
    </div>
  );
}
