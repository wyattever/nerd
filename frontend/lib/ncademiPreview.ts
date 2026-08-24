import { ListingData, SectionKey } from "@/lib/types";
import type { VendorRecord } from "@/lib/vendor-schema";

function escapeHtml(str: string): string {
  if (!str) return str;
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// last_updated is not uniformly shaped: the published snapshot already
// carries a human-readable "March 20, 2026" string, while records created
// through ImportJsonModal's boilerplate fill get `new Date().toISOString()`
// (see ImportJsonModal.tsx). Both parse via the Date constructor, so this
// normalizes either shape to one display format rather than assuming one or
// the other. An unparseable value (empty string already filtered by the
// `listing.last_updated ?` check below; anything else malformed) falls back
// to the raw string so a bad value renders as-is instead of "Invalid Date".
function formatLastUpdated(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

function genHeaderHtml(listing: ListingData): string {
  const parts: string[] = [];

  // h1#product-name retained -- used by frontend/tests/e2e/candidate_lifecycle.spec.ts,
  // frontend/tests/e2e/live_run.spec.ts, and frontend/app/nerd-table.css.
  // Restyled to match the live page's outer <header class="mb-4"><h1 class="mb-0">
  // wrapper instead of the old entry-header/entry-title classes.
  parts.push('<header class="mb-4">');
  parts.push(`<h1 id="product-name" class="mb-0">${escapeHtml(listing.product_name)}</h1>`);
  parts.push('</header>');

  parts.push('<div class="entry-content mb-4">');

  if (listing.vendor_name) {
    const vendorLink = (listing.vendor_directory_url && listing.vendor_directory_url !== '#')
      ? `<a href="${escapeHtml(listing.vendor_directory_url)}">${escapeHtml(listing.vendor_name)}</a>`
      : escapeHtml(listing.vendor_name);
    parts.push(`<p class="mb-2"><strong>Vendor:</strong> ${vendorLink}</p>`);
  }

  if (listing.product_description) {
    parts.push(`<p>${escapeHtml(listing.product_description)}</p>`);
  }

  if (listing.product_website_url && listing.product_website_url !== '#') {
    parts.push(
      '<p class="mb-0 edtech-website-link">' +
      `<a href="${escapeHtml(listing.product_website_url)}" target="_blank" rel="noopener noreferrer">` +
      `<i class="fa-regular fa-globe" aria-hidden="true"></i> ` +
      `<span>${escapeHtml(listing.product_name)} Website</span>` +
      '</a></p>'
    );
  }
  parts.push('</div>');

  return parts.join("\n");
}

function genVendorResourcesHtml(listing: ListingData): string {
  if (!listing.vendor_resources || listing.vendor_resources.length === 0) {
    return "";
  }

  const vendorDisplayName = escapeHtml(listing.vendor_name || "Vendor");
  const parts = [
    `<h3 class="h4 mb-3">From ${vendorDisplayName}</h3>`,
    '<ul class="mb-4">',
    ...listing.vendor_resources.map(item =>
      `<li><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.text)}</a></li>`
    ),
    '</ul>'
  ];
  return parts.join("\n");
}

function genOtherResourcesHtml(listing: ListingData): string {
  if (!listing.other_resources || listing.other_resources.length === 0) {
    return "";
  }

  const parts = [
    '<h3 class="h4 mb-3">From Other Sources</h3>',
    '<ul class="mb-0">',
    ...listing.other_resources.map(item =>
      `<li><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.text)}</a></li>`
    ),
    '</ul>'
  ];
  return parts.join("\n");
}

// Restyled to match the live page's sidebar card markup:
// <section class="card edtech-info-card edtech-info-card--support mb-3">
//   <div class="card-body p-3 p-lg-4"><h2 class="h4 mb-3">Support</h2><ul class="mb-0">...
// The old .product-support/.section-heading/.resource-list classes only ever
// meant something to templates/nerd.css, which never matched the live theme --
// see session notes on the bootscore restyle. Confirmed against live
// view-source of the Adobe Express product page.
function genSupportHtml(listing: ListingData): string {
  if (!listing.support_contacts || listing.support_contacts.length === 0) {
    return "";
  }

  const parts: string[] = [];
  parts.push('<section class="card edtech-info-card edtech-info-card--support mb-3">');
  parts.push('<div class="card-body p-3 p-lg-4">');
  parts.push('<h2 class="h4 mb-3">Support</h2>');
  parts.push('<ul class="mb-0">');
  listing.support_contacts.forEach(contact => {
    parts.push('<li>');
    if (contact.type === "email") {
      parts.push(`<a href="mailto:${escapeHtml(contact.value)}">${escapeHtml(contact.value)}</a>`);
    } else if (contact.type === "url") {
      const label = escapeHtml(contact.label || contact.value);
      parts.push(`<a href="${escapeHtml(contact.value)}" target="_blank" rel="noopener noreferrer">${label}</a>`);
    } else {
      parts.push(escapeHtml(contact.value));
    }
    parts.push('</li>');
  });
  parts.push('</ul>');
  parts.push('</div>');
  parts.push('</section>');
  return parts.join("\n");
}

// Restyled to match the live page's sidebar card markup:
// <section class="card edtech-info-card edtech-info-card--reports">
//   <div class="card-body p-3 p-lg-4"><h2 class="h4 mb-4">Accessibility Conformance
//   Reports</h2><div class="vstack gap-3"><article><h3 class="h6 mb-1">...
// Per-report entries are <article> elements inside a .vstack, not the old
// .acr-report divs. Confirmed against live view-source of the Adobe Express
// product page (3 real ACR entries; that page has no zero-ACR example, so the
// empty-state fallback below is adapted from the old markup, not independently
// verified against a live "no ACR" page -- flagging in case it needs a check).
function genAcrHtml(listing: ListingData): string {
  const parts: string[] = [];
  parts.push('<section class="card edtech-info-card edtech-info-card--reports">');
  parts.push('<div class="card-body p-3 p-lg-4">');
  parts.push('<h2 class="h4 mb-4">Accessibility Conformance Reports</h2>');

  if (!listing.acr_reports || listing.acr_reports.length === 0) {
    parts.push('<div class="vstack gap-3">');
    parts.push('<article>');
    parts.push('<h3 class="h6 mb-1">None found</h3>');
    parts.push('</article>');
    parts.push('</div>');
  } else {
    parts.push('<div class="vstack gap-3">');
    listing.acr_reports.forEach(acr => {
      parts.push('<article>');

      const hasValidUrl = acr.url && acr.url !== "#";
      const titleElement = hasValidUrl
        ? `<a href="${escapeHtml(acr.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(acr.title)}</a>`
        : escapeHtml(acr.title);

      parts.push(`<h3 class="h6 mb-1">${titleElement}</h3>`);

      const liItems: string[] = [];
      if (acr.version) {
        liItems.push(`<li><strong>Version:</strong> ${escapeHtml(acr.version)}</li>`);
      }
      if (acr.date) {
        liItems.push(`<li><strong>Date:</strong> ${escapeHtml(acr.date)}</li>`);
      }
      if (acr.auditor_name) {
        const auditor = acr.auditor_url
          ? `<a href="${escapeHtml(acr.auditor_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(acr.auditor_name)}</a>`
          : escapeHtml(acr.auditor_name);
        liItems.push(`<li><strong>Completed by:</strong> ${auditor}</li>`);
      }

      if (liItems.length > 0) {
        parts.push(`<ul class="small mb-0">${liItems.join("")}</ul>`);
      }

      parts.push('</article>');
    });
    parts.push('</div>');
  }

  parts.push('</div>');
  parts.push('</section>');
  return parts.join("\n");
}

export function getSectionHtml(listing: ListingData, key: SectionKey): string {
  const override = listing.section_overrides?.[key];
  if (override != null) return override;  // empty string is a valid override — see R6
  switch (key) {
    case "header":           return genHeaderHtml(listing);
    case "vendor_resources": return genVendorResourcesHtml(listing);
    case "other_resources":  return genOtherResourcesHtml(listing);
    case "support":          return genSupportHtml(listing);
    case "acr":              return genAcrHtml(listing);
  }
}

// Outer wrapper restyled to match the live page's <div class="row g-4 g-lg-5
// align-items-start"><div class="col-12 col-lg-8">...resources...</div>
// <div class="col-12 col-lg-4">...support/acr cards...</div></div> structure.
// The old wp-block-columns/resources-grid/h2.resources-heading wrapper never
// matched bootscore and is dropped here. Known simplification, flagged rather
// than silently expanded: genHeaderHtml's returned block (header + .entry-content)
// is kept as one unit per the existing "header" SectionKey/override contract
// and rendered above the two-column row, rather than splitting .entry-content
// into col-lg-8 as the live page does -- that would require changing the
// SectionKey shape (types.ts, SectionEditor.tsx) and is out of scope here.
// Confirmed against live view-source of the Adobe Express product page.
export function buildNcademiListingHtml(listing: ListingData): string {
  const header = getSectionHtml(listing, "header");
  const vendorResources = getSectionHtml(listing, "vendor_resources");
  const otherResources = getSectionHtml(listing, "other_resources");
  const support = getSectionHtml(listing, "support");
  const acr = getSectionHtml(listing, "acr");

  const lastUpdatedHtml = listing.last_updated
    ? `<p class="text-end text-body-secondary mt-4 mb-0"><em>Product information last updated ${escapeHtml(formatLastUpdated(listing.last_updated))}</em></p>`
    : "";

  const resourcesSection = (vendorResources || otherResources)
    ? `<section class="edtech-resources mb-4">
        <h2 class="h3 mb-4">Accessibility Documentation &amp; Resources</h2>
        ${vendorResources}
        ${otherResources}
      </section>`
    : "";

  return `
    <article class="nc-single-product product type-product status-publish hentry">
      <div class="row g-4 g-lg-5 align-items-start">
        <div class="col-12 col-lg-8">
          ${header}
          ${resourcesSection}
        </div>
        <div class="col-12 col-lg-4">
          ${support}
          ${acr}
        </div>
      </div>
      ${lastUpdatedHtml}
    </article>
  `;
}

// Stylesheet hrefs duplicated from components/ListingCard.tsx's own
// NCADEMI_STYLESHEETS constant (not exported there, and importing a .tsx
// component into this .ts module would invert the existing dependency
// direction -- ListingCard.tsx imports buildNcademiListingHtml FROM here).
// Kept in sync manually; if the live theme's asset versions change, update
// both places.
//
// NOTE: this dispatch's task text specified different hrefs
// (bootscore-main/css/main.css?ver=6.1.1 and
// bootscore-main/fontawesome/css/all.min.css?ver=6.1.1) -- both 404 on the
// live site as of this writing. Using the verified-working set below
// instead (confirmed 200 via curl), with the requested `id` attributes
// attached to their closest real equivalents, since shipping a 404'd
// stylesheet would defeat the entire point of this preview.
const VENDOR_PREVIEW_STYLESHEETS: ReadonlyArray<{ id?: string; href: string }> = [
  { id: "bootscore-style-css", href: "https://ncademi.org/wp-content/themes/bootscore/style.css?ver=7.1" },
  { href: "https://ncademi.org/wp-content/themes/bootscore-child/assets/css/main.css?ver=202608201748" },
  { id: "fontawesome-css", href: "https://kit.fontawesome.com/a7ee836cc9.css" },
  { href: "https://ncademi.org/wp-content/themes/bootscore-child/style.css?ver=202608201747" },
];

function genVendorWebsiteLinkHtml(vendor: VendorRecord): string {
  if (!vendor.vendor_website_url) return "";
  return (
    '<p class="mb-0 edtech-website-link">' +
    `<a href="${escapeHtml(vendor.vendor_website_url)}" target="_blank" rel="noopener noreferrer">` +
    `<i class="fa-regular fa-globe" aria-hidden="true"></i> ` +
    `<span>${escapeHtml(vendor.vendor_name)} Website</span>` +
    "</a></p>"
  );
}

function genVendorResourcesSectionHtml(vendor: VendorRecord): string {
  const resources = vendor.resources ?? [];
  if (resources.length === 0) return "";

  const parts = [
    '<section class="edtech-resources mb-5">',
    '<h2 class="h3 mb-4">Accessibility Documentation &amp; Resources</h2>',
    `<h3 class="h4 mb-3">From ${escapeHtml(vendor.vendor_name)}</h3>`,
    '<ul class="mb-4">',
    ...resources.map(
      (r) => `<li><a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.text)}</a></li>`
    ),
    "</ul>",
    "</section>",
  ];
  return parts.join("\n");
}

// <article><h3 class="h5 mb-2"><a>...</a></h3></article> only, per this
// dispatch's explicit pattern -- the live page also has a <p class="mb-0">
// description under each h3, but VendorProductLink (vendor-schema.ts) has
// no description field to fill it with, so it's omitted rather than
// invented.
function genVendorProductsSectionHtml(vendor: VendorRecord): string {
  const products = vendor.products ?? [];
  if (products.length === 0) return "";

  const parts = [
    '<section class="edtech-vendor-products">',
    '<h2 class="h3 mb-4">Product/s</h2>',
    '<div class="vstack gap-4">',
    ...products.map(
      (p) =>
        `<article><h3 class="h5 mb-2"><a href="${escapeHtml(p.ncademi_product_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.product_name)}</a></h3></article>`
    ),
    "</div>",
    "</section>",
  ];
  return parts.join("\n");
}

function genVendorSupportSectionHtml(vendor: VendorRecord): string {
  const contacts = vendor.support_contacts ?? [];

  const parts: string[] = [];
  parts.push('<section class="card edtech-info-card edtech-info-card--support">');
  parts.push('<div class="card-body p-3 p-lg-4">');
  parts.push('<h2 class="h4 mb-3">Support</h2>');

  if (contacts.length === 0) {
    parts.push('<p class="mb-0">No support contacts on file.</p>');
  } else {
    parts.push('<ul class="mb-0">');
    contacts.forEach((contact) => {
      parts.push("<li>");
      if (contact.type === "email") {
        parts.push(`<a href="mailto:${escapeHtml(contact.value)}">${escapeHtml(contact.value)}</a>`);
      } else {
        const label = escapeHtml(contact.label || contact.value);
        parts.push(`<a href="${escapeHtml(contact.value)}" target="_blank" rel="noopener noreferrer">${label}</a>`);
      }
      parts.push("</li>");
    });
    parts.push("</ul>");
  }

  parts.push("</div>");
  parts.push("</section>");
  return parts.join("\n");
}

// Unlike buildNcademiListingHtml above (which returns only the <article>
// fragment -- ListingCard.tsx owns the surrounding <html>/<head>/stylesheet
// wrapper), this returns the COMPLETE srcDoc document, head and all, per
// this dispatch's explicit design: VendorPreview.tsx is meant to be nothing
// but `<iframe srcDoc={buildVendorPreviewHtml(vendor)} />` with no wrapping
// logic of its own. Every dynamic value is escapeHtml()'d the same way
// buildNcademiListingHtml's are, which is this function's only XSS defense
// -- there is no DOMPurify pass here, unlike ListingCard.tsx's fragment.
//
// Structure (article.nc-single-vendor, header h1, entry-content
// .edtech-website-link, section.edtech-resources, section.edtech-vendor-products,
// section.card.edtech-info-card--support) confirmed against live
// view-source of https://ncademi.org/provide/directory/vendors/adobe/.
export function buildVendorPreviewHtml(vendor: VendorRecord): string {
  const stylesheetLinks = VENDOR_PREVIEW_STYLESHEETS.map(
    (s) => `<link rel="stylesheet"${s.id ? ` id="${s.id}"` : ""} href="${s.href}" media="all" />`
  ).join("\n");

  const websiteLink = genVendorWebsiteLinkHtml(vendor);
  const resourcesSection = genVendorResourcesSectionHtml(vendor);
  const productsSection = genVendorProductsSectionHtml(vendor);
  const supportSection = genVendorSupportSectionHtml(vendor);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
${stylesheetLinks}
<style>body { margin: 0; padding: 1rem; }</style>
</head>
<body class="wp-singular vendor-template-default single single-vendor wp-theme-bootscore wp-child-theme-bootscore-child no-sidebar">
  <div id="page" class="site">
    <main id="primary" class="site-main edtech-directory-detail edtech-vendor-detail">
      <div class="container">
        <article class="nc-single-vendor vendor type-vendor status-publish hentry">
          <header class="mb-4">
            <h1 class="mb-0">${escapeHtml(vendor.vendor_name)}</h1>
          </header>
          <div class="row g-4 g-lg-5 align-items-start">
            <div class="col-12 col-lg-8">
              <div class="entry-content mb-4">
                ${websiteLink}
              </div>
              ${resourcesSection}
              ${productsSection}
            </div>
            <div class="col-12 col-lg-4">
              ${supportSection}
            </div>
          </div>
        </article>
      </div>
    </main>
  </div>
</body>
</html>`;
}