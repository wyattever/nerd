# Building a Raw-HTML Editing UI in React 19 + Next.js 16 (App Router): Architecture Recommendations for N.E.R.D.

## TL;DR
- **Use a controlled `<textarea value={x} onChange={...}>` with state local to the editor component, and reset it on open with the React `key` prop** — this single lever (controlled + key-based remount) eliminates the setTimeout/ref-buffer race you previously hit, and controlled textareas are performant enough for multi-paragraph HTML when state is held in the small editor, not the parent.
- **Reach for the native `<dialog>` element with `showModal()`** for the per-section editor; it gives you focus management, ESC-to-close, scroll-locking, and top-layer rendering for free, which your hand-rolled `InvalidLinksModal` div-pattern has to reimplement and likely gets partially wrong.
- **Use one generic reusable `<SectionEditor sectionKey="...">` with a single `onSave(key, html)` callback** that does a functional `setListing` update; the anti-pattern to avoid is lifting the live per-keystroke textarea value into the parent state object.

## Key Findings

1. **Controlled vs uncontrolled is the real root lever** — but the bug you hit was not caused by controlled state; it was caused by an *uncontrolled* textarea whose initial value had to be imperatively injected after hydration. Switching to controlled state (or to `key`-based remount) makes the whole class of "set the initial value after open" bug disappear, because the value is declarative.
2. **Cursor-jump/perf problems with controlled inputs are real but narrow** — they occur with *asynchronous* or *transformed* value updates, or when a keystroke re-renders a large parent tree. A controlled textarea that updates its own local `useState` synchronously does not jump the caret and does not lag at the scale of multi-paragraph HTML.
3. **Native `<dialog>` is now the recommended default** for modals in 2026 and is supported in all current browsers; the modern accessibility guidance has even moved *away* from manual focus-trapping for `<dialog>`.
4. **The cleanest state-lifting shape is a generic component + keyed callback**, and the known anti-pattern is making sibling editors each write live (per-keystroke) state into shared parent state.
5. **A dirty-check is cheap and dependency-free**: compare the current value against the original pre-fill value captured on open.
6. **Plain monospace `<textarea>` is a defensible, common choice** for trusted internal-tool users.
7. **Render-time (`dangerouslySetInnerHTML`) has one React 19-specific nuance worth knowing**, plus invalid-nesting hydration traps that pre-date React 19.

---

## Q1 — Controlled vs Uncontrolled Textarea

**Bottom line: Default to a controlled `<textarea value={html} onChange={e => setHtml(e.target.value)}>` with `html` held in the editor/modal component's own `useState`. This is the correct React 19 default for your scale, and it is also the direct fix for the bug class you hit. If you have a specific reason to stay uncontrolled, the correct React 19 way to seed initial content is `defaultValue` plus a `key` that changes on open — never a setTimeout/ref-buffer.**

### Why controlled is right here

The React docs are explicit that a `<textarea>` is controlled when it receives a string `value` prop with an `onChange` handler that synchronously updates the backing value, and that "a text area cannot switch between being controlled or uncontrolled over its lifetime." For an editor whose entire job is to hold and return an edited string, controlled state is the natural model: the value you render *is* the value you'll save, with no DOM round-trip.

Critically, **controlled state dissolves your original bug.** Your race condition came from an uncontrolled textarea whose value had to be imperatively pushed in via a ref after a React 19 hydration pass, with a setTimeout papering over the timing. With a controlled textarea, the initial value is just `useState(initialHtml)` — there is no "set it after mount" step to race against hydration. This is the actual root lever: *controlled-vs-uncontrolled is the decision that determines whether this bug class can even exist.*

### The cursor-jump and performance concerns, scoped honestly

