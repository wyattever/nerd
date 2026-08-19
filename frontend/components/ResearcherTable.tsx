"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ResearcherRecord } from "@/lib/researcher-records";
import { displayName } from "@/lib/users";

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

/**
 * Priority sorts by severity (Low -> Medium -> High), not alphabetically.
 * Status is left as plain alphabetical for MVP -- too many values to justify
 * a fixed rank yet.
 */
const PRIORITY_RANK: Record<string, string> = {
  Low: "0",
  Medium: "1",
  High: "2",
};

type SortDirection = "ascending" | "descending";

interface Column {
  key: string;
  label: string;
  className: string;
  /** Plain-text value this column sorts on. Empty string sorts last. */
  sortValue: (r: ResearcherRecord) => string;
  cell: (r: ResearcherRecord) => ReactNode;
  /**
   * Defaults to true. Set false to render a plain, non-interactive header --
   * used for long free-text fields where alphabetical sort isn't meaningful
   * (Product Description, Notes).
   */
  sortable?: boolean;
}

const COLUMNS: Column[] = [
  {
    key: "product_name",
    label: "Product Name",
    className: "nerd-col-product-name",
    sortValue: (r) => r.product_name,
    cell: (r) => r.product_name,
  },
  {
    key: "vendor_id",
    label: "Vendor ID",
    className: "nerd-col-vendor-id",
    sortValue: (r) => r.vendor_id ?? "",
    cell: (r) => r.vendor_id ?? "",
  },
  {
    key: "product_website",
    label: "Product Website",
    className: "nerd-col-product-website",
    sortValue: (r) => r.product_website ?? "",
    cell: (r) => <LinkCell href={r.product_website} />,
  },
  {
    key: "product_description",
    label: "Product Description",
    className: "nerd-col-product-desc",
    sortValue: (r) => r.product_description ?? "",
    cell: (r) => r.product_description ?? "",
    sortable: false,
  },
  {
    key: "priority",
    label: "Priority",
    className: "nerd-col-priority",
    sortValue: (r) => (r.priority ? PRIORITY_RANK[r.priority] ?? "" : ""),
    cell: (r) => r.priority ?? "",
  },
  {
    key: "platforms",
    label: "Platforms",
    className: "nerd-col-platforms",
    sortValue: (r) => r.platforms.join(", "),
    cell: (r) => r.platforms.join(", "),
  },
  {
    key: "notes",
    label: "Notes",
    className: "nerd-col-notes",
    sortValue: (r) => r.notes ?? "",
    cell: (r) => r.notes ?? "",
    sortable: false,
  },
  {
    key: "status",
    label: "Status",
    className: "nerd-col-status",
    sortValue: (r) => r.status ?? "",
    cell: (r) => r.status ?? "",
  },
  {
    key: "last_updated",
    label: "Last Updated",
    className: "nerd-col-last-updated",
    // ISO 8601 sorts correctly as plain text; formatDate is display-only.
    sortValue: (r) => r.last_updated ?? "",
    cell: (r) => formatDate(r.last_updated),
  },
  {
    key: "ncademi_product_url",
    label: "NCADEMI Product URL",
    className: "nerd-col-ncademi-url",
    sortValue: (r) => r.ncademi_product_url ?? "",
    cell: (r) => <LinkCell href={r.ncademi_product_url} />,
  },
  {
    key: "gatherer",
    label: "Gatherer",
    className: "nerd-col-gatherer",
    sortValue: (r) => displayName(r.gatherer),
    cell: (r) => displayName(r.gatherer),
  },
  {
    key: "reviewer",
    label: "Reviewer",
    className: "nerd-col-reviewer",
    sortValue: (r) => displayName(r.reviewer),
    cell: (r) => displayName(r.reviewer),
  },
];

interface Props {
  records: ResearcherRecord[];
}

export default function ResearcherTable({ records }: Props) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("ascending");
  const [status, setStatus] = useState("");

  const sorted = useMemo(() => {
    if (!sortKey) return records;
    const column = COLUMNS.find((c) => c.key === sortKey);
    if (!column) return records;

    const factor = sortDirection === "ascending" ? 1 : -1;

    // Empty values always sort last, in both directions, so toggling
    // direction never scatters blank rows to the opposite end.
    return [...records].sort((a, b) => {
      const av = column.sortValue(a);
      const bv = column.sortValue(b);
      if (av === "" && bv === "") return 0;
      if (av === "") return 1;
      if (bv === "") return -1;
      return (
        factor *
        av.localeCompare(bv, "en", { sensitivity: "base", numeric: true })
      );
    });
  }, [records, sortKey, sortDirection]);

  function handleSort(column: Column) {
    let nextDirection: SortDirection = "ascending";
    if (sortKey === column.key) {
      nextDirection = sortDirection === "ascending" ? "descending" : "ascending";
    }
    setSortKey(column.key);
    setSortDirection(nextDirection);
    setStatus(`Sorted by ${column.label}, ${nextDirection}.`);
  }

  return (
    <>
      {/* Status region reserved for async updates (WCAG 4.1.3).
          Errors render into a separate role="alert" container, not this one. */}
      <div
        id="researcher-status"
        role="status"
        aria-live="polite"
        className="nerd-visually-hidden"
      >
        {status}
      </div>

      {/* tabIndex={0} makes the horizontally scrollable region keyboard
          operable (WCAG 2.1.1); role and aria-label give it a name. */}
      <div
        className="nerd-table-region"
        id="researcher-table"
        role="region"
        aria-label="Researcher records, horizontally scrollable"
        tabIndex={0}
      >
        <table className="nerd-table nerd-table--wide nerd-table--sortable">
          <caption className="nerd-caption">
            Researcher records — {records.length} products, 12 columns. Most
            column headers are buttons; activate one to sort by that column.
            Product Description and Notes are not sortable.
          </caption>

          <thead>
            <tr>
              {COLUMNS.map((column) => {
                if (column.sortable === false) {
                  return (
                    <th key={column.key} scope="col" className={column.className}>
                      {column.label}
                    </th>
                  );
                }

                const isActive = sortKey === column.key;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={`${column.className} nerd-th-sortable`}
                    aria-sort={isActive ? sortDirection : undefined}
                  >
                    <button
                      type="button"
                      className="nerd-th-sort"
                      onClick={() => handleSort(column)}
                    >
                      <span>{column.label}</span>
                      <span className="nerd-sort-icon" aria-hidden="true">
                        {isActive
                          ? sortDirection === "ascending"
                            ? "\u25B2"
                            : "\u25BC"
                          : "\u2195"}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {sorted.map((r) => (
              <tr key={r.id}>
                {COLUMNS.map((column) => (
                  <td key={column.key} className={column.className}>
                    {column.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
