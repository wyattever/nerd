// frontend/lib/promote-ui.ts
/**
 * Pure, client-safe logic for the D9 confirmation modal (plan §3.14,
 * D42–D52, D54): classifying a promote-live response, the confirm label,
 * the list sections in D44 order, the summary, the password statement, the
 * conflict notice, the Messages lines (D49) and the removed-record check
 * (D52). Everything the modal decides that can be tested without a browser
 * lives here; components/PromoteConfirmModal.tsx renders it.
 *
 * Pure: no React, no fetch, no clock, no randomness, no DOM, and no
 * mutation of any input. The only imports are `import type` (D42), which
 * are erased at build time, so the server response module is never
 * bundled into the client.
 */

import type {
  PromoteConflictBody,
  PromotePlanBody,
  PromoteRefusedBody,
} from "@/lib/server/promote-mirror";
import type { PlanReport } from "@/lib/mirror-planner";

// --- Labels -----------------------------------------------------------------

export type PromoteCategory = "published" | "added" | "vendors";

export const CATEGORY_LABEL: Readonly<Record<PromoteCategory, string>> = {
  published: "Published",
  added: "Added",
  vendors: "Vendors",
};

/** D47: plain-word labels for the promote keys (the seven read, plus candidate). */
const DOCUMENT_LABELS: Readonly<Record<string, string>> = {
  published: "stored Published data",
  added: "stored Added data",
  candidate: "stored Candidates data",
  vendors: "stored Vendors data",
  "published-live": "the live Published snapshot",
  "added-live": "the live Added snapshot",
  "vendors-live": "the live Vendors snapshot",
  passwords: "vendor-review passwords",
  tracking: "tracking data",
};

export function documentLabel(key: string): string {
  return Object.prototype.hasOwnProperty.call(DOCUMENT_LABELS, key) ? DOCUMENT_LABELS[key] : key;
}

// --- Response classification (D47, D48, D54) ---------------------------------

export type PromoteView =
  | { kind: "plan"; body: PromotePlanBody }
  | { kind: "applied"; body: PromotePlanBody }
  | { kind: "conflict"; body: PromoteConflictBody; fresh: PromoteView }
  | { kind: "refused"; body: PromoteRefusedBody }
  | { kind: "error"; status: number; error: string }
  | { kind: "unknown"; detail: string };

/** Passed to classifyResponse when the response body could not be parsed as JSON. */
export const NOT_JSON: unique symbol = Symbol("NOT_JSON");

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unexpected(status: number): PromoteView {
  return { kind: "unknown", detail: `HTTP ${status}; unexpected response` };
}

/**
 * Maps an HTTP status and parsed body to a view, by the rules of dispatch
 * 6.2 in order. Only the fields those rules need are validated; the rest of
 * the body is trusted to the §3.13 server types.
 */
export function classifyResponse(status: number, json: unknown): PromoteView {
  // 1. Not JSON.
  if (json === NOT_JSON) {
    return { kind: "unknown", detail: `HTTP ${status}; the response was not JSON` };
  }
  // 2. Not a plain object.
  if (!isPlainObject(json)) return unexpected(status);

  const outcome = json.outcome;
  // 3. Plan bodies.
  if (outcome === "preview" && status === 200) {
    return { kind: "plan", body: json as unknown as PromotePlanBody };
  }
  if (outcome === "applied" && status === 200) {
    return { kind: "applied", body: json as unknown as PromotePlanBody };
  }
  // 4. Refused.
  if (outcome === "refused" && status === 409) {
    return { kind: "refused", body: json as unknown as PromoteRefusedBody };
  }
  // 5. Conflict, with its fresh preview classified the same way.
  if (outcome === "conflict" && status === 409) {
    const fresh = json.fresh;
    if (isPlainObject(fresh) && typeof fresh.status === "number" && "body" in fresh) {
      const freshView = classifyResponse(fresh.status, fresh.body);
      if (freshView.kind === "conflict") {
        return { kind: "unknown", detail: "HTTP 409; nested conflict" };
      }
      return { kind: "conflict", body: json as unknown as PromoteConflictBody, fresh: freshView };
    }
    return unexpected(status);
  }
  // 6. Error body: no `outcome` field and a string `error`.
  if (!("outcome" in json) && typeof json.error === "string") {
    return { kind: "error", status, error: json.error };
  }
  // 7. Anything else.
  return unexpected(status);
}

// --- Plan presentation (D44, D46) --------------------------------------------

/** D46: the confirm button's visible text and accessible name. */
export function confirmLabel(body: PromotePlanBody): string {
  const category = CATEGORY_LABEL[body.category];
  const n = body.counts.removed;
  if (n > 0 && body.deletionsAllowed) {
    return `Delete ${n} ${n === 1 ? "record" : "records"} and update stored ${category}`;
  }
  return `Update stored ${category}`;
}

export type ModalSection = {
  id: string;
  heading: string;
  items: { primary: string; secondary: string | null }[];
};

