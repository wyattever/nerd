"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
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
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(400);

  // DOMPurify.sanitize needs a real `window`/`document` to build its
  // internal sanitizer, which isn't available during this "use client"
  // component's SERVER render pass (Next still SSRs client components for
  // the initial HTML before hydration) -- calling it directly in the render
  // body is what threw "DOMPurify.sanitize is not a function".
  //
  // `hasMounted` gates the real computation to the client only, via
  // useSyncExternalStore rather than a useEffect+useState "isMounted" flag
  // -- that pattern still calls setState directly inside an effect body,
  // which is exactly what this codebase's "no setState in effect body"
  // lint rule (react-hooks/set-state-in-effect -- see editor/page.tsx's own
  // comment on having hit this rule before) flags, even for a trivial
  // boolean flip. useSyncExternalStore is React's own sanctioned mechanism
  // for a value that must legitimately differ between the server render and
  // the client: getServerSnapshot supplies `false` for SSR, getSnapshot
  // supplies `true` on the client, and React handles the post-hydration
  // re-render itself -- no explicit effect, no hydration-mismatch warning
  // (the subscribe callback is a no-op since this value never changes after
  // that first client render).
  const hasMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  // Mirrors the live page's outer ancestry (body class, #page, main#primary,
  // .container) so Bootscore's descendant selectors resolve the same way
  // they do on the real site. safeHtml -- DOMPurify-sanitized -- supplies
  // the per-product content (whatever buildNcademiListingHtml currently
  // emits, including its own <article> wrapper).
  const srcDoc = useMemo(() => {
    if (!hasMounted) return undefined;
    const html = buildNcademiListingHtml(listing);
    const safeHtml = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    return `<!DOCTYPE html>
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
  }, [hasMounted, listing]);

  const handleLoad = () => {
    const doc = iframeRef.current?.contentDocument;
    const body = doc?.body;
    if (!body) return;
    // Small delay lets the external stylesheets finish applying before we
    // measure -- avoids sizing the iframe against unstyled content.
    setTimeout(() => {
      // Only ever grows from the 400px default within this mount (a fresh
      // record is a fresh mount, so `prev` never carries a stale height
      // over from a differently-sized record). Treating the default as a
      // floor instead of a value that can also jump down avoids a visible
      // shrink-flash for short listings; the transition below smooths any
      // remaining growth for long ones.
      setHeight((prev) => Math.max(prev, body.scrollHeight));
    }, 100);
  };

  return (
    <iframe
      ref={iframeRef}
      title={`${listing.product_name || "Product"} NCADEMI preview`}
      srcDoc={srcDoc}
      onLoad={handleLoad}
      style={{ width: "100%", height: `${height}px`, border: "none", transition: "height 150ms ease-out" }}
      sandbox="allow-same-origin"
    />
  );
}
