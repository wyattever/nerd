# N.E.R.D. — Mirror-Promote Rework, Password Editing, and Deploy Plan

**Date:** 2026-11-02 (revised the same day after the mirror recon)
**Status:** Decisions settled; rework not yet implemented. Password editing and the temporary Added guard are deployed (2026-11-02, revision `nerd-frontend-00018-vad`).
**Location:** `docs/mirror-promote-plan-11-02-26.md`
**Relationship to DECISION_LOG:** #68 records the password-editing work. The mirror-promote rework needs its own entry (#69 or the next free number) when it lands, because it reverses the promote merge rule (§3.1). This document is the working plan; the log entries are the record.

---

## 1. Why this exists

N.E.R.D. is not in regular use right now, so its stored records drift out of step with the NCADEMI website between uses. The 2026-11-02 production scrape made the drift concrete:

- Stored Added held records with no counterpart on the site. ABCmouse is not among the 100 product pages. CommonLit 360 and the three Lexia products are now public pages, so they appear in the published snapshot rather than the added one.
- 21 password-protected product pages on the site are not tracked by N.E.R.D. at all. 7 of them already exist as candidates.
- Grammarly's and Nearpod's stored passwords failed to unlock their pages.
- Stored Vendors held two test records. They have since been removed by hand.

Published and Vendors were promoted later on 2026-11-02 under the current merge rule, so their live snapshots have been consumed. The Added snapshot remains, because the temporary guard (D13) refuses Added promotes.

The current "Update Stored Data" (promote-live) behaviour is a conservative merge. Live records update their stored counterparts, stored records with no live counterpart are kept, and live-only records are appended. For Added, commit `626c556` also auto-creates a stub record, with a generated password, for every untracked protected page. Both behaviours let stored data accumulate records that no longer reflect the site.

The mirror recon (`.scratch/verification/mirror-recon-20261102-1444.md`) then found that **the scraper cannot currently distinguish "not on the site" from "we failed to look"**. URL discovery can fail silently and partially. Most fetch failures are never recorded. Several different failures share the `password_rejected` reason. A mirror rule built on today's snapshots would therefore propose deleting records that were never checked. Decisions D15–D18 exist to close that gap before anything is deleted.

**Recon sources** (all in `.scratch/`):
- `verification/live-data-check-20261102-1045.md`
- `verification/scrape-anomalies-20261102-1101.md`
- `verification/promote-preservation-20261102-1104.md`
- `verification/published-diff-20261102-1106.md`
- `verification/be-my-eyes-deletion-audit-20261102-1114.md`
- `verification/orphan-reconciliation-20261102-1121.md`
- `verification/password-edit-recon-20261102-1137.md`
- `verification/deploy-recon-20261102-1314.md`
- `verification/deploy-candidate-20261102-1412.md`
- `verification/mirror-recon-20261102-1444.md`
- `fixtures/planner-inputs-20261102-1444.md` — reflects the **current** snapshot format. Superseded for planner work by the format in §3.9.

---

## 2. Completed: editable vendor-review passwords

Recorded in full as DECISION_LOG #68. In summary:

- **The API.** `PUT /api/local/passwords` sets a product's password. The value is trimmed and must be 1–255 characters, matching WordPress's `varchar(255)` `post_password`. The row is created if absent, and nothing is written when the value is unchanged.
- **The write path.** Every app write to the `passwords` document goes through `mutatePasswords`, built on `mutateDocument` in `lib/server/documents.ts`, as one Firestore transaction.
- **The UI.** `components/PasswordField.tsx` replaces the read-only Password inputs in both the Added and Candidate editors.
- **Verified** by typecheck, lint, a pure-function test, and manual browser and VoiceOver checks against the Firestore emulator covering every write path. Production edits were confirmed working after deploy.

**Commits:**
- `09daa31` — backend
- `e1329f7` — Added editor
- `ab98bd3` — Candidate editor
- `2fdbc4d` — documentation and #68
- `a82da29` — `frontend/.gcloudignore`
- `543d481` — first version of this plan
- `7134bfc` — the D13 guard
- `e1eccd8` — D14 and §8

---

## 3. Decisions for the mirror-promote rework

### 3.1 The mirror rule (applies to Added, Published and Vendors)

**D1. Stored data mirrors the website.** After a promote, each stored category contains only records the scrape positively identified, plus records the scrape could not check. A stored record is deleted only when the scrape *positively shows* it is no longer present in that category. The reason is reported with each deletion.

This reverses the keep-unmatched merge rule introduced with "Update Stored Data" (commit `0a7849f`; see the DECISION_LOG entry that introduced `promote-live/route.ts`). That rule was conservative because the scraper could not prove absence. D15–D18 make absence provable; where it isn't, nothing is deleted.

**D2. One shared planner for all three categories.** The decision logic lives in one pure planning function used by all three categories. It is testable without Firestore. It takes the stored documents and the live snapshot (including the run record, §3.9) as input, and returns a plan of per-record actions with reasons.

**D14. Deleting a record also deletes its tracking row**, subject to D20. This applies in all three categories.

**D15. Deletions require complete discovery.** For each post type (`product`, `vendor`), the run record states whether URL discovery completed:
- every REST page was fetched successfully;
- no exception occurred;
- the number of URLs discovered equals WordPress's `X-WP-Total` header.

If discovery for a post type was not complete, the planner proposes **no deletions** in the categories that depend on it, and the modal states why. Added and Published depend on `product`; Vendors depends on `vendor`. Updates, additions and password changes still proceed.

**D16. Every snapshot carries the full run record** (format in §3.9):
- the run's ID, start and finish times, and target;
- discovery completeness per post type;
- one outcome entry for **every discovered URL** of both post types.

Each category's promote is therefore self-contained. For example, deciding that an Added product is "now public" uses the outcome list in the Added snapshot itself, even after the Published snapshot has been consumed. The scraper writes all three snapshots in **one atomic batch**, so a crash can never leave snapshots from different runs.

