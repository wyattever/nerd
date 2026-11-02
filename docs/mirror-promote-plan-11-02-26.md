# N.E.R.D. — Mirror-Promote Rework, Password Editing, and Deploy Plan

**Date:** 2026-11-02
**Status:** Decisions settled; rework not yet implemented. Password editing complete (local commits, not yet deployed).
**Suggested location:** `docs/mirror-promote-plan-11-02-26.md`
**Relationship to DECISION_LOG:** #68 records the password-editing work. The mirror-promote rework will need its own entry (#69 or next free number) when it lands, because it reverses the promote merge rule described in §3.1. This document is the working plan; the log entries are the record.

---

## 1. Why this exists

N.E.R.D. is not in regular use right now, so its stored records drift out of step with the NCADEMI website between uses. The 2026-11-02 production scrape made the drift concrete:

- Stored Added held records with no counterpart on the site. ABCmouse is not among the 100 product pages. CommonLit 360 and the three Lexia products are now public pages, so they appear in the published snapshot rather than the added one.
- 21 password-protected product pages on the site are not tracked by N.E.R.D. at all. 7 of them already exist as candidates.
- Grammarly's and Nearpod's stored passwords failed to unlock their pages.
- Stored Vendors contains two test records ("Another Test", "Test Vendor") that survive every promote.

The current "Update Stored Data" (promote-live) behaviour is a conservative merge. Live records update their stored counterparts, stored records with no live counterpart are kept, and live-only records are appended. For Added, commit `626c556` additionally auto-creates a stub record, with a generated password, for every untracked protected page. Both behaviours let stored data accumulate records that no longer reflect the site.

**Recon sources** (all in `.scratch/verification/`):
- `live-data-check-20261102-1045.md`
- `scrape-anomalies-20261102-1101.md`
- `promote-preservation-20261102-1104.md`
- `published-diff-20261102-1106.md`
- `be-my-eyes-deletion-audit-20261102-1114.md`
- `orphan-reconciliation-20261102-1121.md`
- `password-edit-recon-20261102-1137.md`
- `deploy-recon-20261102-1314.md`

---

## 2. Completed today: editable vendor-review passwords

Recorded in full as DECISION_LOG #68. In summary:

- **The API.** `PUT /api/local/passwords` sets a product's password. The value is trimmed and must be 1–255 characters, matching WordPress's `varchar(255)` `post_password`. The row is created if absent, and nothing is written when the value is unchanged.
- **The write path.** Every app write to the `passwords` document goes through `mutatePasswords`, built on `mutateDocument` in `lib/server/documents.ts`, as one Firestore transaction. Writers: POST (candidate import), PUT, DELETE (Promote to Published), and promote-live's stub step.
- **The UI.** `components/PasswordField.tsx` replaces the read-only Password inputs in both the Added and Candidate editors. The Save button appears only when the value has changed. Enter saves and Escape reverts. Focus returns to the input after a save. Outcomes are announced through the shared status and alert regions, with "Saving password…" set first so repeated saves are re-announced.
- **Verified** by typecheck, lint, a pure-function test, and manual browser and VoiceOver checks against the Firestore emulator covering every write path.

**Commits, local only:**
- `09daa31` — backend
- `e1329f7` — Added editor
- `ab98bd3` — Candidate editor
- `2fdbc4d` — documentation and #68
- `a82da29` — `frontend/.gcloudignore`; see §5

---

## 3. Decisions for the mirror-promote rework

### 3.1 The mirror rule (applies to Added, Published, and Vendors)

**D1. Stored data mirrors the website.** After a promote, each stored category contains only records the scrape positively identified, plus records the scrape could not check. A stored record that the scrape positively shows is no longer present in that category is deleted, with its reason reported.

This reverses the keep-unmatched merge rule introduced with "Update Stored Data" (commit `0a7849f`; see the DECISION_LOG entry that introduced `promote-live/route.ts`). That rule was conservative on purpose, because some Added pages could not yet be unlocked. The mirror rule replaces it with explicit handling of each case below, so nothing is deleted merely because it could not be checked.

**D2. One shared planner for all three categories.** The decision logic lives in one pure planning function used by all three categories. It is testable without Firestore, and it implements the case tables in §3.2–3.4.

### 3.2 Added — case table

