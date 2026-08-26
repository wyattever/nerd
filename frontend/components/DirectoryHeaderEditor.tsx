// frontend/components/DirectoryHeaderEditor.tsx
"use client";

/**
 * Structured header editor for DirectoryRecord (directory-schema.ts),
 * replacing the deleted VendorHeaderEditor.tsx. Edits product_name /
 * product_website_url / vendor_directory_url / product_description --
 * DirectoryRecord's own identity fields, not the legacy VendorRecord's
 * vendor_name/vendor_website_url/notes/added_to_site. added_to_site has no
 * DirectoryRecord equivalent and is intentionally not editable here (see
 * directory-schema.ts's toLegacyVendorRecord for why it's defaulted false
 * for the still-legacy dialogs).
 *
 * Native <dialog> + showModal(), dirty-tracking with a confirm-before-close
 * prompt -- same pattern the original (pre-degradation) VendorHeaderEditor
 * used, restored here since this is freshly authored code.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { DirectoryRecord } from "@/lib/directory-schema";

export interface DirectoryHeaderFields {
  product_name: string;
  product_website_url: string | null;
  vendor_directory_url: string | null;
  product_description: string | null;
}

interface DirectoryHeaderEditorProps {
  record: DirectoryRecord;
  onSave: (fields: DirectoryHeaderFields) => void;
  onClose: () => void;
}

function toFormValue(v: string | null): string {
  return v ?? "";
}

/** Empty input maps to null, matching DirectoryRecord's nullable string
 *  fields -- an empty string is not the "no value" signal the rest of the
 *  schema uses. */
function toRecordValue(v: string): string | null {
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

export function DirectoryHeaderEditor({ record, onSave, onClose }: DirectoryHeaderEditorProps) {
  const initial: DirectoryHeaderFields = {
    product_name: record.product_name,
    product_website_url: record.product_website_url,
    vendor_directory_url: record.vendor_directory_url,
    product_description: record.product_description,
  };

  const [name, setName] = useState(initial.product_name);
  const [websiteUrl, setWebsiteUrl] = useState(toFormValue(initial.product_website_url));
  const [directoryUrl, setDirectoryUrl] = useState(toFormValue(initial.vendor_directory_url));
  const [description, setDescription] = useState(toFormValue(initial.product_description));
  const [error, setError] = useState("");

  const dialogRef = useRef<HTMLDialogElement>(null);

  // Written from an effect (post-render), read only in event handlers.
  const isDirtyRef = useRef(false);
  useEffect(() => {
    isDirtyRef.current =
      name !== initial.product_name ||
      websiteUrl !== toFormValue(initial.product_website_url) ||
      directoryUrl !== toFormValue(initial.vendor_directory_url) ||
      description !== toFormValue(initial.product_description);
  });

  const baseId = useId();
  const titleId = `${baseId}-title`;
  const nameId = `${baseId}-name`;
  const nameHintId = `${baseId}-name-hint`;
  const websiteId = `${baseId}-website`;
  const directoryId = `${baseId}-directory`;
  const descriptionId = `${baseId}-description`;
  const errorId = `${baseId}-error`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();

    const handleCancel = (event: Event) => {
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
    if (name.trim() === "") {
      setError("Name is required.");
      return;
    }
    setError("");
    onSave({
      product_name: name.trim(),
      product_website_url: toRecordValue(websiteUrl),
      vendor_directory_url: toRecordValue(directoryUrl),
      product_description: toRecordValue(description),
    });
    dialogRef.current?.close();
  }, [name, websiteUrl, directoryUrl, description, onSave]);

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
            Name
          </label>
          <input
            id={nameId}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-describedby={nameDescribedBy}
            aria-invalid={error ? true : undefined}
            autoFocus
            className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p id={nameHintId} className="mt-1 text-xs text-gray-500">
            Required. Stored as product_name.
          </p>
        </div>

        <div>
          <label htmlFor={websiteId} className="mb-1 block text-sm font-medium text-gray-700">
            Website URL
          </label>
          <input
            id={websiteId}
            type="url"
            inputMode="url"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="https://example.com"
            className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-gray-500">Leave blank to clear -- stored as null, not an empty string.</p>
        </div>

        <div>
          <label htmlFor={directoryId} className="mb-1 block text-sm font-medium text-gray-700">
            NCADEMI directory URL
          </label>
          <input
            id={directoryId}
            type="url"
            inputMode="url"
            value={directoryUrl}
            onChange={(e) => setDirectoryUrl(e.target.value)}
            placeholder="https://ncademi.org/provide/directory/vendors/example/"
            className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor={descriptionId} className="mb-1 block text-sm font-medium text-gray-700">
            Description
          </label>
          <textarea
            id={descriptionId}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

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
