// frontend/components/ImportCandidatesModal.tsx
"use client";

/**
 * "Bulk Import Candidates" dialog for /editor/candidates. Paste one or more
 * research results, Check them against stored data (POST
 * /api/local/candidate-import, mode "preview"), then import the selected
 * records in one transaction (mode "apply", with the preview's version
 * tokens). Every decision lives server-side in
 * lib/server/candidate-import.ts; response types come from there as
 * `import type` only.
 *
 * Steps (one phase value):
 *   paste     --Check-->      checking
 *   checking  --200-->        results (focus moves to the results region)
 *             --error-->      paste (message in the alert region)
 *   results   --Import-->     importing
 *             --Back-->       paste (text kept)
 *   importing --200-->        close; onImported(body), then onClose()
 *             --409-->        results from the fresh preview, with the
 *                             conflict notice focused (D47 pattern)
 *             --error-->      results (message in the alert region)
 *
 * Dialog, focus and busy-state patterns follow PromoteConfirmModal.tsx:
 * a native <dialog> opened with showModal and named by aria-labelledby;
 * status and alert regions rendered before they are filled; while
 * importing, buttons carry aria-disabled (not disabled, which would drop
 * focus to <body>) and their handlers do nothing; Escape is blocked by a
 * "cancel" listener and every close request is guarded by the same check.
 * The native "close" event is the single exit. Focus returns to the element
 * that had focus when the dialog opened. No animation.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type {
  CandidateImportAppliedBody,
  CandidateImportPreviewBody,
  ImportRecordStatus,
} from "@/lib/server/candidate-import";

// Mirrors the private class constants in PromoteConfirmModal.tsx; keep in step.
const FOCUS_RING = "focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2";
const SECONDARY_BUTTON =
  `rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 ${FOCUS_RING} aria-disabled:cursor-not-allowed aria-disabled:opacity-50`;
const PRIMARY_BUTTON =
  `rounded border border-transparent bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 ${FOCUS_RING} aria-disabled:cursor-not-allowed aria-disabled:opacity-50`;

const ENDPOINT = "/api/local/candidate-import";
const SESSION_EXPIRED = "Your session has expired. Sign in again; nothing was imported.";

const STATUS_WORD: Record<ImportRecordStatus, string> = {
  ready: "Ready",
  warning: "Warning",
  blocked: "Blocked",
};
// Colour only reinforces the word; every one is at least 4.5:1 on white.
const STATUS_CLASS: Record<ImportRecordStatus, string> = {
  ready: "text-green-800",
  warning: "text-amber-800",
  blocked: "text-red-700",
};

type Phase = "paste" | "checking" | "results" | "importing";
type FocusTarget = { id: number; target: "textarea" | "results" | "notice" };
type Notice = { id: number; text: string };

interface ImportCandidatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImported: (body: CandidateImportAppliedBody) => void;
}

type Outcome =
  | { kind: "json"; status: number; body: unknown }
  | { kind: "not-json"; status: number }
  | { kind: "network"; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPreviewBody(value: unknown): value is CandidateImportPreviewBody {
  return (
    isPlainObject(value) &&
    value.mode === "preview" &&
    Array.isArray(value.records) &&
    isPlainObject(value.tokens) &&
    isPlainObject(value.summary)
  );
}

function isAppliedBody(value: unknown): value is CandidateImportAppliedBody {
  return isPlainObject(value) && value.mode === "apply" && Array.isArray(value.imported);
}

/** POSTs to the import route. The body is read as text and parsed here, so
 *  a bare non-JSON response (e.g. a 500 page) is reported, not thrown. */
async function postImport(payload: unknown): Promise<Outcome> {
  let response: Response;
  let text: string;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    text = await response.text();
  } catch (err) {
    return { kind: "network", message: err instanceof Error ? err.message : String(err) };
  }
  try {
    return { kind: "json", status: response.status, body: JSON.parse(text) as unknown };
  } catch {
    return { kind: "not-json", status: response.status };
  }
}

function unexpected(status: number): string {
  return `The server returned an unexpected response (status ${status}). Nothing was imported.`;
}

