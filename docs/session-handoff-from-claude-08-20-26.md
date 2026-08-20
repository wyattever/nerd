NERD — Gemini CLI Session Handoff
Repo root: ~/nerd. Frontend: ~/nerd/frontend. Branch: main.
Full repomix available to you at session start — use it to confirm every
file/line reference below before editing; this handoff was written against
a repomix snapshot that may be seconds-to-minutes stale by the time you run.

ROLE: You are the execution agent. Monkey Boy is the sole approval gate for
every commit, push, and architectural decision. Claude (a separate session,
not present here) was architect/reviewer for everything below; nothing here
is a request for your own architectural judgment calls — those are already
made. Your job is mechanical: read the exact instructions, execute, verify
with real terminal output, stop at every gate.

STANDING RULES (apply to every phase below, no exceptions):
- State call count/scope as the first line of output before doing anything.
- One phase per dispatch cycle. Do NOT proceed past a STOP GATE without
  Monkey Boy's explicit go-ahead typed back to you.
- Maximum 2 self-directed fix attempts per distinct error. On persistent
  failure, STOP and paste the exact error plus what you tried — do not
  guess a third time.
- NEVER trust your own self-reported PASS/FAIL. Paste real terminal output
  for every verification step. "It should work now" is not verification.
- Use python3, never python. python3 -m pytest, never bare pytest.
  source venv312/bin/activate before any Python work (system Python 3.14
  via Homebrew lacks project packages).
- Anchor-based string replacement only — never line numbers, they drift.
  Prefer small python3 heredoc scripts with exact old_str/new_str blocks
  over sed for anything multi-line.
- Sequential edits only. One str_replace-equivalent operation at a time.
  Never parallelize file edits — this has silently dropped edits before
  while reporting success.
- .gitignore is a protected file. NEVER edit, comment out, or touch it.
  If you modify it by mistake, immediately run: git checkout -- .gitignore
- No commits without pasting `git diff --staged` for Monkey Boy to read
  first and receiving explicit approval. No pushes without separate
  explicit approval, even if the commit was just approved.
- Stage files explicitly by name. Never `git add -A` or `git add .`.

===========================================================================
CURRENT STATE — read this before touching anything
===========================================================================

Confirm this matches reality first:

    cd ~/nerd
    git status
    git log --oneline -5

