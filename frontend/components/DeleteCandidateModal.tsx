// frontend/components/DeleteCandidateModal.tsx
"use client";

/**
 * Confirmation modal for permanently deleting a Candidate record -- see
 * EditorPage's handleDeleteConfirm, which does the actual removal and save.
 *
 * Dialog architecture matches the other /editor modals (PublishedHeaderEditor,
 * ImportJsonModal, etc.): native <dialog> + showModal(), no aria-modal, and
 * the effect cleanup does NOT call dialog.close() -- see
 * PublishedHeaderEditor.tsx's header comment for why (React 19 Strict
 * Mode's dev-only double-invoke can turn a cleanup-time close() into a
 * phantom close event landing on a freshly re-attached listener).
 *
 * No dirty-state tracking here, unlike the field editors -- there is
 * nothing to "lose" by cancelling a delete confirmation, so Cancel/Escape
 * close immediately.
 */

import { useCallback, useEffect, useId, useRef } from "react";

interface DeleteCandidateModalProps {
  onConfirm: () => void;
  onClose: () => void;
}

export function DeleteCandidateModal({ onConfirm, onClose }: DeleteCandidateModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descId = `${baseId}-desc`;

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

  const handleConfirmClick = useCallback(() => {
    onConfirm();
    // Closing the dialog fires the native "close" event, which calls
    // onClose() -- the single path that unmounts this component, matching
    // the pattern used throughout the other /editor modals.
    dialogRef.current?.close();
  }, [onConfirm]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descId}
      className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 shadow-xl backdrop:bg-gray-900/45"
    >
      <h2 id={titleId} className="mb-2 text-lg font-bold text-gray-900">
        Delete Candidate Product
      </h2>
      <p id={descId} className="mb-4 text-sm text-gray-600">
        This will permanently delete this record.
      </p>

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={requestClose}
          className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirmClick}
          className="rounded border border-transparent bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          OK
        </button>
      </div>
    </dialog>
  );
}
