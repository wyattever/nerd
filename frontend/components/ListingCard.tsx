import { ListingData } from "@/lib/types";
import { buildNcademiListingHtml } from "@/lib/ncademiPreview";

export function ListingCard({ listing }: { listing: ListingData }) {
  const html = buildNcademiListingHtml(listing);

  return (
    <div
      className="ncademi-listing-preview"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
