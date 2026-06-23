import { ListingData } from "@/lib/types";

function escapeHtml(str: string): string {
  if (!str) return str;
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildNcademiListingHtml(listing: ListingData): string {
  const safeVendorName = escapeHtml(listing.vendor_name);
  const safeProductName = escapeHtml(listing.product_name);
  const safeDescription = escapeHtml(listing.product_description);

  const vendorLink = listing.vendor_directory_url && listing.vendor_directory_url !== "#"
    ? `<a href="${listing.vendor_directory_url}">${safeVendorName}</a>`
    : safeVendorName;

  const vendorResourcesHtml = listing.vendor_resources.length
    ? `<h3>From ${safeVendorName || "Vendor"}</h3>
       <ul>
         ${listing.vendor_resources.map(r =>
           `<li><a href="${r.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.text)}</a></li>`
         ).join("
")}
       </ul>`
    : "";

  const otherResourcesHtml = listing.other_resources.length
    ? `<h3>From Other Sources</h3>
       <ul>
         ${listing.other_resources.map(r =>
           `<li><a href="${r.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.text)}</a></li>`
         ).join("
")}
       </ul>`
    : "";

  const supportHtml = listing.support_contacts.length
    ? `<div class="product-support">
         <h3>Support</h3>
         <ul>
           ${listing.support_contacts.map(c => {
             const safeValue = escapeHtml(c.value);
             const safeLabel = escapeHtml(c.label);
             if (c.type === "email") {
               return `<li><a href="mailto:${c.value}">${safeValue}</a></li>`;
             } else if (c.type === "url") {
               return `<li><a href="${c.value}" target="_blank" rel="noopener noreferrer">${safeLabel || safeValue}</a></li>`;
             }
             return `<li>${safeValue}</li>`;
           }).join("
")}
         </ul>
       </div>`
    : "";

  const acrHtml = listing.acr_reports.length
    ? `<div class="edtech-acr">
         <h3>Accessibility Conformance Reports</h3>
         ${listing.acr_reports.map(acr => `
           <h4><a href="${acr.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(acr.title)}</a></h4>
           <ul>
             ${acr.version ? `<li><strong>Version:</strong> ${escapeHtml(acr.version)}</li>` : ""}
             ${acr.date ? `<li><strong>Date:</strong> ${escapeHtml(acr.date)}</li>` : ""}
             ${acr.auditor_name
               ? `<li><strong>Completed by:</strong> ${acr.auditor_url
                   ? `<a href="${acr.auditor_url}" target="_blank" rel="noopener noreferrer">${escapeHtml(acr.auditor_name)}</a>`
                   : escapeHtml(acr.auditor_name)
                 }</li>`
               : ""}
           </ul>`
         ).join("
")}
       </div>`
    : "";

  const aiInsightsHtml = listing.ai_insights
    ? `<div class="ai-insights" style="display: none;">
         <h3>AI Generated Insights</h3>
         <p>${escapeHtml(listing.ai_insights)}</p>
       </div>`
    : "";

  const lastUpdatedHtml = listing.last_updated
    ? `<p class="entry-meta has-text-align-right"><em>Product information last updated ${escapeHtml(listing.last_updated)}</em></p>`
    : "";

  const websiteLinkHtml = listing.product_website_url && listing.product_website_url !== "#"
    ? `<p><a href="${listing.product_website_url}" target="_blank" rel="noopener noreferrer">
         <i class="fa-regular fa-globe" aria-hidden="true"></i>
         ${safeProductName} Website
       </a></p>`
    : "";

  return `
    <header class="page-header">
      <h1 class="page-title">${safeProductName}</h1>
    </header>

    <article class="product type-product status-publish hentry">
      <div class="entry-summary">

        ${listing.vendor_name
          ? `<p><strong>Vendor:</strong> ${vendorLink}</p>`
          : ""}

        ${listing.product_description
          ? `<p>${safeDescription}</p>`
          : ""}

        ${websiteLinkHtml}

        <h2>Accessibility Documentation &amp; Resources</h2>

        <div class="row g-4 g-lg-5 align-items-start">

          <!-- Left column: resource lists -->
          <div class="col-12 col-lg-8">
            ${vendorResourcesHtml}
            ${otherResourcesHtml}
          </div>

          <!-- Right column: support + ACR -->
          <div class="col-12 col-lg-4">
            ${supportHtml}
            ${acrHtml}
          </div>

        </div>

        ${aiInsightsHtml}

        ${lastUpdatedHtml}

      </div>
    </article>
  `;
}
