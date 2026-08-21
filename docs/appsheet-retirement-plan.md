# AppSheet Retirement: Verification & Replacement Plan

**Status:** Phase 1 in progress
**Owner:** Monkey Boy
**Last updated:** 2026-08-21

## Purpose

AppSheet is being retired as N.E.R.D.'s source of truth for product,
vendor, ACR, resource, and support data. This document defines the two
phases required to do that safely:

- **Phase 1 — Verification.** Prove that every piece of content currently
  live on ncademi.org is captured somewhere in the recovered AppSheet
  snapshot, using the existing `/tables` viewer as the verification
  surface. AppSheet stays authoritative and untouched during this phase.
- **Phase 2 — Replacement.** Once Phase 1 is signed off, build a new,
  condensed viewer for Published/Added/Candidate product data, migrate
  editing workflows to it, and archive the AppSheet snapshot + `/tables`
  route.

Phase 2 does not start until Phase 1 is explicitly verified complete.
This is a hard gate, not a soft target.

---

## Background

N.E.R.D.'s seed data was recovered from AppSheet via DOM/CSV export
(2026-08-18/19 capture) into `frontend/lib/appsheet-tables.json`, rendered
read-only at `/tables`. That recovery captured the **Products, Vendors,
ACRs, Product Resources, Vendor Resources, Product Supports, and Vendor
Supports** tables. Per project convention, this snapshot is treated as
frozen historical record, not a live-editable dataset — see
`fix_appsheet_candidate_vendor.py` for the one sanctioned exception
pattern (resolving a known data-entry sentinel, not reshaping the data).

Separately, N.E.R.D. now has tooling to scrape the *live* ncademi.org
site into the same structured schema used internally
(`vendor_resources` / `other_resources` / `support_contacts` /
`acr_reports` / `last_updated`):

- `scripts/scrape_published.py` — scrapes only products marked
  `Status: Published` in the AppSheet export, using AppSheet as the URL
  source list.
- `scripts/scrape_ncademi_directory.py` — crawls the live directory index
  itself and scrapes every product page found there, independent of
  AppSheet's `Status` field.

Both write to `.scratch/verification/` with the same JSON shape, which is
what makes Phase 1 possible: AppSheet content and live content can now be
compared field-for-field.

---

## Phase 1 — Verification

### Goal

Demonstrate, with evidence, that 100% of live ncademi.org product/vendor
accessibility content is represented somewhere in the AppSheet snapshot
— and that this is checkable by looking at `/tables`, not by trusting an
assertion.

