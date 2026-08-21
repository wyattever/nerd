# N.E.R.D. — Next Development Steps (Updated: MVP scope = Import Data only)

**Scope note, read first:** current MVP work is narrowed to importing Gemini-Gem-generated drafts via Import Data (`/ingest/draft`). "Generate Listing" — triggering a *new* live research run (`/research/initial`, `/research/deep-dive`, Cloud Tasks dispatch, the SSE streaming UI) — is explicitly **out of scope** for now.

This matters more than a simple in/out split, because `nerd_core/pipeline.py` is shared code by design — the v4 Import Data refactor deliberately extracted the parser/validator/ACR-check chain so both paths call the same functions. So every item below is tagged:

- **[IMPORT-PATH]** — reachable from `/ingest/draft`, still active and worth fixing now.
- **[GENERATE-ONLY]** — only reachable by triggering a new research run. Deferred with the feature.
- **[UNRELATED]** — proceeds on its own track regardless of this scope call (dashboard/data-layer work, dead code, ops hygiene).

Everything else from the original doc — priority framing, verification tags, sourcing — is unchanged; this pass only retags and re-sequences.

---

## Tier 0 — Live, verified-broken (fix first)

1. **[IMPORT-PATH] The ACR pipeline destroys every ACR the model finds.** `nerd_core/generators.py`'s `parse_markdown_to_listing` still hard-codes `url="#"` for every ACR, and `is_likely_vpat_acr("#")` then overwrites the title to "None found." This runs inside `validate_draft`, which `/ingest/draft` calls directly — **every pasted Gem draft with a real ACR hits this bug today.** Still top priority.

2. **[UNRELATED] `/healthz` always returns 500 in production.** Booleans passed to `.startswith()` in the health-check generator. Nothing to do with either research path — general ops correctness. Still worth a one-line fix, no urgency change.

3. **[IMPORT-PATH, unconfirmed] Copy HTML / Download HTML fail in production.** Both buttons fire whenever `state.status === "complete" && state.listing` is true in `frontend/app/page.tsx` — and Import Data's `onProcessed` callback hydrates exactly that state into the same editor surface a live research run would. **I have not confirmed** whether Import Data's flow actually surfaces these two buttons or a different action set — worth a two-minute check of `page.tsx`'s conditional rendering before deciding this is still Tier 0. Flagging rather than downgrading on an unconfirmed assumption.

4. **[IMPORT-PATH] Liveness validator has two false-negative sources** (relative-redirect `Location` header breaks the loop; no `User-Agent`, so bot-protected hosts 403). `adaptive_validate` — which uses this validator — runs inside `validate_draft` too. A pasted Gem draft can still have valid resources silently stripped. Still active.

## Tier 1 — Data integrity

