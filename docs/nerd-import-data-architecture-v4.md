# N.E.R.D. — "Import Data" Feature Architecture Guide (v4)

**Feature:** Paste a Gem-generated Markdown draft into the UI, validate and parse it through the production pipeline, and load the result into the existing editor surface for review before saving.

**Status:** Architecture definition, all decisions closed, core assumptions verified against live execution. Phases and gates come in a separate document.

**Baseline commit:** `1e14ce9` (pushed to `origin/main`). Working tree clean. This is the "pre-refactor" reference for the §8 equivalence test.

**Sources of truth**

- Code claims marked *(verified)* — checked against `repomix-output.xml` (154 files), extracted and read directly.  
- Claims marked *(measured)* — observed in a live dry-run inside `nerd-api-local` on 2026-08-06; raw output at `.scratch/verification/google-forms-dryrun-01.txt`. See §0.

**Changes from v3**

- New §0 records live verification results; several v3 assumptions are now measured rather than inferred, and two were wrong.  
- Labels finalised: row button `Import Data`, dialog button `Process Data`, component `ImportDataModal.tsx`.  
- File-import-and-temp-folder input path evaluated and rejected (§3.5).  
- The non-persisting endpoint decision was reversed and then reverted; the reasoning is recorded in §4.2 so it does not reopen a third time.  
- §6 now distinguishes *rejected but retained* from *dropped* — v3 conflated them, and live data shows the distinction matters.  
- §7.2 abort timeout is now grounded in a measured runtime.  
- §11 commit 1 gains the `patch("api.worker._validate")` hazard, which would otherwise produce a false regression signal.

---

## 0\. Live verification results *(measured)*

A real Gem draft (Google Forms, 23 lines, 8 URLs) was run through `scripts/ingest_ai_studio_draft.py --dry-run` inside `nerd-api-local`. This exercises the same `nerd_core` functions the new endpoint will call.

| Question | Result | Consequence |
| :---- | :---- | :---- |
| Does Gem output parse? | **Yes** — product name, vendor, website, description, 3 vendor resources, 3 other resources, 1 support contact, 1 ACR | Feature is viable; no parser work needed |
| Do `{confidence, why}` annotations survive? | **No** — 0.99 / 0.95 present after parse, `0.0` / `""` in the payload | **F8 proven live.** Stays in scope (§4.3) |
| Resources silently dropped by `adaptive_validate`? | **Zero** — all 6 survived | Silent loss is not the dominant failure mode on clean drafts |
| Did `is_likely_vpat_acr` reset the ACR? | **No** — accepted the Google VPAT PDF | The most damaging silent loss did not fire |
| Link-validation rejections | **1** — `https://docs.google.com/forms (Too many redirects)` | See below |
| URL count | **8** | `MAX_DRAFT_URLS = 100` is \~12× a realistic draft |
| Wall clock | **3.50s** | §4.2's synchronous endpoint holds; sets the §7.2 abort budget |
| ACR `Version: 2.5` / `Date: 2024-10-07` | **Dropped** (`version=""`, `date=""`); `preparation_type` **did** parse | ACR metadata gap is *partial*, not total (§10) |
| `raw_markdown` in the script's payload | **Present** — and *(verified)* would be stripped by `POST /admin/candidates` | F9 confirmed end to end (§10) |

### 0.1 The rejection was a false positive, and it was on the product URL

The single rejection was `product_website_url`, not a resource. It appears in `rejections` but remains in the payload unmodified — `docs.google.com/forms` redirects to a Google sign-in for an anonymous client, which is the F6 bot-protection class landing on the most important URL in the record.

Two consequences, both folded into this document:

1. **`rejections` and "things that were dropped" are different sets.** A rejection on a metadata URL is advisory; a drop on a resource is data loss. Reporting them identically trains the user to ignore both. §6 now separates them.  
2. **F6 moves up the §10 ordering.** With zero real resource loss in this sample and one false alarm on the product URL, the false-positive rate is currently a more likely source of user distrust than the silent-loss rate.

### 0.2 What was not tested

One draft, one product, one vendor. Nothing here establishes a rate — it establishes that the happy path works and that F8, F9, F6, and the ACR metadata gap are all real on live data. Malformed drafts, drafts with genuinely dead links, and drafts from other Gem sessions remain untested. The §8 test matrix stands regardless.

---

## 1\. Goal and scope

Bring an externally-generated Markdown draft (currently from a Gemini Gem) into N.E.R.D. through the exact same validation the worker pipeline runs, landing in the existing editor surface where it can be reviewed, edited, and saved as a candidate.

**In scope**

- One new button labelled `Import Data`, on the NCADEMI Candidate row  
- A modal containing a textarea for the pasted draft and a `Process Data` button  
- One new synchronous API endpoint that validates and parses a draft  
- Extraction of the shared validation pipeline into `nerd_core/`  
- Surfacing link-validation rejections and silent losses to the user  
- Preserving `confidence` and `justification` through the API boundary (F8)  
- WCAG 2.2 AA conformance for all new UI

**Out of scope**

- Changing, removing, or refactoring the Generate Listing / research path  
- File upload or server-side temp storage (§3.5)  
- `raw_markdown` persistence (F9), liveness User-Agent (F6), `final_url` (F7) — §10  
- Cap ordering, redundant resolution passes, semaphores — §9  
- Duplicate detection or merge; overwrite-by-slug is unchanged, manual deletion is the accepted workflow  
- Any mobile consideration

**Note on existing capability.** *(measured)* `scripts/ingest_ai_studio_draft.py` already performs draft-to-Candidate end to end. This build is ergonomics, not new capability. If the UI slips, the workflow is not blocked.

---

## 2\. UI placement specification

