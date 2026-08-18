import type { Metadata } from "next";
import "./researcher.css";

export const metadata: Metadata = {
  title: "Researcher — N.E.R.D.",
};

export default function ResearcherPage() {
  const rows = Array.from({ length: 10 }, (_, i) => i);
  const cols = Array.from({ length: 12 }, (_, i) => i);

  return (
    <div className="nerd-researcher">
      <a className="nerd-skip" href="#researcher-table">
        Skip to table
      </a>

      <header className="nerd-header">
        <p className="nerd-eyebrow">N.E.R.D.</p>
        <h1 className="nerd-title">Researcher</h1>
        <p className="nerd-subtitle">
          Column scaffold only. No records are loaded; the ten rows below are
          empty placeholders showing the table structure.
        </p>
      </header>

      <div className="nerd-toolbar" role="group" aria-label="Table actions">
        <span className="nerd-toolbar-label" id="actions-label">
          Actions
        </span>
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
          Not yet available. This view is a structural scaffold with no data
          source connected.
        </p>
        <span className="nerd-count">12 columns · 10 empty rows</span>
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
        <table className="nerd-table">
          <caption className="nerd-caption">
            Researcher records — 12 columns. No data loaded; all ten rows are
            empty.
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
            {rows.map((r) => (
              <tr key={r}>
                {cols.map((c) => (
                  <td key={c} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="nerd-footnote">
        Column order and labels are taken verbatim from{" "}
        <code>NERD_TABLES_-_Researcher.csv</code>. Cells are genuinely empty
        rather than filled with placeholder text, so assistive technology
        announces each as blank instead of reading sample content as real data.
      </p>
    </div>
  );
}
