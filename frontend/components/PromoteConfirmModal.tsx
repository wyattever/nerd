// frontend/components/PromoteConfirmModal.tsx
"use client";

/**
 * The D9 confirmation modal for "Update Stored Data" (plan §3.14: D42–D49,
 * D51, D54, D55). Mounting it opens it: it requests a preview of the
 * mirror promote for one category, lists every proposed change, and on
 * Confirm sends `apply` with the preview's version tokens. Every decision
 * that can be tested without a browser lives in lib/promote-ui.ts; response
 * types come from lib/server/promote-mirror.ts as `import type` only (D42).
 *
 * State machine (one state value; it moves only as listed):
 *   loading  --preview-->        plan | failed (refused or error) | unknown
 *   plan     --Confirm-->        applying
 *   applying --applied-->        close with { kind: "applied" }
 *            --conflict, fresh plan-->            plan, with the conflict notice (D47)
 *            --conflict, fresh refused/error-->   failed, with the conflict notice
 *            --refused or error-->               failed
 *            --network failure or not JSON-->    unknown (D54)
 *   unknown  --Preview again-->  loading (notice cleared; apply is never retried)
 *   any state except applying --Cancel/Close/Escape--> close, with
 *            loading/plan -> cancelled, failed -> failed, unknown -> unknown.
 *
 * Busy state (D55): while applying, Cancel and Confirm carry
 * aria-disabled="true" rather than the disabled attribute, and their
 * handlers do nothing. A disabled button would drop focus to <body> the
 * moment the apply starts; aria-disabled keeps focus where it is while
 * still telling assistive technology the control is unavailable. Escape is
 * blocked by a "cancel" listener that calls preventDefault, and every close
 * request is guarded by the same check, because browsers may not honour a
 * repeated preventDefault.
 *
 * The native "close" event is the single exit: it reports the result once
 * through onClosed. The caller (SourceToggle, step 6.3) owns everything
 * after that: the Messages lines (D49), focus after close (D51), the
 * refresh, and navigation after an apply (D52). The effect cleanup never
 * calls dialog.close() (see DeleteAddedModal.tsx for why).
 *
 * Accessibility: aria-labelledby (the h2) and aria-describedby (only the
 * description elements actually rendered); status and alert regions that
 * exist before they are filled; the conflict notice receives focus and is
 * not also a live region; a named, keyboard-focusable scrollable body with
 * h3 sections and real lists; focus rings at 6.82:1 (blue-700); no motion.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { PromotePlanBody } from "@/lib/server/promote-mirror";
import {
  CATEGORY_LABEL,
  NOT_JSON,
  classifyResponse,
  confirmLabel,
  conflictNotice,
  passwordStatement,
  sections,
  summaryLines,
  type PromoteCategory,
  type PromoteModalResult,
  type PromoteView,
} from "@/lib/promote-ui";
import { formatLocalTimestamp } from "@/lib/format";

type FailedView = Extract<PromoteView, { kind: "refused" | "error" }>;
type Notice = { id: number; text: string };

type ModalState =
  | { phase: "loading"; request: number }
  | { phase: "plan"; body: PromotePlanBody; notice: Notice | null }
  | { phase: "applying"; body: PromotePlanBody; notice: Notice | null }
  | { phase: "failed"; view: FailedView; notice: Notice | null }
  | { phase: "unknown"; detail: string };

interface PromoteConfirmModalProps {
  category: PromoteCategory;
  onClosed: (result: PromoteModalResult) => void;
}

const FOCUS_RING = "focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2";
const SECONDARY_BUTTON =
  `rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 ${FOCUS_RING} aria-disabled:cursor-not-allowed aria-disabled:opacity-50`;
const DESTRUCTIVE_BUTTON =
  `rounded border border-transparent bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 ${FOCUS_RING} aria-disabled:cursor-not-allowed aria-disabled:opacity-50`;
const PRIMARY_BUTTON =
  `rounded border border-transparent bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 ${FOCUS_RING} aria-disabled:cursor-not-allowed aria-disabled:opacity-50`;

/** What closing in `state` reports (D48, D54). */
function resultFor(state: ModalState): PromoteModalResult {
  switch (state.phase) {
    case "loading":
    case "plan":
      return { kind: "cancelled" };
    case "failed":
      return { kind: "failed", view: state.view };
    case "unknown":
      return { kind: "unknown", detail: state.detail };
    case "applying":
      // Reached only if a browser closes the dialog despite the cancel guard.
      return { kind: "unknown", detail: "the dialog closed while the apply was in flight" };
  }
}

/** POSTs to the promote route and classifies the response. A rejected fetch
 *  (network) becomes unknown; an abort is rethrown for the caller to ignore. */