### 2.1 Current markup *(verified, `frontend/app/page.tsx`)*

**Do not use line numbers as anchors.** v1's cited ranges have already drifted. Use the string anchors below.

**Pattern A — Product URL row.** Anchor: the `<form onSubmit={handleSubmit}>` containing `id="product-url"`. A `<div className="flex gap-3">` with an input at `w-[55%]`, a `w-44` `bg-blue-700` submit (`Generate Listing` / `Processing...`), and a width-less `bg-[#bf1712]` `Stop`.

**Pattern B — Candidate row.** Anchor: the `<div className="flex gap-3 items-center">` containing `aria-label="Select NCADEMI Candidate"`. Contains a `<select>` at `w-[55%]` and a single `w-44` `bg-[#333]` button labelled `View Candidate`.

`Import Data` occupies the same structural slot on Pattern B that `Stop` occupies on Pattern A: a third flex child, appended after the existing `w-44` button, sized to content.

**Caution:** an identical `flex gap-3 items-center` wrapper appears on the NCADEMI **Products** row immediately above (anchor: `aria-label="Select NCADEMI Product"`, label `View Product`). Anchor any find/replace on the Candidate row's `aria-label` or its `View Candidate` label, never on the wrapper class.

### 2.2 Target markup

\<div className="flex gap-3 items-center"\>

  \<select aria-label="Select NCADEMI Candidate" ... className="w-\[55%\] ..." /\>

  \<button ... className="w-44 bg-\[\#333\] ..."\>

    View Candidate

  \</button\>

  \<button

    type="button"

    onClick={() \=\> setIsImportOpen(true)}

    disabled={state.status \=== "streaming"}

    className="bg-blue-700 text-white text-sm font-medium px-5 py-2 rounded

               hover:bg-blue-800 focus:outline-none focus:ring-2

               focus:ring-blue-500 focus:ring-offset-2

               disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"

  \>

    Import Data

  \</button\>

\</div\>

**Labels — decided.** `Import Data` on the row, `Process Data` in the dialog. Earlier candidates (`Add`, `Submit`, `Add Candidate`) were rejected: `Add Candidate` implies persistence that does not occur (§4.2), and `Submit` on a button that only opens a dialog is an expectation mismatch. `Import Data` describes bringing external content in; `Process Data` describes the transformation. Component filename tracks the visible label — `ImportDataModal.tsx` — so the two cannot drift.

**Colour: `bg-blue-700`.** `bg-[#333]` reads as "view / inspect" in the current vocabulary; this button performs a state change and belongs with `Generate Listing`.

**Disabled condition.** Disabled during `status === "streaming"` — importing mid-research would race the SSE result into `injectListing`. It must **not** depend on `selectedSlug`; unlike `View Candidate`, it does not operate on the dropdown selection.

---

## 3\. Component architecture

### 3.1 New component: `frontend/components/ImportDataModal.tsx`

Modelled on `SectionEditor.tsx`, the established modal pattern in this codebase. `SectionEditor` uses the native `<dialog>` with `showModal()`; `InvalidLinksModal` uses a `<div>` with manual focus management. The native-dialog approach is the better foundation and is already documented in-repo.

**Props**

interface Props {

  isOpen: boolean;

  onClose: () \=\> void;

  onProcessed: (result: IngestDraftResponse) \=\> void;

}

**Internal state**

- `draft: string`  
- `status: "idle" | "submitting" | "error"`  
- `error: string | null`

**Mount condition — load-bearing, not stylistic.**

{isImportOpen && (

  \<ImportDataModal isOpen={isImportOpen} onClose={...} onProcessed={...} /\>

)}

See §3.2. This mirrors how `SectionEditor` is already rendered *(verified: `{editingSection && state.listing && <SectionEditor key={...} .../>}`)*.

**Draft retention.** Do **not** clear `draft` on successful processing. The Gem output exists only in the clipboard, so a bad parse would otherwise cost a round trip back to the Gem to re-copy. State clears when the component unmounts on close, which is the user's explicit dismissal.

### 3.2 Accessibility

**Focus trap: deliberately not implemented.** `SectionEditor.tsx` carries an in-code note citing the W3C APA Working Group's conclusion that `showModal()`'s native behaviour — permitting Tab to reach browser chrome — is not a WCAG failure. WCAG's normative text makes no requirement about focus behaviour in dialogs, and `showModal()` marks the rest of the document `inert`, so focus cannot reach page content behind the dialog. Some secondary sources assert `<dialog>` "traps focus" outright; that is imprecise. The in-repo comment is accurate and must be preserved, not "corrected."

**Use `showModal()`, never `show()` and never the bare `open` attribute.** Only `showModal()` provides the top layer, backdrop, inert background, and Esc-to-close.

**Focus restoration.** `SectionEditor` captures the trigger element in a `useEffect(..., [])` and restores in that effect's cleanup. That works only because `page.tsx` mounts it conditionally, so mount/unmount coincides with open/close. An `isOpen`\-driven component mounted unconditionally would capture at page load with `document.activeElement === <body>`, and closing would drop focus at the top of the document — an SC 2.4.3 failure that no axe scan catches. Mount conditionally per §3.1.

**Required attributes and behaviours**

| Requirement | Implementation |
| :---- | :---- |
| Accessible name | `aria-labelledby` → `useId()` on the `<h2>` reading `Import Data` |
| Visible label on textarea | `<label htmlFor>` — visible text, not placeholder-only |
| Initial focus | `autofocus` on the textarea, or explicit `.focus()` after `showModal()` |
| Focus restoration | Trigger-element ref pattern from `SectionEditor`, with the mount condition above |
| Esc to close | Native, plus `onCancel` handler for dirty-check |
| Visible focus indicator | `focus:ring-2 focus:ring-offset-2` on all controls |
| Submit state announced | `aria-live="polite"` region inside the dialog, present in the DOM before it is populated |
| Error announced | `role="alert"` region inside the dialog |
| Reduced motion | No new animation introduced; do not add an unconditionally-animating spinner |
| Dirty-check on close | Confirmation when `draft` is non-empty and not yet processed, matching `SectionEditor.handleClose` |

