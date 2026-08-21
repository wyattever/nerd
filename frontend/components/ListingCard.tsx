"use client";

import { useRef, useState } from "react";
import DOMPurify from "dompurify";
import { ListingData } from "@/lib/types";
import { buildNcademiListingHtml } from "@/lib/ncademiPreview";

// The live NCADEMI theme's stylesheets, loaded ONLY inside this iframe's
// isolated document -- NOT in the app's root layout. Bootscore is a full
// Bootstrap-based theme; loading it app-wide broke the dashboard's own
// Tailwind styling (buttons, headings, spacing all got reset). Scoping it
// to an iframe gets accurate NCADEMI-page styling for the preview without
// touching anything else in the app. Confirmed against live view-source of
// a NCADEMI product page -- see session notes for the exact URLs/order.
const NCADEMI_STYLESHEETS = [
  "https://ncademi.org/wp-content/themes/bootscore/style.css?ver=7.1",
  "https://ncademi.org/wp-content/themes/bootscore-child/assets/css/main.css?ver=202608201748",
  "https://kit.fontawesome.com/a7ee836cc9.css",
  "https://ncademi.org/wp-content/themes/bootscore-child/style.css?ver=202608201747",
];

export function ListingCard({
  listing
}: {
  listing: ListingData
}) {
  const html = buildNcademiListingHtml(listing);
  const safeHtml = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(400);

  // Mirrors the live page's outer ancestry (body class, #page, main#primary,
  // .container) so Bootscore's descendant selectors resolve the same way
  // they do on the real site. safeHtml -- already DOMPurify-sanitized --
  // supplies the per-product content (whatever buildNcademiListingHtml
  // currently emits, including its own <article> wrapper).
  const srcDoc = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
${NCADEMI_STYLESHEETS.map(href => `<link rel="stylesheet" href="${href}" />`).join("\n")}
<style>body { margin: 0; padding: 1rem; }</style>
</head>
<body class="wp-singular product-template-default single single-product wp-theme-bootscore wp-child-theme-bootscore-child no-sidebar">
  <div id="page" class="site">
    <main id="primary" class="site-main edtech-directory-detail edtech-product-detail">
      <div class="container">
        ${safeHtml}
      </div>
    </main>
  </div>
</body>
</html>`;

  const handleLoad = () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc?.body) return;
    // Small delay lets the external stylesheets finish applying before we
    // measure -- avoids sizing the iframe against unstyled content.
    setTimeout(() => {
      if (doc.body) setHeight(doc.body.scrollHeight);
    }, 100);
  };

  return (
    <iframe
      ref={iframeRef}
      title={`${listing.product_name || "Product"} NCADEMI preview`}
      srcDoc={srcDoc}
      onLoad={handleLoad}
      style={{ width: "100%", height: `${height}px`, border: "none" }}
      sandbox="allow-same-origin"
    />
  );
}