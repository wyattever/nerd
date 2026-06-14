"use client";

import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  type ColumnDef,
} from "@tanstack/react-table";
import { useFormContext, useFieldArray } from "react-hook-form";
import type { ListingData, ResourceLink, ACRReport } from "@/schemas/listing";

// Generic resource link grid (vendor_resources, other_resources)
function ResourceLinkGrid({
  fieldName,
  label,
}: {
  fieldName: "vendor_resources" | "other_resources";
  label: string;
}) {
  const { control, register } = useFormContext<ListingData>();
  const { fields, append, remove } = useFieldArray({ control, name: fieldName });

  const columnHelper = createColumnHelper<ResourceLink & { index: number }>();
  const columns: ColumnDef<ResourceLink & { index: number }, any>[] = [
    columnHelper.accessor("text", {
      header: "Label",
      cell: ({ row }) => (
        <input className="grid-cell-input" {...register(`${fieldName}.${row.original.index}.text`)} />
      ),
    }),
    columnHelper.accessor("url", {
      header: "URL",
      cell: ({ row }) => (
        <input className="grid-cell-input" {...register(`${fieldName}.${row.original.index}.url`)} />
      ),
    }),
    columnHelper.display({
      id: "actions",
      cell: ({ row }) => (
        <button type="button" className="btn-remove" onClick={() => remove(row.original.index)}>
          Remove
        </button>
      ),
    }),
  ];

  const data = fields.map((f, i) => ({ ...f, index: i })) as any;
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <div className="resource-grid">
      <h3 className="section-heading">{label}</h3>
      <table className="grid-table">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => append({ url: "", text: "" })}
      >
        + Add Row
      </button>
    </div>
  );
}

// ACR Reports grid
function ACRReportGrid() {
  const { control, register } = useFormContext<ListingData>();
  const { fields, append, remove } = useFieldArray({ control, name: "acr_reports" });

  const columnHelper = createColumnHelper<ACRReport & { index: number }>();
  const columns: ColumnDef<ACRReport & { index: number }, any>[] = [
    columnHelper.accessor("title", {
      header: "Title",
      cell: ({ row }) => (
        <input className="grid-cell-input" {...register(`acr_reports.${row.original.index}.title`)} />
      ),
    }),
    columnHelper.accessor("url", {
      header: "URL",
      cell: ({ row }) => (
        <input className="grid-cell-input" {...register(`acr_reports.${row.original.index}.url`)} />
      ),
    }),
    columnHelper.accessor("version", {
      header: "Version",
      cell: ({ row }) => (
        <input className="grid-cell-input" {...register(`acr_reports.${row.original.index}.version`)} />
      ),
    }),
    columnHelper.accessor("date", {
      header: "Date",
      cell: ({ row }) => (
        <input className="grid-cell-input" {...register(`acr_reports.${row.original.index}.date`)} />
      ),
    }),
    columnHelper.display({
      id: "actions",
      cell: ({ row }) => (
        <button type="button" className="btn-remove" onClick={() => remove(row.original.index)}>
          Remove
        </button>
      ),
    }),
  ];

  const data = fields.map((f, i) => ({ ...f, index: i })) as any;
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <div className="resource-grid">
      <h3 className="section-heading">ACR / VPAT Reports</h3>
      <table className="grid-table">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() =>
          append({ title: "", url: "", version: "", date: "", auditor_name: "", auditor_url: "" })
        }
      >
        + Add Row
      </button>
    </div>
  );
}

export function ResourceGrids() {
  return (
    <div className="resource-grids">
      <ResourceLinkGrid fieldName="vendor_resources" label="Vendor Resources" />
      <ResourceLinkGrid fieldName="other_resources" label="Third-Party Insights" />
      <ACRReportGrid />
    </div>
  );
}