async function requestPromote(body: unknown, signal?: AbortSignal): Promise<{ status: number; view: PromoteView }> {
  let response: Response;
  try {
    response = await fetch("/api/local/promote-live", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    const message = err instanceof Error ? err.message : String(err);
    return { status: 0, view: { kind: "unknown", detail: `network error: ${message}` } };
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch (err) {
    if (signal?.aborted) throw err;
    json = NOT_JSON;
  }
  return { status: response.status, view: classifyResponse(response.status, json) };
}

export function PromoteConfirmModal({ category, onClosed }: PromoteConfirmModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const previewControllerRef = useRef<AbortController | null>(null);
  const resultRef = useRef<PromoteModalResult | null>(null);
  const nextRequestRef = useRef(1);
  const nextNoticeRef = useRef(1);

  const [state, setState] = useState<ModalState>({ phase: "loading", request: 0 });
  const stateRef = useRef<ModalState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const baseId = useId();
  const titleId = `${baseId}-title`;
  const runDescId = `${baseId}-run`;
  const blockedDescId = `${baseId}-blocked`;
  const passwordDescId = `${baseId}-passwords`;
  const categoryLabel = CATEGORY_LABEL[category];

  // Open on mount; the native "close" event is the single exit.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();

    const handleCancel = (event: Event) => {
      if (stateRef.current.phase === "applying") event.preventDefault();
    };
    const handleClose = () => {
      previewControllerRef.current?.abort();
      onClosed(resultRef.current ?? resultFor(stateRef.current));
    };
    dialog.addEventListener("cancel", handleCancel);
    dialog.addEventListener("close", handleClose);
    return () => {
      dialog.removeEventListener("cancel", handleCancel);
      dialog.removeEventListener("close", handleClose);
    };
  }, [onClosed]);

  // The preview, re-run whenever a new loading request starts. Safe under
  // Strict Mode's double invoke: the cleanup aborts, and aborted results
  // are ignored.
  const previewRequest = state.phase === "loading" ? state.request : null;
  useEffect(() => {
    if (previewRequest === null) return;
    const controller = new AbortController();
    previewControllerRef.current = controller;
    requestPromote({ category, mode: "preview" }, controller.signal)
      .then(({ status, view }) => {
        if (controller.signal.aborted) return;
        switch (view.kind) {
          case "plan":
            setState({ phase: "plan", body: view.body, notice: null });
            return;
          case "refused":
          case "error":
            setState({ phase: "failed", view, notice: null });
            return;
          case "unknown":
            setState({ phase: "unknown", detail: view.detail });
            return;
          default:
            // An applied or conflict body in answer to a preview.
            setState({ phase: "unknown", detail: `HTTP ${status}; unexpected response` });
        }
      })
      .catch(() => {
        // Aborted: the dialog closed, unmounted, or Strict Mode re-ran the effect.
      });
    return () => controller.abort();
  }, [category, previewRequest]);

  // D47: focus moves to the conflict notice whenever a new one is set.
  const noticeId = state.phase === "plan" || state.phase === "applying" || state.phase === "failed" ? state.notice?.id ?? null : null;
  useEffect(() => {
    if (noticeId !== null) noticeRef.current?.focus();
  }, [noticeId]);

  const requestClose = useCallback(() => {
    if (stateRef.current.phase === "applying") return;
    dialogRef.current?.close();
  }, []);

  const handleConfirm = useCallback(async () => {
    const current = stateRef.current;
    if (current.phase !== "plan") return;
    const { body } = current;
    setState({ phase: "applying", body, notice: current.notice });

    // Never aborted: an apply in flight must be allowed to finish.
    const { status, view } = await requestPromote({ category, mode: "apply", tokens: body.tokens });
    switch (view.kind) {
      case "applied":
        resultRef.current = { kind: "applied", body: view.body };
        dialogRef.current?.close();
        return;
      case "conflict": {
        const notice: Notice = { id: nextNoticeRef.current++, text: conflictNotice(view.body) };
        const fresh = view.fresh;
        if (fresh.kind === "plan") {
          setState({ phase: "plan", body: fresh.body, notice });
        } else if (fresh.kind === "refused" || fresh.kind === "error") {
          setState({ phase: "failed", view: fresh, notice });
        } else {
          setState({
            phase: "unknown",
            detail: fresh.kind === "unknown" ? fresh.detail : `HTTP ${status}; unexpected response`,
          });
        }
        return;
      }
      case "refused":
      case "error":
        setState({ phase: "failed", view, notice: null });
        return;
      case "unknown":
        setState({ phase: "unknown", detail: view.detail });
        return;
      case "plan":
        setState({ phase: "unknown", detail: `HTTP ${status}; unexpected response` });
        return;
    }
  }, [category]);

  const handlePreviewAgain = useCallback(() => {
    if (stateRef.current.phase !== "unknown") return;
    setState({ phase: "loading", request: nextRequestRef.current++ });
  }, []);

  // --- Derived view ---------------------------------------------------------

  const isApplying = state.phase === "applying";
  const planBody = state.phase === "plan" || state.phase === "applying" ? state.body : null;
  const notice = state.phase === "plan" || state.phase === "applying" || state.phase === "failed" ? state.notice : null;

  const runTime = planBody ? formatLocalTimestamp(planBody.runFinishedAt) ?? planBody.runFinishedAt : null;
  const blockedReason =
    planBody && !planBody.deletionsAllowed && typeof planBody.deletionsBlockedReason === "string"
      ? planBody.deletionsBlockedReason
      : null;
  const passwordText = planBody ? passwordStatement(planBody) : null;

  const describedBy = [
    state.phase === "loading" || planBody ? runDescId : null,
    blockedReason !== null ? blockedDescId : null,
    passwordText !== null ? passwordDescId : null,
  ]
    .filter((id): id is string => id !== null)
    .join(" ");

  let statusText = "";
  if (state.phase === "loading") statusText = "Loading preview…";
  else if (state.phase === "plan" && state.notice === null) statusText = "Preview ready.";
  else if (state.phase === "applying") statusText = "Applying changes…";

  let alertText = "";
  if (state.phase === "failed") {
    const { view } = state;
    if (view.kind === "refused") alertText = view.body.error;
    else if (view.status === 401) alertText = "Your session has expired; sign in again.";
    else alertText = view.error;
  } else if (state.phase === "unknown") {
    alertText = `The result is unknown (${state.detail}). Review a fresh preview before trying again.`;
  }

  const deletes = planBody !== null && planBody.counts.removed > 0 && planBody.deletionsAllowed;
  const closeLabel = state.phase === "failed" || state.phase === "unknown" ? "Close" : "Cancel";

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={describedBy || undefined}
      className="w-full max-w-2xl rounded-lg border border-gray-200 bg-white p-6 shadow-xl backdrop:bg-gray-900/45"
    >
      <h2 id={titleId} className="mb-2 text-lg font-bold text-gray-900">
        Update stored {categoryLabel} data
      </h2>

      {state.phase === "loading" && (
        <p id={runDescId} className="mb-3 text-sm text-gray-600">
          Loading the preview of changes to stored {categoryLabel} data.
        </p>
      )}
      {planBody && (
        <p id={runDescId} className="mb-3 text-sm text-gray-600">
          Snapshot from the live run of {runTime}.
        </p>
      )}
      {blockedReason !== null && (
        <p id={blockedDescId} className="mb-3 rounded border-2 border-amber-700 bg-amber-50 p-3 text-sm font-bold text-gray-900">
          {blockedReason}
        </p>
      )}
      {passwordText !== null && (
        <p id={passwordDescId} className="mb-3 text-sm text-gray-700">
          {passwordText}
        </p>
      )}

      {notice !== null && (
        <p ref={noticeRef} tabIndex={-1} className={`mb-3 rounded border border-gray-400 bg-gray-50 p-3 text-sm text-gray-900 ${FOCUS_RING}`}>
          {notice.text}
        </p>
      )}

      <p role="status" aria-live="polite" className="min-h-[1.25rem] text-sm text-gray-600">
        {statusText}
      </p>
      <p role="alert" className="min-h-[1.25rem] text-sm font-semibold text-red-700">
        {alertText}
      </p>

      {planBody && (
        <div
          tabIndex={0}
          role="region"
          aria-label="Proposed changes"
          className={`mt-2 max-h-[60vh] overflow-auto rounded border border-gray-200 p-3 ${FOCUS_RING}`}
        >
          {sections(planBody).map((section) => {
            const headingId = `${baseId}-section-${section.id}`;
            return (
              <section key={section.id} aria-labelledby={headingId} className="mb-4">
                <h3 id={headingId} className="mb-1 text-base font-bold text-gray-900">
                  {section.heading}
                </h3>
                <ul className="list-disc space-y-1 pl-5 text-sm text-gray-900">
                  {section.items.map((item, index) => (
                    <li key={`${section.id}-${index}`}>
                      <span className="block">{item.primary}</span>
                      {item.secondary !== null && <span className="block break-all text-gray-600">{item.secondary}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          <h3 className="mb-1 text-base font-bold text-gray-900">Summary</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-gray-900">
            {summaryLines(planBody).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex justify-end gap-3">
        <button
          type="button"
          onClick={requestClose}
          aria-disabled={isApplying ? "true" : undefined}
          className={SECONDARY_BUTTON}
        >
          {closeLabel}
        </button>
        {state.phase === "unknown" && (
          <button type="button" onClick={handlePreviewAgain} className={PRIMARY_BUTTON}>
            Preview again
          </button>
        )}
        {planBody && (
          <button
            type="button"
            onClick={isApplying ? undefined : handleConfirm}
            aria-disabled={isApplying ? "true" : undefined}
            className={deletes ? DESTRUCTIVE_BUTTON : PRIMARY_BUTTON}
          >
            {confirmLabel(planBody)}
          </button>
        )}
      </div>
    </dialog>
  );
}