5. **[IMPORT-PATH, now top priority given MVP focus] `raw_markdown` is destroyed on every candidate save.** This is arguably *the* Import Data bug now: the pasted Gem draft is the only record of that research, and saving via the UI silently discards it (`schemas.ListingData`'s `extra="ignore"`; `schemas.CandidateRecord` exists with the field, zero callers). For a live research run, the worker's auto-persist keeps a copy regardless of what the UI does — but for Import Data, once it's saved without this fix, **the source draft is gone**. Given the MVP is explicitly about importing Gem drafts, this should probably move above item 1 in actual build order — your call, flagging the reordering case rather than deciding it silently.

6. **[IMPORT-PATH] ACR `version`/`date` parsed only partially.** Directly hits every imported draft (directory has a Version column). Deliberate prior cut, not an oversight — check why before restoring, per the architecture doc's §12.2 note.

7. **[IMPORT-PATH, lower urgency than before] Redirect resolution is silently amputated at the root** (`resolve_and_validate_url` always returns the input URL, never the resolved destination). This was originally framed around live research output, but it's not exclusive to that path — a pasted Gem draft can itself contain `grounding-api-redirect` URLs if the Gem session used Search grounding, and Import Data's `resolve_and_validate_all`/`filter_broken_links` would hit the same amputated resolution. Still real, likely lower volume than the live-research path would produce, since Import Data is one paste at a time rather than a continuous research loop. Worth fixing eventually, not as urgent as items 1 and 5.

8. **[UNRELATED] 12 seed candidate files with unresolved redirects; 12 AppSheet-recovered researcher records missing row IDs.** Two different backlogs, neither tied to this scope question.

## Tier 2 — Dashboard / data-layer (NCADEMI Products directory viewer track)

Unaffected by the Generate-Listing-deferral — this is a separate initiative with its own architecture doc and phase-1 build spec already in progress.

9. **[UNRELATED]** Firestore backend for `/researcher` and the AppSheet review tables.
10. **[UNRELATED]** Fate of the 7 static AppSheet review-table HTML files.
11. **[UNRELATED]** 12 AppSheet records missing row IDs; low-confidence platform data.
12. **[UNRELATED]** Auth gate for `/users` — deferred per Decision Log #29 regardless of this conversation.
13. **[UNRELATED]** Dead CSS cleanup (`.nerd-clip`, stale `.nerd-table--wide` arithmetic).

## Tier 3 — Dead code

14. **[IMPORT-PATH] `frontend/lib/api.ts`** — already flagged for deletion in the Import Data architecture doc §7.3 as part of that feature's own build (`ImportDataModal.tsx` writes its own inline fetch instead). This is in-scope work, not backlog cleanup.
15. **[GENERATE-ONLY, now doubly dead] The entire deep-dive path** (`/research/deep-dive`, `worker_deep_dive`, `delta_system_prompt.j2`) — already had no frontend caller before this scope call; now further from being wired up than ever. No urgency at all.
16. **[GENERATE-ONLY] `/research/validate-links`** — no caller, tied to the live research UI's removed "Validate Links" button (Decision Log #25). Fully dormant.
17. **[UNRELATED]** `link_validator_engine.py`, `InvalidLinksModal.tsx`, stale `ai_insights` remnants, `scripts/migrate_to_firestore.py` retirement-status question — general cleanup, unaffected either way.

## Tier 4 — Testing gaps

18. **[IMPORT-PATH]** The Import Data feature's own test plan (architecture doc §8) — worth confirming which of those tests actually landed with the merge, given this is now the active feature.
19. **[GENERATE-ONLY]** `frontend/tests/e2e/live_run.spec.ts` and friends target the research-trigger flow specifically — no urgency to expand this suite right now.
20. **[UNRELATED]** Stale `ai_insights` unit-test failures, wrong import path in `tests/test_link_validator.py`, missing `httpx-sse`/`pytest-httpx` in requirements — general suite health, unaffected.

## Tier 5 — Ops / deploy hygiene

21. **[GENERATE-ONLY] `_enqueue_task`'s blocking gRPC call on the event loop.** Only fires for `/research/initial` and `/research/deep-dive` — Import Data's endpoint is synchronous per its own architecture doc and never touches Cloud Tasks. Fully dormant for now.
22. **[UNRELATED]** `deploy.sh`'s destructive `--set-env-vars`, no frontend promotion step, `/admin/batch-report` unauthenticated, doc drift on `--max-instances 1`'s justification. None of these care about this scope call.

## Strategic / horizon

23. **[GENERATE-ONLY, deprioritized] Gemini 2.5 Flash retirement (October 16, 2026 — confirmed still live, see the DOMPurify/Gemini research fact-check memo) and the Gemini 3.x structured-output/grounding question.** Neither matters right now: Import Data never calls the Gemini API — it parses an already-Gemini-Gem-generated markdown draft that the user pastes in. This whole thread only becomes urgent again once Generate Listing is back in scope. Worth a calendar note given the October date is real and close, but no action needed against the current MVP.

---

## Suggested sequencing (revised for current MVP scope)

1. **Item 5** (`raw_markdown`/`CandidateRecord`) — arguably ahead of item 1 now, given it's the direct core-value-loss bug for the feature currently being built. Flagged above as a re-ordering call, not decided unilaterally.
2. **Item 1** (ACR `url="#"`) — small, isolated, still a real bug hitting every imported ACR.
3. **Item 4** (liveness validator false negatives) — same category, still live on the import path.
4. **Item 3** — resolve the "does this even apply" question first, then act if it does.
5. **Item 6** (ACR version/date) — needs the "why was this cut" check before restoring, per the architecture doc.
6. **Item 7** (redirect resolution) — real but lower urgency than before; fine to schedule after the above.
7. **Item 14** (`lib/api.ts` deletion) — bundle into whichever Import Data commit already touches the fetch call sites.
8. **Tier 2** (dashboard track) proceeds independently, at whatever pace you're already running it.
9. **Items 15, 16, 19, 21, 23** — no action; revisit as a group if/when Generate Listing re-enters scope. Worth a single "re-scope check" pass at that time rather than tracking them individually until then.
