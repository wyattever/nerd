import type { Metadata } from "next";
import { RESEARCHER_RECORDS } from "@/lib/researcher-records";
import { displayName } from "@/lib/users";
import "../nerd-table.css";

export const metadata: Metadata = {
  title: "Researcher — N.E.R.D.",
};

/** Render an ISO timestamp in the table's display format. */
function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}

/**
 * External link, or plain empty cell when there is no URL.
 *
 * `title` carries the full URL so hover and focus reveal it when the cell
 * truncates. `rel="noreferrer"` accompanies target="_blank" to avoid leaking
 * the referrer and to sever the opener reference.
 */
function LinkCell({ href }: { href: string | null }) {
  if (!href) return null;
  return (
    <a href={href} title={href} target="_blank" rel="noreferrer">
      {href}
    </a>
  );
}

export default function ResearcherPage() {
  const records = RESEARCHER_RECORDS;

  return (
    <div className="nerd-table-page">
      <a className="nerd-skip" href="#researcher-table">
        Skip to table
      </a>

      <header className="nerd-header">
        <p className="nerd-eyebrow">N.E.R.D.</p>
        <h1 className="nerd-title">Researcher</h1>
        <p className="nerd-subtitle">
          EdTech products tracked for the NCADEMI accessibility directory.
        </p>
      </header>

      <div className="nerd-toolbar" role="group" aria-label="Table actions">
        <span className="nerd-toolbar-label">Actions</span>
        <button type="button" className="nerd-btn" disabled aria-describedby="actions-note">
          Add row
        </button>
        <button type="button" className="nerd-btn" disabled aria-describedby="actions-note">
          Import
        </button>
        <button type="button" className="nerd-btn" disabled aria-describedby="actions-note">
          Export CSV
        </button>
        <p id="actions-note" className="nerd-visually-hidden">
          Not yet available. This view is read-only; records are seeded from a
          build-time file with no datastore connected.
        </p>
        <span className="nerd-count">
          {records.length} {records.length === 1 ? "product" : "products"}
        </span>
      </div>

      {/* Status region reserved for async updates (WCAG 4.1.3).
          Errors render into a separate role="alert" container, not this one. */}
      <div
        id="researcher-status"
        role="status"
        aria-live="polite"
        className="nerd-visually-hidden"
      />

      {/* tabIndex={0} makes the horizontally scrollable region keyboard
          operable (WCAG 2.1.1); role and aria-label give it a name. */}
      <div
        className="nerd-table-region"
        id="researcher-table"
        role="region"
        aria-label="Researcher records, horizontally scrollable"
        tabIndex={0}
      >
        <table className="nerd-table nerd-table--wide">
          <caption className="nerd-caption">
            Researcher records — {records.length} products, 12 columns.
          </caption>

          <thead>
            <tr>
              <th scope="col" className="nerd-col-product-name">Product Name</th>
              <th scope="col" className="nerd-col-vendor-id">Vendor ID</th>
              <th scope="col" className="nerd-col-product-website">Product Website</th>
              <th scope="col" className="nerd-col-product-desc">Product Description</th>
              <th scope="col" className="nerd-col-priority">Priority</th>
              <th scope="col" className="nerd-col-platforms">Platforms</th>
              <th scope="col" className="nerd-col-notes">Notes</th>
              <th scope="col" className="nerd-col-status">Status</th>
              <th scope="col" className="nerd-col-last-updated">Last Updated</th>
              <th scope="col" className="nerd-col-ncademi-url">NCADEMI Product URL</th>
              <th scope="col" className="nerd-col-gatherer">Gatherer</th>
              <th scope="col" className="nerd-col-reviewer">Reviewer</th>
            </tr>
          </thead>

          <tbody>
            {records.map((r) => (
              <tr key={r.id}>
                <td className="nerd-col-product-name">{r.product_name}</td>
                <td className="nerd-col-vendor-id">{r.vendor_id ?? ""}</td>
                <td className="nerd-col-product-website">
                  <LinkCell href={r.product_website} />
                </td>
                <td className="nerd-col-product-desc">{r.product_description ?? ""}</td>
                <td className="nerd-col-priority">{r.priority ?? ""}</td>
                <td className="nerd-col-platforms">{r.platforms.join(", ")}</td>
                <td className="nerd-col-notes">{r.notes ?? ""}</td>
                <td className="nerd-col-status">{r.status ?? ""}</td>
                <td className="nerd-col-last-updated">{formatDate(r.last_updated)}</td>
                <td className="nerd-col-ncademi-url">
                  <LinkCell href={r.ncademi_product_url} />
                </td>
                <td className="nerd-col-gatherer">{displayName(r.gatherer)}</td>
                <td className="nerd-col-reviewer">{displayName(r.reviewer)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
