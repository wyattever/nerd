// frontend/components/VendorHeaderEditor.tsx
"use client";

/**
 * Structured header editor for the /vendors visual editor. Edits
 * VendorRecord's own fields (vendor_name, vendor_website_url,
 * vendor_directory_url, notes, added_to_site) rather than a blob of raw
 * JSON, mirroring PublishedHeaderEditor.tsx's field-editor pattern for
 * PublishedProductRecord -- see that file for the full dialog-architecture
 * rationale (native <dialog> + showModal(), no aria-modal, no cleanup-time
 * dialog.close()).
 *
 * vendor_name doubles as the vendors.json join key (see vendor-schema.ts and
 * VendorSidebar.tsx's header comments), so /vendors/page.tsx's onSave must
 * also update its own selectedName after a rename -- this component only
 * reports the new fields, it does not know about selection state.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { VendorRecord } from "@/lib/vendor-schema";

export interface VendorHeaderFields {
  vendor_name: string;
  vendor_website_url: string | null;
  vendor_directory_url: string | null;
  notes: string | null;
  added_to_site: boolean;
}

interface VendorHeaderEditorProps {
  record: VendorRecord;
  onSave: (fields: VendorHeaderFields) => void;
  onClose: () => void;
}

function toFormValue(v: string | null): string {
  return v ?? "";
}

/** Empty input maps to null, matching VendorRecord's nullable string fields
 *  -- an empty string is not the "no value" signal the rest of the schema
 *  uses (see PublishedHeaderEditor's toRecordValue). */
function toRecordValue(v: string): string | null {
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

export function VendorHeaderEditor({ record, onSave, onClose }: VendorHeaderEditorProps) {
  const initial: VendorHeaderFields = {
    vendor_name: record.vendor_name,
    vendor_website_url: record.vendor_website_url,
    vendor_directory_url: record.vendor_directory_url,
    notes: record.notes,
    added_to_site: record.added_to_site,
  };

  const [vendorName, setVendorName] = useState(initial.vendor_name);
  const [websiteUrl, setWebsiteUrl] = useState(toFormValue(initial.vendor_website_url));
  const [directoryUrl, setDirectoryUrl] = useState(toFormValue(initial.vendor_directory_url));
  const [notes, setNotes] = useState(toFormValue(initial.notes));
  const [addedToSite, setAddedToSite] = useState(initial.added_to_site);
  const [error, setError] = useState("");

  const dialogRef = useRef<HTMLDialogElement>(null);

  // Written from an effect (post-render), read only in event handlers --
  // never mutated during render itself. Mirrors PublishedHeaderEditor's
  // isDirtyRef pattern.
  const isDirtyRef = useRef(false);
  useEffect(() => {
    isDirtyRef.current =
      vendorName !== initial.vendor_name ||
      websiteUrl !== toFormValue(initial.vendor_website_url) ||
      directoryUrl !== toFormValue(initial.vendor_directory_url) ||
      notes !== toFormValue(initial.notes) ||
      addedToSite !== initial.added_to_site;
  });

  const baseId = useId();
  const titleId = `${baseId}-title`;
  const nameId = `${baseId}-name`;
  const nameHintId = `${baseId}-name-hint`;
  const websiteId = `${baseId}-website`;
  const websiteHintId = `${baseId}-website-hint`;
  const directoryId = `${baseId}-directory`;
  const notesId = `${baseId}-notes`;
  const addedId = `${baseId}-added`;
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
    if (vendorName.trim() === "") {
      setError("Vendor name is required.");
      return;
    }
    setError("");
    onSave({
      vendor_name: vendorName.trim(),
      vendor_website_url: toRecordValue(websiteUrl),
      vendor_directory_url: toRecordValue(directoryUrl),
      notes: toRecordValue(notes),
      added_to_site: addedToSite,
    });
    // Closing the dialog fires the native "close" event, which calls
    // onClose() -- the single path that unmounts this component.
    dialogRef.current?.close();
  }, [vendorName, websiteUrl, directoryUrl, notes, addedToSite, onSave]);

  const nameDescribedBy = error ? `${nameHintId} ${errorId}` : nameHintId;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="w-full max-w-lg rounded-lg border border-gray-200 bg-white p-6 shadow-xl backdrop:bg-gray-900/50"
    >
      <h2 id={titleId} className="mb-4 text-lg font-bold text-gray-900">
        Edit: Header — {record.vendor_name}
      </h2>

      <div className="flex flex-col gap-4">
        <div>
          <label htmlFor={nameId} className="mb-1 block text-sm font-medium text-gray-700">
            Vendor name
          </label>
          <input
            id={nameId}
            type="text"
            value={vendorName}
            onChange={(e) => setVendorName(e.target.value)}
            aria-describedby={nameDescribedBy}
            aria-invalid={error ? true : undefined}
            autoFocus
            className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p id={nameHintId} className="mt-1 text-xs text-gray-500">
            Required. Also the join key used to match this vendor&apos;s resources elsewhere in
            vendors.json.
          </p>
        </div>

        <div>
          <label htmlFor={websiteId} className="mb-1 block text-sm font-medium text-gray-700">
            Vendor website URL
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

        <div>
          <label htmlFor={directoryId} className="mb-1 block text-sm font-medium text-gray-700">
            NCADEMI vendor URL
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
          <label htmlFor={notesId} className="mb-1 block text-sm font-medium text-gray-700">
            Notes
          </label>
          <textarea
            id={notesId}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            id={addedId}
            type="checkbox"
            checked={addedToSite}
            onChange={(e) => setAddedToSite(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <label htmlFor={addedId} className="text-sm font-medium text-gray-700">
            Added to site
          </label>
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