**SC 4.1.3 is the item most likely to be missed.** Any region reporting status must exist in the DOM *before* content is inserted. Creating and populating in the same render will not announce reliably. This applies to the dialog's submit/error regions; the processing result itself is announced by the Messages log (§6).

### 3.3 State integration

*(verified)* `useResearch` exports `injectListing(data, message?)`, used today by `handleInject` and `handleInjectProduct`. The Import flow reuses it unchanged:

onProcessed(result) \=\>

  setProcessHeading("Imported Draft")

  setLocalLog(diagnosticLines(result))

  setIsDirty(false)

  setUnsavedSections(new Set())

  setIsProductLoaded(false)

  setActiveCandidateSlug(null)          // §3.4

  injectListing(result.parsed\_listing, "Loaded imported draft.")

*(verified)* `injectListing` sets `status: "complete"`, which gates the entire editor surface (`state.status === "complete" && state.listing`). Everything downstream — `ListingCard`, section editors, Copy/Download HTML, Save Candidate — becomes available with no further changes. **This is the main reason the feature is small.**

### 3.4 `activeCandidateSlug` — set `null`

*(verified)* `activeCandidateSlug` controls whether **Update Candidate** and **Delete Candidate** render. An imported draft has no persisted record, so those controls would operate on nothing. Null shows only *Save Candidate*, which POSTs and upserts by slugified `product_name` — the same behaviour `handleInjectProduct` already produces.

**Expected visual difference, not a bug:** the post-Import viewer shows `Save Candidate` only, while the post-dropdown-selection viewer shows all three. Setting the slug after a successful save is a follow-on (§9) requiring its own save-failure handling.

### 3.5 File import — evaluated and rejected

The Gem offers both Copy and Download, so `.md` files are available. A file-based input path was considered and rejected.

**Server-side temp storage is clearly wrong.** It requires an upload endpoint, multipart handling, a disk write, cleanup logic, and a filename/path attack surface — all to solve "get text from the user," which a textarea solves. It is worse than neutral on Cloud Run specifically: the container filesystem is in-memory tmpfs, so written files consume the instance's memory allocation and vanish on restart. That is persistence that does not persist.

**Client-side `FileReader` is defensible but unnecessary.** An `<input type="file" accept=".md,.txt">` reading into the same `draft` state is \~15 lines, adds no endpoint and no server-side file handling. It was dropped because the Gem's Copy button makes paste the native path, and a second input surface is a second thing to test for a11y. Recorded in §9 in case the workflow changes.

---

## 4\. Backend architecture

### 4.1 Pipeline extraction — `nerd_core/pipeline.py` (new)

#### Why extract

*(verified)* The validate-and-build sequence exists in two places:

- `api/worker.py` — `_validate()` \+ `_build_result_payload()`  
- `scripts/ingest_ai_studio_draft.py` — `validate_and_build()`, whose docstring states it "mirrors api/worker.py's `_validate` \+ `_build_result_payload` sequence exactly"

A third copy in `api/main.py` is not acceptable under SRD.

**Correction, carried forward.** v1 justified this by asserting the API service *cannot* import from `api/worker.py`. That is false and must not appear in any dispatch. *(verified)* `Dockerfile.api` does `COPY api/ api/`, `requirements.txt` carries `google-genai`, and `api/main.py` **already imports** `worker_initial` and `worker_deep_dive` under `LOCAL_MODE`.

The real reason is coupling: `api/worker.py` is a separate Cloud Run deployment with its own Dockerfile and `requirements-worker.txt`. Making the API's request path depend on it inverts the service boundary and drags `nerd_core.services` — and therefore Vertex/genai initialisation — into a route that never calls Gemini.

#### Why a single `validate_draft(markdown)` cannot work

*(all verified against `api/worker.py`)*

1. **`url_cache` is an output.** `_validate` mutates it in place; `_build_result_payload` puts it into `JobResultPayload`; the frontend round-trips it back on `POST /research/deep-dive` as `req.url_cache`. A markdown-only signature gives it nowhere to enter or leave, silently breaking deep-dive continuation.  
2. **`raw_urls` has no source.** In `worker.py` it is the second return value of `run_initial_research`; in the script it is regex-extracted from the draft. These are not the same set.  
3. **Deep-dive splits the sequence.** `worker_deep_dive` validates the *delta* then parses the *concatenation* (`req.current_draft + "\n\n" + validated_delta`). Steps 1–2 and 3–5 run over different strings.

#### Contract

\# nerd\_core/pipeline.py

\# Copied verbatim from scripts/ingest\_ai\_studio\_draft.py — the pattern verified

\# end-to-end on real Gem drafts. NOTE: nerd\_core/utils.py::extract\_known\_urls uses

\# a DIFFERENT, looser pattern (r'https?://\[^\\)\\s\]+') that captures trailing \] and "

\# characters. Consolidation is deliberately deferred — see §10.

\_URL\_RE \= re.compile(r'https?://\[^\\s\<\>"\\')\\\]\]+')

MAX\_DRAFT\_URLS \= 100

@dataclass

class DraftDiagnostics:

    parsed\_vendor\_count: int

    surviving\_vendor\_count: int

    parsed\_other\_count: int

    surviving\_other\_count: int

    dropped\_urls: list\[str\]        \# resources REMOVED by adaptive\_validate

    acr\_reset: bool