**D17. The confirmation must match the preview.** The dry run (D9) returns the current version tokens (etags) of every document the promote would change. The real promote passes them back and is refused if any has changed, asking the operator to review again. Planning and applying happen inside one transaction (D8). This also closes a lost-edit window in the *current* promote: it reads stored data outside a transaction and writes without checking, so an editor save landing in between is silently overwritten.

**D18. Full runs only.** The mirror promote accepts only a snapshot whose run record shows target `all`. The scraper's targeted runs (`--target published` / `--target added`) are removed, because Vendor-resource deduplication and the mirror rule both require all categories from the same run.

**D20. Shared-name rows.** Password and tracking rows are keyed by `product_name` across every category: a vendor record's `product_name` is its vendor name, and candidates use the same keys. Some names occur in more than one category; for example, "BrainPOP" and "Kami" are each both a product and a vendor, and a product moving from Added to Published keeps its name. A password or tracking row is therefore deleted only if, after the plan is applied, **no remaining record in any category (published, added, candidate, vendors) has that `product_name`**.

### 3.2 Added — case table

Records are matched by `ncademi_product_url` to the snapshot's outcome entries (§3.9).

| Outcome for the stored record's URL | Action | Reported as |
|---|---|---|
| `protected_unlocked` | Keep, updated from the live page | Updated |
| `password_rejected` (a valid unlock request returned the password form again) | Keep the stored record; delete the password row (D20 does not apply: the row belongs to this record) | Needs correct password |
| `no_password` | Keep the stored record | Needs password |
| `fetch_error` or `parse_error` | Untouched: record and password unchanged | Could not check |
| `public_ok` | Delete the record, its password row and its tracking row (subject to D20) | Removed: now public |
| No outcome entry, and product discovery complete | Delete the record, its password row and its tracking row (subject to D20) | Removed: not on site |
| No outcome entry, and product discovery incomplete | Untouched | Could not check: discovery incomplete |
| *(No stored record)* `not_tracked` | Create nothing | Listed as an untracked protected page |

**D3. Fetch and parse errors leave the record untouched**, and the rest of the promote proceeds.

**D4. "No password on file" is treated like "wrong password":** the record is kept and flagged. This prevents a two-cycle trap: D5 clears a wrong password, and on the next scrape the record would otherwise be deleted as unidentified before anyone could enter the correct one.