"Represented" does not mean "identical." Known drift (e.g. live ACR data
newer than what AppSheet captured) is expected and does not block
sign-off — see [What "verified" means](#what-verified-means) below.

### Inputs

| Source | What it is | Mutability |
|---|---|---|
| `frontend/lib/appsheet-tables.json` | Frozen AppSheet recovery snapshot | Read-only during Phase 1 |
| `.scratch/verification/ncademi_live_published_*.json` | Live scrape, AppSheet-scoped (`Status: Published` only) | Regenerated per run |
| `.scratch/verification/ncademi_live_all_products_*.json` | Live scrape, full directory crawl | Regenerated per run |

### Method

1. **Build the diff script** (next concrete deliverable — not yet built).
   For each product in the live-all-products scrape:
   - Match it to an AppSheet Products row by name (fuzzy-match fallback
     for known naming drift, e.g. "Blooket" vs AppSheet's "Blooklet"
     typo, "CommonLit" vs "CommonLit 360").
   - Diff `vendor_resources`, `other_resources`, `support_contacts`,
     `acr_reports` against the corresponding AppSheet ACRs / Product
     Resources / Product Supports rows (joined via the AppSheet row-key
     reference columns — `acrids`, `resourceids`, `supportids` — already
     present in the Products table).
   - Emit a per-product status: `match`, `live-only` (content live but
     absent from AppSheet), `appsheet-only` (recorded but not currently
     live — expected for unpublished/candidate content), or `conflict`
     (both present, values differ).
2. **Write a structured report** to `.scratch/verification/`, run-tagged,
   following the `.scratch/` convention: PASS/FAIL summary up top, raw
   comparison data below.
3. **Manually resolve every `live-only` finding.** This is the actual
   verification work — each one is either:
   - a genuine AppSheet gap (content was never captured) → add it to
     AppSheet, or
   - explainable (e.g. content published after the 2026-08-18/19 capture
     date) → note and accept.
4. **Re-run until zero unresolved `live-only` findings remain.**

### What "verified" means

Phase 1 is complete when:

- Every product currently live on ncademi.org has a corresponding row in
  the AppSheet Products table.
- Every live resource/support/ACR link has a corresponding row in the
  relevant AppSheet child table, OR is documented as a known,
  post-capture addition.
- The `/tables` viewer, searched by product name, can visually confirm
  each of the above for spot-checking — no data should exist live that
  can't be located in `/tables`.
- `conflict` findings (stale AppSheet values vs. live) are logged but do
  **not** block sign-off — those are Phase 2's problem to solve via the
  new viewer's edit workflow, not something to patch into the frozen
  snapshot.

### Known gaps already surfaced (from this session's spot-checks)

These are documented starting points for the diff script, not yet
resolved:

- **Grammarly, Nearpod** — marked `Status: Published` in AppSheet, but
  their live pages are password-protected (WordPress `post_password`
  form). Content is not publicly viewable despite AppSheet's status.
- **Google Forms** — marked `Status: Published`, but has no
  `NCADEMI Product URL` recorded in AppSheet at all.
- **Adobe Express** — live page has populated ACR (3 reports) and Support
  (2 contacts) data; the N.E.R.D.-generated preview iframe shown earlier
  in this project's session showed "None found" for ACR and no Support
  section at all. This is the clearest example of `conflict`-type drift
  Phase 1 is designed to catch.

### Tooling still needed

- The diff script itself (Section [Method](#method), step 1) — not yet
  written.
- A name-matching/aliasing table for known AppSheet-vs-live naming drift
  (Blooklet/Blooket, CommonLit/CommonLit 360, etc.) so the diff doesn't
  misreport genuine matches as gaps.

### Open judgment calls

- Whether `appsheet-only` entries (Candidate/Discussion/Needs
  Review-status products with no live page) need any verification at
  all, or whether Phase 1 scope is strictly "does live content exist in
  AppSheet," not the reverse.
- How to handle the mCLASS DIBELS-style Blooket third-party
  `psdschools.org` VPAT citation exceptions during automated diffing,
  given the excluded-source-domains rule — these should not be flagged
  as anomalies.

---

## Phase 2 — Replacement

### Trigger condition

Phase 1 sign-off: zero unresolved `live-only` findings, confirmed via the
diff report and spot-checked in `/tables`.

### Design principle

The new viewer is built against the **live-scrape schema**
(`vendor_resources` / `other_resources` / `support_contacts` /
`acr_reports`), not AppSheet's raw HTML-table export format. There is no
reason to inherit AppSheet's row/column shape once AppSheet is no longer
the source — the live schema is already what N.E.R.D.'s rendering
pipeline (`ncademiPreview.ts`, `nerd_core/pipeline.py`) consumes.

### Scope

1. **Viewer**: a condensed, per-product view (not a raw-HTML-table dump
   like `/tables`) for Published, Added, and Candidate product data,
   reading from whatever storage replaces the AppSheet JSON (Firestore,
   per the existing "Firestore backend needed before candidate edit/add
   can work at runtime" open item, or an interim structured JSON file).
2. **Editing**: retarget the existing `SectionEditor.tsx` pattern
   (dialog-based override editor, already wired for isOverridden/save/
   reset) at structured per-field edits instead of raw HTML blobs. The
   accessibility and sanitization guarantees already documented in that
   file (native `showModal()` focus behavior, DOMPurify sanitization at
   render time) carry over unchanged.
3. **ACR/Support/Resource rendering**: reuse `ncademiPreview.ts`
   generators as-is; only the data source changes.
4. **Migration**: convert the verified AppSheet snapshot into the new
   storage format as the initial seed data — this is a one-time,
   auditable transform, not an ongoing sync.

### Archive plan

Once the new viewer is live and confirmed to have full data parity:

- Move `frontend/lib/appsheet-tables.json` and
  `frontend/lib/appsheet-tables.ts` to an `archive/` path (or `.scratch/`,
  consistent with existing conventions for retired-but-referenceable
  material).
- Remove the `/tables` route from active navigation. Do not delete the
  code outright — keep it reachable for historical/debugging reference
  until confidence in the new viewer is well established.
- Update `Session_Handoff.md` and this document to reflect Phase 2
  completion.

### Explicitly out of scope for Phase 2 (for now)

- Firestore migration timing is a separate, already-tracked open item
  ("Firestore backend needed before candidate edit/add can work at
  runtime") — Phase 2 does not force that decision, it just designs the
  new viewer to be storage-agnostic enough to sit on top of either an
  interim JSON file or Firestore directly.
- Six AppSheet dashboard views not yet replicated (per existing project
  state notes) remain a separate backlog item, not bundled into this
  plan.

---

## Sequencing Summary

```
Phase 1                                    Phase 2
--------                                   --------
Build diff script                          (blocked until Phase 1 sign-off)
        ↓
Run diff: AppSheet vs. live-all-products
        ↓
Resolve every live-only finding
        ↓
Re-run until zero live-only findings   →   Design new viewer (live schema)
        ↓                                          ↓
Phase 1 SIGN-OFF                           Migrate seed data
                                                    ↓
                                            Retarget SectionEditor.tsx
                                                    ↓
                                            Archive AppSheet + /tables
```

---

## Appendix: File Reference

| Path | Purpose | Phase |
|---|---|---|
| `frontend/lib/appsheet-tables.json` | Frozen AppSheet snapshot | 1 (source of truth), 2 (archived) |
| `frontend/lib/appsheet-tables.ts` | Parsers/getters over the snapshot | 1, 2 (archived) |
| `/tables` route | Read-only raw-table viewer | 1 (verification surface), 2 (archived) |
| `scripts/scrape_published.py` | Live scrape, AppSheet-scoped | 1 |
| `scripts/scrape_ncademi_directory.py` | Live scrape, full directory | 1 |
| `.scratch/verification/` | Scrape outputs + diff reports | 1 |
| *(diff script — not yet built)* | Compares AppSheet vs. live scrapes | 1 |
| `frontend/components/SectionEditor.tsx` | Override-editing dialog | 2 (retargeted) |
| `nerd_core/pipeline.py`, `ncademiPreview.ts` | Rendering pipeline | 1, 2 (unchanged) |