/** The alert text for any outcome that is not the expected success. */
function errorMessage(outcome: Outcome): string {
  if (outcome.kind === "network") {
    return `The server could not be reached (${outcome.message}). Nothing was imported.`;
  }
  if (outcome.status === 401) return SESSION_EXPIRED;
  if (outcome.kind === "not-json") return unexpected(outcome.status);
  const body = outcome.body;
  if (isPlainObject(body) && typeof body.error === "string") return body.error;
  return unexpected(outcome.status);
}

/** Slugs of the rows that can be imported (ready or warning). */
function importableSlugs(preview: CandidateImportPreviewBody): string[] {
  return preview.records
    .filter((r) => r.status !== "blocked" && r.slug !== null)
    .map((r) => r.slug as string);
}

export function ImportCandidatesModal({ isOpen, onClose, onImported }: ImportCandidatesModalProps) {
  if (!isOpen) return null;
  // Mounted fresh on every open, so each open starts at the paste step.
  return <ImportCandidatesDialog onClose={onClose} onImported={onImported} />;
}

function ImportCandidatesDialog({ onClose, onImported }: Omit<ImportCandidatesModalProps, "isOpen">) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const appliedRef = useRef<CandidateImportAppliedBody | null>(null);
  const nextIdRef = useRef(1);

  const [phase, setPhase] = useState<Phase>("paste");
  const phaseRef = useRef<Phase>(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const [text, setText] = useState("");
  const [preview, setPreview] = useState<CandidateImportPreviewBody | null>(null);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [alertText, setAlertText] = useState("");
  const [pasteInvalid, setPasteInvalid] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);

  const baseId = useId();
  const titleId = `${baseId}-title`;
  const textareaId = `${baseId}-text`;
  const hintId = `${baseId}-hint`;
  const alertId = `${baseId}-alert`;

  const moveFocus = useCallback((target: FocusTarget["target"]) => {
    setFocusTarget({ id: nextIdRef.current++, target });
  }, []);

  // The callbacks are read through refs so a parent re-render (a new
  // function identity) never re-runs the open effect, which focuses the
  // textarea.
  const onCloseRef = useRef(onClose);
  const onImportedRef = useRef(onImported);
  useEffect(() => {
    onCloseRef.current = onClose;
    onImportedRef.current = onImported;
  }, [onClose, onImported]);

  // Open on mount; the native "close" event is the single exit.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    // Captured once: under Strict Mode's double invoke the second run would
    // otherwise record the textarea, which already has focus.
    if (openerRef.current === null && document.activeElement instanceof HTMLElement) {
      openerRef.current = document.activeElement;
    }
    if (!dialog.open) dialog.showModal();
    textareaRef.current?.focus();

    const handleCancel = (event: Event) => {
      if (phaseRef.current === "importing") event.preventDefault();
    };
    const handleClose = () => {
      const opener = openerRef.current;
      if (opener && opener.isConnected) opener.focus();
      const applied = appliedRef.current;
      if (applied) onImportedRef.current(applied);
      onCloseRef.current();
    };
    dialog.addEventListener("cancel", handleCancel);
    dialog.addEventListener("close", handleClose);
    return () => {
      dialog.removeEventListener("cancel", handleCancel);
      dialog.removeEventListener("close", handleClose);
    };
  }, []);

  // Focus moves only on these explicit requests (results entry, a conflict
  // notice, or back to the textarea), after the target has rendered.
  useEffect(() => {
    if (focusTarget === null) return;
    if (focusTarget.target === "textarea") textareaRef.current?.focus();
    else if (focusTarget.target === "results") resultsRef.current?.focus();
    else noticeRef.current?.focus();
  }, [focusTarget]);

  const requestClose = useCallback(() => {
    if (phaseRef.current === "importing") return;
    dialogRef.current?.close();
  }, []);

  const handleCheck = useCallback(async () => {
    if (phaseRef.current !== "paste") return;
    setPhase("checking");
    setAlertText("");
    setPasteInvalid(false);
    setNotice(null);

    const outcome = await postImport({ mode: "preview", text });
    if (outcome.kind === "json" && outcome.status === 200 && isPreviewBody(outcome.body)) {
      const body = outcome.body;
      setPreview(body);
      setChecked(new Set(importableSlugs(body)));
      setPhase("results");
      moveFocus("results");
      return;
    }
    setAlertText(errorMessage(outcome));
    setPhase("paste");
    if (outcome.kind === "json" && outcome.status === 400) {
      setPasteInvalid(true);
      moveFocus("textarea");
    }
  }, [text, moveFocus]);

  const handleBack = useCallback(() => {
    if (phaseRef.current !== "results") return;
    setPreview(null);
    setNotice(null);
    setAlertText("");
    setPhase("paste");
    moveFocus("textarea");
  }, [moveFocus]);

  const handleImport = useCallback(async () => {
    if (phaseRef.current !== "results" || preview === null) return;
    const selected = preview.records
      .filter((r) => r.status !== "blocked" && r.slug !== null && checked.has(r.slug))
      .map((r) => r.slug as string);
    if (selected.length === 0) return;

    setPhase("importing");
    setAlertText("");

    // Never aborted: an import in flight must be allowed to finish.
    const outcome = await postImport({ mode: "apply", text, selected, tokens: preview.tokens });
    if (outcome.kind === "json" && outcome.status === 200 && isAppliedBody(outcome.body)) {
      appliedRef.current = outcome.body;
      // close() is not a "cancel", so the Escape guard does not apply here.
      dialogRef.current?.close();
      return;
    }
    if (outcome.kind === "json" && outcome.status === 409 && isPlainObject(outcome.body)) {
      const body = outcome.body;
      if (body.conflict === true && typeof body.notice === "string" && isPreviewBody(body.preview)) {
        const fresh = body.preview;
        const stillImportable = new Set(importableSlugs(fresh));
        setPreview(fresh);
        setChecked(new Set([...checked].filter((slug) => stillImportable.has(slug))));
        setNotice({ id: nextIdRef.current++, text: body.notice });
        setPhase("results");
        moveFocus("notice");
        return;
      }
    }
    setAlertText(errorMessage(outcome));
    setPhase("results");
  }, [preview, checked, text, moveFocus]);

  const toggle = useCallback((slug: string, on: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(slug);
      else next.delete(slug);
      return next;
    });
  }, []);

  // --- Derived view ---------------------------------------------------------

  const isImporting = phase === "importing";
  const isChecking = phase === "checking";
  const showResults = (phase === "results" || phase === "importing") && preview !== null;
  const selectedCount =
    preview === null
      ? 0
      : preview.records.filter((r) => r.status !== "blocked" && r.slug !== null && checked.has(r.slug)).length;
  const importUnavailable = isImporting || selectedCount === 0;

  let statusText = "";
  if (isChecking) statusText = "Checking…";
  else if (isImporting) statusText = "Importing…";
  else if (showResults && preview) {
    const s = preview.summary;
    statusText = `${s.total} ${s.total === 1 ? "record" : "records"} checked: ${s.ready} ready, ${s.warning} with warnings, ${s.blocked} blocked.`;
  }

  const describedBy = [hintId, pasteInvalid && alertText ? alertId : null].filter(Boolean).join(" ");

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="w-full max-w-4xl rounded-lg border border-gray-200 bg-white p-6 shadow-xl backdrop:bg-gray-900/45"
    >
      <h2 id={titleId} className="mb-3 text-lg font-bold text-gray-900">
        Bulk Import Candidates
      </h2>

      {!showResults && (
        <div className="flex flex-col gap-1">
          <label htmlFor={textareaId} className="text-sm font-medium text-gray-700">
            Research results
          </label>
          <p id={hintId} className="text-sm text-gray-600">
            Paste one or more JSON records from the Candidate Researcher. Code fences are fine. Up to 25 records.
          </p>
          <textarea
            id={textareaId}
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-describedby={describedBy}
            aria-invalid={pasteInvalid ? "true" : undefined}
            rows={12}
            spellCheck={false}
            className={`w-full rounded border border-gray-400 p-2 font-mono text-sm text-gray-900 ${FOCUS_RING}`}
          />
        </div>
      )}

      {notice !== null && (
        <p ref={noticeRef} tabIndex={-1} className={`mb-3 rounded border border-gray-400 bg-gray-50 p-3 text-sm text-gray-900 ${FOCUS_RING}`}>
          {notice.text}
        </p>
      )}

      <p role="status" aria-live="polite" className="mt-2 min-h-[1.25rem] text-sm text-gray-600">
        {statusText}
      </p>
      <p id={alertId} role="alert" className="min-h-[1.25rem] whitespace-pre-line text-sm font-semibold text-red-700">
        {alertText}
      </p>

      {showResults && preview && (
        <div
          ref={resultsRef}
          tabIndex={0}
          role="region"
          aria-label="Check results"
          className={`mt-2 max-h-[60vh] overflow-auto rounded border border-gray-200 ${FOCUS_RING}`}
        >
          <table className="w-full border-collapse text-left text-sm text-gray-900">
            <caption className="px-3 py-2 text-left text-sm font-bold text-gray-900">Records in this paste</caption>
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="border-b border-gray-300 px-3 py-2 font-semibold">Import</th>
                <th scope="col" className="border-b border-gray-300 px-3 py-2 font-semibold">#</th>
                <th scope="col" className="border-b border-gray-300 px-3 py-2 font-semibold">Product</th>
                <th scope="col" className="border-b border-gray-300 px-3 py-2 font-semibold">Slug</th>
                <th scope="col" className="border-b border-gray-300 px-3 py-2 font-semibold">Status</th>
                <th scope="col" className="border-b border-gray-300 px-3 py-2 font-semibold">Issues</th>
              </tr>
            </thead>
            <tbody>
              {preview.records.map((record) => {
                const importable = record.status !== "blocked" && record.slug !== null;
                const slug = record.slug;
                const label = record.product_name
                  ? `Import ${record.product_name}`
                  : `Import record ${record.index}`;
                return (
                  <tr key={record.index} className="align-top">
                    <td className="border-b border-gray-200 px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={label}
                        checked={importable && slug !== null && checked.has(slug)}
                        disabled={!importable}
                        onChange={(e) => {
                          if (importable && slug !== null) toggle(slug, e.target.checked);
                        }}
                        className={`h-4 w-4 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
                      />
                    </td>
                    <td className="border-b border-gray-200 px-3 py-2">{record.index}</td>
                    <th scope="row" className="border-b border-gray-200 px-3 py-2 text-left font-medium">
                      {record.product_name ?? "(no name)"}
                    </th>
                    <td className="break-all border-b border-gray-200 px-3 py-2 font-mono text-xs">{slug ?? "(none)"}</td>
                    <td className={`border-b border-gray-200 px-3 py-2 font-semibold ${STATUS_CLASS[record.status]}`}>
                      {STATUS_WORD[record.status]}
                    </td>
                    <td className="border-b border-gray-200 px-3 py-2">
                      {record.issues.length === 0 ? (
                        "None"
                      ) : (
                        <ul className="list-disc space-y-1 pl-5">
                          {record.issues.map((issue, i) => (
                            <li key={i} className="break-words">{issue}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-3">
        {showResults ? (
          <>
            <button
              type="button"
              onClick={isImporting ? undefined : requestClose}
              aria-disabled={isImporting ? "true" : undefined}
              className={SECONDARY_BUTTON}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={isImporting ? undefined : handleBack}
              aria-disabled={isImporting ? "true" : undefined}
              className={SECONDARY_BUTTON}
            >
              Back
            </button>
            <button
              type="button"
              onClick={importUnavailable ? undefined : handleImport}
              aria-disabled={importUnavailable ? "true" : undefined}
              className={PRIMARY_BUTTON}
            >
              Import {selectedCount} {selectedCount === 1 ? "candidate" : "candidates"}
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={requestClose} className={SECONDARY_BUTTON}>
              Cancel
            </button>
            <button
              type="button"
              onClick={isChecking ? undefined : handleCheck}
              aria-disabled={isChecking ? "true" : undefined}
              className={PRIMARY_BUTTON}
            >
              Check
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}
