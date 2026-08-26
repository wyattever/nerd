// frontend/app/vendors/page.tsx
//
// Cutover: the legacy single-page vendors monolith is now
// frontend/app/editor/(routed)/vendors/, split into layout/list/[slug]
// like the candidates/added/published editors before it. This route stays
// as a thin redirect rather than being deleted outright, so any existing
// /vendors bookmark keeps working -- matching the routing guide's Phase 6
// cutover approach for /editor and /records.

import { redirect } from "next/navigation";

export default function VendorsPage() {
  redirect("/editor/vendors");
}
