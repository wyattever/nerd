import { ListingData, ACRReport, SupportContact, ResourceLink } from "@/lib/types";

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="text-base font-semibold text-gray-800 mt-6 mb-2">
      {children}
    </h3>
  );
}

function LinkList({ items }: { items: ResourceLink[] }) {
  if (!items.length) return null;
  return (
    <ul className="list-disc list-inside space-y-1">
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
    <div className="mb-4">
      <h4 className="text-sm font-semibold mb-1">
        <a
          href={acr.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-700 underline hover:text-blue-900"
        >
          {acr.title}
        </a>
      </h4>
      <ul className="list-none space-y-0.5 text-sm text-gray-700">
        {acr.version && (
          <li><span className="font-medium">Version:</span> {acr.version}</li>
        )}
        {acr.date && (
          <li><span className="font-medium">Date:</span> {acr.date}</li>
        )}
        {acr.auditor_name && (
          <li>
            <span className="font-medium">Completed by:</span>{" "}
            {acr.auditor_url
              ? <a href={acr.auditor_url} target="_blank" rel="noopener noreferrer"
                  className="text-blue-700 underline hover:text-blue-900">
                  {acr.auditor_name}
                </a>
              : acr.auditor_name}
          </li>
        )}
      </ul>
    </div>
  );
}

function SupportItem({ contact }: { contact: SupportContact }) {
  if (contact.type === "email") {
    return (
      <li>
        <a href={`mailto:${contact.value}`}
          className="text-sm text-blue-700 underline hover:text-blue-900">
          {contact.value}
        </a>
      </li>
    );
  }
  if (contact.type === "url") {
    return (
      <li>
        <a href={contact.value} target="_blank" rel="noopener noreferrer"
          className="text-sm text-blue-700 underline hover:text-blue-900">
          {contact.label || contact.value}
        </a>
      </li>
    );
  }
  return <li className="text-sm text-gray-700">{contact.value}</li>;
}

export function ListingCard({ listing }: { listing: ListingData }) {
  return (
    <div className="space-y-2">

      {/* Product Header */}
      <header>
        <h1 id="product-name" className="text-2xl font-bold text-gray-900 mb-1">
          {listing.product_name}
        </h1>

        {listing.vendor_name && (
          <p className="text-sm text-gray-700 mb-1">
            <strong>Vendor:</strong>{" "}
            {listing.vendor_directory_url && listing.vendor_directory_url !== "#"
              ? (
                <a href={listing.vendor_directory_url}
                  className="text-blue-700 underline hover:text-blue-900">
                  {listing.vendor_name}
                </a>
              )
              : listing.vendor_name}
          </p>
        )}

        {listing.product_description && (
          <p className="text-sm text-gray-700 mb-1">
            {listing.product_description}
          </p>
        )}

        {listing.product_website_url && listing.product_website_url !== "#" && (
          <p className="text-sm mb-1">
            <a
              href={listing.product_website_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 underline hover:text-blue-900"
            >
              🌐 {listing.product_name} Website
            </a>
          </p>
        )}
      </header>

      {/* Section heading */}
      <h2 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-1 mt-4">
        Accessibility Documentation &amp; Resources
      </h2>

      {/* From Vendor */}
      {listing.vendor_resources.length > 0 && (
        <section aria-labelledby="vendor-resources-heading">
          <SectionHeading id="vendor-resources-heading">
            From {listing.vendor_name || "Vendor"}
          </SectionHeading>
          <LinkList items={listing.vendor_resources} />
        </section>
      )}

      {/* From Other Sources */}
      {listing.other_resources.length > 0 && (
        <section aria-labelledby="other-resources-heading">
          <SectionHeading id="other-resources-heading">
            From Other Sources
          </SectionHeading>
          <LinkList items={listing.other_resources} />
        </section>
      )}

      {/* Support */}
      {listing.support_contacts.length > 0 && (
        <section aria-labelledby="support-heading">
          <SectionHeading id="support-heading">Support</SectionHeading>
          <ul className="list-none space-y-1">
            {listing.support_contacts.map((c, i) => (
              <SupportItem key={i} contact={c} />
            ))}
          </ul>
        </section>
      )}

      {/* Accessibility Conformance Reports */}
      {listing.acr_reports.length > 0 && (
        <section aria-labelledby="acr-heading">
          <SectionHeading id="acr-heading">
            Accessibility Conformance Reports
          </SectionHeading>
          {listing.acr_reports.map((acr, i) => (
            <ACRCard key={i} acr={acr} />
          ))}
        </section>
      )}

      {/* AI Generated Insights — hidden by default */}
      {listing.ai_insights && (
        <section aria-labelledby="ai-insights-heading" hidden>
          <SectionHeading id="ai-insights-heading">
            AI Generated Insights
          </SectionHeading>
          <p className="text-sm text-gray-700 leading-relaxed">
            {listing.ai_insights}
          </p>
        </section>
      )}

      {/* Last updated */}
      {listing.last_updated && (
        <p className="text-xs text-gray-400 italic text-right pt-4">
          Product information last updated {listing.last_updated}
        </p>
      )}

    </div>
  );
}
