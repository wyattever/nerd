// frontend/components/VendorGlobalResourcesEditor.tsx
"use client";

/**
 * Structured resources editor for the vendor Directory editor. Edits
 * DirectoryRecord's vendor_resources / other_resources arrays
 * (DirectoryResourceLink[]: { text, url }) as a single dynamic list of
 * add/edit/remove rows with a Section selector, splitting back into the
 * two arrays on save -- the unified schema keeps these as two separate
 * arrays rather than one array with a per-row source enum (the legacy
 * VendorResource shape this editor used to edit), so the split happens
 * here instead of in a bridge adapter.
 *
 * DirectoryResourceLink carries no id/label/date/added_to_site (unlike the
 * legacy VendorResource) -- those fields have no home in the unified
 * schema and are dropped from this editor entirely, not faked. Row ids
 * here are client-only (crypto.randomUUID()), same pattern
 * VendorProductsEditor.tsx already uses for its id-less rows.
 *
 * Follows PublishedVendorResourcesEditor.tsx for the dialog and
 * dynamic-list architecture (native <dialog> + showModal(), no aria-modal,
 * no cleanup-time dialog.close(), per-row focus targeting via a
 * pendingFocusId ref) -- see that file for the full rationale.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { DirectoryRecord, DirectoryResourceLink } from "@/lib/directory-schema";

export interface DirectoryResourcesUpdate {
  vendor_resources: DirectoryResourceLink[];
  other_resources: DirectoryResourceLink[];
}

interface VendorGlobalResourcesEditorProps {
  record: DirectoryRecord;
  onSave: (resources: DirectoryResourcesUpdate) => void;
  onClose: () => void;
}

/** "vendor" -> DirectoryRecord.vendor_resources, "other" ->
 *  DirectoryRecord.other_resources. */
type ResourceSection = "vendor" | "other";

interface DraftRow {
  id: string;
  text: string;
  url: string;
  section: ResourceSection;
}

/** Sentinel pendingFocusId meaning "focus the Add resource button", distinct
 *  from any row id (crypto.randomUUID() never produces this string). */
const ADD_BUTTON_FOCUS_ID = "__add_resource_button__";

function makeRowId(): string {
  return crypto.randomUUID();
}

function toInitialRows(record: DirectoryRecord): DraftRow[] {
  return [
    ...record.vendor_resources.map((r) => ({ id: makeRowId(), text: r.text, url: r.url, section: "vendor" as const })),
    ...record.other_resources.map((r) => ({ id: makeRowId(), text: r.text, url: r.url, section: "other" as const })),
  ];
}

