// frontend/components/PublishedAcrEditor.tsx
"use client";

/**
 * Structured ACR (Accessibility Conformance Report) editor for the /editor
 * visual editor. Edits the `acr_reports` array (PublishedAcrReport[]:
 * { title, url, version, date, auditor_name, auditor_url }) of a
 * PublishedProductRecord as a dynamic list of add/edit/remove rows, rather
 * than raw HTML or raw JSON.
 *
 * Follows PublishedVendorResourcesEditor.tsx / PublishedOtherResourcesEditor.tsx /
 * PublishedSupportEditor.tsx for the dialog and dynamic-list architecture --
 * see those files for the rationale behind each pattern. Field shape here:
 *
 * - `title` is the only required field, matching published-validate.ts's
 *   isPublishedAcrReport / validateProductRecord (title must be a
 *   non-empty string; url/version/date/auditor_name/auditor_url are all
 *   `string | null`).
 * - The five nullable fields use plain text inputs, not type="date" for
 *   `date` or type="url" for the two URL fields with browser validation --
 *   the real snapshot data isn't guaranteed to be strict ISO dates or
 *   well-formed URLs (e.g. a report published under a partner's domain,
 *   or a date given only as a year), and this form should not silently
 *   reject or reformat data it didn't itself produce. Empty input maps to
 *   null on save, matching PublishedHeaderEditor's toRecordValue
 *   convention for the rest of this schema's nullable string fields.
 *
 * Dialog architecture matches PublishedHeaderEditor.tsx: native <dialog> +
 * showModal(), no aria-modal, and the effect cleanup does NOT call
 * dialog.close() -- see that file's header comment for why (React 19
 * Strict Mode's dev-only double-invoke can turn a cleanup-time close() into
 * a phantom close event landing on a freshly re-attached listener).
 *
 * Row identity: PublishedAcrReport itself has no id field, so each row gets
 * a client-only id (crypto.randomUUID()) used purely for React keys and for
 * targeting focus after add/remove -- it is never persisted; onSave strips
 * it back down to the six PublishedAcrReport fields.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { PublishedAcrReport, PublishedProductRecord } from "@/lib/published-tables";

interface PublishedAcrEditorProps {
  record: PublishedProductRecord;
  onSave: (reports: PublishedAcrReport[]) => void;
  onClose: () => void;
}

interface DraftRow {
  id: string;
  title: string;
  url: string;
  version: string;
  date: string;
  auditor_name: string;
  auditor_url: string;
}

/** Sentinel pendingFocusId meaning "focus the Add report button", distinct
 *  from any row id (crypto.randomUUID() never produces this string). */
const ADD_BUTTON_FOCUS_ID = "__add_report_button__";

function makeRowId(): string {
  return crypto.randomUUID();
}

function toFormValue(v: string | null): string {
  return v ?? "";
}

/** Empty input maps to null, matching PublishedAcrReport's nullable string
 *  fields -- an empty string is not the "no value" signal the rest of the
 *  schema uses. */
