// frontend/components/AppsheetSortableTable.tsx
"use client";

import { useMemo, useState } from "react";
import type { AppsheetColumnDef, AppsheetRow } from "@/lib/appsheet-tables";

type SortDirection = "ascending" | "descending";

interface Props {
  tableId: string;
  statusId: string;
  caption: string;
  columns: AppsheetColumnDef[];
  rows: AppsheetRow[];
}

function CellContent({ cell }: { cell: { text: string; href?: string } }) {
  if (!cell.text) return null;
  if (cell.href) {
    return (
      <a href={cell.href} title={cell.href} target="_blank" rel="noreferrer">
        {cell.text}
      </a>
    );
  }
  return <>{cell.text}</>;
}

export function AppsheetSortableTable({ tableId, statusId, caption, columns, rows }: Props) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("ascending");
  const [status, setStatus] = useState("");

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const factor = sortDirection === "ascending" ? 1 : -1;

    return [...rows].sort((a, b) => {
      const av = a[sortKey]?.text ?? "";
      const bv = b[sortKey]?.text ?? "";
      if (av === "" && bv === "") return 0;
      if (av === "") return 1;
      if (bv === "") return -1;
      return (
        factor *
        av.localeCompare(bv, "en", { sensitivity: "base", numeric: true })
      );
    });
  }, [rows, sortKey, sortDirection]);

  function handleSort(column: AppsheetColumnDef) {
    if (!column.sortable) return;
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
      <div id={statusId} role="status" aria-live="polite" className="nerd-visually-hidden">
        {status}
      </div>

      <div className="nerd-table-region" id={tableId} role="region" aria-label={caption} tabIndex={0}>
        <table className="nerd-table nerd-table--sortable">
          <caption className="nerd-caption">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => {
                if (!column.sortable) {
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
                    <button type="button" className="nerd-th-sort" onClick={() => handleSort(column)}>
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
            {sorted.map((row, i) => (
              <tr key={i}>
                {columns.map((column) => (
                  <td key={column.key} className={column.className}>
                    <CellContent cell={row[column.key] ?? { text: "" }} />
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