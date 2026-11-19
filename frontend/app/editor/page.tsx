// frontend/app/editor/page.tsx
//
// Retired: this route replaces the legacy single-page editor, retired under
// plan D21 (docs/mirror-promote-plan-11-02-26.md). Editing now lives in the
// routed editors under frontend/app/editor/(routed)/. This route stays as a
// thin redirect rather than being deleted outright, so /editor redirects to
// /editor/candidates and any existing /editor bookmark keeps working.

import { redirect } from "next/navigation";

export default function EditorPage() {
  redirect("/editor/candidates");
}