@dataclass

class DraftValidationResult:

    listing: gen.ListingData

    rejections: list\[str\]          \# links FLAGGED but retained in the draft

    url\_cache: dict\[str, str\]

    diagnostics: DraftDiagnostics

async def validate\_links(

    raw\_urls: list\[str\],

    draft\_markdown: str,

    url\_cache: dict\[str, str\],

) \-\> tuple\[str, list\[str\]\]:

    """Behavioural equivalent of api/worker.py::\_validate.

    Mutates url\_cache in place. Returns (validated\_markdown, rejections).

    """

async def build\_listing(

    validated\_markdown: str,

) \-\> tuple\[gen.ListingData, DraftDiagnostics\]:

    """Parse \+ adaptive\_validate \+ ACR check. Equivalent to \_build\_result\_payload

    minus JobResultPayload construction. No persistence, no HTTP, no job store.

    """

async def validate\_draft(

    draft\_markdown: str,

    raw\_urls: list\[str\] | None \= None,

    url\_cache: dict\[str, str\] | None \= None,

) \-\> DraftValidationResult:

    """Convenience wrapper for the single-input case: import path and script.

    When raw\_urls is None, extracts via \_URL\_RE and raises ValueError above

    MAX\_DRAFT\_URLS (§7.1).

    """

Sequence inside the wrapper, preserved exactly as `worker.py` runs it today:

1. `resolve_and_validate_all(raw_urls, url_cache)`  
2. `filter_broken_links(draft_markdown)` → `(validated_markdown, rejections)`  
3. `parse_markdown_to_listing(validated_markdown)`  
4. `adaptive_validate()` on `vendor_resources` and `other_resources`  
5. `is_likely_vpat_acr(acr_reports[0].url)` → on failure, rewrite to `url="#"`, `title="None found"`

| Caller | Calls |
| :---- | :---- |
| `worker_initial` | `validate_links(raw_urls, draft, url_cache)` → `build_listing(validated_md)` → wraps in `JobResultPayload` |
| `worker_deep_dive` | `validate_links(raw_urls, new_draft, url_cache)` → concatenates → `build_listing(full_validated_md)` |
| `POST /ingest/draft` | `validate_draft(req.draft_markdown)` |
| `scripts/ingest_ai_studio_draft.py` | `validate_draft(draft_markdown)` |

`DraftDiagnostics` is returned to every caller; `worker.py` ignores it for now and `JobResultPayload` is unchanged in this build.

**Regression surface.** The only part of the build touching the live research path. Verify by round-tripping a known draft through both old and new code paths and comparing serialised output — not by inspection. Baseline is `1e14ce9`.

**Ordering note (SRD).** *(verified)* Step 1's results are discarded: `resolve_and_validate_url` returns the input URL (F7), so `url_cache` never receives anything different, and `filter_broken_links` never consults the cache — so steps 1, 2 and 4 each re-validate the same URLs over the network. **Do not "optimise" this away during extraction.** Tracked in §9.

### 4.2 New endpoint — `POST /ingest/draft`

@app.post("/ingest/draft", response\_model=schemas.IngestDraftResponse)

async def ingest\_draft(

    req: schemas.IngestDraftRequest,

    uid: str \= Depends(verify\_token),

):

    try:

        result \= await validate\_draft(req.draft\_markdown)

    except ValueError as e:

        raise HTTPException(status\_code=422, detail=str(e))

    return schemas.IngestDraftResponse(

        parsed\_listing=dataclass\_to\_pydantic(result.listing),

        rejections=result.rejections,

        diagnostics=schemas.DraftDiagnostics(\*\*asdict(result.diagnostics)),

    )

#### The endpoint does not persist — settled, with the reasoning recorded

This decision was reversed mid-design and then reverted. Recording why, so it does not reopen.

**The case for auto-persisting** (proposed when the success behaviour was to open the new Candidate in the viewer): it reuses the verified `handleInject` path, sets `activeCandidateSlug` naturally, and — because *(verified)* `worker.py`'s auto-persist calls `store.upsert_candidate` directly with `raw_markdown` attached, bypassing the stripping endpoint — it would solve F9 for the import path for free.

**Why that was wrong.** §6 exists because the pipeline silently discards data. If the record is written before the user sees the diagnostics, "2 resources dropped, ACR reset to None found" is a post-mortem on a row already in Firestore. Surfacing loss *after* the write is most of the way back to the failure the diagnostics were meant to prevent. It would also make the import path the only place in the system where an automated parse lands in production data unreviewed — against the evidence-first discipline applied everywhere else.

**Settled behaviour:** validate and parse, return the listing, `injectListing` renders it in the editor surface, user reviews and presses the existing **Save Candidate**. The cost is that F9 is not solved for free; it stays the top item in §10.

| Decision | Rationale |
| :---- | :---- |
| Synchronous, not a job | *(measured)* 3.50s end to end. No SSE, no Cloud Tasks, no job store |
| Does not persist | Above |
| Auth required | `Depends(verify_token)`, matching every other admin route |
| Path `/ingest/draft` | Not under `/admin/` — does not touch the store; not under `/research/` — does not call Gemini |

**Schemas**

class IngestDraftRequest(BaseModel):

    draft\_markdown: str \= Field(min\_length=1, max\_length=102400)

    model\_config \= {"extra": "forbid"}

class DraftDiagnostics(BaseModel):

    parsed\_vendor\_count: int

    surviving\_vendor\_count: int

    parsed\_other\_count: int

    surviving\_other\_count: int

    dropped\_urls: list\[str\] \= Field(default\_factory=list)

    acr\_reset: bool \= False

