import { ListingData, ACRReport, SupportContact, ResourceLink } from "@/lib/types";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-lg font-semibold text-gray-800 border-b border-gray-200 pb-1 mb-3">
      {children}
    </h2>
  );
}

function LinkList({ items }: { items: ResourceLink[] }) {
  if (!items.length) return <p className="text-sm text-gray-400 italic">None found.</p>;
  return (
    <ul className="space-y-1">
      {items.map((item, i) => (
        <li key={i}>
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-700 underline hover:text-blue-900"
          >
            {item.text}
          </a>
        </li>
      ))}
    </ul>
  );
}

function ACRCard({ acr }: { acr: ACRReport }) {
  return (
    <div className="border border-gray-200 rounded p-3 text-sm space-y-1">
      <p className="font-medium">
        <a href={acr.url} target="_blank" rel="noopener noreferrer"
          className="text-blue-700 underline hover:text-blue-900">
          {acr.title}
        </a>
      </p>
      {acr.version && <p><span className="font-medium">Version:</span> {acr.version}</p>}
      {acr.date && <p><span className="font-medium">Date:</span> {acr.date}</p>}
      {acr.auditor_name && (
        <p>
          <span className="font-medium">Completed by:</span>{" "}
          {acr.auditor_url
            ? <a href={acr.auditor_url} target="_blank" rel="noopener noreferrer"
                className="text-blue-700 underline">{acr.auditor_name}</a>
            : acr.auditor_name}
        </p>
      )}
    </div>
  );
}

function SupportItem({ contact }: { contact: SupportContact }) {
  if (contact.type === "email") {
    return <li><a href={`mailto:${contact.value}`}
      className="text-sm text-blue-700 underline">{contact.value}</a></li>;
  }
  if (contact.type === "url") {
    return <li><a href={contact.value} target="_blank" rel="noopener noreferrer"
      className="text-sm text-blue-700 underline">{contact.label || contact.value}</a></li>;
  }
  return <li className="text-sm text-gray-700">{contact.value}</li>;
}

export function ListingCard({ listing }: { listing: ListingData }) {
  return (
    <div className="space-y-8">

      {/* Block 1: Product Header */}
      <section aria-labelledby="product-name">
        <h1 id="product-name" className="text-2xl font-bold text-gray-900 mb-1">
          {listing.product_name}
        </h1>
        {listing.vendor_name && (
          <p className="text-sm text-gray-600 mb-1">
            <span className="font-medium">Vendor:</span>{" "}
            {listing.vendor_directory_url && listing.vendor_directory_url !== "#"
              ? <a href={listing.vendor_directory_url} className="text-blue-700 underline">
                  {listing.vendor_name}
                </a>
              : listing.vendor_name}
          </p>
        )}
        {listing.product_description && (
          <p className="text-sm text-gray-700 mt-2">{listing.product_description}</p>
        )}
        {listing.product_website_url && listing.product_website_url !== "#" && (
          <p className="mt-2">
            <a href={listing.product_website_url} target="_blank" rel="noopener noreferrer"
              className="text-sm text-blue-700 underline">
              {listing.product_name} Website
            </a>
          </p>
        )}
      </section>

      {/* Block 2: Vendor Resources */}
      <section aria-labelledby="vendor-resources-heading">
        <SectionHeading>
          <span id="vendor-resources-heading">
            From {listing.vendor_name || "Vendor"}
          </span>
        </SectionHeading>
        <LinkList items={listing.vendor_resources} />
      </section>

      {/* Block 3: Third-Party Resources */}
      <section aria-labelledby="other-resources-heading">
        <SectionHeading>
          <span id="other-resources-heading">From Other Sources</span>
        </SectionHeading>
        <LinkList items={listing.other_resources} />
      </section>

      {/* Block 4: AI Generated Insights */}
      {listing.ai_insights && (
        <section aria-labelledby="ai-insights-heading">
          <SectionHeading>
            <span id="ai-insights-heading">AI Generated Insights</span>
          </SectionHeading>
          <p className="text-sm text-gray-700 leading-relaxed">{listing.ai_insights}</p>
        </section>
      )}

      {/* Block 5: ACR Reports */}
      {listing.acr_reports.length > 0 && (
        <section aria-labelledby="acr-heading">
          <SectionHeading>
            <span id="acr-heading">Accessibility Conformance Reports</span>
          </SectionHeading>
          <div className="space-y-3">
            {listing.acr_reports.map((acr, i) => <ACRCard key={i} acr={acr} />)}
          </div>
        </section>
      )}

      {/* Block 6: Support */}
      {listing.support_contacts.length > 0 && (
        <section aria-labelledby="support-heading">
          <SectionHeading>
            <span id="support-heading">Support</span>
          </SectionHeading>
          <ul className="space-y-1">
            {listing.support_contacts.map((c, i) => <SupportItem key={i} contact={c} />)}
          </ul>
        </section>
      )}

      {listing.last_updated && (
        <p className="text-xs text-gray-400">
          Product information last updated {listing.last_updated}
        </p>
      )}

    </div>
  );
}
