// frontend/components/VendorPreview.tsx
"use client";

/**
 * Iframe-based preview of a VendorRecord for the /vendors editor, modeled
 * after ListingCard.tsx's product preview -- see buildVendorPreviewHtml in
 * lib/ncademiPreview.ts for the live-NCADEMI-styled HTML this renders.
 *
 * Unlike ListingCard.tsx (whose component owns the outer <html>/<head>
 * wrapper, with buildNcademiListingHtml only returning the inner <article>
 * fragment), buildVendorPreviewHtml returns the COMPLETE document -- head,
 * stylesheets, and all -- so this component has no wrapping logic of its
 * own, per this dispatch's explicit design.
 *
 * Fixed height (min-h-[600px]) rather than ListingCard's measure-and-resize
 * approach (onLoad + iframe.contentDocument.body.scrollHeight): no dispatch
 * has asked for that yet, and a vendor page's content varies enough (some
 * vendors have zero resources/products) that a fixed minimum reads better
 * here than a possibly very short auto-sized frame.
 */

import { buildVendorPreviewHtml } from "@/lib/ncademiPreview";
import type { VendorRecord } from "@/lib/vendor-schema";

export function VendorPreview({ vendor }: { vendor: VendorRecord }) {
  return (
    <iframe
      title="Vendor Preview"
      srcDoc={buildVendorPreviewHtml(vendor)}
      className="h-full min-h-[600px] w-full border-0"
      sandbox="allow-same-origin"
    />
  );
}