class IngestDraftResponse(BaseModel):

    parsed\_listing: ListingData

    rejections: list\[str\] \= Field(default\_factory=list)

    diagnostics: DraftDiagnostics

`max_length=102400` matches the existing convention on `html_override` and `SectionOverrides`. `extra="forbid"` is deliberate even though `ListingData` lacks it (F10).

**Concurrency, correctly framed.** v1 claimed a synchronous ingest "occupies" the single pinned `nerd-api` instance. That is wrong: the pipeline is fully `await`\-based, the event loop is not blocked, and in-flight SSE streams keep flowing. The `--max-instances 1` pin is a deliberate architectural decision (in-memory `validation_jobs`) and this endpoint does not interact with it. The real exposure is fan-out — §7.1.

### 4.3 F8 — confidence preservation (in scope, proven live)

*(verified)* The parser extracts `{confidence, why}` via `_ANNOTATED_LINK_RE` and `_parse_confidence_annotation`. *(measured)* On the Google Forms draft: `0.99` and `0.95` present after parse.

*(verified, and measured)* Both converters in `api/conversions.py` drop them — `dataclass_to_pydantic` and `pydantic_to_dataclass` each construct `ResourceLink(url=..., text=...)` only, twice per function. The dry-run payload shows `"confidence": 0.0, "justification": ""` on all six resources.

**Fix — four constructions, two per function:**

gen.ResourceLink(url=r.url, text=r.text,

                 confidence=r.confidence, justification=r.justification)

schemas.ResourceLink(url=r.url, text=r.text,

                     confidence=r.confidence, justification=r.justification)

*(verified)* Both classes already declare `confidence: float = 0.0` and `justification: str = ""` — no schema change needed.

**`frontend/lib/types.ts`** *(verified)* declares only `url` and `text` on `ResourceLink`. At runtime extra keys survive `JSON.stringify` and are accepted on save, so the save path works without this change; the type is simply wrong. Add both as optional.

**Scope discipline:** F8 covers `ResourceLink` only. Do **not** extend to ACR metadata (`Version:`, `Date:`, `Auditor:`) — §10.

---

## 5\. Data flow

Gem output → Copy button → clipboard

        ↓  paste

ImportDataModal textarea ── draft\_markdown ──►  POST /ingest/draft

        │  \[Process Data\]                                ↓

        │                             nerd\_core.pipeline.validate\_draft()

        │                                extract raw\_urls  (≤100, else 422\)

        │                                validate\_links()

        │                                  resolve\_and\_validate\_all

        │                                  filter\_broken\_links   → rejections

        │                                build\_listing()

        │                                  parse\_markdown\_to\_listing

        │                                  adaptive\_validate     → dropped\_urls

        │                                  is\_likely\_vpat\_acr    → acr\_reset

        │                                               ↓

        │                        dataclass\_to\_pydantic (now carries confidence)

        │                                               ↓

        ◄──── { parsed\_listing, rejections, diagnostics } ┘

        ↓

onProcessed → injectListing(listing) \+ diagnostics into Messages log

        ↓                                    (modal closes; draft retained until unmount)

status: "complete" → existing editor surface renders

        ↓

USER REVIEWS — sees diagnostics, edits sections, or discards

        ↓

Save Candidate → POST /admin/candidates (existing) → Firestore nerd\_candidates

Nothing is written to Firestore until the user presses Save Candidate.

---

## 6\. Rejection and silent-loss surfacing

**The highest-value non-obvious requirement in the feature.**

### 6.1 Two categories, not one — corrected in v4

*(measured)* v3 treated `rejections` and dropped resources as one report. The live run showed why that fails: the only rejection was on `product_website_url`, which was **flagged but retained**, while zero resources were dropped. A user shown "1 link rejected" next to a listing where that link works fine learns to discount the message.

| Category | Mechanism | Effect on data | How to report |
| :---- | :---- | :---- | :---- |
| **Flagged, retained** | `filter_broken_links` appends `(Status: …)` and returns `rejections` | URL stays in the listing | Advisory — "verify this link" |
| **Dropped** | `adaptive_validate` **deletes** resources failing liveness | Resource is gone | Data loss — name the URL |
| **Reset** | `is_likely_vpat_acr` rewrites a real ACR to `url="#"`, `title="None found"` | ACR is gone | Data loss — most damaging |

The user is responsible for validating URLs — which is precisely why the app must not silently remove them. *(measured)* A 403 or redirect loop from a bot-protected host is a live false-positive source; `docs.google.com/forms` produced one on the first real draft tested.

### 6.2 Requirement

After processing, report:

- **Advisory:** each rejection string, labelled as flagged-not-removed  
- **Loss:** resources parsed vs. surviving per section, with dropped URLs named  
- **Loss:** whether the ACR was reset

Present these as distinct groups. Do not merge them into a single count.

### 6.3 Diagnostics are returned, not deferred

Shipping rejections-only reproduces the silent-loss failure in a new surface. `validate_draft`'s return shape changes anyway (§4.1), so `DraftDiagnostics` is near-free, and `build_listing` is the only place holding before/after counts. Computing them in `main.py` by re-calling `parse_markdown_to_listing` would duplicate pipeline knowledge in the route layer and is rejected.

### 6.4 Rendering target: the existing Messages log

*(verified)* `role="log"`, `aria-live="polite"`, `aria-atomic="false"`, `aria-label="System messages and progress log"`. Already exists, already announced, already in the DOM when `onProcessed` fires — so appending satisfies SC 4.1.3 with no new wiring. The modal closes on success.

A richer variant — keeping the modal open when something was lost — is better UX and is recorded in §9. It adds a second modal state, a processed-guard on the textarea, and a second announcement to sequence, for a path the log already covers correctly.

The dialog still needs its own `role="alert"` for submission failures (§3.2), separate from diagnostics.

