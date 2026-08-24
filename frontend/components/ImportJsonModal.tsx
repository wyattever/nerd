// frontend/components/ImportJsonModal.tsx
"use client";

/**
 * "Import Candidate" modal for the /editor visual editor. Lets a user paste
 * a single raw PublishedProductRecord as JSON and adds it to the current
 * tab's in-memory list -- see EditorPage's handleImport, which restricts
 * this to the Candidate tab and handles the slug-uniqueness check.
 *
 * Dialog architecture matches the other /editor modals (PublishedHeaderEditor
 * etc.): native <dialog> + showModal(), no aria-modal, and the effect
 * cleanup does NOT call dialog.close() -- see PublishedHeaderEditor.tsx's
 * header comment for why (React 19 Strict Mode's dev-only double-invoke can
 * turn a cleanup-time close() into a phantom close event landing on a
 * freshly re-attached listener).
 *
 * Unlike the field editors, there is no "original" record here to lose on
 * Cancel -- the textarea always starts empty and nothing is edited in
 * place -- so Cancel/Escape close immediately with no discard confirmation.
 *
 * Validation: JSON.parse alone is not enough to safely hand the result back
 * as a PublishedProductRecord -- a syntactically valid but structurally
 * wrong paste (missing slug, wrong field types) would silently corrupt the
 * list it's added to and likely break rendering downstream (ListingCard,
 * the five field editors). Every other editor in this app runs
 * validateProductRecord/hasBlockingError before accepting data for exactly
 * this reason, so this modal does the same rather than trusting JSON.parse
 * success alone as "valid".
 *
 * Before that validation runs, handleImportClick auto-fills a handful of
 * boilerplate fields the schema requires but a hand-authored or partial
 * paste commonly omits (ncademi_product_url, vendor_directory_url,
 * last_updated, ai_insights) -- see the comments at each fill for what each
 * value actually represents (several are placeholders, not real data).
 * This only touches fields that are missing outright; anything the pasted
 * JSON already provides, including an explicit null, is left untouched.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { hasBlockingError, validateProductRecord } from "@/lib/published-validate";
import type { PublishedProductRecord } from "@/lib/published-tables";

interface ImportJsonModalProps {
  onImport: (record: PublishedProductRecord) => void;
  onClose: () => void;
}

export function ImportJsonModal({ onImport, onClose }: ImportJsonModalProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const baseId = useId();
  const titleId = `${baseId}-title`;
  const textareaId = `${baseId}-json`;
  const hintId = `${baseId}-hint`;
  const errorId = `${baseId}-error`;

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

  const handleImportClick = useCallback(() => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);

      // Auto-fill boilerplate fields the schema requires but a hand-authored
      // or partial paste commonly omits, before validation runs below. Only
      // attempted when parsed is actually a plain object; anything else
      // (an array, a primitive) is left alone and validateProductRecord's
      // own "must be a JSON object" error reports it, same as before this
      // change.
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;

        // PLACEHOLDER, not a verified live URL -- mirrors the same
        // convention used by the AppSheet migration route
        // (/api/local/migrate-appsheet) for the same reason: a candidate
        // record has no real ncademi.org URL yet, but the field is
        // required non-empty by published-validate.ts.
        if (!record.ncademi_product_url && typeof record.slug === "string" && record.slug) {
          record.ncademi_product_url = `https://ncademi.org/provide/directory/products/${record.slug}/`;
        }
        if (record.vendor_directory_url === undefined) {
          record.vendor_directory_url = null;
        }
        // Represents "when this record was imported," not a real prior
        // update timestamp from a source -- there is no such timestamp to
        // carry over for a hand-pasted record.
        if (record.last_updated === undefined) {
          record.last_updated = new Date().toISOString();
        }
        // Deprecated field, still required by the schema.
        if (record.ai_insights === undefined) {
          record.ai_insights = null;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? `Invalid JSON: ${err.message}` : "Invalid JSON.");
      return;
    }

    const issues = validateProductRecord(parsed);
    if (hasBlockingError(issues)) {
      const errorLines = issues
        .filter((i) => i.severity === "error")
        .map((i) => `${i.path}: ${i.message}`);
      setError(`This record does not match the schema:\n${errorLines.join("\n")}`);
      return;
    }

    setError("");
    onImport(parsed as PublishedProductRecord);
    setText("");
    // Closing the dialog fires the native "close" event, which calls
    // onClose() -- the single path that unmounts this component, matching
    // the pattern used throughout the other /editor modals.
    dialogRef.current?.close();
  }, [text, onImport]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="w-full max-w-2xl rounded-lg border border-gray-200 bg-white p-6 shadow-xl backdrop:bg-gray-900/45"
    >
      <h2 id={titleId} className="mb-4 text-lg font-bold text-gray-900">
        Import Candidate
      </h2>

      <label htmlFor={textareaId} className="mb-1 block text-sm font-medium text-gray-700">
        Record JSON
      </label>
      <p id={hintId} className="mb-2 text-xs text-gray-500">
        Paste a single product record as JSON. It will be added to the Candidate list once
        imported.
      </p>
      <textarea
        id={textareaId}
        ref={textareaRef}
        rows={15}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-describedby={error ? `${hintId} ${errorId}` : hintId}
        aria-invalid={error ? true : undefined}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        wrap="off"
        autoFocus
        className="w-full rounded border border-gray-300 bg-white p-2 font-mono text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      {/* Rendered unconditionally so the region exists in the DOM before it
          is populated -- a live region created and filled in the same
          commit is frequently not announced at all. */}
      <p id={errorId} role="alert" className="mt-3 whitespace-pre-line text-sm font-semibold text-red-700">
        {error}
      </p>

      <div className="mt-4 flex justify-end gap-3">
        <button
          type="button"
          onClick={requestClose}
          className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleImportClick}
          className="rounded border border-transparent bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Import
        </button>
      </div>
    </dialog>
  );
}