Expected: working tree has ONE set of uncommitted changes — a fix already
applied to nerd_core/tools/liveness_validator.py (see Phase A, "already
applied" below) — and nothing else. If git status shows anything different
from that, STOP and report back before proceeding; do not assume Phase A's
edit is what's actually sitting there.

Recent history (already committed, already pushed, already verified — for
your context only, do not redo): the raw_markdown persistence fix
(CandidateRecord adoption on POST/PUT /admin/candidates), the /tables
read-only page, a full documentation pass (README.md rewrite,
NERD_System_Architecture.md refresh, DECISION_LOG.md entries #30-33), and
docs/next-development-steps.md + scripts/scrape_ncademi_directory.py added
to the repo. docs/next-development-steps.md is your backlog reference for
everything below — read it in full before Phase C.

KEY FINDING FROM THIS SESSION (already validated empirically, not a
hypothesis): next-development-steps.md's Tier 0 items 1 and 4 were
diagnosed as two separate bugs. They are the same bug. Empirically
confirmed: nerd_core/generators.py's parse_markdown_to_listing() correctly
extracts real ACR URLs from "Report Title:"/"Link:" pairs — tested directly
against GEM-instructions.txt's own few-shot example, works fine. The actual
failure is downstream: nerd_core/pipeline.py's build_listing() calls
is_likely_vpat_acr(url), which calls validate_link() in
nerd_core/tools/liveness_validator.py — the SAME function item 4 already
flagged as broken (no User-Agent header, broken relative-redirect
handling). A correctly-parsed ACR URL gets wiped back to "#" / "None found"
because the liveness check false-negatives on it, not because parsing
failed. adaptive_validation.py's adaptive_validate() (vets ALL vendor/other
resources, not just ACRs) also calls the same validate_link(). One fix in
liveness_validator.py closes three previously-separate-looking backlog
items: Tier 0 #1, Tier 0 #4, and the general "resources silently dropped"
pattern mentioned throughout docs/nerd-import-data-architecture-v4.md.

===========================================================================
PHASE A — Finish + test the liveness_validator.py fix (closes items 1 & 4)
===========================================================================

The fix itself is ALREADY APPLIED to nerd_core/tools/liveness_validator.py
(uncommitted). Confirm it matches this diff exactly before doing anything
else:

    git --no-pager diff nerd_core/tools/liveness_validator.py

Expected diff: adds `from urllib.parse import urljoin`; adds a
`_BROWSER_HEADERS` dict with a realistic Chrome User-Agent + Accept header,
passed to `httpx.AsyncClient(timeout=10.0, headers=_BROWSER_HEADERS)`; and
changes the redirect-follow branch from
`current_url = resp.headers.get("location")` to resolving via
`current_url = urljoin(current_url, location)`.

If the diff does NOT match this description, STOP and report — do not
proceed on an assumption that it's correct.

STEP A1 — Add regression coverage. There is currently ZERO test coverage
for the relative-redirect fix (the 3 existing tests in
tests/unit/test_liveness.py only cover 200/404/transport-failure, no
redirect at all). Add ONE new test to tests/unit/test_liveness.py, appended
after the existing test_transport_failure test, following the exact same
httpx_mock pattern as the file's other tests:

    @pytest.mark.asyncio
    async def test_relative_redirect_resolves(httpx_mock):
        # Reproduces the bug: a server issuing a relative Location header
        # (common on real VPAT/ACR hosts) used to break the follow-loop
        # entirely -- httpx.URL(current_url).host on a bare path resolves
        # to nothing, DNS lookup fails, and the link is wrongly reported
        # dead. Fixed via urllib.parse.urljoin.
        start_url = "https://example.com/vpat-redirect"
        final_url = "https://example.com/final-vpat.pdf"
        httpx_mock.add_response(
            url=start_url,
            status_code=302,
            headers={"location": "/final-vpat.pdf"},
        )
        httpx_mock.add_response(url=final_url, status_code=200)

        result = await validate_link(start_url)
        assert result.is_live is True
        assert result.status_code == 200

Do not modify the 3 existing tests. Do not add a test asserting on the
exact User-Agent string sent — that's an implementation detail worth
leaving unpinned; the redirect-resolution behavior is the load-bearing
regression to guard.

STEP A2 — Verify. Paste full output, not a summary:

    source venv312/bin/activate
    python3 -m pytest tests/unit/test_liveness.py -v
    python3 -m pytest tests/unit/test_pipeline_equivalence.py tests/integration/test_ingest_draft_api.py -v

All must show PASS. If test_relative_redirect_resolves fails, do not loosen
the assertion to make it pass -- the fix might be incomplete. Report the
exact failure and stop (2-attempt cap applies).

STEP A3 — Confirm no unrelated changes:

    git status --short

Should show exactly: modified nerd_core/tools/liveness_validator.py,
modified tests/unit/test_liveness.py. Nothing else.

STOP GATE A. Paste the diff, both test run outputs, and git status.
Do not stage or commit. Wait for Monkey Boy's explicit approval before
Phase B.

===========================================================================
PHASE B — Item 7: thread the resolved URL through (currently discarded)
===========================================================================

Do not start this phase until Phase A is committed and pushed with explicit
approval.

Root cause (verified against nerd_core/utils.py and
nerd_core/tools/liveness_validator.py): `ValidationResult` has no field for
the final resolved URL -- `validate_link()` follows redirects internally
(now correctly, after Phase A) but only ever returns the ORIGINAL input url
in `resolve_and_validate_url()`'s return tuple. Consequence:
grounding-api-redirect URLs and other redirect chains validate as "live"
but persist verbatim into stored listings instead of their real
destination -- this is the redirect backlog next-development-steps.md item
7 and item 8 describe.

STEP B1 -- nerd_core/tools/liveness_validator.py. Confirm the live file
first:

    grep -n "class ValidationResult" -A5 nerd_core/tools/liveness_validator.py

Add a `final_url: str` field to the `ValidationResult` dataclass (after
`is_live`, before `status_code` -- exact position doesn't matter, just
don't break existing positional usage; check for any positional
`ValidationResult(...)` construction across the codebase first with
`grep -rn "ValidationResult(" nerd_core/ tests/` and use keyword args if
any exist positionally, to avoid silently shifting fields). Every
`return ValidationResult(...)` call site in `validate_link()` needs a
`final_url=current_url` (or `final_url=url` for the earliest-return SSRF
and "too long"/"corrupted" paths, where no request was ever made -- use the
original `url` argument in `validate_link`, not the module-level function
parameter name if it differs -- check the actual parameter name in the live
file before writing this).

STEP B2 -- nerd_core/utils.py. `resolve_and_validate_url` currently does:

    result = await validate_link(url)
    return url, result.is_live, result.reason

Change the return to use `result.final_url` instead of the input `url`:

    return result.final_url, result.is_live, result.reason

STEP B3 -- Update/add tests. tests/unit/test_liveness.py's 3 existing tests
assert on `is_live`/`status_code` only -- check whether adding a required
`final_url` field breaks their construction anywhere (it shouldn't, since
they only read from `validate_link`'s return, not construct
ValidationResult directly -- confirm this by reading the file, don't
assume). Add one assertion to your new Phase-A redirect test confirming
`result.final_url == final_url` (the resolved destination, not the
original start_url). Check tests/unit/test_api_utils.py for any existing
resolve_and_validate_url tests and update/extend similarly if the file
exists -- grep for it first:

    grep -rln "resolve_and_validate_url" tests/

STEP B4 -- Verify:

    python3 -m pytest tests/unit/test_liveness.py tests/unit/test_api_utils.py tests/unit/test_pipeline_equivalence.py tests/integration/test_ingest_draft_api.py -v

STOP GATE B. Paste diffs for both files, the new/updated test assertions,
and full pytest output. Wait for explicit approval before Phase C.

===========================================================================
PHASE C — Item 6: restore ACR Version/Date/Auditor parsing
===========================================================================

Do not start until Phase B is committed and pushed with explicit approval.

Context, already verified -- do not re-litigate: nerd_core/generators.py's
ACRReport dataclass carries the comment
`# Metadata fields retained for structure, but no longer parsed from
markdown.` on version/date. This was a DELIBERATE prior cut, not an
oversight (per docs/nerd-import-data-architecture-v4.md §12.2). The
directory has a Version column, so this is real content loss on every
imported draft, but the ask here is specifically "reinstate parsing that
was deliberately removed" -- read the full git blame/history on that
comment line first if you can, to understand why it was cut, before adding
code back. If you find a reason in git history that argues against
restoring this, STOP and report that instead of proceeding.

GEM-instructions.txt's canonical ACR block format (verified, exact field
labels):

    ### ACR / VPAT
    Report Title: [Title of the ACR/VPAT document]
    Link: [Title (PDF)](URL) {confidence: 0.NN, why: "..."}
    Version: [VPAT version as printed, e.g. 2.5 -- omit if not stated]
    Date: [Report date as printed, e.g. July 2025 -- omit if not stated]
    Auditor: [Auditing organization name -- omit if not stated]
    Auditor URL: [Auditor's website -- omit if not stated]
    Preparation Type: [Internal or External]

STEP C1 -- nerd_core/generators.py, inside `parse_markdown_to_listing()`'s
`elif current_section == "acr":` branch. Confirm current exact code first:

    grep -n "elif current_section == \"acr\":" -A15 nerd_core/generators.py

Add parsing for the 5 metadata lines (Version, Date, Auditor, Auditor URL,
Preparation Type), each conditional on `data.acr_reports` being non-empty
(mirroring the existing `Link:` branch's guard), writing to
`data.acr_reports[-1].version` / `.date` / `.auditor_name` / `.auditor_url`
/ `.preparation_type` respectively. `Preparation Type` should map "Internal"
or "External" (case-insensitive match against the line value) -- default
stays "Internal" per the dataclass default if the line is malformed or
missing, do not raise. Watch the field-name collision: the line label is
"Auditor:" but the dataclass field is `auditor_name` -- do not create a
literal `auditor` field. "Auditor URL:" maps to `auditor_url`.

Remove the now-inaccurate comment
`# Metadata fields retained for structure, but no longer parsed from
markdown.` on the ACRReport dataclass (version/date ARE parsed again after
this change) -- but leave the dataclass fields themselves untouched.

STEP C2 -- Tests. Check tests/unit/test_generators.py for existing ACR
parsing tests and extend rather than duplicate:

    grep -n "acr\|ACR" tests/unit/test_generators.py

Add a test asserting a full ACR block (all 5 metadata lines present) parses
into an ACRReport with all fields populated, AND a second test confirming
a block with metadata lines OMITTED (matching the "omit if not stated"
spec) still parses cleanly with version="" date="" etc. (the dataclass
defaults), not an error.

STEP C3 -- Verify:

    python3 -m pytest tests/unit/test_generators.py tests/unit/test_pipeline_equivalence.py tests/integration/test_ingest_draft_api.py -v

STOP GATE C. Paste the diff and full test output. Wait for explicit
approval before committing.

===========================================================================
ITEMS CONFIRMED ALREADY RESOLVED -- NO ACTION, VERIFY ONLY
===========================================================================

- Item 14 (frontend/lib/api.ts deletion): the file no longer exists in the
  current tree -- confirmed via full-repo grep, zero hits. Just run
  `ls frontend/lib/api.ts` (expect "No such file or directory") and
  `grep -rn "lib/api" frontend/` (expect zero import references) to
  double-confirm, then mark this item done in your own tracking. Do not
  spend a phase on it.
- Item 3 (Copy HTML / Download HTML in Import Data): already confirmed in
  a prior session -- both buttons are gated by
  `state.status === "complete" && state.listing` in frontend/app/page.tsx,
  which Import Data's onProcessed callback does set via injectListing().
  No further action needed.

===========================================================================
OPTIONAL BONUS -- only if Monkey Boy explicitly asks for it, not by default
===========================================================================

Item 2, /healthz always 500s in production: api/main.py's healthz()
function builds a `checks` dict where `worker_url_configured` and
`tasks_sa_configured` are actual Python booleans
(`bool(WORKER_URL)`/`bool(TASKS_SA)`), but later code does
`any(v.startswith("error") for v in checks.values())` -- `.startswith()`
on a bool raises AttributeError. One-line-class fix: either exclude those
two keys from the `.startswith()` check, or convert them to strings when
building the dict. This is [UNRELATED] per next-development-steps.md's
tagging -- do not bundle it into Phases A/B/C above; treat as its own
single-file, single-commit phase if and when asked.