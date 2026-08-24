// frontend/components/PublishedSupportEditor.tsx
"use client";

/**
 * Structured support-contacts editor for the /editor visual editor. Edits
 * the `support_contacts` array (PublishedSupportContact[]: { type, value,
 * label }) of a PublishedProductRecord as a dynamic list of add/edit/remove
 * rows, rather than raw HTML or raw JSON.
 *
 * Follows PublishedVendorResourcesEditor.tsx / PublishedOtherResourcesEditor.tsx
 * for the dialog and dynamic-list architecture -- see those files for the
 * rationale behind each pattern. Field shape differs (type/value/label
 * instead of text/url):
 *
 * - `type` is a <select> constrained to exactly "email" | "url" -- the two
 *   values PublishedSupportContact's type accepts. Unlike a free-text
 *   input, a <select> makes an invalid type unrepresentable in the form
 *   itself rather than something to validate after the fact.
 * - `value` is required, like vendor/other resources' `url`.
 * - `label` is optional and nullable (string | null | undefined on the
 *   interface). Empty input maps to null on save, matching
 *   PublishedHeaderEditor's toRecordValue convention for the rest of this
 *   schema's nullable string fields.
 *
 * Dialog architecture matches PublishedHeaderEditor.tsx: native <dialog> +
 * showModal(), no aria-modal, and the effect cleanup does NOT call
 * dialog.close() -- see that file's header comment for why (React 19
 * Strict Mode's dev-only double-invoke can turn a cleanup-time close() into
 * a phantom close event landing on a freshly re-attached listener).
 *
 * Row identity: PublishedSupportContact itself has no id field, so each row
 * gets a client-only id (crypto.randomUUID()) used purely for React keys
 * and for targeting focus after add/remove -- it is never persisted; onSave
 * strips it back down to { type, value, label }.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { PublishedProductRecord, PublishedSupportContact } from "@/lib/published-tables";

interface PublishedSupportEditorProps {
  record: PublishedProductRecord;
  onSave: (contacts: PublishedSupportContact[]) => void;
  onClose: () => void;
}

type ContactType = "email" | "url";

interface DraftRow {
  id: string;
  type: ContactType;
  value: string;
  label: string;
}

/** Sentinel pendingFocusId meaning "focus the Add contact button", distinct
 *  from any row id (crypto.randomUUID() never produces this string). */
const ADD_BUTTON_FOCUS_ID = "__add_contact_button__";

function makeRowId(): string {
  return crypto.randomUUID();
}

function toFormLabel(v: string | null | undefined): string {
  return v ?? "";
}

/** Empty input maps to null, matching PublishedSupportContact's nullable
 *  label -- an empty string is not the "no value" signal the rest of the
 *  schema uses. */
