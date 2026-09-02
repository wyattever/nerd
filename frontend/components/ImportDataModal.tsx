"use client";
import { useEffect, useId, useRef, useState } from "react";
import { IngestDraftResponse } from "@/lib/types";

// ACCESSIBILITY NOTE: no manual focus trap is implemented here, by design,
// matching SectionEditor.tsx. The W3C APA Working Group concluded
// showModal()'s native behavior (allowing Tab to reach browser chrome) is
// not a WCAG violation and is an intentional escape mechanism -- see
// https://github.com/w3c/wcag/discussions/4987. If this is ever flagged in
// an audit, start from that discussion before adding a focus trap.

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onProcessed: (result: IngestDraftResponse) => void;
}

type Status = "idle" | "submitting" | "error";

const ABORT_TIMEOUT_MS = 60000; // See nerd-import-data-architecture-v4.md §7.2 -- measured 3.50s for an 8-URL draft; 60s is headroom, not a guess at typical duration.

export function ImportDataModal({ isOpen, onClose, onProcessed }: Props) {
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const hasProcessedRef = useRef(false);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const submitStatusId = useId();

  // --- Focus Restoration Logic (matches SectionEditor.tsx) ---
  const triggerElementRef = useRef<HTMLElement | null>(null);
  const hasCapturedRef = useRef(false);

  useEffect(() => {
    if (!hasCapturedRef.current) {
      triggerElementRef.current = document.activeElement as HTMLElement | null;
      hasCapturedRef.current = true;
    }
    return () => {
      triggerElementRef.current?.focus?.();
      hasCapturedRef.current = false;
    };
  }, []);

  // --- Dialog Lifecycle ---
  useEffect(() => {
    if (isOpen) {
      dialogRef.current?.showModal();
      // Explicit focus rather than relying on [autofocus] inside <dialog>,
      // for consistent behavior across browsers.
      textareaRef.current?.focus();
    } else {
      dialogRef.current?.close();
    }
  }, [isOpen]);

  const handleClose = () => {
    const isDirty = draft.trim() !== "" && !hasProcessedRef.current;
    if (isDirty) {
      if (window.confirm("You have unsaved draft text. Are you sure you want to discard it?")) {
        onClose();
      }
    } else {
      onClose();
    }
  };

  const handleProcess = async () => {
    if (!draft.trim() || status === "submitting") return;

    setStatus("submitting");
    setError(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ABORT_TIMEOUT_MS);

    try {
      // Same-origin relative URL. The Python service is reached server-side
      // by app/api/ingest/draft/route.ts, which authenticates the session
      // and attaches an OIDC token. Three things follow: no Authorization
      // header here (the session cookie is sent automatically), no CORS,
      // and NOTHING about the API host compiled into the JS bundle -- which
      // is what NEXT_PUBLIC_API_BASE_URL was, and the reason the deployed
      // frontend has been calling the wrong host since June.
      const res = await fetch("/api/ingest/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft_markdown: draft }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || `Request failed (${res.status})`);
      }

      const result: IngestDraftResponse = await res.json();
      hasProcessedRef.current = true;
      setStatus("idle");
      onProcessed(result);
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === "AbortError"
          ? "Request timed out after 60 seconds. The draft may be too large, or a linked site may be unreachable."
          : err instanceof Error
          ? err.message
          : "Unknown error while processing draft.";
      setStatus("error");
      setError(message);
    } finally {
      clearTimeout(timeoutId);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleClose}
      onClose={handleClose}
      aria-labelledby={titleId}
      className="p-6 bg-white rounded-lg shadow-xl w-full max-w-3xl m-auto backdrop:bg-gray-900/50 border border-gray-200"
    >
      <h2 id={titleId} className="text-lg font-bold text-gray-900 mb-4">
        Import Data
      </h2>

      <label htmlFor="import-data-textarea" className="text-sm font-semibold text-gray-700 block mb-1">
        Paste Gem-generated draft
      </label>
      <textarea
        id="import-data-textarea"
        ref={textareaRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        rows={14}
        disabled={status === "submitting"}
        className="w-full font-mono text-sm p-4 border border-gray-300 rounded
                   focus:outline-none focus:ring-2 focus:ring-blue-500
                   disabled:bg-gray-100 disabled:cursor-not-allowed"
      />

      {/* Present in the DOM before content is inserted -- SC 4.1.3 requires
          this for reliable announcement of async status changes. */}
      <div id={submitStatusId} aria-live="polite" className="text-sm text-gray-600 mt-2 min-h-[1.25rem]">
        {status === "submitting" && "Processing draft..."}
      </div>

      {status === "error" && error && (
        <div role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3 mt-2">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-3 mt-4">
        <button
          type="button"
          onClick={handleClose}
          disabled={status === "submitting"}
          className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded
                     hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleProcess}
          disabled={!draft.trim() || status === "submitting"}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-700 border border-transparent rounded
                     hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {status === "submitting" ? "Processing..." : "Process Data"}
        </button>
      </div>
    </dialog>
  );
}
