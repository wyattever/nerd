// frontend/components/CodeViewModal.tsx
"use client";

/**
 * Read-only "view source" modal for the /editor "Code" button (Phase: adds
 * a code icon button right after ACR in CandidateEditor.tsx/AddedEditor.tsx/
 * PublishedEditor.tsx -- not VendorEditor.tsx, which has no ACR button and
 * whose records aren't rendered through buildNcademiListingHtml). Shows the
 * exact HTML string lib/ncademiPreview.ts's buildNcademiListingHtml()
 * builds for the live preview iframe (ListingCard.tsx), as plain escaped
 * text -- NOT re-rendered/executed -- so pasting it over the <article> on
 * an actual ncademi.org page reproduces the same result. Deliberately not
 * wired to the Viewer/preview iframe itself; this is its own read path.
 *
 * Dialog architecture matches the other /editor modals (ImportJsonModal
 * etc.): native <dialog> + showModal(), no aria-modal, and the effect
 * cleanup does NOT call dialog.close() -- see PublishedHeaderEditor.tsx's
 * header comment for why (React 19 Strict Mode's dev-only double-invoke can
 * turn a cleanup-time close() into a phantom close event landing on a
 * freshly re-attached listener).
 *
 * No dirty-state/discard-confirmation on Escape or Cancel, unlike the field
 * editors: there's nothing to lose here, the content is entirely read-only.
 *
 * Wider than the other /editor dialogs (max-w-5xl vs. their max-w-2xl/3xl)
 * per this feature's own ask -- HTML source needs the extra width to stay
 * readable without wrapping every line.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";

interface CodeViewModalProps {
  code: string;
  onClose: () => void;
}

export function CodeViewModal({ code, onClose }: CodeViewModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [copyStatus, setCopyStatus] = useState("");

  const baseId = useId();
  const titleId = `${baseId}-title`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();

    const handleClose = () => onClose();
    dialog.addEventListener("close", handleClose);
    return () => {
      dialog.removeEventListener("close", handleClose);
    };
  }, [onClose]);

  const requestClose = useCallback(() => {
    dialogRef.current?.close();
  }, []);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(
      () => setCopyStatus("Copied to clipboard."),
      () => setCopyStatus("Copy failed -- select the text below and copy manually.")
    );
  }, [code]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="w-full max-w-5xl rounded-lg border border-gray-200 bg-white p-6 shadow-xl backdrop:bg-gray-900/45"
    >
      <h2 id={titleId} className="mb-4 text-lg font-bold text-gray-900">
        Code
      </h2>

      <pre className="max-h-[70vh] overflow-auto whitespace-pre rounded border border-gray-300 bg-gray-50 p-4 font-mono text-xs text-gray-900">
        <code>{code}</code>
      </pre>

      {/* Rendered unconditionally so the region exists in the DOM before it
          is populated -- a live region created and filled in the same
          commit is frequently not announced at all. */}
      <p role="status" aria-live="polite" className="mt-2 min-h-[1rem] text-xs text-gray-600">
        {copyStatus}
      </p>

      <div className="mt-4 flex justify-end gap-3">
        <button
          type="button"
          onClick={handleCopy}
          className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Copy
        </button>
        <button
          type="button"
          onClick={requestClose}
          className="rounded border border-transparent bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Close
        </button>
      </div>
    </dialog>
  );
}