function toRecordLabel(v: string): string | null {
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

export function PublishedSupportEditor({ record, onSave, onClose }: PublishedSupportEditorProps) {
  // Lazy initializer: runs exactly once on mount, so generating ids here
  // has no render-time side-effect concerns.
  const [rows, setRows] = useState<DraftRow[]>(() =>
    record.support_contacts.map((c) => ({
      id: makeRowId(),
      type: c.type,
      value: c.value,
      label: toFormLabel(c.label),
    }))
  );
  const [issues, setIssues] = useState<string[]>([]);
  const [saveAttempted, setSaveAttempted] = useState(false);

  // record.support_contacts is a plain prop read (no side effect), so
  // re-evaluating it on every render before useRef discards all but the
  // first result is harmless -- unlike mutating .current during render.
  const initialContactsRef = useRef(record.support_contacts);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  // Keyed by row id rather than index, since indices shift on remove.
  const valueInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
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
    const current = rows.map((r) => ({ type: r.type, value: r.value, label: r.label }));
    const initial = initialContactsRef.current.map((c) => ({
      type: c.type,
      value: c.value,
      label: toFormLabel(c.label),
    }));
    isDirtyRef.current =
      current.length !== initial.length ||
      current.some(
        (r, i) =>
          r.type !== initial[i]?.type || r.value !== initial[i]?.value || r.label !== initial[i]?.label
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
      if (isDirtyRef.current && !window.confirm("Discard unsaved changes to support contacts?")) {
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
      valueInputRefs.current.get(target)?.focus();
    }
    pendingFocusIdRef.current = null;
  }, [rows]);

  const requestClose = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isDirtyRef.current && !window.confirm("Discard unsaved changes to support contacts?")) return;
    dialog.close();
  }, []);

  const handleAddRow = useCallback(() => {
    const id = makeRowId();
    pendingFocusIdRef.current = id;
    setRows((prev) => [...prev, { id, type: "email", value: "", label: "" }]);
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

  const handleTypeChange = useCallback((id: string, value: ContactType) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, type: value } : r)));
  }, []);

  const handleValueChange = useCallback((id: string, value: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, value } : r)));
  }, []);

  const handleLabelChange = useCallback((id: string, label: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, label } : r)));
  }, []);

  const handleSave = useCallback(() => {
    setSaveAttempted(true);
    const foundIssues: string[] = [];
    rows.forEach((r, i) => {
      if (r.value.trim() === "") foundIssues.push(`Contact ${i + 1}: value is required.`);
    });
    if (foundIssues.length > 0) {
      setIssues(foundIssues);
      return;
    }
    setIssues([]);
    onSave(
      rows.map((r) => ({
        type: r.type,
        value: r.value.trim(),
        label: toRecordLabel(r.label),
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
        Edit: Support — {record.product_name}
      </h2>

      <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
        {rows.length === 0 ? (
          <p className="text-sm text-gray-500">No support contacts yet.</p>
        ) : (
          rows.map((row, index) => {
            const valueInvalid = saveAttempted && row.value.trim() === "";
            const typeId = `${baseId}-type-${row.id}`;
            const valueId = `${baseId}-value-${row.id}`;
            const labelId = `${baseId}-label-${row.id}`;
            return (
              <fieldset key={row.id} className="rounded border border-gray-200 p-3">
                <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Contact {index + 1}
                </legend>
                <div className="flex flex-col gap-2">
                  <div>
                    <label htmlFor={typeId} className="mb-1 block text-sm font-medium text-gray-700">
                      Contact type
                    </label>
                    <select
                      id={typeId}
                      value={row.type}
                      onChange={(e) => handleTypeChange(row.id, e.target.value as ContactType)}
                      className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="email">Email</option>
                      <option value="url">URL</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor={valueId} className="mb-1 block text-sm font-medium text-gray-700">
                      {row.type === "email" ? "Email address" : "URL"}
                    </label>
                    <input
                      id={valueId}
                      ref={(el) => {
                        if (el) valueInputRefs.current.set(row.id, el);
                        else valueInputRefs.current.delete(row.id);
                      }}
                      type={row.type === "email" ? "email" : "url"}
                      inputMode={row.type === "email" ? "email" : "url"}
                      value={row.value}
                      onChange={(e) => handleValueChange(row.id, e.target.value)}
                      aria-describedby={valueInvalid ? errorId : undefined}
                      aria-invalid={valueInvalid ? true : undefined}
                      placeholder={row.type === "email" ? "support@example.com" : "https://example.com/support"}
                      className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label htmlFor={labelId} className="mb-1 block text-sm font-medium text-gray-700">
                      Label <span className="font-normal text-gray-400">(optional)</span>
                    </label>
                    <input
                      id={labelId}
                      type="text"
                      value={row.label}
                      onChange={(e) => handleLabelChange(row.id, e.target.value)}
                      placeholder="e.g. Accessibility support"
                      className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveRow(row.id)}
                    aria-label={`Remove contact ${index + 1}${row.value ? `: ${row.value}` : ""}`}
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
        Add contact
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
