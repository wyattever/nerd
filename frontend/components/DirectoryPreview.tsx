// frontend/components/DirectoryPreview.tsx
"use client";

/**
 * Iframe-based preview of a DirectoryRecord (directory-schema.ts),
 * replacing the deleted VendorPreview.tsx. Renders both branch (kind
 * "vendor", with a Product/s section) and leaf (kind "product", no
 * Product/s section) records from the same component -- see
 * buildProductsSectionHtml below for the conditional.
 *
 * Follows ListingCard.tsx's sanitize pattern rather than the old
 * VendorPreview.tsx's escapeHtml-only one: build the inner content
 * fragment with escapeHtml, run it through DOMPurify.sanitize, and only
 * THEN wrap the sanitized fragment inside the trusted (hardcoded, not
 * user-derived) document shell/stylesheets -- sanitizing the full
 * document string risks DOMPurify stripping the <head>/<link> tags
 * themselves, since its default profile targets body content.
 */

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import DOMPurify from "dompurify";
import type { DirectoryRecord } from "@/lib/directory-schema";

// Duplicated from lib/ncademiPreview.ts / components/ListingCard.tsx's own
// stylesheet lists (neither exports theirs) -- kept in sync manually, same
// as ncademiPreview.ts's own header comment on this duplication.
const NCADEMI_STYLESHEETS = [
  "https://ncademi.org/wp-content/themes/bootscore/style.css?ver=7.1",
  "https://ncademi.org/wp-content/themes/bootscore-child/assets/css/main.css?ver=202608201748",
  "https://kit.fontawesome.com/a7ee836cc9.css",
  "https://ncademi.org/wp-content/themes/bootscore-child/style.css?ver=202608201747",
];

function escapeHtml(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildResourceListHtml(title: string, items: DirectoryRecord["vendor_resources"]): string {
  if (items.length === 0) return "";
  return `
    <h3 class="h4 mb-3">${escapeHtml(title)}</h3>
    <ul class="mb-4">
      ${items
        .map(
          (item) =>
            `<li><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.text)}</a></li>`
        )
        .join("\n")}
    </ul>
  `;
}

