// frontend/components/PublishedHeaderEditor.tsx
"use client";

/**
 * Structured header editor for the /editor visual editor. Replaces the
 * legacy SectionEditor's raw-HTML textarea for this one field group: this
 * form edits actual PublishedProductRecord fields (product_name,
 * vendor_name, product_description, product_website_url) rather than a
 * blob of HTML, so a bad edit is caught by shape/validation rather than by
 * eyeballing markup.
 *
 * Dialog pattern follows RawJsonEditor.tsx: native <dialog> + showModal(),
 * no aria-modal (showModal() already conveys modality; adding it alongside
 * an accessible name is known to hide static dialog content from VoiceOver
 * quick-nav), and the effect's cleanup does NOT call dialog.close(). That
 * call used to be exactly here in RawJsonEditor.tsx and caused a real bug:
 * dialog.close() fires its "close" event as a QUEUED task per the HTML
 * spec, and React 19 Strict Mode's dev-only double-invoke of this effect
 * (mount -> cleanup -> mount) let that queued event land on the "close"
 * listener re-attached by the second mount, closing the dialog immediately
 * after it opened. Every real close path here (Save, Cancel, Escape)
 * already calls dialog.close() itself before onClose() fires, so cleanup
 * never needs to.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { PublishedProductRecord } from "@/lib/published-tables";

export interface HeaderFields {
  product_name: string;
  vendor_name: string | null;
  product_description: string | null;
  product_website_url: string | null;
}

interface PublishedHeaderEditorProps {
  record: PublishedProductRecord;
  onSave: (fields: HeaderFields) => void;
  onClose: () => void;
}

function toFormValue(v: string | null): string {
  return v ?? "";
}

/** Empty input maps to null, matching PublishedProductRecord's nullable
 *  string fields -- an empty string is not the "no value" signal the rest
 *  of the schema uses. */
function toRecordValue(v: string): string | null {
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

export function PublishedHeaderEditor({ record, onSave, onClose }: PublishedHeaderEditorProps) {
  const initial: HeaderFields = {
    product_name: record.product_name,
    vendor_name: record.vendor_name,
    product_description: record.product_description,
    product_website_url: record.product_website_url,
  };

  const [productName, setProductName] = useState(initial.product_name);
  const [vendorName, setVendorName] = useState(toFormValue(initial.vendor_name));
  const [description, setDescription] = useState(toFormValue(initial.product_description));
  const [websiteUrl, setWebsiteUrl] = useState(toFormValue(initial.product_website_url));
  const [error, setError] = useState("");

  const dialogRef = useRef<HTMLDialogElement>(null);

  // Written from an effect (post-render), read only in event handlers --
  // never mutated during render itself. Mirrors RawJsonEditor's isDirtyNow
  // pattern so the cancel/close listener (which must stay stable) doesn't
  // need `productName` etc. in its closure.
  const isDirtyRef = useRef(false);
  useEffect(() => {
    isDirtyRef.current =
      productName !== initial.product_name ||
      vendorName !== toFormValue(initial.vendor_name) ||
      description !== toFormValue(initial.product_description) ||
      websiteUrl !== toFormValue(initial.product_website_url);
  });

  const baseId = useId();
  const titleId = `${baseId}-title`;
  const nameId = `${baseId}-name`;
  const nameHintId = `${baseId}-name-hint`;
  const vendorId = `${baseId}-vendor`;
  const descriptionId = `${baseId}-description`;
  const websiteId = `${baseId}-website`;
  const websiteHintId = `${baseId}-website-hint`;
  const errorId = `${baseId}-error`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();

    const handleCancel = (event: Event) => {
      // Esc fires 'cancel' then 'close'. Without this, Esc discards unsaved
      // edits with no prompt.
      if (isDirtyRef.current && !window.confirm("Discard unsaved changes to the header?")) {
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

  const requestClose = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isDirtyRef.current && !window.confirm("Discard unsaved changes to the header?")) return;
    dialog.close();
  }, []);

  const handleSave = useCallback(() => {
    if (productName.trim() === "") {
      setError("Product name is required.");
      return;
    }
    setError("");
    onSave({
      product_name: productName.trim(),
      vendor_name: toRecordValue(vendorName),
      product_description: toRecordValue(description),
      product_website_url: toRecordValue(websiteUrl),
    });
    // Closing the dialog fires the native "close" event, which calls
    // onClose() -- the single path that unmounts this component. onSave
    // itself does not unmount anything, so there is no race between two
    // different close triggers.
    dialogRef.current?.close();
  }, [productName, vendorName, description, websiteUrl, onSave]);

  const nameDescribedBy = error ? `${nameHintId} ${errorId}` : nameHintId;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="w-full max-w-lg rounded-lg border border-gray-200 bg-white p-6 shadow-xl backdrop:bg-gray-900/50"
    >
      <h2 id={titleId} className="mb-4 text-lg font-bold text-gray-900">
        Edit: Header — {record.product_name}
      </h2>

      <div className="flex flex-col gap-4">
        <div>
          <label htmlFor={nameId} className="mb-1 block text-sm font-medium text-gray-700">
            Product name
          </label>
          <input
            id={nameId}
            type="text"
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            aria-describedby={nameDescribedBy}
            aria-invalid={error ? true : undefined}
            autoFocus
            className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p id={nameHintId} className="mt-1 text-xs text-gray-500">
            Required. Shown as the listing&apos;s page title.
          </p>
        </div>

        <div>
          <label htmlFor={vendorId} className="mb-1 block text-sm font-medium text-gray-700">
            Vendor name
          </label>
          <input
            id={vendorId}
            type="text"
            value={vendorName}
            onChange={(e) => setVendorName(e.target.value)}
            className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor={descriptionId} className="mb-1 block text-sm font-medium text-gray-700">
            Product description
          </label>
          <textarea
            id={descriptionId}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor={websiteId} className="mb-1 block text-sm font-medium text-gray-700">
            Product website URL
          </label>
          <input
            id={websiteId}
            type="url"
            inputMode="url"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            aria-describedby={websiteHintId}
            placeholder="https://example.com"
            className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p id={websiteHintId} className="mt-1 text-xs text-gray-500">
            Leave blank to clear -- stored as null, not an empty string.
          </p>
        </div>
      </div>

      {/* Rendered unconditionally so the region exists in the DOM before it
          is populated -- a live region created and filled in the same
          commit is frequently not announced at all. */}
      <p id={errorId} role="alert" className="mt-3 text-sm font-semibold text-red-700">
        {error}
      </p>

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
