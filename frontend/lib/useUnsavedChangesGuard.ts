// frontend/lib/useUnsavedChangesGuard.ts
"use client";

/**
 * Warns before navigating away from a detail-page editor with unsaved
 * field edits -- see docs/UI_ROUTING_MIGRATION_IMPLEMENTATION_GUIDE_v2.md
 * Phase 4. The App Router removed `Router.events`, so there's no built-in
 * navigation-cancel hook; this hooks two of the three escapes the guide
 * identifies:
 *
 *   | Navigation type   | Trigger                          | Mitigation                     |
 *   |--------------------|-----------------------------------|--------------------------------|
 *   | Hard navigation    | Tab close, refresh, address bar   | `window.beforeunload`          |
 *   | Soft navigation    | `<Link>` / `<a>` click            | capture-phase click listener   |
 *   | History traversal  | Back/Forward buttons              | deliberately NOT fought        |
 *
 * Back/Forward is intentionally left alone: aggressively cancelling
 * `popstate` is a well-documented anti-pattern that corrupts the bfcache
 * and breaks the browser's own state restoration. Accepting that one gap
 * is the tradeoff, not an oversight.
 *
 * NOT implemented: patching `router.push`/`router.replace` on the object
 * `useRouter()` returns. The guide's Phase 4 draft called for this as a
 * third layer (catching programmatic navigation that isn't a click), but
 * this repo's eslint-plugin-react-hooks config (v7, the React Compiler
 * ruleset -- `react-hooks/immutability`) hard-errors on mutating any value
 * returned from a hook, `router` included; there's no way to implement it
 * that both matches the guide's literal technique and passes that rule.
 * Given eslint-config-next enforces this by default in this Next version
 * (not just an opt-in style preference), silencing it with a disable
 * comment would be overriding a rule that exists for React Compiler
 * correctness, not just linting taste -- flagged rather than guessed past.
 * In practice this leaves no gap for this app today: every internal
 * `router.push` call already happens only AFTER a successful save/delete/
 * promote (see each *Editor.tsx's own isDirty-clearing comment), and every
 * user-initiated soft navigation in this app goes through a real `<Link>`,
 * which the click listener below already covers.
 *
 * Uses native `window.confirm()`, not a custom modal -- `beforeunload`'s
 * dialog is entirely browser-controlled anyway (no page can customize its
 * text or style), so a custom modal there would give a false sense of
 * control it can't actually deliver; using the same native confirm for
 * both keeps the two cases consistent instead of jarringly different.
 *
 * `isDirtyRef` is synced inside a `useEffect`, not a direct render-body
 * assignment -- the same rule set (`react-hooks/refs`) errors on mutating
 * a ref during render. This hook's listeners are therefore installed once
 * for the whole mounted lifetime and read the ref at call time, so a
 * dirty-state change doesn't require tearing down and re-attaching either
 * listener.
 */

import { useEffect, useRef } from "react";

const CONFIRM_MESSAGE = "You have unsaved changes. Leave this page and discard them?";

export function useUnsavedChangesGuard(isDirty: boolean): void {
  const isDirtyRef = useRef(isDirty);
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  // Hard navigation: tab close, refresh, address-bar entry.
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return;
      e.preventDefault();
      // Legacy requirement for some browsers to actually show the prompt;
      // the string itself is never displayed -- browsers show their own
      // fixed text for this dialog.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  // Soft navigation via <Link>/<a> clicks. Capture phase on `document` so
  // this runs before Next's own click handling gets a chance to start the
  // navigation -- window.confirm() is synchronous, so the decision to
  // preventDefault happens before Next ever sees the click.
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!isDirtyRef.current || e.defaultPrevented) return;
      // Only plain left-clicks with no modifier -- ctrl/cmd/shift/middle
      // click are the browser's own "open in new tab/window" gestures and
      // don't navigate this tab away from the unsaved edit at all.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = e.target as Element | null;
      const anchor = target?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const href = anchor.getAttribute("href") ?? "";
      if (!href || href.startsWith("#")) return;

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      // Same-page anchor (hash-only) navigation doesn't leave the editor.
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return;
      }

      if (!window.confirm(CONFIRM_MESSAGE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, []);
}
