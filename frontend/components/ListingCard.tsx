import DOMPurify from "dompurify";
import { ListingData } from "@/lib/types";
import { buildNcademiListingHtml } from "@/lib/ncademiPreview";

export function ListingCard({ 
  listing, 
  showAiInsights 
}: { 
  listing: ListingData, 
  showAiInsights: boolean 
}) {
  const html = buildNcademiListingHtml(listing, showAiInsights);
  const safeHtml = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });

  return (
    <div
      className="ncademi-listing-preview"
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}
