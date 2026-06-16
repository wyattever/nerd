import { ListingData } from "@/lib/types";

export function buildNcademiPreviewHtml(listing: ListingData): string {
  const vendorLink = listing.vendor_directory_url && listing.vendor_directory_url !== "#"
    ? `<a href="https://ncademi.org/provide/directory/vendors/${listing.vendor_name.toLowerCase().replace(/\s+/g, '-')}/">${listing.vendor_name}</a>`
    : listing.vendor_name;

  const vendorResourcesHtml = listing.vendor_resources.length
    ? `<h3>From ${listing.vendor_name || "Vendor"}</h3>
       <ul>
         ${listing.vendor_resources.map(r =>
           `<li><a href="${r.url}" target="_blank">${r.text}</a></li>`
         ).join("\n")}
       </ul>`
    : "";

  const otherResourcesHtml = listing.other_resources.length
    ? `<h3>From Other Sources</h3>
       <ul>
         ${listing.other_resources.map(r =>
           `<li><a href="${r.url}" target="_blank">${r.text}</a></li>`
         ).join("\n")}
       </ul>`
    : "";

  const supportHtml = listing.support_contacts.length
    ? `<div class="product-support">
         <h3>Support</h3>
         <ul>
           ${listing.support_contacts.map(c => {
             if (c.type === "email") {
               return `<li><a href="mailto:${c.value}">${c.value}</a></li>`;
             } else if (c.type === "url") {
               return `<li><a href="${c.value}" target="_blank">${c.label || c.value}</a></li>`;
             }
             return `<li>${c.value}</li>`;
           }).join("\n")}
         </ul>
       </div>`
    : "";

  const acrHtml = listing.acr_reports.length
    ? `<div class="edtech-acr">
         <h3>Accessibility Conformance Reports</h3>
         ${listing.acr_reports.map(acr => `
           <h4><a href="${acr.url}" target="_blank">${acr.title}</a></h4>
           <ul>
             ${acr.version ? `<li><strong>Version:</strong> ${acr.version}</li>` : ""}
             ${acr.date ? `<li><strong>Date:</strong> ${acr.date}</li>` : ""}
             ${acr.auditor_name
               ? `<li><strong>Completed by:</strong> ${acr.auditor_url
                   ? `<a href="${acr.auditor_url}" target="_blank">${acr.auditor_name}</a>`
                   : acr.auditor_name
                 }</li>`
               : ""}
           </ul>`
         ).join("\n")}
       </div>`
    : "";

  const aiInsightsHtml = listing.ai_insights
    ? `<div class="ai-insights" style="display: none;">
         <h3>AI Generated Insights</h3>
         <p>${listing.ai_insights}</p>
       </div>`
    : "";

  const lastUpdatedHtml = listing.last_updated
    ? `<p class="entry-meta has-text-align-right"><em>Product information last updated ${listing.last_updated}</em></p>`
    : "";

  const websiteLinkHtml = listing.product_website_url && listing.product_website_url !== "#"
    ? `<p><a href="${listing.product_website_url}">
         <i class="fa-regular fa-globe" aria-hidden="true"></i>
         ${listing.product_name} Website
       </a></p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en-US">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${listing.product_name} — NCADEMI EdTech Directory</title>
  <link rel="icon" href="https://ncademi.org/wp-content/uploads/2025/05/ncademi-icon-150x150.png" sizes="32x32">
  <link rel="icon" href="https://ncademi.org/wp-content/uploads/2025/05/ncademi-icon-300x300.png" sizes="192x192">

  <!-- WordPress block library styles -->
  <style>
    :root{--wp-block-synced-color:#7a00df;--wp-admin-theme-color:#007cba;}
    .wp-element-button{cursor:pointer}
    :where(body){margin:0}
    :where(.is-layout-flex){gap:0.5em}
    body .is-layout-flex{display:flex}
    .is-layout-flex{flex-wrap:wrap;align-items:center}
    .is-layout-flex > :is(*,div){margin:0}
    .screen-reader-text{border:0;clip-path:inset(50%);height:1px;margin:-1px;
      overflow:hidden;padding:0;position:absolute;width:1px;word-wrap:normal!important}
    .screen-reader-text:focus{background-color:#ddd;clip-path:none;color:#444;
      display:block;font-size:1em;height:auto;left:5px;line-height:normal;
      padding:15px 23px 14px;text-decoration:none;top:5px;width:auto;z-index:100000}
  </style>

  <!-- Classic theme styles -->
  <style>
    .wp-block-button__link{color:#fff;background-color:#32373c;border-radius:9999px;
      box-shadow:none;text-decoration:none;
      padding:calc(.667em + 2px) calc(1.333em + 2px);font-size:1.125em}
  </style>

  <!-- Font Awesome -->
  <script defer crossorigin="anonymous"
    src="https://kit.fontawesome.com/a7ee836cc9.js"></script>

  <!-- NCADEMI theme stylesheet -->
  <link rel="stylesheet"
    href="https://ncademi.org/wp-content/themes/ncademitheme/style.css?ver=1.3">

  <!-- Megamenu stylesheet -->
  <link rel="stylesheet"
    href="https://ncademi.org/wp-content/uploads/maxmegamenu/style.css?ver=abf1a2">

  <!-- Megamenu JS (needed for mobile toggle) -->
  <script src="https://ncademi.org/wp-includes/js/jquery/jquery.min.js?ver=3.7.1"></script>
  <script src="https://ncademi.org/wp-includes/js/jquery/jquery-migrate.min.js?ver=3.4.1"></script>
  <script src="https://ncademi.org/wp-content/plugins/megamenu/js/maxmegamenu.js?ver=3.10.5"></script>
  <script src="https://ncademi.org/wp-content/themes/ncademitheme/js/qi-navigation.js?ver=1.0.1"></script>

  <!-- N.E.R.D. preview indicator -->
  <style>
    .nerd-preview-banner {
      background: #0c2336;
      color: #fff;
      text-align: center;
      padding: 6px 12px;
      font-size: 13px;
      font-family: sans-serif;
      position: sticky;
      top: 0;
      z-index: 99999;
    }
    .nerd-preview-banner strong { color: #99c9eb; }
  </style>
</head>
<body class="wp-singular product-template-default single single-product wp-theme-ncademitheme ctct-ncademitheme mega-menu-primary">

  <!-- N.E.R.D. preview banner -->
  <div class="nerd-preview-banner" role="note">
    <strong>N.E.R.D. Preview</strong> — This is a simulated NCADEMI product page.
    Content has not been published to the live directory.
  </div>

  <!-- ===== SITE HEADER ===== -->
  <header class="site-header header-home">
    <div class="top-bar">
      <div class="logo-container">
        <a href="https://ncademi.org/">
          <img width="400" height="243"
            src="https://ncademi.org/wp-content/uploads/2025/07/ncademi-logo.webp"
            alt="NCADEMI: National Center on Accessible Digital Educational Materials &amp; Instruction">
        </a>
      </div>
      <div class="search-bar">
        <form action="https://ncademi.org/" method="get">
          <label for="site-search" class="screen-reader-text">Search the site</label>
          <input type="search" id="site-search" name="s" placeholder="Search">
          <button type="submit" aria-label="Submit search">
            <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M10 2a8 8 0 016.32 12.9l4.39 4.38a1 1 0 01-1.41 1.42l-4.38-4.39A8 8 0 1110 2zm0 2a6 6 0 100 12 6 6 0 000-12z"/>
            </svg>
          </button>
        </form>
      </div>
    </div>
    <div class="nav-bar-wrapper">
      <nav class="main-nav" aria-label="Primary navigation">
        <div id="mega-menu-wrap-primary" class="mega-menu-wrap">
          <div class="mega-menu-toggle">
            <div class="mega-toggle-blocks-right">
              <div class="mega-toggle-block mega-menu-toggle-animated-block mega-toggle-block-1" id="mega-toggle-block-1">
                <button aria-controls="mega-menu-primary" aria-expanded="false"
                  aria-haspopup="true" aria-label="Toggle Menu"
                  class="mega-toggle-animated mega-toggle-animated-slider" type="button">
                  <span class="mega-toggle-animated-box">
                    <span class="mega-toggle-animated-inner"></span>
                  </span>
                </button>
              </div>
            </div>
          </div>
          <ul id="mega-menu-primary"
            class="mega-menu max-mega-menu mega-menu-horizontal mega-no-js"
            data-event="hover_intent" data-effect="fade_up" data-effect-speed="200"
            data-effect-mobile="slide_right" data-effect-speed-mobile="200"
            data-mobile-force-width="false" data-second-click="go"
            data-document-click="collapse" data-vertical-behaviour="standard"
            data-breakpoint="950" data-unbind="true" data-mobile-state="collapse_all"
            data-mobile-direction="vertical">

            <li class="mega-menu-item mega-menu-item-has-children mega-align-bottom-left mega-menu-flyout mega-menu-item-4807" id="mega-menu-item-4807">
              <a class="mega-menu-link" href="https://ncademi.org/about/" aria-expanded="false">About<span class="mega-indicator" aria-hidden="true"></span></a>
              <ul class="mega-sub-menu">
                <li class="mega-menu-item"><a class="mega-menu-link" href="https://ncademi.org/about/">About NCADEMI</a></li>
                <li class="mega-menu-item"><a class="mega-menu-link" href="https://ncademi.org/blog/">Blog</a></li>
                <li class="mega-menu-item"><a class="mega-menu-link" href="https://ncademi.org/about/events/">Events</a></li>
                <li class="mega-menu-item"><a class="mega-menu-link" href="https://ncademi.org/about/nac/">National Advisory Council</a></li>
                <li class="mega-menu-item"><a class="mega-menu-link" href="https://ncademi.org/about/partners/">NCADEMI Partners</a></li>
                <li class="mega-menu-item"><a class="mega-menu-link" href="https://ncademi.org/newsletter/">Newsletter</a></li>
              </ul>
            </li>
            <li class="mega-menu-item mega-menu-item-has-children mega-align-bottom-left mega-menu-flyout mega-menu-item-4808" id="mega-menu-item-4808">
              <a class="mega-menu-link" href="https://ncademi.org/learn/" aria-expanded="false">Learn<span class="mega-indicator" aria-hidden="true"></span></a>
              <ul class="mega-sub-menu">
                <li class="mega-menu-item"><a class="mega-menu-link" href="https://ncademi.org/learn/">Learn Digital Accessibility</a></li>
                <li class="mega-menu-item"><a class="mega-menu-link" href="https://ncademi.org/learn/learning-modules/">Learning Modules</a></li>
                <li class="mega-menu-item"><a class="mega-menu-link" href="https://ncademi.org/learn/legal/">Legal Foundations</a></li>
                <li class="mega-menu-item"><a class="mega-menu-link" href="https://ncademi.org/learn/key-terms/">Key Terms</a></li>
                <li class="mega-menu-item"><a class="mega-menu-link" href="https://ncademi.org/learn/publications/">Publications</a></li>
                <li class="mega-menu-item"><a class="mega-menu-link" href="https://ncademi.org/learn/webinars/">Webinar Recordings</a></li>
              </ul>
            </li>
            <li class="mega-menu-item mega-menu-item-has-children mega-align-bottom-left mega-menu-flyout mega-menu-item-4809" id="mega-menu-item-4809">
              <a class="mega-menu-link" href="https://ncademi.org/create/" aria-expanded="false">Create<span class="mega-indicator" aria-hidden="true"></span></a>
              <ul class="mega-sub-menu">
                <li class="mega-menu-item"><a class="mega-menu-link" href="https://ncademi.org/create/">Create Accessible Content</a></li>
                <li class="mega-menu-item"><a class="mega-menu-link" href="https://ncademi.org/create/basics/">Accessibility Basics</a></li>
                <li class="mega-menu-item"><a class="mega-menu-link" href="https://ncademi.org/create/diy-accessibility-basics/">Document Starter Kit</a></li>
              </ul>
            </li>
            <li class="mega-menu-item mega-menu-item-has-children mega-align-bottom-left mega-menu-flyout mega-menu-item-4810" id="mega-menu-item-4810">
              <a class="mega-menu-link" href="https://ncademi.org/provide/" aria-expanded="false">Provide<span class="mega-indicator" aria-hidden="true"></span></a>
              <ul class="mega-sub-menu">
                <li class="mega-menu-item"><a class="mega-menu-link" href="https://ncademi.org/provide/">Provide Accessible Materials</a></li>
                <li class="mega-menu-item"><a class="mega-menu-link" href="https://ncademi.org/provide/edtech/">Accessible EdTech</a></li>
                <li class="mega-menu-item"><a class="mega-menu-link" href="https://ncademi.org/provide/formats/">Accessible Formats</a></li>
                <li class="mega-menu-item"><a class="mega-menu-link" href="https://ncademi.org/provide/directory/">EdTech Directory</a></li>
              </ul>
            </li>
            <li class="mega-menu-item mega-menu-item-has-children mega-align-bottom-left mega-menu-flyout mega-menu-item-4811" id="mega-menu-item-4811">
              <a class="mega-menu-link" href="https://ncademi.org/sustain/" aria-expanded="false">Sustain<span class="mega-indicator" aria-hidden="true"></span></a>
              <ul class="mega-sub-menu">
                <li class="mega-menu-item"><a class="mega-menu-link" href="https://ncademi.org/sustain/">Sustain Accessibility</a></li>
                <li class="mega-menu-item"><a class="mega-menu-link" href="https://ncademi.org/sustain/quality-indicators/">Quality Indicators</a></li>
                <li class="mega-menu-item"><a class="mega-menu-link" href="https://ncademi.org/sustain/roadmap/">ADA Title II Roadmap</a></li>
              </ul>
            </li>
            <li class="mega-contact-item mega-menu-item mega-hide-arrow mega-item-align-right contact-item" id="mega-menu-item-208">
              <a class="mega-menu-link" href="https://ncademi.org/contact/">Contact Us</a>
            </li>
            <li class="mega-menu-item mega-menu-item-has-children mega-align-bottom-left mega-menu-flyout mega-item-align-right mega-menu-item-4812" id="mega-menu-item-4812">
              <a class="mega-menu-link" href="https://ncademi.org/audiences/" aria-expanded="false">Audiences<span class="mega-indicator" aria-hidden="true"></span></a>
              <ul class="mega-sub-menu">
                <li class="mega-menu-item"><a class="mega-menu-link" href="https://ncademi.org/audiences/">All Audiences</a></li>
                <li class="mega-menu-item"><a class="mega-menu-link" href="https://ncademi.org/audiences/seas-leas/">SEAs and LEAs</a></li>
                <li class="mega-menu-item"><a class="mega-menu-link" href="https://ncademi.org/audiences/partc/">Part C</a></li>
                <li class="mega-menu-item"><a class="mega-menu-link" href="https://ncademi.org/audiences/parent-centers/">Parent Centers</a></li>
                <li class="mega-menu-item"><a class="mega-menu-link" href="https://ncademi.org/audiences/prep-programs/">Prep Programs</a></li>
                <li class="mega-menu-item"><a class="mega-menu-link" href="https://ncademi.org/audiences/osep-centers/">OSEP-Funded Centers</a></li>
              </ul>
            </li>
          </ul>
          <button aria-controls="mega-menu-primary" aria-label="Close" class="mega-close"></button>
        </div>
      </nav>
    </div>
  </header>

  <!-- ===== MAIN CONTENT ===== -->
  <main id="main" class="site-main">

    <p id="breadcrumbs">
      <span>
        <span><a href="https://ncademi.org/">Home</a></span> »
        <span><a href="https://ncademi.org/provide/">Provide</a></span> »
        <span><a href="https://ncademi.org/provide/directory/">EdTech Directory</a></span> »
        <span><a href="https://ncademi.org/provide/directory/products/">Products</a></span> »
        <span class="breadcrumb_last" aria-current="page">${listing.product_name}</span>
      </span>
    </p>

    <header class="page-header">
      <h1 class="page-title">${listing.product_name}</h1>
    </header>

    <article class="product type-product status-publish hentry">
      <div class="entry-summary">

        ${listing.vendor_name
          ? `<p><strong>Vendor:</strong> ${vendorLink}</p>`
          : ""}

        ${listing.product_description
          ? `<p>${listing.product_description}</p>`
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
  </main>

  <!-- ===== SITE FOOTER ===== -->
  <footer class="site-footer">
    <!-- Top row -->
    <div class="footer-content">
      <div class="footer-col">
        <ul class="contact-list">
          <h2>Contact Us</h2>
          <li><i class="fa-regular fa-envelope" style="color:#ec8e22;"></i>&nbsp;<a href="mailto:ncademi@usu.edu">ncademi@usu.edu</a></li>
          <li><i class="fa-regular fa-phone" style="color:#ec8e22;"></i>&nbsp;<a href="tel:4355548213">(435) 554-8213</a>&nbsp;(voice and text)</li>
          <li><i class="fa-regular fa-location-dot" style="color:#ec8e22;"></i>&nbsp;6581 Old Main Hill, Logan, UT 84322</li>
        </ul>
      </div>
      <div class="footer-col">
        <ul class="contact-list">
          <h2>Follow Us</h2>
          <li><i class="fa-brands fa-linkedin" style="color:#ec8e22;"></i>&nbsp;<a href="https://www.linkedin.com/company/ncademi/">LinkedIn</a></li>
          <li><i class="fa-brands fa-square-youtube" style="color:#ec8e22;"></i>&nbsp;<a href="https://www.youtube.com/@NCADEMI">YouTube</a></li>
          <li><a href="/newsletter/">Sign up for our newsletter</a></li>
        </ul>
      </div>
      <div class="footer-col footer-logos">
        <a href="https://idrpp.usu.edu">
          <img width="400" height="140"
            src="https://ncademi.org/wp-content/uploads/2025/07/idrpp-logo.webp"
            alt="Emma Eccles Jones College of Education and Human Services; Institute for Disability Research, Policy, &amp; Practice; Utah State University"
            loading="lazy">
        </a>
        <a href="https://ncademi.org/">
          <img width="400" height="134"
            src="https://ncademi.org/wp-content/uploads/2025/07/ncademi-logo-footer.webp"
            alt="National Center on Accessible Digital Educational Materials &amp; Instruction"
            loading="lazy">
        </a>
      </div>
    </div>
    <!-- Middle row -->
    <div class="footer-middle-row">
      <div class="middle-row-links">
        <ul>
          <li><a href="https://ncademi.org/accessibility/">Accessibility Statement</a></li>
          <li><a href="https://www.usu.edu/copyright/">Disclaimers &amp; Copyright</a></li>
          <li><a href="https://www.usu.edu/civilrights-titleix/non-discrimination">Non-Discrimination</a></li>
        </ul>
      </div>
    </div>
    <!-- Disclaimer row -->
    <div class="footer-disclaimer-row">
      <div class="disclaimer-logo-left">
        <img width="160" height="160"
          src="https://ncademi.org/wp-content/uploads/2025/07/osep-logo.webp"
          alt="Ideas that Work Office of Special Education Programs"
          loading="lazy">
      </div>
      <div class="disclaimer-text">
        <p>The contents of this website were developed under a cooperative agreement
        with the U.S. Department of Education, Office of Special Education Programs
        (Award No. H327Z240007). However, those contents do not necessarily represent
        the policy of the Department of Education, and you should not assume endorsement
        by the Federal Government. Project Officer: Rebecca Sheffield, Ph.D.</p>
        <p>This work is licensed under a
        <a href="https://creativecommons.org/licenses/by-sa/4.0/">Creative Commons
        Attribution-ShareAlike 4.0 International license</a>.
        Where indicated, images may be licensed separately.</p>
      </div>
      <div class="disclaimer-logo-right">
        <a href="https://creativecommons.org/licenses/by-sa/4.0/">
          <img width="160" height="56"
            src="https://ncademi.org/wp-content/uploads/2025/07/cc-logo.webp"
            alt="Creative Commons Attribution-ShareAlike 4.0 International"
            loading="lazy">
        </a>
      </div>
    </div>
  </footer>

</body>
</html>`;
}
