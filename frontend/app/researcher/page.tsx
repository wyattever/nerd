import type { Metadata } from "next";
import { RESEARCHER_RECORDS } from "@/lib/researcher-records";
import ResearcherTable from "@/components/ResearcherTable";
import "../nerd-table.css";

export const metadata: Metadata = {
  title: "Researcher — N.E.R.D.",
};

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

      <ResearcherTable records={records} />
    </div>
  );
}
