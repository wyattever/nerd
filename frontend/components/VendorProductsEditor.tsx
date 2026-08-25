// frontend/components/VendorProductsEditor.tsx
"use client";

/**
 * Structured products editor for the /vendors visual editor. Edits
 * VendorRecord's `products` array (VendorProductLink[]: { product_name,
 * ncademi_product_url }) as a dynamic list of add/edit/remove rows, rather
 * than raw JSON.
 *
 * Follows PublishedOtherResourcesEditor.tsx / PublishedVendorResourcesEditor.tsx
 * for the dialog and dynamic-list architecture (native <dialog> +
 * showModal(), no aria-modal, no cleanup-time dialog.close(), per-row focus
 * targeting via a pendingFocusId ref) -- see those files for the full
 * rationale. Field shape differs (product_name/ncademi_product_url instead
 * of text/url), and per vendor-schema.ts, VendorProductLink has no
 * description field or per-product resources -- this editor only manages
 * the name/URL pair.
 *
 * Row identity: VendorProductLink has no id field, so each row gets a
 * client-only id (crypto.randomUUID()) used purely for React keys and
 * focus-targeting -- it is never persisted; onSave strips it back down to
 * { product_name, ncademi_product_url }.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { VendorProductLink, VendorRecord } from "@/lib/vendor-schema";

interface VendorProductsEditorProps {
  record: VendorRecord;
  onSave: (products: VendorProductLink[]) => void;
  onClose: () => void;
}

interface DraftRow {
  id: string;
  product_name: string;
  ncademi_product_url: string;
}

/** Sentinel pendingFocusId meaning "focus the Add product button", distinct
 *  from any row id (crypto.randomUUID() never produces this string). */
const ADD_BUTTON_FOCUS_ID = "__add_product_button__";

function makeRowId(): string {
  return crypto.randomUUID();
}

export function VendorProductsEditor({ record, onSave, onClose }: VendorProductsEditorProps) {
  // Lazy initializer: runs exactly once on mount, so generating ids here
  // has no render-time side-effect concerns.
  const [rows, setRows] = useState<DraftRow[]>(() =>
    record.products.map((p) => ({
      id: makeRowId(),
      product_name: p.product_name,
      ncademi_product_url: p.ncademi_product_url,
    }))
  );
  const [issues, setIssues] = useState<string[]>([]);
  const [saveAttempted, setSaveAttempted] = useState(false);

  // record.products is a plain prop read (no side effect), so re-evaluating
  // it on every render before useRef discards all but the first result is
  // harmless -- unlike mutating .current during render.
  const initialProductsRef = useRef(record.products);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  // Keyed by row id rather than index, since indices shift on remove.
  const nameInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  // Set from event handlers (add/remove), consumed by the focus effect
  // below and cleared there. A ref rather than state -- see
  // PublishedVendorResourcesEditor's header comment on why.
  const pendingFocusIdRef = useRef<string | null>(null);

  // Written from an effect (post-render), read only in event handlers --
  // never mutated during render itself. Mirrors PublishedHeaderEditor's
  // isDirtyRef pattern.
  const isDirtyRef = useRef(false);
  useEffect(() => {
    const current = rows.map((r) => ({
      product_name: r.product_name,
      ncademi_product_url: r.ncademi_product_url,
    }));
    const initial = initialProductsRef.current;
    isDirtyRef.current =
      current.length !== initial.length ||
      current.some(
        (r, i) =>
          r.product_name !== initial[i]?.product_name ||
          r.ncademi_product_url !== initial[i]?.ncademi_product_url
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
      if (isDirtyRef.current && !window.confirm("Discard unsaved changes to products?")) {
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
      nameInputRefs.current.get(target)?.focus();
    }
    pendingFocusIdRef.current = null;
  }, [rows]);

  const requestClose = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isDirtyRef.current && !window.confirm("Discard unsaved changes to products?")) return;
    dialog.close();
  }, []);

  const handleAddRow = useCallback(() => {
    const id = makeRowId();
    pendingFocusIdRef.current = id;
    setRows((prev) => [...prev, { id, product_name: "", ncademi_product_url: "" }]);
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

  const handleNameChange = useCallback((id: string, value: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, product_name: value } : r)));
  }, []);

  const handleUrlChange = useCallback((id: string, value: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ncademi_product_url: value } : r)));
  }, []);

  const handleSave = useCallback(() => {
    setSaveAttempted(true);
    const foundIssues: string[] = [];
    rows.forEach((r, i) => {
      if (r.product_name.trim() === "") foundIssues.push(`Product ${i + 1}: name is required.`);
      if (r.ncademi_product_url.trim() === "")
        foundIssues.push(`Product ${i + 1}: NCADEMI product URL is required.`);
    });
    if (foundIssues.length > 0) {
      setIssues(foundIssues);
      return;
    }
    setIssues([]);
    onSave(
      rows.map((r) => ({
        product_name: r.product_name.trim(),
        ncademi_product_url: r.ncademi_product_url.trim(),
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
        Edit: Product/s — {record.vendor_name}
      </h2>

      <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
        {rows.length === 0 ? (
          <p className="text-sm text-gray-500">No products linked yet.</p>
        ) : (
          rows.map((row, index) => {
            const nameInvalid = saveAttempted && row.product_name.trim() === "";
            const urlInvalid = saveAttempted && row.ncademi_product_url.trim() === "";
            const nameId = `${baseId}-name-${row.id}`;
            const urlId = `${baseId}-url-${row.id}`;
            return (
              <fieldset key={row.id} className="rounded border border-gray-200 p-3">
                <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Product {index + 1}
                </legend>
                <div className="flex flex-col gap-2">
                  <div>
                    <label htmlFor={nameId} className="mb-1 block text-sm font-medium text-gray-700">
                      Product name
                    </label>
                    <input
                      id={nameId}
                      ref={(el) => {
                        if (el) nameInputRefs.current.set(row.id, el);
                        else nameInputRefs.current.delete(row.id);
                      }}
                      type="text"
                      value={row.product_name}
                      onChange={(e) => handleNameChange(row.id, e.target.value)}
                      aria-describedby={nameInvalid ? errorId : undefined}
                      aria-invalid={nameInvalid ? true : undefined}
                      className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label htmlFor={urlId} className="mb-1 block text-sm font-medium text-gray-700">
                      NCADEMI product URL
                    </label>
                    <input
                      id={urlId}
                      type="url"
                      inputMode="url"
                      value={row.ncademi_product_url}
                      onChange={(e) => handleUrlChange(row.id, e.target.value)}
                      aria-describedby={urlInvalid ? errorId : undefined}
                      aria-invalid={urlInvalid ? true : undefined}
                      placeholder="https://ncademi.org/provide/directory/products/example/"
                      className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveRow(row.id)}
                    aria-label={`Remove product ${index + 1}${row.product_name ? `: ${row.product_name}` : ""}`}
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
        Add product
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
