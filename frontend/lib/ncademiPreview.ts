import { ListingData, SectionKey } from "@/lib/types";

function escapeHtml(str: string): string {
  if (!str) return str;
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function genHeaderHtml(listing: ListingData): string {
  const parts: string[] = [];

  // Entry Header
  parts.push('<header class="entry-header alignwide">');
  parts.push(`<h1 id="product-name" class="entry-title">${escapeHtml(listing.product_name)}</h1>`);
  parts.push('</header>');

  // Product Header
  parts.push('<header class="product-header">');
  if (listing.vendor_name) {
    const vendorLink = (listing.vendor_directory_url && listing.vendor_directory_url !== '#')
      ? `<a href="${escapeHtml(listing.vendor_directory_url)}">${escapeHtml(listing.vendor_name)}</a>`
      : escapeHtml(listing.vendor_name);
    parts.push(`<p class="vendor-line"><strong>Vendor:</strong> ${vendorLink}</p>`);
  }

  if (listing.product_description) {
    parts.push(`<p class="product-desc">${escapeHtml(listing.product_description)}</p>`);
  }

  if (listing.product_website_url && listing.product_website_url !== '#') {
    parts.push(
      '<p class="product-website">' +
      `<a href="${escapeHtml(listing.product_website_url)}" target="_blank" rel="noopener noreferrer">` +
      `<i class="fa-solid fa-globe" aria-hidden="true"></i> ${escapeHtml(listing.product_name)} Website` +
      '</a></p>'
    );
  }
  parts.push('</header>');

  return parts.join("\n");
}

function genVendorResourcesHtml(listing: ListingData): string {
  if (!listing.vendor_resources || listing.vendor_resources.length === 0) {
    return "";
  }

  const vendorDisplayName = escapeHtml(listing.vendor_name || "Vendor");
  const parts = [
    `<h3 class="section-heading">From ${vendorDisplayName}</h3>`,
    '<ul class="wp-block-list resource-list">',
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
    '<h3 class="section-heading">From Other Sources</h3>',
    '<ul class="wp-block-list resource-list">',
    ...listing.other_resources.map(item =>
      `<li><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.text)}</a></li>`
    ),
    '</ul>'
  ];
  return parts.join("\n");
}

function genSupportHtml(listing: ListingData): string {
  if (!listing.support_contacts || listing.support_contacts.length === 0) {
    return "";
  }

  const parts: string[] = [];
  parts.push('<div class="product-support">');
  parts.push('<h3 class="section-heading">Support</h3>');
  parts.push('<ul class="wp-block-list resource-list">');
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
  parts.push('</ul></div>');
  return parts.join("\n");
}

function genAcrHtml(listing: ListingData): string {
  const parts: string[] = [];
  parts.push('<div class="edtech-acr">');
  parts.push('<h3 class="section-heading">Accessibility Conformance Reports</h3>');

  if (!listing.acr_reports || listing.acr_reports.length === 0) {
    parts.push('<div class="acr-report">');
    parts.push('<h4><a href="#" rel="noopener noreferrer">None found</a></h4>');
    parts.push('<ul>');
    parts.push('<li><strong>Version:</strong> </li>');
    parts.push('<li><strong>Date:</strong> </li>');
    parts.push('<li><strong>Completed by:</strong> </li>');
    parts.push('</ul></div>');
  } else {
    listing.acr_reports.forEach(acr => {
      parts.push('<div class="acr-report">');
      
      const hasValidUrl = acr.url && acr.url !== "#";
      const titleElement = hasValidUrl
        ? `<a href="${escapeHtml(acr.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(acr.title)}</a>`
        : escapeHtml(acr.title);

      parts.push(`<h4>${titleElement}</h4>`);
      parts.push('<ul>');
      parts.push('<li><strong>Version:</strong> </li>');
      parts.push('<li><strong>Date:</strong> </li>');
      parts.push('<li><strong>Completed by:</strong> </li>');
      parts.push('</ul></div>');
    });
  }
  
  parts.push('</div>');
  return parts.join("\n");
}

function genAiInsightsHtml(listing: ListingData): string {
  if (!listing.ai_insights || listing.ai_insights === "Insufficient data") {
    return "";
  }
  const parts = [];
  parts.push('<div class="ai-insights">');
  parts.push('<h3>AI Generated Insights</h3>');
  parts.push(`<p>${escapeHtml(listing.ai_insights)}</p>`);
  parts.push('</div>');
  return parts.join('\n');
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
    case "ai_insights":      return genAiInsightsHtml(listing);
  }
}

export function buildNcademiListingHtml(listing: ListingData, showAiInsights: boolean = true): string {
  const header = getSectionHtml(listing, "header");
  const vendorResources = getSectionHtml(listing, "vendor_resources");
  const otherResources = getSectionHtml(listing, "other_resources");
  const support = getSectionHtml(listing, "support");
  const acr = getSectionHtml(listing, "acr");
  const aiInsightsHtml = showAiInsights ? getSectionHtml(listing, "ai_insights") : "";

  const lastUpdatedHtml = listing.last_updated
    ? `<p class="last-updated">Product information last updated ${escapeHtml(listing.last_updated)}</p>`
    : "";

  return `
    ${header}
    <article class="product type-product status-publish hentry">
      <div class="nerd-artifact">
        <div class="entry-content">
          <h2 class="resources-heading">Accessibility Documentation &amp; Resources</h2>
          <div class="wp-block-columns is-layout-flex wp-container-core-columns-is-layout-1 wp-block-columns-is-layout-flex resources-grid">
            <div class="wp-block-column is-layout-flow wp-block-column-is-layout-flow col-main" style="flex-basis:66.66%">
              ${vendorResources}
              ${otherResources}
              ${aiInsightsHtml}
            </div>
            <div class="wp-block-column is-layout-flow wp-block-column-is-layout-flow col-side" style="flex-basis:33.33%">
              ${support}
              ${acr}
            </div>
          </div>
          ${lastUpdatedHtml}
        </div>
      </div>
    </article>
  `;
}