function toRecordValue(v: string): string | null {
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

function toDraftRow(r: PublishedAcrReport): DraftRow {
  return {
    id: makeRowId(),
    title: r.title,
    url: toFormValue(r.url),
    version: toFormValue(r.version),
    date: toFormValue(r.date),
    auditor_name: toFormValue(r.auditor_name),
    auditor_url: toFormValue(r.auditor_url),
  };
}

export function PublishedAcrEditor({ record, onSave, onClose }: PublishedAcrEditorProps) {
  // Lazy initializer: runs exactly once on mount, so generating ids here
  // has no render-time side-effect concerns.
  const [rows, setRows] = useState<DraftRow[]>(() => record.acr_reports.map(toDraftRow));
  const [issues, setIssues] = useState<string[]>([]);
  const [saveAttempted, setSaveAttempted] = useState(false);

  // record.acr_reports is a plain prop read (no side effect), so
  // re-evaluating it on every render before useRef discards all but the
  // first result is harmless -- unlike mutating .current during render.
  const initialReportsRef = useRef(record.acr_reports);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  // Keyed by row id rather than index, since indices shift on remove.
  const titleInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  // Set from event handlers (add/remove), consumed by the focus effect
  // below and cleared there. A ref rather than state: applying focus is a
  // side effect on an external system (the DOM), not a value the component
  // needs to render with, so it doesn't belong in state and calling
  // setState synchronously inside an effect just to "consume" it would
  // trigger an avoidable extra render.
  const pendingFocusIdRef = useRef<string | null>(null);

  // Written from an effect (post-render), read only in event handlers --
  // never mutated during render itself. Mirrors PublishedHeaderEditor's
  // isDirtyRef pattern.
  const isDirtyRef = useRef(false);
  useEffect(() => {
    const current = rows.map((r) => ({
      title: r.title,
      url: r.url,
      version: r.version,
      date: r.date,
      auditor_name: r.auditor_name,
      auditor_url: r.auditor_url,
    }));
    const initial = initialReportsRef.current.map((r) => ({
      title: r.title,
      url: toFormValue(r.url),
      version: toFormValue(r.version),
      date: toFormValue(r.date),
      auditor_name: toFormValue(r.auditor_name),
      auditor_url: toFormValue(r.auditor_url),
    }));
    isDirtyRef.current =
      current.length !== initial.length ||
      current.some(
        (r, i) =>
          r.title !== initial[i]?.title ||
          r.url !== initial[i]?.url ||
          r.version !== initial[i]?.version ||
          r.date !== initial[i]?.date ||
          r.auditor_name !== initial[i]?.auditor_name ||
          r.auditor_url !== initial[i]?.auditor_url
      );
  });

  const baseId = useId();
  const titleId = `${baseId}-title`;
  const errorId = `${baseId}-error`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();

    const handleCancel = (event: Event) => {
      // Esc fires 'cancel' then 'close'. Without this, Esc discards unsaved
      // edits with no prompt.
      if (isDirtyRef.current && !window.confirm("Discard unsaved changes to ACR reports?")) {
        event.preventDefault();
      }
    };
    const handleClose = () => onClose();

    dialog.addEventListener("cancel", handleCancel);
    dialog.addEventListener("close", handleClose);
    return () => {
      dialog.removeEventListener("cancel", handleCancel);
      dialog.removeEventListener("close", handleClose);
    };
  }, [onClose]);

  // Consumes a pending focus request once the target's ref has settled
  // after the render it was requested in (a new row's input doesn't exist
  // until after that commit; a removed row's input is already gone). Runs
  // after every rows change; a no-op whenever nothing is pending, e.g. a
  // plain field edit.
  useEffect(() => {
    const target = pendingFocusIdRef.current;
    if (target === null) return;
    if (target === ADD_BUTTON_FOCUS_ID) {
      addButtonRef.current?.focus();
    } else {
      titleInputRefs.current.get(target)?.focus();
    }
    pendingFocusIdRef.current = null;
  }, [rows]);

  const requestClose = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isDirtyRef.current && !window.confirm("Discard unsaved changes to ACR reports?")) return;
    dialog.close();
  }, []);

  const handleAddRow = useCallback(() => {
    const id = makeRowId();
    pendingFocusIdRef.current = id;
    setRows((prev) => [
      ...prev,
      { id, title: "", url: "", version: "", date: "", auditor_name: "", auditor_url: "" },
    ]);
  }, []);

  const handleRemoveRow = useCallback(
    (id: string) => {
      const index = rows.findIndex((r) => r.id === id);
      if (index === -1) return;
      // Computed from the CURRENT rows, before removal: the row after this
      // one slides into this same index once it's gone, so focusing "the
      // next row" and "the row that will occupy this spot" are the same
      // target. Falls back to the previous row, then the Add button.
      const focusTarget = rows[index + 1]?.id ?? rows[index - 1]?.id ?? ADD_BUTTON_FOCUS_ID;
      pendingFocusIdRef.current = focusTarget;
      setRows((prev) => prev.filter((r) => r.id !== id));
    },
    [rows]
  );

  const handleFieldChange = useCallback(
    (id: string, field: keyof Omit<DraftRow, "id">, value: string) => {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
    },
    []
  );

  const handleSave = useCallback(() => {
    setSaveAttempted(true);
    const foundIssues: string[] = [];
    rows.forEach((r, i) => {
      if (r.title.trim() === "") foundIssues.push(`Report ${i + 1}: title is required.`);
    });
    if (foundIssues.length > 0) {
      setIssues(foundIssues);
      return;
    }
    setIssues([]);
    onSave(
      rows.map((r) => ({
        title: r.title.trim(),
        url: toRecordValue(r.url),
        version: toRecordValue(r.version),
        date: toRecordValue(r.date),
        auditor_name: toRecordValue(r.auditor_name),
        auditor_url: toRecordValue(r.auditor_url),
      }))
    );
    // Closing the dialog fires the native "close" event, which calls
    // onClose() -- the single path that unmounts this component.
    dialogRef.current?.close();
  }, [rows, onSave]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="w-full max-w-2xl rounded-lg border border-gray-200 bg-white p-6 shadow-xl backdrop:bg-gray-900/50"
    >
      <h2 id={titleId} className="mb-4 text-lg font-bold text-gray-900">
        Edit: ACR — {record.product_name}
      </h2>

      <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
        {rows.length === 0 ? (
          <p className="text-sm text-gray-500">No ACR reports yet.</p>
        ) : (
          rows.map((row, index) => {
            const titleInvalid = saveAttempted && row.title.trim() === "";
            const titleFieldId = `${baseId}-title-${row.id}`;
            const urlFieldId = `${baseId}-url-${row.id}`;
            const versionFieldId = `${baseId}-version-${row.id}`;
            const dateFieldId = `${baseId}-date-${row.id}`;
            const auditorNameFieldId = `${baseId}-auditor-name-${row.id}`;
            const auditorUrlFieldId = `${baseId}-auditor-url-${row.id}`;
            return (
              <fieldset key={row.id} className="rounded border border-gray-200 p-3">
                <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Report {index + 1}
                </legend>
                <div className="flex flex-col gap-2">
                  <div>
                    <label
                      htmlFor={titleFieldId}
                      className="mb-1 block text-sm font-medium text-gray-700"
                    >
                      Title
                    </label>
                    <input
                      id={titleFieldId}
                      ref={(el) => {
                        if (el) titleInputRefs.current.set(row.id, el);
                        else titleInputRefs.current.delete(row.id);
                      }}
                      type="text"
                      value={row.title}
                      onChange={(e) => handleFieldChange(row.id, "title", e.target.value)}
                      aria-describedby={titleInvalid ? errorId : undefined}
                      aria-invalid={titleInvalid ? true : undefined}
                      className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label htmlFor={urlFieldId} className="mb-1 block text-sm font-medium text-gray-700">
                      Report URL <span className="font-normal text-gray-400">(optional)</span>
                    </label>
                    <input
                      id={urlFieldId}
                      type="text"
                      value={row.url}
                      onChange={(e) => handleFieldChange(row.id, "url", e.target.value)}
                      placeholder="https://example.com/acr.pdf"
                      className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <div className="flex-1">
                      <label
                        htmlFor={versionFieldId}
                        className="mb-1 block text-sm font-medium text-gray-700"
                      >
                        Version <span className="font-normal text-gray-400">(optional)</span>
                      </label>
                      <input
                        id={versionFieldId}
                        type="text"
                        value={row.version}
                        onChange={(e) => handleFieldChange(row.id, "version", e.target.value)}
                        className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="flex-1">
                      <label htmlFor={dateFieldId} className="mb-1 block text-sm font-medium text-gray-700">
                        Date <span className="font-normal text-gray-400">(optional)</span>
                      </label>
                      <input
                        id={dateFieldId}
                        type="text"
                        value={row.date}
                        onChange={(e) => handleFieldChange(row.id, "date", e.target.value)}
                        placeholder="e.g. 2026-03 or March 2026"
                        className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label
                      htmlFor={auditorNameFieldId}
                      className="mb-1 block text-sm font-medium text-gray-700"
                    >
                      Auditor name <span className="font-normal text-gray-400">(optional)</span>
                    </label>
                    <input
                      id={auditorNameFieldId}
                      type="text"
                      value={row.auditor_name}
                      onChange={(e) => handleFieldChange(row.id, "auditor_name", e.target.value)}
                      className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={auditorUrlFieldId}
                      className="mb-1 block text-sm font-medium text-gray-700"
                    >
                      Auditor URL <span className="font-normal text-gray-400">(optional)</span>
                    </label>
                    <input
                      id={auditorUrlFieldId}
                      type="text"
                      value={row.auditor_url}
                      onChange={(e) => handleFieldChange(row.id, "auditor_url", e.target.value)}
                      placeholder="https://auditor.example.com"
                      className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveRow(row.id)}
                    aria-label={`Remove report ${index + 1}${row.title ? `: ${row.title}` : ""}`}
                    className="self-end rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    Remove
                  </button>
                </div>
              </fieldset>
            );
          })
        )}
      </div>

      <button
        type="button"
        ref={addButtonRef}
        onClick={handleAddRow}
        className="mt-3 rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        Add report
      </button>

      {/* Rendered unconditionally so the region exists in the DOM before it
          is populated -- a live region created and filled in the same
          commit is frequently not announced at all. */}
      <div id={errorId} role="alert" className="mt-3 flex flex-col gap-1 text-sm font-semibold text-red-700">
        {issues.map((issue) => (
          <p key={issue}>{issue}</p>
        ))}
      </div>

      <div className="mt-4 flex justify-end gap-3">
        <button
          type="button"
          onClick={requestClose}
          className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="rounded border border-transparent bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Save
        </button>
      </div>
    </dialog>
  );
}
