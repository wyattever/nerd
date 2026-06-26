import DOMPurify from "dompurify";
import { ListingData } from "@/lib/types";
import { buildNcademiListingHtml } from "@/lib/ncademiPreview";

export function ListingCard({ listing }: { listing: ListingData }) {
  const html = buildNcademiListingHtml(listing);
  const safeHtml = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });

  return (
    <div
      className="ncademi-listing-preview"
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}
