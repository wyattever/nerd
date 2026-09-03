# Session handoff — 2026-09-02

**From:** Claude (web) session with Monkey Boy
**Branch state:** `main` at `71f1de5`, pushed to `origin`. Working tree clean.
**Phases completed this session:** 1a (cleanup), 2 (persistence), 3 (auth).

---

## Where things actually stand

Phases 1a, 2, and 3 are done, merged to `main`, and pushed. Each was verified
live in a browser against the Firestore emulator, not just by typecheck and
build — that distinction earned its keep this session (see "Lessons" below).

### Commit trail

```
71f1de5  Merge branch 'cloud-migration-phase-3'
417756c  updated decision log with PHASE 3 COMPLETE
b173c13  docs: add Firebase/Next.js auth configuration research
e1851b6  phase 3: real Firebase session-cookie auth replaces the local-only gate
9271bfe  chore: remove orphaned doc-store.ts / firestore-admin.ts
7341eb0  Merge branch 'cloud-migration-phase-2'
d172a25  docs: log Decision #60, add Cloud Run Jobs + Firebase Hosting research
5b46330  fix: editor/records pages read from Firestore, not stale filesystem module
17b728d  phase 2: install Firestore persistence layer
c64187d  phase 2 infra: Firestore config, deny-all rules, seed script
9ff4033  docs: log Phase 1a/1b decisions, Firestore 1500-byte research, reconcile script
4474f74  phase 1a cleanup: dead research schemas, Cloud Tasks plumbing, AppSheet exports
```

Branches `cloud-migration-phase-2` and `cloud-migration-phase-3` are left in
place (not deleted), matching how phase-1 was handled.

### What works right now, verified live

- Real Google sign-in mints an HttpOnly Firebase session cookie server-side.
- Allowlisted account: signs in, loads editor data, saves successfully.
- Unlisted Google account: correctly denied with "This account is not
  authorized for N.E.R.D."
- ETag optimistic concurrency: single-tab save succeeds; a second tab holding
  a stale ETag gets a 412 rather than silently overwriting.
- Firestore emulator seeded with all 9 documents, `verify` reports every one
  byte-identical.

---

## Immediate next work, in priority order

### 1. Phase 4 — Python slim, scrape rehome, local-only deletion  ← START HERE

All three are one phase. The scrape rehome and the local-only module group
deletion were framed as "Phase 5" in an earlier dispatch; that was wrong. The
plan of record puts the scrape rehome in Phase 4
(`nerd-cloud-migration.md:124` phase map, `:785` Part C, and the stage-3 spec
`:120`), and Phase 5 is deploy only. Corrected 09-02 — see Decision #63.

#### Slim the Python service

