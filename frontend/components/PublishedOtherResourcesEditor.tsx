// frontend/components/PublishedOtherResourcesEditor.tsx
"use client";

/**
 * Structured other-resources editor for the /editor visual editor. Edits
 * the `other_resources` array (PublishedResourceLink[]: { text, url }) of
 * a PublishedProductRecord as a dynamic list of add/edit/remove rows,
 * rather than raw HTML or raw JSON.
 *
 * Follows PublishedVendorResourcesEditor.tsx exactly (same field shape,
 * same dialog and focus-management architecture) -- see that file for the
 * rationale behind each pattern:
 *
 * Dialog architecture matches PublishedHeaderEditor.tsx: native <dialog> +
 * showModal(), no aria-modal, and the effect cleanup does NOT call
 * dialog.close() -- see that file's header comment for why (React 19
 * Strict Mode's dev-only double-invoke can turn a cleanup-time close() into
 * a phantom close event landing on a freshly re-attached listener).
 *
 * Row identity: PublishedResourceLink itself has no id field, so each row
 * gets a client-only id (crypto.randomUUID()) used purely for React keys
 * and for targeting focus after add/remove -- it is never persisted; onSave
 * strips it back down to { text, url }.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { PublishedProductRecord, PublishedResourceLink } from "@/lib/published-tables";

interface PublishedOtherResourcesEditorProps {
  record: PublishedProductRecord;
  onSave: (resources: PublishedResourceLink[]) => void;
  onClose: () => void;
}

interface DraftRow {
  id: string;
  text: string;
  url: string;
}

/** Sentinel pendingFocusId meaning "focus the Add resource button", distinct
 *  from any row id (crypto.randomUUID() never produces this string). */
const ADD_BUTTON_FOCUS_ID = "__add_resource_button__";

function makeRowId(): string {
  return crypto.randomUUID();
}

export function PublishedOtherResourcesEditor({
  record,
  onSave,
  onClose,
}: PublishedOtherResourcesEditorProps) {
  // Lazy initializer: runs exactly once on mount, so generating ids here
  // has no render-time side-effect concerns.
  const [rows, setRows] = useState<DraftRow[]>(() =>
    record.other_resources.map((r) => ({ id: makeRowId(), text: r.text, url: r.url }))
  );
  const [issues, setIssues] = useState<string[]>([]);
  const [saveAttempted, setSaveAttempted] = useState(false);

  // record.other_resources is a plain prop read (no side effect), so
  // re-evaluating it on every render before useRef discards all but the
  // first result is harmless -- unlike mutating .current during render.
  const initialResourcesRef = useRef(record.other_resources);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  // Keyed by row id rather than index, since indices shift on remove.
  const textInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
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
    const current = rows.map((r) => ({ text: r.text, url: r.url }));
    const initial = initialResourcesRef.current;
    isDirtyRef.current =
      current.length !== initial.length ||
      current.some((r, i) => r.text !== initial[i]?.text || r.url !== initial[i]?.url);
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
      if (isDirtyRef.current && !window.confirm("Discard unsaved changes to other resources?")) {
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
  // plain text/url edit.
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
    if (isDirtyRef.current && !window.confirm("Discard unsaved changes to other resources?")) return;
    dialog.close();
  }, []);

  const handleAddRow = useCallback(() => {
    const id = makeRowId();
    pendingFocusIdRef.current = id;
    setRows((prev) => [...prev, { id, text: "", url: "" }]);
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

  const handleRowChange = useCallback((id: string, field: "text" | "url", value: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
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
    onSave(rows.map((r) => ({ text: r.text.trim(), url: r.url.trim() })));
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
        Edit: Other Resources — {record.product_name}
      </h2>

      <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
        {rows.length === 0 ? (
          <p className="text-sm text-gray-500">No other resources yet.</p>
        ) : (
          rows.map((row, index) => {
            const textInvalid = saveAttempted && row.text.trim() === "";
            const urlInvalid = saveAttempted && row.url.trim() === "";
            const textId = `${baseId}-text-${row.id}`;
            const urlId = `${baseId}-url-${row.id}`;
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
                      onChange={(e) => handleRowChange(row.id, "text", e.target.value)}
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
                      onChange={(e) => handleRowChange(row.id, "url", e.target.value)}
                      aria-describedby={urlInvalid ? errorId : undefined}
                      aria-invalid={urlInvalid ? true : undefined}
                      placeholder="https://example.com"
                      className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
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