**D5. A rejected password is deleted, and the record is flagged.** The correct WordPress password is then entered through the editable Password field (#68).

**D6. No auto-stubs.** Untracked protected pages no longer become records with generated passwords; this replaces `626c556`'s behaviour. They are reported for a person to act on, through the normal candidate workflow if wanted. Generated passwords remain correct for products that *start* in N.E.R.D. (see D19). They were wrong only for pages discovered already protected on the site, whose real password exists in WordPress.

**D7. Deleting a record also deletes its password row** (and its tracking row, per D14), subject to D20.

### 3.3 Published — case table

Records are matched by `ncademi_product_url`.

| Outcome for the stored record's URL | Action | Reported as |
|---|---|---|
| `public_ok` | Keep, updated from the live page | Updated |
| `fetch_error` or `parse_error` | Untouched | Could not check |
| `protected_unlocked`, `password_rejected`, `no_password` or `not_tracked` | Delete the record and its tracking row (subject to D20) | Removed: now protected |
| No outcome entry, and product discovery complete | Delete the record and its tracking row (subject to D20) | Removed: not on site |
| No outcome entry, and product discovery incomplete | Untouched | Could not check: discovery incomplete |
| *(No stored record)* `public_ok` | Append | Added |

**D12. Workflow assumption, Published.** "Promote to Published" in the Added editor is used only after the product page has been made public on the website. Under that workflow, stored Published never runs ahead of the site.

**D19. Workflow assumption, Added.** "Added to Site" in the Candidate editor is used only after the webmaster has manually built the protected page on the website. The webmaster either uses the N.E.R.D.-generated password or sets their own; in the latter case the operator enters the real one through the Password field. Under that workflow, stored Added never runs ahead of the site.

### 3.4 Vendors — case table

Records are matched by `vendor_directory_url`.

| Outcome for the stored record's URL | Action | Reported as |
|---|---|---|
| `public_ok` | Keep, updated from the live page | Updated |
| `protected_vendor` | Untouched; the scraper's stub is **never** used to update the stored record (its name is derived from the URL slug) | Could not check: protected vendor page |
| `fetch_error` or `parse_error` | Untouched | Could not check |
| No outcome entry, and vendor discovery complete | Delete the record and its tracking row (subject to D20) | Removed: not on site |
| No outcome entry, and vendor discovery incomplete | Untouched | Could not check: discovery incomplete |
| *(No stored record)* `public_ok` | Append | Added |
| *(No stored record)* `protected_vendor` | Append nothing | Listed as an unscraped protected vendor page |
| *(Stored record with no `vendor_directory_url`: null, empty or whitespace-only)* | Untouched, never deleted, does not block the promote (D36) | Could not check: not on the site yet (no directory URL) |
| *(No stored record with this URL)* `public_ok`, and the live `vendor_name` matches a stored vendor that has no URL (D36) | Append nothing | Could not check: possible match for that vendor; add its directory URL to link them |

**D22. Protected vendor pages are "exists, could not check."** The stored vendor is left as it is, and the slug-derived stub is never appended or used as an update.

**D23. Workflow assumption, Vendors.** *(Amended 2026-11-19 by D36.)* A vendor may be created with "add vendor" in the Vendor editor before its NCADEMI page exists, or without a real URL for testing, so `vendor_directory_url` stays optional in the UI and API. A vendor with no directory URL is "not on the site yet", and the promote leaves it untouched (D36). A vendor that has a directory URL is assumed to have its page on the website, so stored vendors with URLs never run ahead of the site. The confirmation modal (D9) remains the backstop if a record ever does.

### 3.5 Scraper changes

**D10. The scraper records what actually happened for every URL**, as outcome entries in the run record (§3.9):
- **Discovery** (`get_rest_urls`):
  - set an explicit timeout on every request;
  - read `X-WP-Total` / `X-WP-TotalPages`;
  - treat any exception, any non-200 page, or a count mismatch as incomplete discovery, recorded per post type (D15) rather than swallowed;
  - keep a non-200 response from silently ending paging.
- **Product pages:** a failed fetch is `fetch_error`, and a page that fetches but fails to parse is `parse_error`, for public and protected pages alike.
- **Protected pages:** `password_rejected` is reserved for one case only — the unlock request succeeded and WordPress returned the password form again. A request error or non-200 during unlock is `fetch_error`; a parse failure after unlocking is `parse_error`.
- **Vendor pages:** fetch and parse failures are recorded as outcomes, not only printed. A protected vendor page is recorded as `protected_vendor`.
- **Names:** apply Python's `html.unescape` to WordPress REST `title.rendered` wherever it is used for a name (today, `not_tracked` entries). Slug-derived names are never presented as real names.
- **Writes:** all three snapshots are written in one Firestore batch (D16). The three document keys remain named explicitly, preserving #66's write boundary.
- **Targets:** remove `--target published` and `--target added`; every run scrapes all categories (D18).
- **Interim compatibility:** the run record replaces `$meta.missing`. Until the new promote route ships, nothing reads `missing` except the guarded Added stub block (D13), so dropping it is safe.

### 3.6 Promote route and confirmation

**D8. One transaction.** The stored-document write, password-row changes, tracking-row changes and the live-snapshot deletion happen in one Firestore transaction. All seven documents of D30 are read first (the category's stored document, the other three stored documents, the live snapshot, `passwords` and `tracking`), then planned (the pure planner of D2, called inside the transaction), then up to four are written (the stored document, `passwords`, `tracking`, and the live-snapshot deletion). This follows the read-then-pure-function pattern of `mutateDocument`, through the dedicated helper of D31. A failed promote leaves nothing half-applied. *(Amended 2026-11-19 by D30; originally "four documents".)*

**D9. Dry run, then an all-or-nothing confirmation modal.**
- **The dry run.** The route accepts a dry-run request that returns the complete plan and the version tokens of D17, and writes nothing.
- **The modal** lists every proposed deletion with its reason, every password to be cleared, every record that could not be checked (and why), every untracked or unscraped protected page, and the counts of updates and additions. It also shows the snapshot's run time. The operator confirms or cancels the whole promote. Per-record keep checkboxes were considered and not adopted: under D12, D19 and D23, every deletion should be legitimate, so anything unexpected is a signal to cancel and investigate.
- **Accessibility requirements.** The modal follows the native `<dialog>`/`showModal()` pattern of `DeleteAddedModal.tsx`:
  - `aria-labelledby` and `aria-describedby`;
  - focus moved into the dialog on open; on close, focus goes where D51 says (amended 2026-11-19: the "Update Stored Data" button after cancel, the Messages log after a successful apply, because the button is then disabled);
  - native Escape to cancel;
  - real list markup for the lists;
  - a confirm button with a specific accessible name, such as "Delete 6 records and update".

  This is a destructive data action, so SC 3.3.4 error prevention applies.
- **Results** go to the existing Messages log (`liveLog`, `role="log"`). Each result line needs a **unique `stage`** value, because the log uses it as the React key.

### 3.7 Future: WordPress page creation and publishing

**D11. Ordering principle for future WordPress integration.** N.E.R.D. writes a stored record only after WordPress confirms the corresponding page change:
- **Publishing:** "Promote to Published" writes the record to stored Published only after WordPress confirms the publish succeeded.
- **Page creation:** the planned flow for Added, where N.E.R.D. creates the protected page in WordPress and sets the N.E.R.D.-generated password, writes the record to stored Added only after WordPress confirms the page exists with that password set.
- **Vendor saves:** the planned flow where saving a vendor in the Vendor editor pushes the change to the vendor page through WordPress writes the record to stored Vendors only after WordPress confirms the change. This covers both creating a new vendor and editing an existing one.

If either fails or is pending, the record stays where it was. Stored data then never contains a page the site lacks, and the mirror rule stays safe without special cases. Nothing to build now.

### 3.8 Temporary guard (deployed)

**D13.** Until the rework lands, `POST /api/local/promote-live` refuses `category: "added"` with HTTP 409 and a message explaining the temporary block. Published and Vendors promotes keep the current merge rule meanwhile. Remove the guard in step 5 of §4.

### 3.9 Snapshot run record (format)

Every `*-live` snapshot's `$meta` carries the same `run` block from the run that produced it:

```
$meta: {
  last_scraped: <ISO-8601 UTC>,        // retained, = run.finished_at
  total_records: <int>,                // retained; records in THIS snapshot
  generated_by: "scrape_ncademi_live.py",
  run: {
    run_id: <string, uuid4>,
    started_at: <ISO-8601 UTC>,
    finished_at: <ISO-8601 UTC>,
    target: "all",
    discovery: {
      product: { complete: <bool>, expected_total: <int|null>, discovered: <int>, error: <string|null> },
      vendor:  { complete: <bool>, expected_total: <int|null>, discovered: <int>, error: <string|null> }
    },
    outcomes: [
      {
        url: <string>,                 // the match key: ncademi_product_url or vendor_directory_url
        post_type: "product" | "vendor",
        status: "public_ok" | "protected_unlocked" | "password_rejected" | "no_password"
              | "not_tracked" | "protected_vendor" | "fetch_error" | "parse_error",
        name: <string|null>,           // decoded real name where known; null when only a slug is available
        detail: <string|null>          // short diagnostic, e.g. "HTTP 503", "timeout", "no <article>"
      }
    ]
  }
}
```

Rules:
- **One entry per discovered URL.** `outcomes` contains exactly one entry for every URL discovered for either post type, so its length equals the sum of `discovery.*.discovered`.
- **Statuses by post type.** `protected_unlocked`, `password_rejected`, `no_password` and `not_tracked` occur only for `product`; `protected_vendor` only for `vendor`.
- **Snapshot contents.** A record appears in `published-live` only with outcome `public_ok`; in `added-live` only with `protected_unlocked`; in `vendors-live` only with `public_ok`.
- **Same run.** All three snapshots of one run carry identical `run` blocks.
- **`$meta.missing` is removed.**

### 3.10 Retire the legacy editor

**D21.** The old `/editor` page (`frontend/app/editor/page.tsx`) is unused, and still reachable by URL, with its own import actions and a per-record move between Added and Published (`handlePromoteRecord`). It has no copy of the live-data promote. It is retired, after a grep-confirmed zero-reference check. This is independent of the mirror rework and can ship separately. *(Wording corrected 2026-11-19 by D39.)*

### 3.11 Planner escalation rulings (2026-11-19)

The planner (§4 step 4) marked six points where §3.2–3.4 and §3.9 did not settle its behaviour. Each is ruled on below and marked `RESOLVED (Dn)` in `frontend/lib/mirror-planner.ts`.

**D24.** A stored Added record whose URL has a `not_tracked` outcome has no row in §3.2; it arises when the record was added to stored Added between the scrape and the promote. Ruling: untouched, reported as could not check.

**D25.** §3.9 states that the number of outcomes equals the sum of `discovery.*.discovered`, and the planner checks the count per post type instead. Ruling: per-post-type check kept.

**D26.** The tables do not say what to do when a stored record's URL matches an outcome of the other post type. Ruling: refuse.

**D27.** §3.2 has no append row, so a live Added record with no stored counterpart is neither appended nor deleted. Ruling: not appended; reported under couldNotCheck. Reported under couldNotCheck; never created, deleted or appended, and does not affect deletionsAllowed.

**D28.** An outcome of the category's post type with no stored record and no table row — `fetch_error` or `parse_error` in any category, or for Added `protected_unlocked`, `password_rejected` or `no_password` — was ignored silently. Statuses that place the page in the other product category (Added: `public_ok`; Published: `protected_unlocked`, `password_rejected`, `no_password`, `not_tracked`) are not reported, because every snapshot lists every product URL (D16). Ruling: never created or deleted; reported under couldNotCheck. Reported under couldNotCheck; never created, deleted or appended, and does not affect deletionsAllowed.

**D29.** The tables say "Append" for a `public_ok` outcome with no stored record, but the live snapshot can hold no record to append. Ruling: refuse.

### 3.12 Step 5 rulings (2026-11-19)

The step 5 recon (taken at commit `39eba1b`) raised twelve findings where the plan and the code did not settle step 5, and a vendor policy question. Each is ruled on below. D30 amends D8, D36 amends D23 and the §3.4 table, and D39 corrects D21.

**D30.** Promote reads seven documents in one transaction: the stored document for the category, the other three stored documents (needed for `namesInOtherCategories`, D20), the category's live snapshot, `passwords` and `tracking`. It writes up to four: the stored document, `passwords`, `tracking`, and the deletion of the live snapshot (with the existing backup behaviour). This amends D8's "four documents".

**D31.** A new dedicated multi-document transaction helper, `transactDocuments`, in `frontend/lib/server/documents.ts`. `mutateDocument` is not widened: its restriction to `"passwords"` is a standing decision. Existing helpers are not composed, because each opens its own `runTransaction`. The existing backup behaviour (`stageWrite`) is preserved for every document written. Like the rest of `documents.ts`, the helper knows nothing about record shape: it reads a given list of keys, hands their bytes and etags to a pure `decide` function, and applies the writes and live-snapshot deletions that function returns.

**D32.** Version tokens (D17) cover all seven documents. A document's token is its stored `etag`; a document that does not exist has the token `"absent"`. If any token differs at apply time, including absent→present and present→absent, the apply is refused, writes nothing, and returns a fresh preview.

**D33.** The route reshapes live records to stored shape before calling `planPromote`, as before: product field defaults (`PRODUCT_FIELD_DEFAULTS`) and the derived `slug`. It also strips `is_protected`, a scraper-only field that stored records do not have. Before stripping, step 5 verifies that no stored record type declares it.

**D34.** Removed from the route: the D13 guard, the unreachable Added stub block (which read `$meta.missing` and created stub records and passwords in a separate transaction), and every other read of `$meta.missing`. D6 forbids stubs, and §3.9 replaces `$meta.missing`.

**D35.** The promoted stored document's `$meta` keeps `snapshot_taken_at`, the `total_*` count and `generated_from`, with values taken from the run record, and adds `run_id`:
- `snapshot_taken_at` is `run.finished_at`;
- `total_products` or `total_vendors` is the length of the new stored array;
- `generated_from` is `mirror promote via /records ("Update Stored Data")`;
- `run_id` is `run.run_id`.

Other `$meta` keys and `$schema_version` are carried over unchanged.

**D36.** Vendors with no directory URL. Users must be able to create vendors before their NCADEMI page exists, and to test the system without real URLs, so `vendor_directory_url` stays optional in the UI and API. The planner changes as follows, for Vendors only:
- (a) A stored vendor whose `vendor_directory_url` is null, empty or whitespace-only is "not on the site yet". It is left untouched, never deleted, and never blocks the promote, and it is reported (below). This replaces the planner's "has no vendor_directory_url" refusal for Vendors only. The refusal stays for every other category, for a vendor whose `vendor_directory_url` is missing or not a string, and for every other unmatched-key case.
- (b) Duplicate guard: a live vendor that would otherwise be appended is not appended if its `vendor_name` matches the `vendor_name` of a stored vendor that has no URL. It is reported (below).
- (c) D23's workflow assumption is amended accordingly.

Reporting uses the existing `couldNotCheck` array; `PlanReport` gains no fields. Three reasons:
- D1 lets a stored record remain only if the scrape identified it or could not check it, and a vendor with no URL cannot be checked.
- D27 and D28 already use `couldNotCheck` for pages on the site that are not acted on, which is case (b).
- The D9 modal already lists `couldNotCheck`.

The entries are:
- (a) `{ url: "", name: <stored product_name>, reason: "not on the site yet (no directory URL)" }`. `url` is the empty string because the record has none.
- (b) `{ url: <live vendor_directory_url>, name: <outcome name, else live product_name>, reason: "possible match for \"<stored product_name>\"; add its directory URL to link them" }`.

Name comparison for (b) normalizes `vendor_name` on both sides: Unicode NFC, trim, collapse internal whitespace runs to one space, lower-case. A `vendor_name` that is null or not a string matches nothing. The plan prescribes no normalization for comparing vendor names (D10's `html.unescape` applies to scraper-side REST titles), so this normalization is a step 5 choice, flagged for review. Neither case affects `deletionsAllowed`, and neither is subject to the D15 gate.

**Deferred (not a decision).** A full vendor lifecycle — a Vendor Candidate state, with Admin-only promotion to Added — is deferred and out of scope for the mirror-promote rework.

**D37.** The existing "Update Stored Data" button (`SourceToggle.tsx`) may break on the branch between steps 5 and 6. Nothing merges or deploys until steps 6 and 7 pass, so there is no backward-compatibility layer.

**D38.** `liveLog` keys must be unique per press. This belongs to step 6 and is recorded here only.

**D39.** D21's wording is corrected: the legacy `/editor` page moves single records between Added and Published, and has no copy of the promote. Retiring it still stands.

**D40.** Password-row deletions (`passwordNamesToDelete`) and tracking-row deletions (`trackingNamesToDelete`) commit in the same transaction as the stored-document write. Every password row whose `product_name` matches exactly is deleted, including duplicates. Tracking deletion reuses `reconcileTrackingRows(existing, namesToDelete, [])`. A `passwords` or `tracking` document is written only when at least one row is removed, and is never created when absent.

**D41.** Testing.
- `transactDocuments` gets an emulator-backed `node:test` integration test. It runs only when `FIRESTORE_EMULATOR_HOST` is set, and skips with a clear message otherwise.
- The route's decision logic (reshape, plan, tokens, envelope, response building) moves into a pure, unit-tested module, `frontend/lib/server/promote-mirror.ts`, so the route handler is thin.
- Playwright/E2E is not used in dispatches (AGENTS.md). `node:test` against the emulator is not E2E.
- `documents.ts` and its neighbours use `import "server-only"`, extensionless value imports and TypeScript parameter properties. These tests therefore run with a test-only resolve hook (`tests-ts/support/ts-resolve.mjs`) and Node's `--experimental-transform-types`. The planner test keeps running with plain `node --test`.

### 3.13 Promote route contract (step 5)

`POST /api/local/promote-live`, with `runtime = "nodejs"` and `dynamic = "force-dynamic"`. Every response is JSON with `Cache-Control: no-store`. The handler is thin: `assertSession`, JSON parsing, `parsePromoteRequest`, then one `transactDocuments` call whose `decide` function is `decidePromote` (both in `frontend/lib/server/promote-mirror.ts`, D41). Steps 5.4 and 6 build from this section.

**Request.** The body is `{ "category": "published" | "added" | "vendors", "mode": "preview" | "apply", "tokens": { ... } }`.
- Not valid JSON: 400 `{ error: "Request body is not valid JSON." }`.
- `category` not one of the three: 400 `{ error: '"category" must be one of "published", "added", "vendors".' }`.
- `mode` missing, or not `"preview"` or `"apply"`: 400. There is no default, so the pre-step-6 `SourceToggle` request (`{ category }` only) gets 400 (D37).
- `apply`: `tokens` must be an object with exactly the seven keys below, each a non-empty string; otherwise 400. In `preview`, `tokens` is ignored.
- No session: 401 from `assertSession`, unchanged.

**The seven documents, in this fixed order.** This is also the order of `tokens` and of `changed`:
1. the category's stored document;
2. the other three of `published`, `added`, `candidate`, `vendors`, in that order;
3. the category's live snapshot (`published-live`, `added-live` or `vendors-live`);
4. `passwords`;
5. `tracking`.

**Processing.** Both modes run in one `transactDocuments` transaction that reads all seven documents. Preview writes nothing.
1. Tokens: each document's stored `etag`, or `"absent"`. A present document without a string `etag` returns 500 `{ error }`.
2. `apply` only: if any request token differs from the token just read, return 409 conflict (below), writing nothing.
3. Live snapshot absent: 409 `{ error: 'No live data to promote. Run "Retrieve Live Data" first.' }`.
4. Any of the four stored documents absent: 503 `{ error }` naming it.
5. Any present document that is not valid JSON, is not a JSON object, or (for the four stored documents and the live snapshot) lacks an array under "products" or "vendors": 500 { error } naming it.
6. Call `planPromote` with: the stored records; the live records reshaped per D33; `$meta.run`; `namesInOtherCategories` (every string `product_name` in the other three stored documents); the password rows (`parsePasswordsFile`; none if absent); and the tracking rows (none if absent). A planner refusal returns 409 refused (below).
7. If `run.finished_at` is not a non-empty string, return 409 refused, with `error` saying so.
8. `preview`: 200 plan body with `outcome: "preview"`.
9. `apply`: stage the writes, then return 200 plan body with `outcome: "applied"`:
   - The stored document, always: `$schema_version`, and `$meta` per D35; the `products` or `vendors` array is `plan.nextStored`; serialized as `JSON.stringify(doc, null, 2) + "\n"`.
   - `passwords`, only if at least one row is removed: every row whose `product_name` is exactly in `passwordNamesToDelete`, duplicates included. Other rows keep their order. Serialized by `serializePasswordsFile`.
   - `tracking`, only if at least one row is removed: `reconcileTrackingRows(existing, trackingNamesToDelete, [])`, serialized as `tracking` is elsewhere.
   - The live snapshot is deleted, after its rolling backup is refreshed.

   Every written document gets its rolling backup (`stageWrite`). `DocumentTooLargeError` returns 413 `{ error }`, and nothing is written.

**Plan body** (status 200; `outcome` is `"preview"` or `"applied"`):
- `outcome`, `category`.
- `runId` (`run.run_id`) and `runFinishedAt` (`run.finished_at`, the snapshot's run time for the modal).
- `tokens`: the seven tokens read, keyed by document key. The modal sends these back on apply.
- `deletionsAllowed`, `deletionsBlockedReason`.
- `report`: the complete `PlanReport`.
- `passwordNamesToDelete`, `trackingNamesToDelete`. These are names only; password values never appear in any response.
- `counts`: `storedBefore`, `storedAfter`, one count per `PlanReport` array (`updated`, `appended`, `removed`, `needsCorrectPassword`, `needsPassword`, `couldNotCheck`, `untrackedProtected`, `unscrapedProtectedVendors`), `passwordRowsToDelete` and `trackingRowsToDelete` (rows, counting duplicates).
- `applied` only: `written: { stored: true, passwords: <boolean>, tracking: <boolean>, liveDeleted: true }`.

**Refused body** (status 409): `{ outcome: "refused", category, error, runId: <string or null>, runFinishedAt: <string or null>, tokens }`. `error` is the planner's text, verbatim.

**Conflict body** (status 409, `apply` only): `{ outcome: "conflict", category, error: "The stored data changed after the preview. Review the updated preview and confirm again.", changed: [<keys whose token differs, in the fixed order>], fresh: { status, body } }`. `fresh` is exactly the response that a `preview` of the same category would give from the documents just read: a plan body, a refused body or an error body.

**Error body.** `{ error }`, for statuses 400, 401, 409 (no live data), 413, 500 and 503. Any response without an `outcome` field is an error.

**For step 6.** The modal is filled from a preview's plan body. Confirm sends `apply` with that body's `tokens`. On `conflict`, the modal replaces its content with `fresh` and asks for confirmation again. On `refused`, it shows `error` and offers no confirm.

### 3.14 Step 6 rulings (2026-11-19)

The step 6 recon (`.scratch/verification/step6-recon-20261119-1443.md`) raised 14 open questions and 12 accessibility gaps. Each is ruled on below. D51 amends D9; D50 implements D38.

**D42. Response types on the client.** Client components import the §3.13 body types with `import type` from `@/lib/server/promote-mirror`. Type-only imports are erased at build time; a value import would fail the build through `server-only`. Precedent: the editors type-import `SnapshotMeta` from `documents-read.ts`.

**D43. Opening the modal.** Pressing "Update Stored Data" opens the D9 modal at once in a loading state, announced through a status region that exists before it is filled, then requests the preview from inside the modal.

**D44. Lists and their order.** Every list is shown in full (D9: "lists every"), each under an `h3` naming it with its count, inside one scrollable dialog body that is keyboard-focusable and labelled. Order, by consequence: (1) records to delete, with reasons; (2) password rows to delete (`passwordNamesToDelete`); (3) Added records needing a correct password or a password (`needsCorrectPassword`, `needsPassword`), as lists; (4) records that could not be checked, with reasons; (5) untracked protected pages and unscraped protected vendor pages; (6) counts: updated, added, stored before and after, tracking rows to delete (count only). The snapshot's run time (`runFinishedAt`) is shown near the top. Empty lists are omitted.

**D45. Blocked deletions.** When `deletionsAllowed` is false, a prominent notice at the top of the dialog states `deletionsBlockedReason`. The notice is part of the dialog's `aria-describedby`, and the confirm label follows D46.

**D46. The confirm button.** Its visible text and accessible name are "Delete N records and update stored <Category>" when `counts.removed` > 0 and deletions are allowed, otherwise "Update stored <Category>". Password-row changes are stated in the dialog description, not in the label. There is no confirm button for refused or error bodies (D48).

**D47. Conflict refresh.** On a `conflict` body the dialog stays open, replaces its content with `fresh`, and shows a notice: the contract's error text followed by the changed documents in plain words. Document labels: published "stored Published data", added "stored Added data", candidate "stored Candidates data", vendors "stored Vendors data", published-live "the live Published snapshot", added-live "the live Added snapshot", vendors-live "the live Vendors snapshot", passwords "vendor-review passwords", tracking "tracking data". Focus moves to the notice (`tabIndex=-1`), so it is announced exactly once; the notice is not also a live region. If `fresh` is a refused or error body, D48 applies to it.

**D48. Refused and error bodies.** A `refused` body or an error body (any response without `outcome`) is shown inside the dialog in a `role="alert"` region that exists before it is filled, with only a Close button. On close, one Messages line is written (D49). A 401 says the session has expired and asks the operator to sign in again.

**D49. Messages wording.** One line per event, written when the dialog closes:
- applied: `Updated stored <Category> from the live run of <runFinishedAt, formatted with formatLocalTimestamp>: <updated> updated, <appended> added, <removed> removed; <passwordRowsToDelete> password rows removed. Live snapshot cleared.`
- applied with deletions blocked: the applied line, then `Deletions were not applied: <deletionsBlockedReason>`
- cancelled (Cancel, Escape or Close before any apply): `Update Stored Data cancelled; nothing was changed.`
- refused or error: `Update Stored Data failed: <error>` (for 401: `Update Stored Data failed: your session has expired; sign in again.`)
- unknown result (D54): `Update Stored Data: the result is unknown (<detail>); review a fresh preview.`
Category labels are "Published", "Added" and "Vendors".

**D50. Unique Messages keys.** The Messages panel assigns every entry a panel-unique id through an `appendLog(stage, message)` helper on the messages context, and keys entries by that id. Writers never build keys. This implements D38 and survives `SourceToggle` remounting on record navigation.

**D51. Focus on close (amends D9).** After Cancel, Escape, or Close of a refused or error body, focus returns to the "Update Stored Data" button, which must still be enabled at that point. After a successful apply the button is disabled (the snapshot is consumed), so focus moves to the Messages log, which has a visible focus indicator (D55). If the button is unexpectedly disabled at close, focus goes to the Messages log.

**D52. The open record after apply.** If the record open on the page is in `report.removed` (matched by its URL), the client navigates to `/records/<category>`, whose index redirects to the first remaining record. Otherwise it stays on the record and refreshes.

**D53. Enabling the button.** "Update Stored Data" is enabled whenever the category's live snapshot document exists, even with zero records: an empty snapshot can still carry deletions, password flags and refusals (for example, every protected Added page rejected its password). "Live Data" stays enabled only when the snapshot has records.

**D54. Unknown results.** If the apply request fails at the network level or returns a body that is not JSON, the dialog states that the result is unknown and offers "Preview again", which requests a fresh preview. Apply is never retried automatically. The transaction is atomic (D8), so the fresh preview shows either "No live data to promote" (it applied) or the same plan (it did not).

**D55. Accessibility requirements for step 6.** In addition to D9's:
- Busy state: while a preview or apply is in flight, a status region (present before it is filled) announces it; Escape and every close request are ignored while apply runs (a `cancel` listener with `preventDefault`, plus a guard in the close path, since browsers may not honour repeated `preventDefault`); focus is never left on a control that becomes disabled.
- Structure: the dialog title is an `h2`; each list section is an `h3`; lists use real list markup.
- The scrollable dialog body has `tabIndex=0` and an accessible name.
- The Messages log gets an accessible name (associated with its visible "Messages" title) and a visible focus indicator (it receives programmatic focus); its status and alert regions move out of the `role="log"` container so announcements are not doubled.
- Focus indicators on every control `SourceToggle` and the modal render meet 3:1 (SC 1.4.11); the current `focus:ring-emerald-500` is replaced.
- No new motion; any added motion honours `prefers-reduced-motion`.
Deferred, not step 6: the nested `<main>` landmarks on `/records` category pages, and the legacy `/records` page's stubbed "Update Stored Data" button.

---

## 4. Implementation plan

Each step is one dispatch with stop-and-report gates, validated before the next is written. Claude CLI commits when its checks pass and never pushes. UI and persistence changes commit only after the developer's browser check.

1. **Recon** — done (`mirror-recon-20261102-1444.md`).
2. **Plan update** — this revision.
3. **Scraper** (Claude CLI). Implement D10, D16 and D18 and the §3.9 format.
   - Verify with `py_compile` and new pytest tests for discovery completeness and outcome classification, using stubbed HTTP responses (no network).
   - Then one emulator run, and one production run read back to confirm the format.
4. **Planner** (external model, Claude Fable, from an upload bundle). A pure TypeScript function implementing §3.2–3.4, D15, D20 and D22 against the §3.9 format, with a `node:test` test for every row of every table.
   - Node 25 runs `.ts` test files directly; the tests live outside `frontend/`, because `tsconfig.json` does not allow `.ts`-extension imports.
   - Claude CLI places the files on a branch and runs the tests and the typecheck.
   - **Done** — commit `00b11a4`.
   - Escalation rulings (§3.11, D24–D29) applied in commit `e538930`.
5. **Promote route and document layer** (Claude CLI), as six gated dispatches. Rulings are in §3.12; the route contract is in §3.13.
   - 5.0 Plan update: D30–D41, the route contract, and the D8, D21 and D23 amendments.
   - 5.1 Planner: D36, with `node:test` tests.
   - 5.2 Document layer: `transactDocuments` (D31), its emulator-backed `node:test` test, and the test-only resolve hook (D41).
   - 5.3 Pure decision module `frontend/lib/server/promote-mirror.ts`, covering reshape (D33), tokens (D32), envelope (D35), row changes (D40) and response bodies, with unit tests (D41).
   - 5.4 Route handler: preview and apply through `transactDocuments` and the pure module (D8, D17, D30, D32). The D13 guard, the stub block and the `$meta.missing` reads are removed (D34).
   - 5.5 Emulator verification: preview and apply for all three categories, the D32 conflict path, and D36.
   - **Done** — commits 83db7a6, 62162db, 66b7818, bef6eed, 28b40e7, 43aa2b4, 321b01b; emulator-verified 2026-11-19 (report `.scratch/verification/step5-5-emulator-verification-20261119-1456.md`).
6. **Modal and messages** (Claude CLI), as four gated dispatches. Rulings are in §3.14.
   - 6.0 Plan update: D42–D55, the D9 amendment, and the completed step 5 "Done" line.
   - 6.1 Messages panel: `appendLog` with panel-unique ids (D50), the log's accessible name and focus indicator, and its status and alert regions moved out of the log (D55).
   - 6.2 The D9 modal component (D43–D49, D51, D54, D55), statically verified.
   - 6.3 `SourceToggle` wiring: preview, apply, conflict, refused, error and unknown flows; Messages lines; focus on close; navigation after apply (D52); the button gate (D53); focus-ring contrast (D55). Developer browser and VoiceOver check before commit.
7. **Emulator end-to-end test.** Fixtures covering every row of §3.2–3.4, plus incomplete discovery. Developer browser and screen-reader check of the modal.
8. **Retire the legacy editor** (D21). Independent; any time.
9. **DECISION_LOG entry** recording D1–D29, with a forward pointer on the merge-rule entry it reverses.

---

## 5. Deploy record (2026-11-02)

**What shipped.** Eleven commits, `97fd4d9` through `7134bfc`:
- four from 2026-09-04: `97fd4d9`, `723510a`, `74df9c7`, `626c556`;
- `09daa31`, `e1329f7`, `ab98bd3`, `2fdbc4d`, `a82da29`, `543d481`, `7134bfc`.

Only `nerd-frontend` needed a new revision.

**Procedure used.** Manual and frontend-only; `scripts/deploy.sh` was not used, because it redeploys `nerd-api`, runs `gcloud config set project`, and auto-promotes with `--to-latest`.
1. Build from `frontend/` with `gcloud builds submit --config cloudbuild.yaml`, with explicit `--project`.
2. Deploy by digest with `--no-traffic --tag=candidate` and no env-var flags.
3. Check at the candidate URL.
4. Promote with `update-traffic --to-revisions=<revision>=100`.

**Outcome:**
- Cloud Build `630f60fc`; image digest `sha256:76c01acb21eb8bfb5423b17adf36384042285158110fc5147b9c2635c1fcfaa6`.
- Revision `nerd-frontend-00018-vad` was promoted to 100%, with environment variable names and the service account unchanged.
- **Rollback:** `gcloud run services update-traffic nerd-frontend --project=edtech-agent-2026 --region=us-central1 --to-revisions=nerd-frontend-00016-beq=100`.
- Password edits were confirmed working in production.
- Grammarly's and Nearpod's correct WordPress passwords are still to be obtained from whoever manages the protected pages on ncademi.org.

**Repeatable procedure.** The same four steps above, run from a clean, pushed `main`.

---

## 6. Open questions

- **Message wording and ordering** in the Messages log for promote results: to be settled in step 6.

---

## 7. Known, not addressed (carried forward)

**From the password work (#68):**
- **"Delete" in the Added and Candidate editors leaves password rows behind.** The orphaned "Be My Eyes" row and the password rows for products now only in Published are cleanup candidates. The mirror rework covers deletions made by promote only.
- **Renaming a product** orphans its password and tracking rows.
- **`useUnsavedChangesGuard` does not cover the Password field.**
- **Pressing Escape while a password save is in flight** reverts the field, but the save still completes.
- **`frontend/lib/passwords.json` `$meta` text is stale.** It is local seed data.

**Elsewhere:**
- **`scripts/nerd_documents.py push` overwrites all 9 Firestore documents wholesale** from local files dated late August, with no backup. It needs a safety guard, or retirement. `scripts/write_single_document.py` also writes directly.
- **`nerd_documents.py`'s usage text** shows `--project` after the subcommand. The script requires it before.
- **CLAUDE.md and AGENTS.md describe Next.js 15**; the repo runs Next 16.2.9.
- **Earlier Cloud Build source uploads may contain `emulator-data/`** and debug logs (**UNVERIFIED**). The bucket is private to the project.
- **The `"Amplify Change"` tracking row matches no record.**
- **The current promote's lost-edit window** (D17) remains until step 5 ships. It is low risk with one operator.

---

## 8. Later phase: scraping from the cloud

**Goal.** Keep the live snapshots current without anyone running the scraper from a terminal, so N.E.R.D. stays in step with the site while it is not in regular use. Promotes remain manual and reviewed through the D9 modal; a scrape only ever writes the three `*-live` snapshots.

**Sequencing.** After the mirror-promote rework (§4). The rework changes the scraper (D10, D16, D18), and the reviewed promote is what makes unattended snapshots safe to act on. The feasibility probe (§8.3) runs first, independently of the rework.

### 8.1 Options

**Option A: GitHub Actions** (preferred; a judgment call).
- A workflow runs `scripts/scrape_ncademi_live.py --prod` on a schedule (proposed: nightly) and on demand ("Run workflow").
- It authenticates to Google Cloud through Workload Identity Federation, with no key files, trusted only for this repository, the `main` branch and this workflow. It runs as a service account holding `roles/datastore.user`.
- Progress and failures appear in the GitHub run log.
- Effort: about 3–4/10.
- Trade-offs:
  - Triggering requires GitHub repository access, which is separate from `NERD_ALLOWED_EMAILS`.
  - The run log is GitHub's interface, not an in-app status display that the project's live-region requirement could govern.
  - Minutes count against GitHub's free allowance if the repository is private. Repository visibility is **UNVERIFIED**.

**Option B: a Cloud Run Job, triggered from the N.E.R.D. UI.**
- The job is built from the existing Python image. A server route starts an execution through the Cloud Run Admin API.
- The job has its own service account with `roles/datastore.user`, and the frontend service account gets permission to run the job.
- A lock prevents overlapping runs.
- A status document is polled by an accessible progress display: milestones (not individual pages) announced through a polite live region per SC 4.1.3, and failures announced with `role="alert"`.
- Effort: about 6/10. It supersedes DECISION_LOG #66.
- Preferred only if colleagues without GitHub access must be able to trigger scrapes.

**Common to both:**
- **Full runs only (D18)**, written as one atomic batch (D16).
- **#66's write boundary still applies.** The script names its three output documents explicitly.
- **Any identity that runs the scraper can write any document in the database** (#66), so its credentials must be scoped and protected accordingly.
- **Running from colleagues' own machines (Mac or Windows) was considered and not preferred.** WSL2 makes Windows behave like the Mac setup, but each person would need a Google login with Firestore write access to the project, which widens the exposure #66 describes.

### 8.2 Why not GitHub Pages

GitHub Pages serves static files only, so the scraper would have to run in a browser, which cannot do the job:
- The browser cannot read ncademi.org's product pages from another origin.
- It cannot use WordPress's page-password cookie for another site.
- Writing to Firestore from the browser would require loosening the deny-all security rules.

### 8.3 Feasibility probe (first step)

**The unknown (UNVERIFIED):** whether ncademi.org, or a security plugin protecting `wp-login.php`, blocks or challenges requests from cloud datacenter addresses. GitHub Actions runners and Cloud Run both use datacenter addresses, so the answer applies to both options.

**The probe:** a one-off, manually triggered workflow with no Google Cloud access. It:
- fetches the WordPress REST product list;
- fetches one public product page;
- unlocks one protected page (Newsela Student Platform) using its password stored as an Actions secret — one password request in total;
- prints the status codes, and whether the unlocked page parsed.

**After it:**
- If any step is blocked or challenged, raise it with ncademi.org's site owner (an allowlist or an exception) before any further design.
- Remove the probe workflow and its secret afterwards.
