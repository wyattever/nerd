// frontend/components/RawJsonEditor.tsx
"use client";

/**
 * Raw JSON editor for a single published-tables record.
 *
 * Deliberate choices, each with a reason that should survive refactoring:
 *
 * 1. PLAIN <textarea>, not CodeMirror/Monaco. A native textarea is a
 *    first-class text-editing widget to NVDA/JAWS/VoiceOver with no ARIA, it
 *    cannot trap the keyboard (WCAG 2.1.2), and it supports browser
 *    find-in-page. contentEditable-based editors have to reconstruct all of
 *    that. The largest record in the snapshot is 100 lines / 4.7 KB, so there
 *    is no performance argument for a code editor either.
 *
 * 2. NATIVE <dialog> + showModal(), not a div overlay. Focus containment,
 *    background inertness, Esc, and top-layer stacking come free.
 *    aria-modal is NOT set: showModal() already conveys modality, and adding
 *    aria-modal alongside an accessible name is known to hide static dialog
 *    content from VoiceOver quick-nav.
 *
 * 3. close/cancel wired via addEventListener on a ref, not onClose/onCancel
 *    props. React's synthetic versions of these events bubble even though the
 *    native events do not (facebook/react#34038), which fires parent handlers
 *    spuriously. The native listener has no such problem.
 *
 * 4. LIVE REGIONS LIVE INSIDE THE DIALOG. A live region outside a modal
 *    dialog is unreliable while the dialog is open -- VoiceOver ignores them
 *    outright and Chromium has a matching bug. Both regions here are rendered
 *    empty on mount and populated later; creating and filling a live region in
 *    the same commit is the classic way to get no announcement at all.
 *
 * 5. setText(e.target.value) is SYNCHRONOUS and does not transform the value.
 *    Any transformation, or any deferral of the input's own value, makes React
 *    write a value back that differs from what the browser has, and the
 *    browser resets the caret. useDeferredValue is applied only to the
 *    DERIVED validation, never to `text`.
 */

import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { formatJsonError, parseJsonWithPosition } from "@/lib/json-position";
import {
  hasBlockingError,
  summarizeIssues,
  validateProductRecord,
  validateSlugIntegrity,
  type ValidationIssue,
} from "@/lib/published-validate";
import type { PublishedProductRecord } from "@/lib/published-tables";

interface RawJsonEditorProps {
  /** The record to edit. Stringified once, on mount. */
  record: PublishedProductRecord;
  /** Every slug in the current draft, for uniqueness checking. */
  allSlugs: readonly string[];
  /** Called with the validated record. The dialog closes itself afterwards. */
  onSave: (next: PublishedProductRecord) => void;
  /** Called after the dialog has actually closed, for any reason. */
  onClose: () => void;
}

interface Analysis {
  syntaxMessage: string | null;
  issues: ValidationIssue[];
  parsed: PublishedProductRecord | null;
}

function analyze(
  text: string,
  originalSlug: string,
  allSlugs: readonly string[]
): Analysis {
  const result = parseJsonWithPosition<PublishedProductRecord>(text);
  if (!result.ok) {
    return { syntaxMessage: formatJsonError(result.error), issues: [], parsed: null };
  }
  const issues = validateProductRecord(result.value);
  const candidateSlug =
    typeof (result.value as { slug?: unknown })?.slug === "string"
      ? (result.value as { slug: string }).slug
      : originalSlug;
  issues.push(...validateSlugIntegrity(candidateSlug, originalSlug, allSlugs));
  return {
    syntaxMessage: null,
    issues,
    parsed: hasBlockingError(issues) ? null : result.value,
  };
}