---

## 7\. Security

| Concern | Handling |
| :---- | :---- |
| Endpoint auth | `Depends(verify_token)` |
| Request size | `max_length=102400`; Pydantic rejects oversize with 422 |
| SSRF via pasted URLs | *(verified)* Already handled — `liveness_validator.is_safe_ip()` resolves hostnames and blocks private/loopback/link-local/multicast before every request, including at each redirect hop |
| XSS | Pasted text is Markdown, parsed server-side into structured fields, never injected as HTML. `html_override` remains the only `dangerouslySetInnerHTML` surface and is DOMPurify-sanitised at the render site |
| Auth header on the new fetch | Required. F4 was exactly this on `/render` — omitted `Authorization`, got 401, wrote `undefined` to the clipboard with no `.catch`. Header, `.ok` check, and `.catch` from the first commit |
| Unbounded outbound fan-out | §7.1 |

### 7.1 Fan-out ceiling

*(verified)* `filter_broken_links` does `asyncio.gather` over every URL with **no semaphore**, each opening its own `httpx.AsyncClient` with a 10s timeout; `adaptive_validate._fast_pass` repeats over surviving resources. `max_length=102400` permits hundreds of URLs. Bounded on the research path by Gemini's output; on the import path, only by the clipboard.

**Decision: `MAX_DRAFT_URLS = 100`, raised as `ValueError` → 422\.** *(measured)* A realistic draft is 8 URLs, so 100 is \~12× headroom while capping worst case at 100 concurrent sockets. A semaphore in `nerd_core` is the better fix and benefits the research path too — deferred to §9 because it changes `nerd_core` behaviour in the same commit whose purpose is proving `nerd_core` behaviour unchanged.

### 7.2 Client-side abort

The fetch needs an `AbortController`. Without one, a hung validation leaves the modal in `submitting` indefinitely — which is what the `aria-live` region is reporting, so the user is told "processing" forever with no error and no exit but Esc.

*(measured)* 3.50s for an 8-URL draft. With a 10s per-URL timeout and unbounded concurrency, a pathological draft is bounded by roughly two sequential validation passes. **Recommend 60s** — comfortably above any legitimate draft, well below the point where the user assumes the app is dead. Judgment call; adjust once more drafts have been timed.

### 7.3 `frontend/lib/api.ts` — delete

*(verified)* Dead code, zero call sites, references `process.env.NEXT_PUBLIC_API_URL` while the application uses `NEXT_PUBLIC_API_BASE_URL`. Calling it would fetch from `undefined/ingest/draft`.

**Delete it. Write the new fetch inline, following the `handleInject` pattern.** Fixing the env var name produces two conventions, not one. The genuinely best end state — one helper with `.ok` checked everywhere, migrated across all of `page.tsx` — is six or seven call sites in the largest frontend file, which would turn a Medium-risk file into a High-risk one inside a feature build. Recorded in §10.

**Related, out of scope:** *(verified)* `handleInject` and `handleInjectProduct` both do `await res.json()` with no `.ok` check — the same F4 class, still live.

---

## 8\. Testing strategy

| Layer | Test |
| :---- | :---- |
| Unit — pipeline | `validate_draft` on the Google Forms fixture returns the listing, 1 rejection, 6 surviving resources, `acr_reset=False` — matching §0 exactly |
| Unit — pipeline equivalence | `validate_links` \+ `build_listing` produce output **identical** to the pre-refactor path at `1e14ce9`; compare serialised `JobResultPayload`. **Must not use `test_job_lifecycle.py`** — see §11 |
| Unit — deep-dive shape | `validate_links(delta)` \+ `build_listing(current + validated_delta)` reproduces `worker_deep_dive`'s pre-refactor output, including `url_cache` contents |
| Unit — conversions | `confidence` / `justification` survive both converter directions — *(measured)* currently proven to fail |
| Unit — fan-out ceiling | Draft with \>100 URLs → `ValueError` → 422 |
| Unit — diagnostics split | A draft where a resource is dropped **and** a metadata URL is flagged produces distinct `dropped_urls` and `rejections` |
| Integration — endpoint | Valid draft → 200 \+ populated listing; empty → 422; oversize → 422; \>100 URLs → 422; no auth → 401 |
| Regression — worker | Existing worker tests green; research path behaviour unchanged |
| E2E — Playwright | `Import Data` → paste fixture → `Process Data` → editor surface renders → Save Candidate → record present |
| E2E — focus | Close via Esc **and** via the close button; assert `document.activeElement` is the `Import Data` button in both cases |
| E2E — draft retention | Process, reopen the modal, confirm the draft is still there |
| Accessibility — axe | `@axe-core/playwright` with the dialog open; zero violations |
| Accessibility — manual | Keyboard-only: open, type, process, close, Esc. Screen reader: dialog name announced, diagnostics announced without focus change |

**Fixture:** `.scratch/fixtures/google-forms-gem-draft.md`, with expected values from §0. Note that `.scratch/` is now gitignored — the fixture must be copied into `tests/fixtures/` to be usable in CI.

**Note:** the axe scan will not catch the §3.2 focus-restoration failure. That is what the explicit E2E focus assertion is for.

---

## 9\. Optimizations — after the basic path works

None of these are bugs. All are improvements the minimal path chose not to take.

