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

**D22. Protected vendor pages are "exists, could not check."** The stored vendor is left as it is, and the slug-derived stub is never appended or used as an update.

**D23. Workflow assumption, Vendors.** New vendors are added with "add vendor" in the Vendor editor only after the vendor page has been manually added to the website. Under that workflow, stored Vendors never runs ahead of the site. The confirmation modal (D9) remains the backstop if a record ever does.

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

**D8. One transaction.** The stored-document write, password-row changes, tracking-row changes and the live-snapshot deletion happen in one Firestore transaction. All four documents are read first, then planned (the pure planner of D2, called inside the transaction), then written. This follows the read-then-pure-function pattern of `mutateDocument`, extended to four documents. A failed promote leaves nothing half-applied.

**D9. Dry run, then an all-or-nothing confirmation modal.**
- **The dry run.** The route accepts a dry-run request that returns the complete plan and the version tokens of D17, and writes nothing.
- **The modal** lists every proposed deletion with its reason, every password to be cleared, every record that could not be checked (and why), every untracked or unscraped protected page, and the counts of updates and additions. It also shows the snapshot's run time. The operator confirms or cancels the whole promote. Per-record keep checkboxes were considered and not adopted: under D12, D19 and D23, every deletion should be legitimate, so anything unexpected is a signal to cancel and investigate.
- **Accessibility requirements.** The modal follows the native `<dialog>`/`showModal()` pattern of `DeleteAddedModal.tsx`:
  - `aria-labelledby` and `aria-describedby`;
  - focus moved into the dialog on open, and returned to the "Update Stored Data" button on close;
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

**D21.** The old `/editor` page (`frontend/app/editor/page.tsx`) is unused, and still reachable by URL with its own copies of the promote and import actions. It is retired, after a grep-confirmed zero-reference check. This is independent of the mirror rework and can ship separately.

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
5. **Promote route and document layer** (Claude CLI).
   - A four-document transaction variant of `promoteLive` that calls the planner inside the transaction (D8).
   - The dry run with version tokens (D17).
   - Password and tracking row changes (D5, D7, D14, D20). Tracking removal can reuse `reconcileTrackingRows`.
   - Remove the D13 guard.
6. **Modal and messages** (Claude CLI): D9.
7. **Emulator end-to-end test.** Fixtures covering every row of §3.2–3.4, plus incomplete discovery. Developer browser and screen-reader check of the modal.
8. **Retire the legacy editor** (D21). Independent; any time.
9. **DECISION_LOG entry** recording D1–D23, with a forward pointer on the merge-rule entry it reverses.

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