function distinct(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

/** D44: the lists, in order of consequence; empty lists are omitted. */
export function sections(body: PromotePlanBody): ModalSection[] {
  const report: PlanReport = body.report;
  const out: ModalSection[] = [];

  if (report.removed.length > 0) {
    out.push({
      id: "removed",
      heading: `Records to delete (${report.removed.length})`,
      items: report.removed.map((e) => ({ primary: e.name, secondary: `${e.url} — ${e.reason}` })),
    });
  }

  const passwordNames = distinct(body.passwordNamesToDelete);
  if (passwordNames.length > 0) {
    out.push({
      id: "passwords",
      heading: `Password rows to delete (${body.counts.passwordRowsToDelete})`,
      items: passwordNames.map((name) => ({ primary: name, secondary: null })),
    });
  }

  if (report.needsCorrectPassword.length > 0) {
    out.push({
      id: "needs-correct-password",
      heading: `Need the correct password (${report.needsCorrectPassword.length})`,
      items: report.needsCorrectPassword.map((e) => ({ primary: e.name, secondary: e.url })),
    });
  }
  if (report.needsPassword.length > 0) {
    out.push({
      id: "needs-password",
      heading: `Need a password (${report.needsPassword.length})`,
      items: report.needsPassword.map((e) => ({ primary: e.name, secondary: e.url })),
    });
  }

  if (report.couldNotCheck.length > 0) {
    out.push({
      id: "could-not-check",
      heading: `Could not check (${report.couldNotCheck.length})`,
      // An entry with no name of its own (the planner falls back to the URL,
      // or the name is empty) shows its URL once, as the label.
      items: report.couldNotCheck.map((e) =>
        e.url !== "" && (e.name === "" || e.name === e.url)
          ? { primary: e.url, secondary: e.reason }
          : { primary: e.name, secondary: e.url === "" ? e.reason : `${e.url} — ${e.reason}` }
      ),
    });
  }

  if (report.untrackedProtected.length > 0) {
    out.push({
      id: "untracked-protected",
      heading: `Protected pages not tracked (${report.untrackedProtected.length})`,
      items: report.untrackedProtected.map((e) =>
        e.name !== null ? { primary: e.name, secondary: e.url } : { primary: e.url, secondary: null }
      ),
    });
  }
  if (report.unscrapedProtectedVendors.length > 0) {
    out.push({
      id: "unscraped-vendors",
      heading: `Protected vendor pages not scraped (${report.unscrapedProtectedVendors.length})`,
      items: report.unscrapedProtectedVendors.map((e) => ({ primary: e.url, secondary: null })),
    });
  }

  return out;
}

/** D44 item 6: the counts. */
export function summaryLines(body: PromotePlanBody): string[] {
  const c = body.counts;
  const lines = [
    `Updated: ${c.updated}`,
    `Added: ${c.appended}`,
    `Stored records: ${c.storedBefore} → ${c.storedAfter}`,
  ];
  if (c.trackingRowsToDelete > 0) lines.push(`Tracking rows to delete: ${c.trackingRowsToDelete}`);
  return lines;
}

/** D46: password-row changes are stated in the description, not the label. */
export function passwordStatement(body: PromotePlanBody): string | null {
  const n = body.counts.passwordRowsToDelete;
  if (n <= 0) return null;
  return `${n} vendor-review password ${n === 1 ? "row" : "rows"} will be removed.`;
}

/** D47: the contract's error text, then the changed keys in plain words. */
export function conflictNotice(body: PromoteConflictBody): string {
  return `${body.error} Changed: ${body.changed.map(documentLabel).join(", ")}.`;
}

// --- How the modal closed, and the Messages lines (D49) ------------------------

export type PromoteModalResult =
  | { kind: "applied"; body: PromotePlanBody }
  | { kind: "cancelled" }
  | { kind: "failed"; view: Extract<PromoteView, { kind: "refused" | "error" }> }
  | { kind: "unknown"; detail: string };

/**
 * D49: one Messages line per event (two when an apply ran with deletions
 * blocked). `formattedRunTime` is runFinishedAt formatted by the caller with
 * formatLocalTimestamp; this module has no clock or locale.
 */
export function messageLines(
  result: PromoteModalResult,
  category: PromoteCategory,
  formattedRunTime: string | null
): string[] {
  switch (result.kind) {
    case "applied": {
      const { body } = result;
      const c = body.counts;
      const lines = [
        `Updated stored ${CATEGORY_LABEL[category]} from the live run of ${formattedRunTime ?? body.runFinishedAt}: ` +
          `${c.updated} updated, ${c.appended} added, ${c.removed} removed; ` +
          `${c.passwordRowsToDelete} password rows removed. Live snapshot cleared.`,
      ];
      if (!body.deletionsAllowed && typeof body.deletionsBlockedReason === "string") {
        lines.push(`Deletions were not applied: ${body.deletionsBlockedReason}`);
      }
      return lines;
    }
    case "cancelled":
      return ["Update Stored Data cancelled; nothing was changed."];
    case "failed": {
      const { view } = result;
      if (view.kind === "error" && view.status === 401) {
        return ["Update Stored Data failed: your session has expired; sign in again."];
      }
      const error = view.kind === "refused" ? view.body.error : view.error;
      return [`Update Stored Data failed: ${error}`];
    }
    case "unknown":
      return [`Update Stored Data: the result is unknown (${result.detail}); review a fresh preview.`];
  }
}

/** D52: is the open record (by URL) among the removed records? */
export function removedContainsUrl(body: PromotePlanBody, url: string | null): boolean {
  if (typeof url !== "string" || url === "") return false;
  return body.report.removed.some((e) => e.url === url);
}