export function RawJsonEditor({ record, allSlugs, onSave, onClose }: RawJsonEditorProps) {
  // Stringified once. Recomputing it from `record` on every render would make
  // the dirty check compare against a moving target.
  const initialText = useMemo(() => `${JSON.stringify(record, null, 2)}\n`, [record]);

  const [text, setText] = useState(initialText);
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [alertText, setAlertText] = useState("");

  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // The close/cancel listener must not re-subscribe on every keystroke, so it
  // cannot close over `text`. This ref is written in the same handler as the
  // state -- never during render -- and read only from event handlers.
  const textRef = useRef(initialText);

  const applyText = useCallback((next: string) => {
    textRef.current = next;
    setText(next);
  }, []);
  const isDirtyNow = useCallback(() => textRef.current !== initialText, [initialText]);

  const baseId = useId();
  const titleId = `${baseId}-title`;
  const hintId = `${baseId}-hint`;
  const textareaId = `${baseId}-json`;
  const alertId = `${baseId}-alert`;
  const resultsId = `${baseId}-results`;

  const isDirty = text !== initialText;

  // Validation is derived work, so it is safe -- and correct -- to defer it.
  // The textarea's own value is never deferred.
  const deferredText = useDeferredValue(text);
  const analysis = useMemo(
    () => analyze(deferredText, record.slug, allSlugs),
    [deferredText, record.slug, allSlugs]
  );
  const isStale = deferredText !== text;
  const blocked = analysis.syntaxMessage !== null || hasBlockingError(analysis.issues);

  const lineCount = useMemo(() => text.split("\n").length, [text]);

  // Open as a true modal and attach native cancel/close listeners.
  //
  // Deliberately does NOT call dialog.close() in the cleanup. Every real
  // close path (Save, Close, Escape) already calls dialog.close() before
  // onClose() fires and this component unmounts, so by the time cleanup runs
  // the dialog is already closed. Closing it here too used to be the bug:
  // per the HTML spec, dialog.close() fires its "close" event as a QUEUED
  // task, not synchronously. React 19 Strict Mode double-invokes this effect
  // in dev (mount -> cleanup -> mount), and the queued event from the first
  // cleanup's close() call was landing on the "close" listener re-attached
  // by the second mount -- calling onClose() and tearing the editor down
  // immediately after it opened, with nothing thrown to explain why.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (!dialog.open) dialog.showModal();

    const handleCancel = (event: Event) => {
      // Esc fires 'cancel' then 'close'. Without this, Esc discards unsaved
      // work with no prompt -- the exact loss the dirty check exists to stop.
      if (isDirtyNow() && !window.confirm("Discard unsaved changes to this record?")) {
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
  }, [onClose, isDirtyNow]);

  const requestClose = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isDirtyNow() && !window.confirm("Discard unsaved changes to this record?")) return;
    dialog.close();
  }, [isDirtyNow]);

  const handleSave = useCallback(() => {
    setSaveAttempted(true);
    // Re-analyze the CURRENT text, not the deferred copy -- the user may have
    // typed and hit Save before the deferred pass caught up.
    const fresh = analyze(text, record.slug, allSlugs);
    if (fresh.syntaxMessage) {
      setAlertText(`Cannot save. ${fresh.syntaxMessage}`);
      return;
    }
    if (hasBlockingError(fresh.issues)) {
      setAlertText(`Cannot save. ${summarizeIssues(fresh.issues)} See the list below.`);
      return;
    }
    if (!fresh.parsed) {
      setAlertText("Cannot save. The record could not be validated.");
      return;
    }
    setAlertText("");
    onSave(fresh.parsed);
    dialogRef.current?.close();
  }, [text, record.slug, allSlugs, onSave]);

  const handleReformat = useCallback(() => {
    const result = parseJsonWithPosition(text);
    if (!result.ok) {
      setAlertText(`Cannot reformat. ${formatJsonError(result.error)}`);
      return;
    }
    applyText(`${JSON.stringify(result.value, null, 2)}\n`);
    setAlertText("Reformatted with two-space indentation.");
    textareaRef.current?.focus();
  }, [text, applyText]);

  const handleRevert = useCallback(() => {
    if (!isDirty) return;
    if (!window.confirm("Revert this record to its state when the editor opened?")) return;
    applyText(initialText);
    setSaveAttempted(false);
    setAlertText("Reverted to the original record.");
    textareaRef.current?.focus();
  }, [isDirty, initialText, applyText]);

  const showIssues = saveAttempted || analysis.issues.length > 0 || analysis.syntaxMessage !== null;

  return (
    <dialog ref={dialogRef} className="nerd-json-dialog" aria-labelledby={titleId}>
      <div className="nerd-json-dialog-inner">
        <header className="nerd-json-dialog-head">
          <h2 className="nerd-json-dialog-title" id={titleId}>
            Edit raw JSON — {record.product_name}
          </h2>
          <p className="nerd-json-dialog-slug">
            <code>{record.slug}</code>
            {isDirty ? <span className="nerd-json-dirty"> · unsaved changes</span> : null}
          </p>
        </header>

        <label className="nerd-json-label" htmlFor={textareaId}>
          Record JSON
        </label>
        <p className="nerd-json-hint" id={hintId}>
          {lineCount} lines. Tab moves focus out of this field rather than inserting a tab
          character. Changes are held in the browser until you export the file.
        </p>

        <textarea
          id={textareaId}
          ref={textareaRef}
          className="nerd-json-textarea"
          value={text}
          onChange={(e) => applyText(e.target.value)}
          aria-describedby={hintId}
          aria-invalid={blocked ? true : undefined}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          wrap="off"
          // Focusing the editing surface is the point of this dialog, and
          // showModal() still announces the dialog and its name on open.
          autoFocus
        />

        {/*
          Assertive region. Empty on mount, populated only on an explicit user
          action (save / reformat / revert). It carries a SUMMARY -- the full
          per-issue text lives in the non-live list below, so a screen reader
          does not read every message twice.
        */}
        <div className="nerd-json-alert" id={alertId} role="alert">
          {alertText}
        </div>

        {/* Polite region for non-urgent state. Also inside the dialog. */}
        <div className="nerd-visually-hidden" role="status" aria-live="polite">
          {isStale ? "" : analysis.syntaxMessage ? "JSON is not valid." : ""}
        </div>

        {showIssues ? (
          <section className="nerd-json-results" id={resultsId} aria-label="Validation results">
            {analysis.syntaxMessage ? (
              <p className="nerd-json-issue nerd-json-issue--error">
                <span className="nerd-json-issue-badge">Syntax</span>
                {analysis.syntaxMessage}
              </p>
            ) : analysis.issues.length === 0 ? (
              <p className="nerd-json-issue nerd-json-issue--ok">
                <span className="nerd-json-issue-badge">OK</span>
                Valid JSON and a well-formed product record.
              </p>
            ) : (
              <ul className="nerd-json-issue-list">
                {analysis.issues.map((issue) => (
                  <li
                    key={`${issue.severity}:${issue.path}:${issue.message}`}
                    className={`nerd-json-issue nerd-json-issue--${issue.severity}`}
                  >
                    <span className="nerd-json-issue-badge">
                      {issue.severity === "error" ? "Error" : "Warning"}
                    </span>
                    <code className="nerd-json-issue-path">{issue.path}</code>
                    <span className="nerd-json-issue-text">{issue.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        <div className="nerd-json-dialog-actions">
          <button className="nerd-btn nerd-btn--primary" onClick={handleSave} type="button">
            Save changes
          </button>
          <button
            className="nerd-btn"
            disabled={analysis.syntaxMessage !== null}
            onClick={handleReformat}
            type="button"
          >
            Reformat
          </button>
          <button className="nerd-btn" disabled={!isDirty} onClick={handleRevert} type="button">
            Revert
          </button>
          <button className="nerd-btn" onClick={requestClose} type="button">
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}