| Optimization | Why deferred |
| :---- | :---- |
| **Validate-then-cap instead of cap-then-validate.** *(verified)* `_rank_and_cap_resources(cap=5)` runs in the parser *before* liveness. Eight resources with three dead links in the top five yields two, while ranked \#6–\#7 were live and are unrecoverable | Changes `nerd_core` output; breaks the §8 equivalence test during the riskiest commit |
| **Semaphore in `nerd_core`** replacing the §7.1 ceiling | Same reason; do it once commit 1 is verified green |
| **Drop the redundant `resolve_and_validate_all` pass** — every URL is resolved three times; F7 makes step 1 pure waste | Behaviour-preservation is the hard constraint of this build |
| **Have `filter_broken_links` consult `url_cache`** instead of always re-resolving | Same |
| **Raise or configure the five-resource cap** — the live Adobe Acrobat listing publishes six vendor resources | Editorial decision; needs your call on the number |
| **Surface `confidence` in the editor UI** now that F8 preserves it | *(measured)* Real values are 0.95–0.99 and the Gem emits `why` strings — display work with a real consumer, but wait until values land |
| **Keep the modal open on loss** (§6.4 variant) — report where attention already is, close clean when nothing was lost | Second modal state \+ processed-guard \+ announcement sequencing |
| **Set `activeCandidateSlug` after a successful save** so Update/Delete appear | Needs its own save-failure handling |
| **Client-side `FileReader` input** (§3.5) — `<input type="file">` into the same `draft` state, \~15 lines, no backend change | Paste is the native path while the Gem offers Copy |

---

## 10\. Issues to address after import works

Pre-existing or adjacent. None block this build; all are real, and four are now confirmed on live data.

### Data integrity

- **`raw_markdown` dropped on save (F9)** — *(verified \+ measured)* the script's payload contains it; `POST /admin/candidates` accepts `schemas.ListingData` whose `extra="ignore"` silently discards it, and `store.py` does a full-replace `.set(data)`. `CandidateRecord(ListingData)` exists with the field and has zero callers. *(verified)* `worker.py`'s auto-persist attaches it by bypassing the endpoint, so research candidates keep provenance until the first UI save. **For Gem drafts this is unrecoverable** — the clipboard is the only record. Fix is one line (`data: schemas.CandidateRecord`) plus verification of read paths, `PUT`, and `/admin/products`. **Top of this list.**  
- **ACR metadata partially unparsed** — *(measured)* `Preparation Type` parses; `Version: 2.5` and `Date: 2024-10-07` are silently dropped. The directory has a Version column, so this is content loss on every imported draft.  
- **12 seed candidate files** still carry unresolved `grounding-api-redirect` markers.

### Correctness and robustness

- **Liveness false-negatives on bot-protected hosts (F6)** — *(measured)* `docs.google.com/forms` rejected as "Too many redirects" on the first real draft, on the product URL. **Raised in priority:** with zero real resource loss observed, the false-positive rate is currently the more likely source of user distrust.  
- **`resolve_and_validate_url` never returns `final_url` (F7)** — returns the input URL, which is why the `url_cache` pass is a no-op.  
- **`adaptive_validate` docstring** claims it preserves highest-confidence resources; it does `survivors[:cap]` with no sort, and the claim holds only because `_rank_and_cap_resources` sorted upstream. *(This corrects v2 §9.4, which wrongly described it as active unsorted truncation.)* Comment fix plus a note on the implicit coupling.  
- **URL-regex duplication** — `utils.extract_known_urls` uses a looser pattern than `pipeline._URL_RE` and captures trailing `]` and `"`. Consolidate after checking call sites.

### Frontend hygiene

- **`handleInject` / `handleInjectProduct` have no `.ok` check** — same class as F4, still live.  
- **`types.ts` declares `ai_insights: string` as required** *(verified)* while `api/schemas.py` removed it and `api/main.py` pops it on save. Harmless at runtime; the file is not trustworthy as a contract.  
- **Single fetch helper \+ migrate all `page.tsx` call sites** — the correct end state deferred in §7.3.

### Ops and security

- **`GET /admin/batch-report` is unauthenticated** *(verified)* — the only `/admin/` route without `Depends(verify_token)`. Check callers before adding it.  
- **`ListingData` lacks `extra="forbid"` (F10)** — root cause of F9's silent drop.  
- **Image / Dockerfile drift** — *(measured)* `/app/scripts/` in the running `nerd-api-local` container is fully populated, while `Dockerfile.api` in the snapshot copies only `prompts/`, `nerd_core/`, `api/`, and `templates/`. The running image contains more than the checked-in Dockerfile specifies. Worth reconciling before the next deploy.  
- **Test hygiene** — `tests/test_link_validator.py` fails collection on a stale import path.

### Strategic

- **Gemini 2.5 Flash retirement, October 2026\.**  
- **Gemini 3.x structured-output migration.** Highest-leverage item here: native structured output would remove `parse_markdown_to_listing` from the critical path entirely and retire the ACR-metadata gap, the confidence-annotation parsing, and much of the markdown-regex surface with it.

---

## 11\. Files touched and build sequencing

| File | Change | Risk |
| :---- | :---- | :---- |
| `nerd_core/pipeline.py` | **New** — `validate_links()`, `build_listing()`, `validate_draft()`, `DraftDiagnostics`, `DraftValidationResult`, `_URL_RE`, `MAX_DRAFT_URLS` | — |
| `api/worker.py` | Refactor `_validate` / `_build_result_payload` to call shared pipeline; **both** worker routes | **Highest** — live research path |
| `tests/integration/test_job_lifecycle.py` | Update patch target — **see below** | **Trap** |
| `scripts/ingest_ai_studio_draft.py` | Refactor to call `validate_draft` | Low |
| `api/schemas.py` | Add `IngestDraftRequest`, `IngestDraftResponse`, `DraftDiagnostics` | Low |
| `api/main.py` | Add `POST /ingest/draft` | Low |
| `api/conversions.py` | F8 — 4 constructions gain 2 kwargs each | Low |
| `frontend/lib/types.ts` | Add optional `confidence`, `justification` to `ResourceLink` | Low |
| `frontend/lib/api.ts` | **Delete** (§7.3) | Low |
| `frontend/components/ImportDataModal.tsx` | **New** | Low |
| `frontend/app/page.tsx` | `Import Data` button \+ **conditional** modal mount \+ `onProcessed` | Medium — large file, existing surface |
| `tests/…` | New unit \+ integration \+ E2E | — |