Records are matched to scrape results by `ncademi_product_url`.

| Scrape result for the stored record | Outcome | Reported as |
|---|---|---|
| Page unlocked with the password on file | Keep, updated from the live page | Updated |
| Password on file rejected (WordPress returned the password form again) | Keep the stored record; **delete the password row** | Needs correct password |
| Protected page, but no password on file | Keep the stored record | Needs password |
| Page fetch failed (network or server error) | **Untouched**: record and password unchanged | Could not check |
| Not found as a protected page: absent from the site, or now public | **Delete the record and its password row** | Removed, with reason ("not on site" / "now public") |
| *(Not a stored record)* Protected page on the site that N.E.R.D. does not track | **Create nothing** | Listed as an untracked protected page |

**D3. Fetch errors leave the record untouched, and the rest of the promote proceeds.** Only the affected record is skipped. The run-wide alternative, where any fetch error blocks all deletions, was considered and not adopted, because the confirmation modal (D9) shows every proposed change before anything is written.

**D4. "No password on file" is treated like "wrong password."** The record is kept and flagged. This prevents a two-cycle trap: D5 clears a wrong password; on the next scrape the record has no password; without D4 it would be deleted as unidentified before anyone had a chance to enter the correct password.

**D5. A rejected password is deleted, and the record is flagged.** The editable Password field (DECISION_LOG #68) is where the correct WordPress password is then entered.

**D6. No auto-stubs.** Untracked protected pages no longer become records with generated passwords. This replaces `626c556`'s auto-stub behaviour. The 21 untracked pages, including the 7 that are already candidates, are reported for a person to act on, through the normal candidate workflow if wanted. It also removes the HTML-entity problem for stub names (§3.5, D10).

**Rationale for D6.** A generated password made sense when N.E.R.D. assigned passwords that someone then set on WordPress. For pages already protected on the site, the real password exists on WordPress, so a generated one is wrong by construction and would fail to unlock on every future scrape.

**D7. Deleting a record also deletes its password row.** This avoids the orphaned-row pattern found today; see §7.

### 3.3 Published — case table

Records are matched by `ncademi_product_url`.

| Scrape result | Outcome | Reported as |
|---|---|---|
| Public page scraped | Keep, updated from the live page | Updated |
| Page fetch failed | Untouched | Could not check |
| Not found as a public page: absent from the site, or now protected | Delete | Removed, with reason ("not on site" / "now protected") |
| *(Not a stored record)* New public page | Append | Added |

**D12. Current workflow assumption.** "Promote to Published" in the Added editor is used only after the product page has been manually made public on the website. Under that workflow, stored Published never runs ahead of the site, so the mirror rule never deletes a legitimate in-flight record.

### 3.4 Vendors — case table

Records are matched by `vendor_directory_url`.

| Scrape result | Outcome | Reported as |
|---|---|---|
| Vendor page scraped | Keep, updated from the live page | Updated |
| Page fetch failed | Untouched | Could not check |
| Not found on the site | Delete | Removed ("not on site") |
| *(Not a stored record)* New vendor page | Append | Added |

**Expected effect on first run:** the two test vendors ("Another Test", "Test Vendor") are proposed for deletion and appear in the confirmation modal.

**UNVERIFIED, for recon.** The scraper has a protected-vendor stub path (`make_protected_vendor_stub`) and a `vendors_missing` progress milestone. How protected or missing vendor pages appear in `vendors-live` needs confirming before the Vendors planner is written.

### 3.5 Scraper changes

**D10. The scraper reports distinct outcomes.**

- **Separate reasons** in `$meta.missing`: `fetch_error`, `password_rejected` (the password form was returned again), `no_password`, and `not_tracked`. Today `password_rejected` covers both a re-shown password form and a request failure (`scrape_ncademi_live.py` approx. :920–928). Under D5 that conflation would delete correct passwords after a timeout, so splitting it is a prerequisite.
- **Published and vendor fetch errors** are recorded, not only Added ones, so D3 can apply to every category. How the scraper currently handles a failed public-page fetch is **UNVERIFIED**; confirm in recon.
- **Decode names at the source.** WordPress REST `title.rendered` values are HTML-encoded (for example `Kate&#8217;s Math Lessons`). Decode them with Python's `html.unescape`, so names agree with names parsed from page HTML.

### 3.6 Promote route and confirmation

**D8. One transaction.** The stored-document write, the password-row changes, and the live-snapshot deletion happen in one Firestore transaction. A failed promote leaves nothing half-applied.

**D9. Dry run, then an all-or-nothing confirmation modal.**

- **The dry run.** The route accepts a dry-run request that returns the complete plan and writes nothing.
- **The modal.** "Update Stored Data" opens a modal listing every proposed deletion with its reason, every password to be cleared, every record that could not be checked, and the counts of updates and additions. The operator confirms or cancels the whole promote. Per-record keep checkboxes were considered and not adopted: under D12 every deletion should be legitimate, so anything unexpected in the list is a signal to cancel and investigate rather than to proceed selectively.
- **Accessibility requirements.** The modal follows the existing `<dialog>`/`showModal()` pattern used by `DeleteAddedModal.tsx`. It has a programmatically labelled heading, and focus moves into the dialog on open. Escape cancels, and focus returns to the "Update Stored Data" button on close. The lists use real list markup, and the confirm button has a specific accessible name, such as "Delete 6 records and update". This is a destructive data action, so error prevention under SC 3.3.4 applies: the action is checked and confirmed before it happens.
- **Results.** After the promote, the outcome lines go to the existing Messages log, through `liveLog` and `role="log"`: updated, removed with reasons, needs correct password, needs password, could not check, and untracked protected pages.

### 3.7 Future: WordPress publishing

**D11. Ordering principle for the planned WordPress-publishing version of "Promote to Published".** Write the record to stored Published only after WordPress confirms the publish succeeded. If the publish fails or is pending, the record stays where it was. This keeps stored Published from ever containing a page the site lacks, so the mirror rule remains safe without special cases. Nothing to build now.

### 3.8 Temporary guard (ships with today's deploy)

**D13.** Until the rework lands, `POST /api/local/promote-live` refuses `category: "added"` with HTTP 409 and this message: "Updating stored Added data is temporarily disabled while the promote rules are being reworked. Published and Vendors are unaffected." Published and Vendors promotes keep their current merge behaviour in the meantime. Remove the guard when the rework ships.

---

## 4. Implementation plan

Each step is one Claude CLI dispatch with stop-and-report gates. Claude validates each report before the next dispatch is written. Claude CLI commits when its checks pass, never pushes, and commits UI and persistence changes only after the developer's browser check.

1. **Recon.** How the scraper handles fetch failures per target (products, protected products, vendors); what `$meta.missing` and `vendors_missing` contain today; how protected-vendor stubs appear in `vendors-live`; every code path that creates records in stored Added, Published and Vendors (to confirm nothing runs ahead of the site beyond D12); promote-live's current structure; and the `DeleteAddedModal.tsx` pattern to reuse.
2. **Scraper.** Distinct `$meta.missing` reasons; fetch errors recorded for all targets; `html.unescape` on REST titles. Verify with `py_compile`/pytest and an emulator run.
3. **Planner.** A pure function implementing §3.2–3.4 for all three categories, returning a plan with per-record actions and reasons. Test it standalone against fixtures for every row of every table.
4. **Promote route.** A dry-run mode returning the plan, and the real promote applying it in one transaction (D8), including password-row deletions (D5, D7). Remove the D13 guard here.
5. **Modal and messages.** The confirmation modal (D9) and the result lines in the Messages log.
6. **Emulator end-to-end test.** Fixtures covering every case (unlocked, rejected, no password, fetch error, not on site, now public, untracked, appended), across all three categories. Developer browser and screen-reader check of the modal.
7. **DECISION_LOG entry** recording D1–D13, with a forward pointer on the merge-rule entry it reverses.

---

## 5. Today's deploy plan (before the rework)

**What ships.** Ten local commits ahead of `origin/main` (`6dd8921`):
- four from 2026-09-04: `97fd4d9`, `723510a`, `74df9c7`, `626c556`;
- today's password and `.gcloudignore` commits: `09daa31`, `e1329f7`, `ab98bd3`, `2fdbc4d`, `a82da29`;
- the D13 guard commit, once made.

Only `nerd-frontend` needs a new revision. Nothing under `api/` or `Dockerfile.api` changed.

**Production state at recon time:**
- `nerd-frontend-00016-beq`, created 2026-09-04T19:32:36Z, serves 100% of traffic and also carries the `candidate` tag.
- No label records its source commit. By timestamp it was most likely built from `1fcded7`; this is inferred, not verified.

**Procedure.** Manual, frontend-only. `scripts/deploy.sh` is not used, because it redeploys `nerd-api`, runs `gcloud config set project`, and auto-promotes with `--to-latest`. Every command carries `--project=edtech-agent-2026` and, where applicable, `--region=us-central1`.

1. **Guard.** Add D13; emulator check that an Added promote is refused and a Published promote still works; commit.
2. **Push.** The developer pushes `main` to origin, so production does not run code that exists only locally.
3. **Build.** From `frontend/`, `gcloud builds submit --config cloudbuild.yaml` with the same substitutions `deploy.sh` uses (the two `NEXT_PUBLIC_FIREBASE_*` values plus `_REPO`). Record the image digest. `frontend/.gcloudignore` (`a82da29`) keeps `emulator-data/`, debug logs and `test-results/` out of the upload. `.env.local` was already excluded and remains so.
4. **Deploy with no traffic.** `gcloud run deploy nerd-frontend --image <repo>/nerd-frontend@sha256:<digest> --no-traffic --tag=candidate`, with **no env-var flags**: the six existing variables, the service account and public access are retained. Confirm immediately with `describe` that `00016-beq` still serves 100%.
5. **Check the candidate.** The developer tests at `https://candidate---nerd-frontend-meomhj23xq-uc.a.run.app`. That host is already a Firebase Auth authorized domain. Suggested first real use: enter Grammarly's and Nearpod's correct WordPress passwords.
6. **Promote.** `gcloud run services update-traffic nerd-frontend --to-revisions=<new revision>=100`, run only after the developer's OK.
7. **Rollback, if needed.** `gcloud run services update-traffic nerd-frontend --to-revisions=nerd-frontend-00016-beq=100`.

**After deploy:**
- Re-scrape (`scrape_ncademi_live.py --prod`) to confirm Grammarly and Nearpod unlock.
- Promoting Vendors and Published under the current merge rule remains safe; see the recon reports. Added stays blocked by the guard.

---

## 6. Open questions

- **Tracking rows on deletion.** When the mirror rule deletes a record that has a tracking row (today only the "Amplify" vendor and candidate records have them), should the tracking row be deleted too, consistent with D7 for passwords? *Proposed: yes; confirm.*
- **Message wording and ordering** in the Messages log for promote results: to be settled in step 5.
- **Promote order across categories.** Promoting Added before Published deletes the four now-public products from Added before Published holds them. Nothing is lost, since they remain in the published snapshot, but the modal should say "now public" so the order is understandable. *Proposed: no enforced order; rely on the reason text.*

---

## 7. Known, not addressed (carried forward)

**From the password work (DECISION_LOG #68):**
- **"Delete" leaves password rows behind** in the Added and Candidate editors. Today's orphaned "Be My Eyes" row, and the 12 password rows for products that are now only in Published, are cleanup candidates. The mirror rework's D7 covers deletions made by promote only.
- **Rows are keyed by `product_name`**, so renaming a product orphans its password and tracking rows.
- **`useUnsavedChangesGuard` does not cover the Password field.**
- **Pressing Escape while a password save is in flight** reverts the field, but the save still completes.
- **`frontend/lib/passwords.json` `$meta` text is stale.** It is local seed data.

**Elsewhere:**
- **`scripts/nerd_documents.py push` overwrites all 9 Firestore documents wholesale** from local files dated late August, with no backup. A production push would revert every edit since. It needs a safety guard (refuse when Firestore is newer, or require an explicit override), or retirement.
- **`nerd_documents.py`'s docstring usage text** shows `--project` after the subcommand. The script requires it before.
- **CLAUDE.md and AGENTS.md describe Next.js 15**; the repo runs Next 16.2.9.
- **Earlier Cloud Build source uploads may contain `emulator-data/`** (a Firestore export including passwords) and debug logs, if those existed at the time. The bucket is private to the project. This needs a read-only check of retained source archives (**UNVERIFIED**).
- **The `"Amplify Change"` tracking row matches no record.** Delete it, or rename it to the intended product.