There is a large body of reports about controlled inputs jumping the caret to the end. The honest read of the literature: **the caret only jumps when the value is updated asynchronously or transformed before being written back** (e.g., the value flows through an async store like a context updated off-cycle, a debounce, or an uppercase/replace transform). The fix in those cases is to keep a synchronous local cache. A plain controlled textarea that writes `e.target.value` straight into local `useState` on every keystroke does not jump the caret, because React writes the value back synchronously within the same event.

The React `<textarea>` docs themselves note that if the textarea is "removed and re-added from the DOM on every keystroke" — typically because a parent "always receives a different `key`," or because component definitions are nested (remounting the inner component each render) — you'll see exactly the kind of focus/value loss that *feels* like the bug you hit. This is worth flagging given your history: make sure the `key` you use to reset on open (see below) is stable *while the editor is open*, and don't define `SectionEditor` inside another component's render body.

On raw performance: controlled inputs cause a re-render per keystroke. There is a well-documented React issue (facebook/react #12072) where *all* controlled `<textarea>` fields re-render on any `setState()` in the same component, even unrelated ones. The practical mitigation is structural and aligns with Q3: **hold the editing state in the small editor/modal component, not in the big parent listing object.** If each keystroke only re-renders a tiny editor subtree, multi-paragraph HTML is a non-issue. If you ever did bind the textarea directly to the large parent object such that every keystroke re-renders the whole record, you could either (a) keep editing state local and only lift on Save (recommended), or (b) reach for `useDeferredValue` to deprioritize the expensive downstream render — but note `useDeferredValue` defers *consumers* of the value, it does not make the textarea itself faster, and you likely won't need it.

### If you insist on uncontrolled: the correct React 19 pattern

If you have a reason to stay uncontrolled (e.g., you truly never need to read the value except on Save), the React-sanctioned way to set initial content is the `defaultValue` prop — *not* children, and *not* a post-mount ref write. The catch the docs call out: "Changing the value of `defaultValue` attribute after a component has mounted will not cause any update of the value in the DOM." So `defaultValue` alone won't update when you re-open the editor on a different section.

The clean, idiomatic React 19 solution is to **force a remount with `key`**: render `<textarea key={openToken} defaultValue={initialHtml} ref={ref} />`, where `openToken` changes each time the editor opens (or is the section key). React unmounts the old textarea and mounts a fresh one initialized to the new `defaultValue`. This is the documented "resetting state with a key" technique from the official "You Might Not Need an Effect" page, and it replaces both the `useEffect`-keyed-to-open workaround and the setTimeout/ref-buffer entirely. React 19's ref-callback cleanup feature exists for DOM-library integration, but you do not need it just to seed a textarea value.

**Verdict:** Controlled + local state is the cleaner, lower-risk default and is the direct antidote to your bug. Reserve uncontrolled+`defaultValue`+`key` for the rare case where you want zero per-keystroke re-renders and never read the value mid-edit.

---

## Q2 — Modal vs Inline; Native `<dialog>` vs Custom Div Modal

**Bottom line: Use a modal built on the native `<dialog>` element with `showModal()`, not a custom div-based modal like `InvalidLinksModal` and not an inline expand-in-place editor. The native element gives you focus movement into the dialog, ESC-to-close, background `inert`-ing, scroll lock, and top-layer rendering (no z-index/portal fights) for free — all things your custom modal must reimplement and is the most common place accessibility breaks.**

### Why modal over inline for this interaction

Both are viable, and inline (your old removed html-editor approach) has real virtues: it keeps the edited HTML visually adjacent to where it renders, avoids any open/close state machinery, and is dead-simple. But for "click a button next to a section header to edit raw HTML," a modal is the better fit because: (1) raw HTML for a multi-paragraph block needs vertical room that an inline textarea fights the surrounding layout for; (2) a modal gives a clear, deliberate "I am editing this section now" mode with explicit Save/Cancel affordances and a natural place for a dirty-check prompt (Q4); and (3) it cleanly separates "edit" from "view," which matters when the view is itself rendering raw HTML.

That said, if accessibility simplicity is paramount and the editor is small, inline is legitimately *simpler* — there's no focus-return, no announcement, no trapping to think about because focus never leaves the page flow. Flagging this as a genuine tradeoff: inline is simpler to get *correct*; modal is better *UX* for large content but has more accessibility surface area. Since `<dialog>` collapses most of that surface area, the modal recommendation holds.

### Native `<dialog>` vs replicating `InvalidLinksModal`

The strong consensus in current (2026) guidance is to prefer native `<dialog>` + `showModal()`. Per MDN, `<dialog>`/`HTMLDialogElement` is Baseline "Widely available," having "been available across browsers since March 2022" (Chrome, Edge, Firefox, Safari) — so legacy-support concerns no longer justify a hand-rolled modal. It provides, per the platform: automatic focus movement into the dialog, ESC-to-close (firing a `cancel` then `close` event), background content made `inert` (un-interactable and hidden from AT), scroll locking, top-layer rendering that sidesteps z-index and portal gymnastics, and a `::backdrop` pseudo-element for the overlay. A hand-rolled div modal has to reimplement every one of these. Per TestParty's modal-dialog-accessibility guide, modals are "one of the most commonly broken accessibility patterns. When modals fail, keyboard users can't escape, screen reader users don't know they've opened, and the experience breaks down completely" — and OpenReplay similarly identifies broken focus management as the most severe of these failures. The single biggest reason to choose `<dialog>` is that it removes the need to write the code that usually contains those defects.

Two important, somewhat counterintuitive accessibility points to flag:

- **Focus-trapping is no longer required for `<dialog>`.** As Scott O'Hara puts it (quoted in CSS-Tricks, "There is No Need to Trap Focus on a Dialog Element"): "WCAG is not normatively stating focus must be trapped within a dialog. Rather, the normative WCAG spec makes zero mention of requirements for focus behavior in a dialog." The W3C APA Working Group "came to the conclusion that the current behavior of the native dialog element should be kept as it is. So, that you can tab from the dialog to the browser functionalities." So you do *not* need to add a focus-trap utility on top of `<dialog>` — doing so re-introduces the exact behavior the standards bodies decided against. This is a reason to prefer `<dialog>` over your custom modal, where you'd be tempted to hand-roll trapping.
- **`autofocus` placement has a known Chrome quirk.** Per Jared Cunha ("HTML dialog: Getting accessibility and UX right"): "placing autofocus on the `<dialog>` seems to work in every browser except for Chrome on MacOS and Windows (it works in Chrome on iOS)." So put `autofocus` on the first interactive element you want focused — for an editor, that's the textarea itself.

### The one React integration gotcha

The well-known friction with `<dialog>` in React is keeping React state in sync with the dialog's own open/close. The standard, correct pattern: drive it from an `isOpen` prop via `useEffect` calling `showModal()`/`close()`, *and* listen for the dialog's `close`/`cancel` events to push state back to `false` so React state doesn't desync when the user hits ESC or the backdrop. Treat React state as the source of truth, sync the DOM element to it, and reflect native closes back into state. Include the effect's cleanup `close()` call so React 19 Strict Mode's double-invoke in development doesn't leave you in a bad state. (Guard `showModal()` with a check that the dialog isn't already open, since calling it on an open dialog throws.)

**Verdict:** Native `<dialog>` + `showModal()`, state-synced via `useEffect` + the `close` event, with `autofocus` on the textarea. Don't replicate `InvalidLinksModal` for new work, and don't add a manual focus trap.

---

## Q3 — State-Lifting Pattern for 5 Independent Section Editors

**Bottom line: One generic `<SectionEditor sectionKey="header" value={...} onSave={...}>` reused five times, with a single parent callback `handleSave = useCallback((key, html) => setListing(prev => ({...prev, section_overrides: {...prev.section_overrides, [key]: html}})), [])`. Keep each editor's in-progress text in that editor's own local state and only call `onSave` on Save. The anti-pattern to avoid is having all five siblings write their live, per-keystroke value into the shared parent object.**

### Why generic-component + keyed callback

This is the textbook "lifting state up" shape from the React docs: the parent owns the canonical `listing` object (single source of truth), and passes down both the current value and a callback to update it. A computed `[sectionKey]` key in the functional updater lets one callback service all five sections without five near-identical handlers. Five separately *named* components would be pure duplication with no benefit given the editors are structurally identical; a generic component keyed by `sectionKey` is DRY and the differences (label, current value) are just props. You explicitly don't need Context or a store here — with a single parent owning the object and direct children consuming it, there's no prop-drilling depth that would justify Context, and you've already standardized on plain hooks.

Use the **functional updater form** (`setListing(prev => ...)`) rather than `setListing({...listing, ...})`. With several sibling editors potentially saving in close succession, the functional form guarantees each update composes on the latest state rather than a stale closure capture. Wrap `handleSave` in `useCallback` with an empty dep array (the functional updater means it never needs to close over `listing`), so the five children get a stable callback reference and don't re-render spuriously.

### The anti-pattern to avoid

The specific anti-pattern, well-documented in the React community and codified in lint rules derived from "You Might Not Need an Effect": **do not lift live, per-keystroke editing state up into the parent.** If each sibling's textarea is bound directly to `listing.section_overrides[key]` via the parent setter, then every keystroke in any one editor triggers a `setListing` that re-renders the whole record and all five editors — the performance problem from Q1, multiplied. Keep the in-progress draft local to each `SectionEditor` (its own `useState`, seeded from the `value` prop), and only push up to the parent on Save. A closely related documented anti-pattern (codified as `no-pass-live-state-to-parent` in the `eslint-plugin-react-you-might-not-need-an-effect` rule set) is using a `useEffect` to mirror a child's live state up to a parent — "avoid passing live state to parents in an effect; instead lift it and pass it down." Don't do that either; the explicit Save callback is the clean boundary.

Seed each editor's local draft from its `value` prop on open using the `key` reset technique (Q1): give `<SectionEditor key={`${sectionKey}-${openToken}`} ...>` a key that changes when it opens, so its local `useState(value)` re-initializes to the freshly-passed current HTML rather than going stale.

**Verdict:** Generic component, single `useCallback` functional-update callback keyed by `sectionKey`, local draft state per editor, lift only on Save.

---

## Q4 — Dirty-State / Unsaved-Changes UX

**Bottom line: Yes, warn on close when there are unsaved edits, and implement it with zero dependencies by capturing the original pre-fill value when the editor opens and comparing `currentValue !== originalValue` on any close attempt (ESC, backdrop, Cancel, X). If dirty, intercept the close and show a lightweight confirm. This is a handful of lines and needs no form library.**

### Implementation shape

Capture the original value once at open time. Because you're seeding local state from the `value` prop with a `key`-based remount (Q1/Q3), the cleanest place to stash the baseline is a `useRef` set on mount, or simply keep `useState(value)` and compare against the `value` prop you were given. The dirty check is then `const isDirty = currentValue !== originalValue;`.

Wire it into every close path: the `<dialog>`'s `cancel` event (ESC), backdrop click, the Cancel button, and the X. In the close handler, if `isDirty`, call `event.preventDefault()` on the `cancel` event (the native `cancel` event is cancelable) and show your confirm; otherwise close. For the in-app confirm you can use `window.confirm()` for a quick, dependency-free prompt, or — more consistent with your UI — render a small nested confirmation rather than the browser dialog. The React community's "unsaved changes" patterns converge on exactly this: a boolean dirty flag plus an interception on the close/navigation event.

### Scope note / what NOT to over-build

The browser `beforeunload` event (the native "Changes you made may not be saved" prompt for tab-close/reload) is a *separate* concern aimed at full-page navigation, and given your editor only writes to in-memory React state (not the backend) and the actual backend save happens elsewhere, you almost certainly do **not** need `beforeunload` wiring inside the editor — that belongs (if anywhere) at the record/page level where the real unsaved-to-backend state lives. Flagging this so you don't gold-plate: the editor's dirty-check is about "don't silently discard my typing when I hit ESC," not about browser tab closure.

One UX caution from the literature worth heeding: blocking the user from leaving is mildly an anti-pattern, so make the discard prompt easy to dismiss and only show it when genuinely dirty — never on a clean close.

**Verdict:** Capture original-on-open, compare on close, intercept `cancel`/Cancel/backdrop when dirty, confirm via `window.confirm` or a small nested confirm. No library.

---

## Q5 — Syntax Highlighting (Confirming Plain Textarea)

**Bottom line: A plain monospace `<textarea>` is a reasonable, common, and appropriate choice for trusted internal-tool users editing raw HTML by hand. No code-editor library is warranted here.** *(Per your constraint, no code-editor libraries are discussed or recommended.)*

For an internal research tool ("N.E.R.D.") with trusted users intentionally hand-writing `<ul>/<li>/<a>/<h3>`, a monospace `<textarea>` (e.g., Tailwind `font-mono`, plus `whitespace-pre` and `resize-y`) hits the right point on the simplicity/speed/dependency curve. It's instantly familiar, has zero bundle cost, is fully accessible by default (native form control, works with every screen reader and keyboard convention), and has none of the hydration/SSR or focus-management complications a heavier editor surface introduces.

The only assumptions worth flagging where you *might* reconsider — none of which imply a library:
- **No bracket/tag matching or validation feedback.** For trusted users this is acceptable; if mistyped tags become a frequent support burden, the lightweight mitigation is rendering a live preview (the same `dangerouslySetInnerHTML` view) next to or below the textarea so authors see breakage immediately — not adding an editor component.
- **Tab key inserts focus change, not a tab character.** Standard textarea behavior; generally fine and actually better for keyboard accessibility (trapping Tab to indent is an a11y smell). Leave it alone.
- **Large documents.** Covered in Q1 — a plain textarea is the *fastest* possible option here; per Nolan Lawson's testing, a vanilla `<textarea>` with no JS handlers has no perceptible typing delay even under 6× CPU slowdown.

**Verdict:** Plain monospace `<textarea>` confirmed. Consider a side-by-side live preview if validation pain emerges, but that's additive, not a replacement.

---

## Q6 — Render-Time Safety with `dangerouslySetInnerHTML` (React 19 / Next.js 16)

**Bottom line: Beyond the universal XSS caveat (which you've consciously accepted for trusted users), the React 19/Next 16-specific things to know are: (1) `dangerouslySetInnerHTML` produces NO hydration mismatch as long as the server and client render the identical string — the mismatch only fires when the string differs between server and client render; (2) invalid HTML nesting in the raw string (e.g., block elements inside `<p>`) is the most likely real-world hydration trap and pre-dates React 19; (3) decide deliberately whether the rendering surface is a Server or Client Component.**

### Same string in = no hydration mismatch

The core reassurance: React's documented hydration principle is that "the React tree you pass to `hydrateRoot` needs to produce the same output as it did on the server." For `dangerouslySetInnerHTML` this means that if the same `__html` string is used on the server render and the client render, there is no mismatch. The mismatch warning ("Prop `dangerouslySetInnerHTML` did not match. Server: … Client: …", as seen in facebook/react #19901) fires precisely when the two strings differ. So the practical rule for N.E.R.D.: **make sure the HTML string rendered on the server equals the string rendered on the client.** The danger zone is computing the HTML differently per environment — e.g., deriving it from `Date.now()`, `Math.random()`, locale-dependent formatting, `localStorage`, or a `typeof window` branch. Since your raw HTML comes from saved overrides or structured data (deterministic given the same input), you should be clear of this as long as the data is identical on both sides.

### React 19-specific nuances (flagged with uncertainty)

React 19 made several documented hydration changes, none of which target `dangerouslySetInnerHTML` directly but two of which are worth knowing:
- **Better hydration-error diffs.** Per the React 19 release notes (react.dev/blog/2024/12/05/react-19), React now logs "a single message with a diff of the mismatch" instead of multiple opaque errors — so if you *do* hit a raw-HTML mismatch, debugging is materially easier than in React 18. The error message explicitly enumerates the usual causes (server/client branches, `Date.now()`/`Math.random()`, locale formatting, external changing data, and **invalid HTML tag nesting**).
- **Tolerance of third-party/extension-inserted tags.** Per the React 19 release notes, verbatim: "unexpected tags in the `<head>` and `<body>` will be skipped over, avoiding the mismatch errors." This reduces spurious hydration errors caused by browser extensions mangling the DOM — historically a common false-alarm source when rendering raw HTML.

There is a **reported but unconfirmed** React 19 behavior change worth flagging honestly: GitHub issue facebook/react #32975 claims that in React 18, combining `dangerouslySetInnerHTML={{ __html: '' }}` with `suppressHydrationWarning` would *cancel* hydration and preserve server HTML (a manual hydration-control trick), whereas in React 19 — quoting the issue verbatim — "Hydration proceeds and replaces the HTML with an empty string, resulting in a hydration error dialog being displayed." **Caveat: this issue was labeled "Status: Unconfirmed" by the React team and auto-closed as "Resolution: Stale" with no maintainer confirmation, no linked fix, and the React 18 behavior is the reporter's own characterization, not documented React behavior** (the only other thread comments are community spam promoting a non-existent npm package). You should not rely on the `dangerouslySetInnerHTML={{__html:''}}` + `suppressHydrationWarning` combination as a hydration-cancellation mechanism in React 19. If you ever need to deliberately suppress an unavoidable mismatch on the raw-HTML container, the documented escape hatch is `suppressHydrationWarning={true}` on that element — but note it's "intended to be an escape hatch" that "only works one level deep," and React "will not attempt to patch mismatched text content" under it.

### Invalid nesting is your most likely real trap

Independent of React version, the most probable hydration error when hand-authoring raw HTML is **invalid tag nesting**. The classic case: a string containing block-level elements that the browser auto-closes (e.g., a `<div>` or another `<p>` inside a `<p>`) produces a different DOM tree than React's in-memory expectation, triggering a mismatch. React's own list of hydration causes calls out elements — `<a>`, `<button>`, `<p>`, `<textarea>`, and others — where `dangerouslySetInnerHTML` adding nested content can cause errors. **Concrete recommendation:** render the raw HTML into a neutral, permissive container (a `<div>`), never into a `<p>` or other phrasing/interactive element that restricts its children. Since your users author `<ul>/<li>/<h3>` (block content), a `<div className="prose" dangerouslySetInnerHTML={{__html: html}} />` is the safe host.

### Server vs Client Component boundary

In Next.js 16 App Router, components are Server Components by default. `dangerouslySetInnerHTML` itself works in either a Server or Client Component — the boundary question is about *where the value lives*. If the raw HTML is part of an interactive, state-driven view (editing happens on the same page, value held in React state), that surface is already a Client Component (`'use client'`) because it uses hooks/handlers. If the raw HTML is purely display (read from saved data, no interactivity), prefer rendering it in a Server Component — zero JS shipped, no hydration of that subtree at all, which sidesteps the entire mismatch question for the view. Keep the `'use client'` boundary as close to the interactive leaf (the editor) as possible, and let the read-only rendered output stay on the server where practical.

**Verdict:** Render into a `<div>`, ensure the server and client see the identical string, prefer a Server Component for the read-only rendered view, don't depend on the unconfirmed `__html:''`+`suppressHydrationWarning` trick, and reserve `suppressHydrationWarning` as a narrow one-level escape hatch.

---

## Recommendations (Staged & Concrete)

**Stage 1 — Build the editor (do first):**
1. Create a generic client component `SectionEditor` with local `useState(initialHtml)`, a controlled monospace `<textarea value={html} onChange={...}>`, and Save/Cancel buttons. This alone retires the setTimeout/ref-buffer bug.
2. Wrap it in a native `<dialog>`; sync open/close from an `isOpen` prop via `useEffect` (`showModal()`/`close()` + cleanup, guarding against double-`showModal()`), and listen for the `close`/`cancel` events to push state back to the parent. Put `autofocus` on the textarea. Do not add a focus trap.
3. Reset the draft on open with a `key` that changes per open (e.g., `${sectionKey}-${openCount}`).

**Stage 2 — Wire up state lifting:**
4. In the parent, keep the canonical `listing`; pass each editor `value={listing.section_overrides[key]}` and a single `useCallback` `onSave(key, html)` using the functional `setListing(prev => …[key]: html)` updater.
5. Verify in React DevTools Profiler that typing in one editor only re-renders that editor — if it re-renders the whole record, you've leaked live state upward; pull it back local.

**Stage 3 — Polish:**
6. Add the dirty-check: capture original-on-open, intercept `cancel`/Cancel/backdrop when `value !== original`, confirm discard.
7. Render the saved HTML for display in a `<div>` (not `<p>`), in a Server Component where the view is read-only.

**Benchmarks / thresholds that would change these recommendations:**
- *If* Profiler shows per-keystroke lag even with local state (unlikely below tens of KB of HTML) → introduce `useDeferredValue` on any expensive downstream preview, or memoize the preview; do not abandon controlled state.
- *If* you observe caret jumping → you've introduced an async/transform step in the value path; remove it or add a synchronous local cache. It is not a reason to switch to uncontrolled.
- *If* mistyped-tag breakage becomes a frequent issue → add a live preview pane (additive), not a code-editor library.
- *If* you must support a browser without `<dialog>` (none current; Baseline since March 2022) → fall back to the ARIA Authoring Practices modal pattern, at which point you *do* need manual focus management.

## Caveats & Uncertainties
- **The React 18→19 `dangerouslySetInnerHTML={{__html:''}}` + `suppressHydrationWarning` hydration-cancellation change is unconfirmed** (GitHub #32975 was labeled "Unconfirmed" and closed "Stale"; the React 18 behavior is the reporter's claim, not documented). Treat it as "don't rely on this trick," not as established React behavior.
- **Modal vs inline is a genuine tradeoff, not a clear win.** Inline is simpler to make accessible; modal is better UX for large content. The recommendation favors `<dialog>` because it collapses the accessibility cost, but a small inline editor is a legitimate alternative.
- **Cursor-jump literature is muddy** — many reports conflate the async-update cause with the `key`-reset cause. The actionable distillation: synchronous local controlled state + stable key while open = no jumping. Your prior bug shares a root with the `key`-instability failure mode, so be deliberate about key stability.
- **You've explicitly accepted no sanitization.** That is defensible for trusted internal users, but flag it loudly in code (a comment on the `dangerouslySetInnerHTML` site) so a future maintainer who repoints the data source at untrusted input understands the assumption. This is exactly the scenario the Signal Desktop XSS/RCE post-mortem warns about: the 2018 Signal vulnerability (CVE-2018-10994), per Matthew Bryant's write-up, had its "core … in the use of React's `dangerouslySetInnerHTML` in order to render the contents of a Quoted Reply message" — a trusted-looking content path that turned out to be attacker-influenced.
- **Browser-support and version specifics** (Next.js 16.2.9, React 19) were treated as current as of June 2026; the `<dialog>` and React 19 behaviors cited are from current docs but always worth a quick re-verify against your exact patch versions.