// Only branch (kind "vendor") records carry child products -- see
// directory-schema.ts's file header on the branch/leaf model.
function buildProductsSectionHtml(record: DirectoryRecord): string {
  if (record.kind !== "vendor" || record.products.length === 0) return "";
  return `
    <section class="edtech-vendor-products">
      <h2 class="h3 mb-4">Product/s</h2>
      <div class="vstack gap-4">
        ${record.products
          .map(
            (p) =>
              `<article><h3 class="h5 mb-2"><a href="${escapeHtml(p.ncademi_product_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.product_name)}</a></h3></article>`
          )
          .join("\n")}
      </div>
    </section>
  `;
}

function buildSupportSectionHtml(record: DirectoryRecord): string {
  const contacts = record.support_contacts;
  const items =
    contacts.length === 0
      ? '<p class="mb-0">No support contacts on file.</p>'
      : `<ul class="mb-0">
          ${contacts
            .map((c) => {
              const href = c.type === "email" ? `mailto:${c.value}` : c.value;
              const label = c.label || c.value;
              return `<li><a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a></li>`;
            })
            .join("\n")}
        </ul>`;
  return `
    <section class="card edtech-info-card edtech-info-card--support">
      <div class="card-body p-3 p-lg-4">
        <h2 class="h4 mb-3">Support</h2>
        ${items}
      </div>
    </section>
  `;
}

function buildAcrSectionHtml(record: DirectoryRecord): string {
  if (record.acr_reports.length === 0) return "";
  return `
    <section class="card edtech-info-card edtech-info-card--reports">
      <div class="card-body p-3 p-lg-4">
        <h2 class="h4 mb-4">Accessibility Conformance Reports</h2>
        <div class="vstack gap-3">
          ${record.acr_reports
            .map((acr) => {
              const title = acr.url
                ? `<a href="${escapeHtml(acr.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(acr.title)}</a>`
                : escapeHtml(acr.title);
              return `<article><h3 class="h6 mb-1">${title}</h3></article>`;
            })
            .join("\n")}
        </div>
      </div>
    </section>
  `;
}

function buildDirectoryArticleHtml(record: DirectoryRecord): string {
  const websiteLink = record.product_website_url
    ? `<p class="mb-0 edtech-website-link">
        <a href="${escapeHtml(record.product_website_url)}" target="_blank" rel="noopener noreferrer">
          <i class="fa-regular fa-globe" aria-hidden="true"></i>
          <span class="ml-2">${escapeHtml(record.product_name)} Website</span>
        </a>
      </p>`
    : "";

  const description = record.product_description ? `<p>${escapeHtml(record.product_description)}</p>` : "";

  const hasResources = record.vendor_resources.length > 0 || record.other_resources.length > 0;
  const resourcesSection = hasResources
    ? `<section class="edtech-resources mb-5">
        <h2 class="h3 mb-4">Accessibility Documentation &amp; Resources</h2>
        ${buildResourceListHtml(`From ${record.product_name}`, record.vendor_resources)}
        ${buildResourceListHtml("From Other Sources", record.other_resources)}
      </section>`
    : "";

  return `
    <article class="nc-single-vendor vendor type-vendor status-publish hentry">
      <header class="mb-4">
        <h1 class="mb-0">${escapeHtml(record.product_name)}</h1>
      </header>
      <div class="row g-4 g-lg-5 align-items-start">
        <div class="col-12 col-lg-8">
          <div class="entry-content mb-4">
            ${websiteLink}
            ${description}
          </div>
          ${resourcesSection}
          ${buildProductsSectionHtml(record)}
        </div>
        <div class="col-12 col-lg-4">
          ${buildSupportSectionHtml(record)}
          ${buildAcrSectionHtml(record)}
        </div>
      </div>
    </article>
  `;
}

export function DirectoryPreview({ record }: { record: DirectoryRecord }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(600);

  // DOMPurify.sanitize needs a real window/document, unavailable during
  // this "use client" component's SSR pass -- see ListingCard.tsx's own
  // comment on hasMounted for the full rationale.
  const hasMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const srcDoc = useMemo(() => {
    if (!hasMounted) return undefined;
    const articleHtml = buildDirectoryArticleHtml(record);
    const safeHtml = DOMPurify.sanitize(articleHtml, { USE_PROFILES: { html: true } });
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
${NCADEMI_STYLESHEETS.map((href) => `<link rel="stylesheet" href="${href}" />`).join("\n")}
<style>body { margin: 0; padding: 1rem; }</style>
</head>
<body class="wp-singular vendor-template-default single single-vendor wp-theme-bootscore wp-child-theme-bootscore-child no-sidebar">
  <div id="page" class="site">
    <main id="primary" class="site-main edtech-directory-detail edtech-vendor-detail">
      <div class="container">
        ${safeHtml}
      </div>
    </main>
  </div>
</body>
</html>`;
  }, [hasMounted, record]);

  const handleLoad = () => {
    const doc = iframeRef.current?.contentDocument;
    const body = doc?.body;
    if (!body) return;
    setTimeout(() => {
      // Only ever grows from the 600px default within this mount (a fresh
      // record is a fresh mount -- see VendorEditor.tsx's remount-per-slug
      // note -- so `prev` never carries a stale height over from a
      // differently-sized record). Treating the default as a floor instead
      // of a value that can also jump down avoids a visible shrink-flash
      // for short records; the transition below smooths any remaining
      // growth for long ones.
      setHeight((prev) => Math.max(prev, body.scrollHeight));
    }, 100);
  };

  return (
    <iframe
      ref={iframeRef}
      title={`${record.product_name || "Directory record"} preview`}
      srcDoc={srcDoc}
      onLoad={handleLoad}
      style={{ width: "100%", height: `${height}px`, border: "none", transition: "height 150ms ease-out" }}
      sandbox="allow-same-origin"
    />
  );
}