export function VendorGlobalResourcesEditor({
  record,
  onSave,
  onClose,
}: VendorGlobalResourcesEditorProps) {
  // Lazy initializer: runs exactly once on mount, so generating ids here
  // has no render-time side-effect concerns.
  const [rows, setRows] = useState<DraftRow[]>(() => toInitialRows(record));
  const [issues, setIssues] = useState<string[]>([]);
  const [saveAttempted, setSaveAttempted] = useState(false);

  // The initial rows (already-tagged with a client-only id), not the raw
  // record arrays -- comparing against those directly would require
  // re-deriving the same vendor_resources/other_resources -> rows mapping
  // a second time just for the dirty-check.
  const initialRowsRef = useRef(rows);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  // Keyed by row id rather than index, since indices shift on remove.
  const textInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  // Set from event handlers (add/remove), consumed by the focus effect
  // below and cleared there. A ref rather than state -- see
  // PublishedVendorResourcesEditor's header comment on why.
  const pendingFocusIdRef = useRef<string | null>(null);

  // Written from an effect (post-render), read only in event handlers --
  // never mutated during render itself. Mirrors PublishedHeaderEditor's
  // isDirtyRef pattern.
  const isDirtyRef = useRef(false);
  useEffect(() => {
    const current = rows.map((r) => ({ text: r.text, url: r.url, section: r.section }));
    const initial = initialRowsRef.current.map((r) => ({ text: r.text, url: r.url, section: r.section }));
    isDirtyRef.current =
      current.length !== initial.length ||
      current.some(
        (r, i) => r.text !== initial[i]?.text || r.url !== initial[i]?.url || r.section !== initial[i]?.section
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
      if (isDirtyRef.current && !window.confirm("Discard unsaved changes to global resources?")) {
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
  // after the render it was requested in. Runs after every rows change; a
  // no-op whenever nothing is pending, e.g. a plain field edit.
  useEffect(() => {
    const target = pendingFocusIdRef.current;
    if (target === null) return;
    if (target === ADD_BUTTON_FOCUS_ID) {
      addButtonRef.current?.focus();
    } else {
      textInputRefs.current.get(target)?.focus();
    }
    pendingFocusIdRef.current = null;
  }, [rows]);

  const requestClose = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isDirtyRef.current && !window.confirm("Discard unsaved changes to global resources?")) return;
    dialog.close();
  }, []);

  const handleAddRow = useCallback(() => {
    const id = makeRowId();
    pendingFocusIdRef.current = id;
    setRows((prev) => [...prev, { id, text: "", url: "", section: "vendor" }]);
  }, []);

  const handleRemoveRow = useCallback(
    (id: string) => {
      const index = rows.findIndex((r) => r.id === id);
      if (index === -1) return;
      // Computed from the CURRENT rows, before removal -- see
      // PublishedVendorResourcesEditor's header comment on why.
      const focusTarget = rows[index + 1]?.id ?? rows[index - 1]?.id ?? ADD_BUTTON_FOCUS_ID;
      pendingFocusIdRef.current = focusTarget;
      setRows((prev) => prev.filter((r) => r.id !== id));
    },
    [rows]
  );

  const handleTextChange = useCallback((id: string, value: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, text: value } : r)));
  }, []);

  const handleUrlChange = useCallback((id: string, value: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, url: value } : r)));
  }, []);

  const handleSectionChange = useCallback((id: string, value: ResourceSection) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, section: value } : r)));
  }, []);

  const handleSave = useCallback(() => {
    setSaveAttempted(true);
    const foundIssues: string[] = [];
    rows.forEach((r, i) => {
      if (r.text.trim() === "") foundIssues.push(`Resource ${i + 1}: link text is required.`);
      if (r.url.trim() === "") foundIssues.push(`Resource ${i + 1}: URL is required.`);
    });
    if (foundIssues.length > 0) {
      setIssues(foundIssues);
      return;
    }
    setIssues([]);
    const toLink = (r: DraftRow): DirectoryResourceLink => ({ text: r.text.trim(), url: r.url.trim() });
    onSave({
      vendor_resources: rows.filter((r) => r.section === "vendor").map(toLink),
      other_resources: rows.filter((r) => r.section === "other").map(toLink),
    });
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
        Edit: Global Resources — {record.product_name}
      </h2>

      <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
        {rows.length === 0 ? (
          <p className="text-sm text-gray-500">No global resources yet.</p>
        ) : (
          rows.map((row, index) => {
            const textInvalid = saveAttempted && row.text.trim() === "";
            const urlInvalid = saveAttempted && row.url.trim() === "";
            const textId = `${baseId}-text-${row.id}`;
            const urlId = `${baseId}-url-${row.id}`;
            const sectionId = `${baseId}-section-${row.id}`;
            return (
              <fieldset key={row.id} className="rounded border border-gray-200 p-3">
                <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Resource {index + 1}
                </legend>
                <div className="flex flex-col gap-2">
                  <div>
                    <label htmlFor={textId} className="mb-1 block text-sm font-medium text-gray-700">
                      Link text
                    </label>
                    <input
                      id={textId}
                      ref={(el) => {
                        if (el) textInputRefs.current.set(row.id, el);
                        else textInputRefs.current.delete(row.id);
                      }}
                      type="text"
                      value={row.text}
                      onChange={(e) => handleTextChange(row.id, e.target.value)}
                      aria-describedby={textInvalid ? errorId : undefined}
                      aria-invalid={textInvalid ? true : undefined}
                      className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label htmlFor={urlId} className="mb-1 block text-sm font-medium text-gray-700">
                      URL
                    </label>
                    <input
                      id={urlId}
                      type="url"
                      inputMode="url"
                      value={row.url}
                      onChange={(e) => handleUrlChange(row.id, e.target.value)}
                      aria-describedby={urlInvalid ? errorId : undefined}
                      aria-invalid={urlInvalid ? true : undefined}
                      placeholder="https://example.com"
                      className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <label htmlFor={sectionId} className="mb-1 block text-sm font-medium text-gray-700">
                        Section
                      </label>
                      <select
                        id={sectionId}
                        value={row.section}
                        onChange={(e) => handleSectionChange(row.id, e.target.value as ResourceSection)}
                        className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="vendor">From {record.product_name}</option>
                        <option value="other">From Other Sources</option>
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveRow(row.id)}
                      aria-label={`Remove resource ${index + 1}${row.text ? `: ${row.text}` : ""}`}
                      className="self-end rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500"
                    >
                      Remove
                    </button>
                  </div>
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
        Add resource
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