### 11.1 The `test_job_lifecycle.py` trap

*(verified, at `1e14ce9`)* the test patches:

patch("api.worker.\_validate", new\_callable=AsyncMock)

Commit 1 moves `_validate` out of `api/worker.py`. The moment it lands, `api.worker._validate` no longer exists, `patch()` raises `AttributeError`, and the test fails — **not because behaviour changed, but because the patch target moved.** That is precisely the false signal the equivalence test exists to rule out, in the one test that exercises the job lifecycle end to end.

**Update the target in the same commit as the extraction.** Prefer `patch("api.worker.validate_links")` — patching the name as bound in the worker's namespace preserves the test's intent ("the worker calls its validation step") and does not reach across the module boundary the extraction just established. `patch("nerd_core.pipeline.validate_links")` would patch at source and affect any caller.

**The §8 equivalence test cannot live in this file.** It needs its own fixture calling the real code path unmocked, since `test_job_lifecycle` mocks out the exact function whose behaviour is under test. v3 implied these were the same check. They are not.

### 11.2 Build order — three commits, gated

1. **`nerd_core/pipeline.py` \+ `api/worker.py` refactor \+ `test_job_lifecycle.py` patch target \+ equivalence tests.** Verified green and committed alone. The only part that can break something that currently works; bundling it with new-surface work makes a bisect meaningless. Baseline for comparison is `1e14ce9`.  
2. **`api/schemas.py` \+ `api/main.py` endpoint \+ `api/conversions.py` (F8) \+ `frontend/lib/types.ts` \+ script refactor.** Backend path complete and testable via curl before any UI exists. Re-run the §0 dry-run and confirm `confidence` is now non-zero in the payload — that is the F8 acceptance test.  
3. **`ImportDataModal.tsx` \+ `page.tsx` wiring \+ `lib/api.ts` deletion \+ E2E.**

Do not begin commit 2 until commit 1's equivalence and worker-regression tests are green against real terminal output.

## 12. Addendum — post-v4 review notes

Reviewed against `repomix-output.xml` after v4 was closed. No architectural decision changes. Three items to fold in before Commit 2.

### 12.1 §4.2 — exception path for `POST /ingest/draft` is unspecified

*(verified)* The endpoint sketch only catches `ValueError` (the `MAX_DRAFT_URLS` case) → 422. `validate_draft` → `validate_links` → `resolve_and_validate_all` / `filter_broken_links` make live network calls (`httpx.AsyncClient`, 10s timeout each). A timeout, connection error, or any other exception from that path is currently uncaught at the route and falls through to FastAPI's default 500 handler.

This differs from the worker's handling of the same calls: `worker_initial`/`worker_deep_dive` wrap the whole pipeline in `except Exception` and call `fail_job`. `POST /ingest/draft` has no equivalent job to fail, but it also shouldn't hand the client a bare unstructured 500.

**Add to §4.2's endpoint contract:**

    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.exception("Draft ingest failed")
        raise HTTPException(status_code=502, detail="Draft validation failed — see server logs.")

502 rather than 500: the failure is downstream (link validation hitting the network), not a bug in the route itself. Judgment call — 500 is also defensible if you want to keep the semantic reserved for actual server bugs.

**Add to §8 (Testing strategy):** Integration test — mock `resolve_and_validate_all` to raise, confirm 502 and a logged traceback, not an unhandled exception.

### 12.2 §10 — correction to the ACR metadata framing

*(verified, `nerd_core/generators.py`)* `ACRReport`'s dataclass definition carries an in-repo comment: `# Metadata fields retained for structure, but no longer parsed from markdown.` This applies to `version` and `date`.

§10 currently frames this as unparsed/dropped without noting that the fields were deliberately taken out of the parser at some prior point — this is not an oversight resurfacing, it's a prior intentional cut whose consequence is now visible on the import path. Doesn't change the finding (content loss on every imported draft, directory has a Version column) or its priority. Matters only for whoever picks up the fix later: the work is "reinstate parsing that was deliberately removed," which should prompt a check of *why* it was removed before re-adding it — not a blind "fix the bug."

**Reword §10's bullet from:**
> ACR metadata partially unparsed — Preparation Type parses; Version: 2.5 and Date: 2024-10-07 are silently dropped.

**to:**
> ACR metadata partially unparsed by design — Preparation Type parses; Version and Date are not extracted, per an explicit in-code note that this was deliberately descoped from the parser. Directory has a Version column, so this is still content loss on every imported draft; re-enabling it requires checking why it was cut before restoring it.

### 12.3 §7.1 / §7.2 — flagging both numbers as single-sample extrapolations

*(measured)* Both `MAX_DRAFT_URLS = 100` and the recommended 60s abort timeout are derived from one data point: the Google Forms draft (8 URLs, 3.50s). §0.2 already disclaims the sample size for correctness findings (F6/F8/F9/ACR gap); the same disclaimer should extend to these two constants, since they're being set as hard limits off the same run.

No proposed change to either number — 100 and 60s are still reasonable headroom. Just recommend the two lines in §7.1 and §7.2 explicitly cross-reference §0.2 rather than reading as independently-derived, so a future reader doesn't mistake "measured" for "measured across a representative sample." Revisit both once a handful of real Gem drafts (ideally including one with a genuinely dead link and one over 15–20 URLs) have been timed.