Per the execution plan: `api/main.py` from **121 lines** (not the 373 the plan
predates — Phase 1a already cut it; verified in
`.scratch/verification/phase4-recon-20260903-1133-raw.md` at `71f1de5`, and see
Decision #64(c)) to roughly 40 — one route (`/ingest/draft`), no Firebase Admin,
no CORS middleware, no Cloud Tasks client, no `LOCAL_MODE`. Deploy
`--no-allow-unauthenticated` and grant the frontend's runtime SA
`roles/run.invoker`.

**Known trap — already resolved.** `api/job_store.py` no longer exists, and
`api/store.py:66-73` already carries the relocated Firestore client init
(`db = AsyncClient()`, guarded by `if not LOCAL_MODE:`) with an explanatory
comment. Nothing imports `job_store`; the only importer of `store` is
`api/main.py:20`. The "three-line move" was already done — no action pending.
(Recon at `71f1de5`; Decision #64(c).)

Also in scope: the dead Firestore TTL policy on `nerd_research_jobs`
in `scripts/deploy.sh` (references the already-deleted `api/job_store.py`).

**Out of Phase 4 scope — the single-renderer deletion.** Decision #57 (tagged
PROPOSED — delete `nerd_core/generators.py`'s render half, drop
`jinja2`/`markupsafe`) is a standalone, test-covered commit, not Phase 4 work:
`nerd-cloud-migration.md:786` and `:1115` both gate it, and Decision #64(a)
corrects #57's "Done in Phase 4" subtitle. Phase 4 diagnoses and reports only.
The recon already did that diagnosis and it holds. The *parser* half (lines
77-209) is the load-bearing asset and stays untouched; it is cleanly separable
from the render half (212-286) — `generators.py` is 285 lines total, not the
"large deletion diff" the plan assumed. Phase 4 recon is banked at
`.scratch/verification/phase4-recon-20260903-1133-raw.md` (at `71f1de5`).

#### The `published.json` build-time import — resolved

`lib/published-tables.ts:16` does `import data from "./published.json"` at build
time. Recon (`71f1de5`) settled it: this is dead Phase 2 residue, not a
deliberate editorial freeze. The module's runtime accessors have zero call
sites; all 26 importers use `import type`; all six editor/records "published"
route files read Firestore via `getPublishedProducts()`
(`lib/server/documents-read.ts:99`); a Firestore read and write path for the
`published` kind both exist.

**Decision (see #64(b)):** delete the static import and the module's unreachable
runtime half; keep the type exports (26 files depend on them).
`frontend/lib/published.json` the file is retained for now as the pre-migration
snapshot and is removed in the **same commit as the local-only module group**,
after the Firestore `published` copy is confirmed complete and byte-verified.

#### Rehome the scrape (blocked on two decisions)

**Unresolved decision A:** the scrape script reads password files from disk,
so after the filesystem removal the Next.js route must build and transmit a
password index to the Python service. This was flagged as a conscious
credential exposure requiring an explicit decision, and that decision has not
been made.

**Unresolved decision B:** swapping the scrape route's readers to
`documents-read.ts` replaces `notFound()` with `requireSessionUser()` →
`redirect("/login")`, thrown from inside a `ReadableStream` `start()` callback
(readers are invoked at route.ts line ~304). `redirect()` throws
`NEXT_REDIRECT`, and by the time `start()` runs the response headers are
already committed, so it likely tears the stream rather than redirecting.
Candidate fix: hoist the auth check to the top of `POST`, where
`assertLocalOnly()` currently sits at line ~229. UNVERIFIED — needs the route
actually run.

Do not start the scrape rehome without settling both.

Research is banked: `docs/cloud-run-jobs-architecture-09-02-26.md` covers the
Cloud Run Job model (unthrottled CPU, 10-minute default task timeout that
needs raising, `--max-retries=0` recommended since the scrape isn't
idempotent, and confirms the Firestore-polled-SSE progress pattern is our own
design rather than a documented Google one).

#### Delete the local-only module group

**Reclassified 09-02 from "latent production bug" to dead-code cleanup.**
See Decision #62. `lib/local-data.ts` has exactly one importer:
`app/api/local/scrape/route.ts`. No page or layout reads through it — the
editor vendors and candidates pages were migrated to
`lib/server/documents-read.ts` by commit `5b46330`, and
`lib/published-tables.ts` / `lib/directory-schema.ts` never imported it at all
(they matched an earlier grep only on comments). There is no production 404
risk.

The route's own `assertLocalOnly()` is the first statement of `POST` (line
~229) and returns before any `local-data.ts` function is reached, so the five
local-only gates inside `local-data.ts` are unreachable in deployment.

`local-data.ts`, `local-only.ts`, and `local-write.ts` share that single root.
Rehome the scrape route above and all three become unreachable together
and can be deleted in one commit. Do not migrate them separately.

This is not an addition to Phase 4's scope — the phase's own existing exit
criterion, `grep -rn "node:fs\|NERD_REPO_ROOT\|libDir" frontend/` returns
**zero** hits (correction C6), already forces `lib/local-write.ts` out: it is
the sole definer of `libDir()` and, with `local-data.ts`, the only remaining
`node:fs` user in the group. The three-module deletion is in scope by the
plan's own criteria, not by this handoff's say-so.

Surface audit is banked: all 12 `local-data.ts` exports have name-, signature-,
and shape-identical counterparts in `documents-read.ts`, which is a superset
(7 of 7 document kinds plus tracking, and it also reaches passwords). The swap
itself is mechanical; only decisions A and B above make it non-trivial.

### 2. Phase 5 — Deployment

`docs/firebase-hosting-header-passthrough-09-02-26.md` says the planned
architecture (classic `firebase.json` rewrites → existing Cloud Run service)
is the most predictable option for conditional requests. One risk to verify
empirically rather than trust: **CDN dynamic compression can downgrade a
strong ETag to weak (`W/` prefix)**, which strict `If-Match` validation would
reject — producing spurious 412s that look like concurrency conflicts. The
two-terminal concurrent-save test will surface it; check for a `W/` prefix to
distinguish it from a real conflict.

---

## Open items not blocking anything

- **`NEXT_PUBLIC_DISABLE_AUTH` still exists.** Phase 3's plan of record
  (`nerd-cloud-migration.md`, Phase 3 acceptance criteria; Decisions #54 and
  the stage-3 architecture spec) called for deleting the flag entirely. It was
  deferred with explicit approval during the Phase 3 dispatch — Decision #61
  records the deferral. It remains live at `lib/local-only.ts:25`, gating
  `/api/local/scrape` only. It is intentionally absent from
  `.env.local.example` and must never be set in a deployed environment. Goes
  with the module group in Phase 4. `NERD_CLOUD_DEMO_LOCAL_WRITE` and
  `isLocalOnlyAllowed()` are in exactly the same position — all three are still
  live in `lib/local-only.ts` (lines 21, 24, 25) and come out together. The
  deferred Phase 3 exit criteria covering them now sit in Phase 4's exit
  criteria block.
- **`billing_data` BigQuery dataset ownership** — the second of Decision #58's
  two "would reopen this" findings, never checked. If it belongs to a
  different workload, `edtech-agent-2026` is a shared project and the
  project-reuse decision deserves revisiting.
- **Orphaned user-managed key on `nerd-cli-admin`** — confirmed to exist
  (created 2026-07-01, non-expiring), but the SA holds *zero* project-level
  IAM roles. Whether it was created deliberately, and whether it's been
  distributed anywhere, is not answerable from IAM alone. Worth a decision.
- **Stale `.next/standalone/` build artifacts** in `frontend/` — contains old
  copies of source files. `next dev` doesn't read them, but they showed up in
  greps twice this session and could mislead a future search.
- **Claude CLI deny rule `Read(./docs/appsheet-export/**)`** — uses a relative
  path, so it false-positives on every recursive grep from `frontend/`,
  requiring manual approval each time. Worth checking whether the path even
  exists anymore (AppSheet data was deleted in `4474f74`); the fix may be
  deleting the rule rather than editing it.
- **Session handoffs live in three places** — `docs/reports/` (08-20, 09-02),
  and `~/Downloads/claude_session_files/` (08-28). The Downloads copy is the
  anomaly. Consolidate or accept.

---

## Lessons worth carrying forward

**Green builds proved nothing.** The Phase 2 read-path bug (Decision #60)
passed `tsc --noEmit`, `npm run build`, and `npm run lint` cleanly — because
the two modules had structurally identical exports. It was only caught by
clicking "save" in a browser and getting a 412. For any persistence or auth
migration, treat static verification as necessary but not sufficient, and
budget for live exercise of the actual write path.

**Delivered code can be internally consistent and still leave an integration
gap.** The 08-28 delivery installed a correct new reader module but nothing
forced the pre-existing pages consuming the *old* reader to be updated. When
installing a module that replaces another, grep for every importer of the old
one as part of the same pass.

**Substring greps produce false consumers.** The 09-02 "latent production bug"
was an artifact of a grep for `local-data` matching *comments* in six files
that had already been migrated. Match on import statements, not on the module
name appearing anywhere in the file.

**Claude CLI's escalations were consistently correct.** It caught: Phase 1a
being ~90% already done, the `deploy.sh` deletion boundary being incoherent
as specified, the `local-only.ts` deletion that would have broken the build,
the fact that the auth session route *was* delivered when the dispatch claimed
it wasn't, and a dispatch instruction to edit a handoff document that did not
exist. All five were genuine errors in the dispatches. The stop-and-report
gates are earning their cost — keep writing them in.

**Watch broad globs near this repo.** A `find . -name "*.bak" -delete` cleanup
swept up `frontend/lib/vendors.json.bak`, a legitimate committed migration
backup. Caught before staging, restored with `git checkout --`. Scope cleanup
commands to explicit paths.

---

## Environment notes

- **Java is now installed** (Homebrew openjdk 26, Apple Silicon) and on PATH
  via `~/.zshrc`. Required by the Firestore emulator; no sudo was available
  so the system JDK symlink was skipped — the PATH entry is what makes it work.
- **Firebase CLI** authenticated, project aliased as `prod` →
  `edtech-agent-2026` via `.firebaserc`.
- **Local dev model:** emulate Firestore, use **real** Firebase Auth. Do not
  set `FIREBASE_AUTH_EMULATOR_HOST` — the Auth emulator has documented
  session-cookie friction (`no "kid" claim`) and Auth has nothing local to
  corrupt.
- **`frontend/.env.local`** holds the real `NERD_ALLOWED_EMAILS` (four
  addresses: `wyattever@gmail.com` plus the three `@usu.edu` accounts).
  The committed `.env.local.example` has it empty by design.
- **Two terminals needed:** `firebase emulators:start --only firestore`, and
  `npm run dev` in `frontend/`. Kill any stale dev server first — one was
  holding port 3000 with stale env this session.
