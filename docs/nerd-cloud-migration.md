# N.E.R.D. Cloud Migration — Unified Plan (Phases 0–6)

**Status:** Canonical. Supersedes `nerd-cloud-migration-phase-0.md` and `nerd-cloud-migration-phases-1-6.md`. Both should be moved to `docs/superseded/` once this document is accepted.

**Validated against:** repomix snapshot regenerated 2026-08-28 for all file paths, function names, and line counts. Cloud Run and Firebase Hosting timeout limits verified against Google Cloud documentation on 2026-08-28.

**Why this document exists.** The two prior documents published two different phase maps. The Phase 0 document defined phases 0–5; the Phases 1–6 document inserted a new subtraction phase at position 1 and shifted everything after it by one, without correcting the Phase 0 document's forward references. A reader following the two in sequence would provision against one numbering scheme and execute against another. This document reconciles them into a single map and folds in the corrections listed below.

---

## 1. Reconciliation record

Everything in this section is a change from the two superseded documents. It is recorded so the changes are auditable rather than silent.

### 1.1 Corrections to the phase map and its cross-references

| ID | Correction |
|---|---|
| C1 | Phase numbering unified to 0–6. The Phase 0 document's map (0–5) is retired. Every phase from the old "Phase 1" onward shifts up by one to make room for Subtraction at position 1. |
| C2 | Eleven stale forward references in the Phase 0 document corrected: the three user accounts are needed by Phase **3** (not 2); the Firestore Rules allowlisting note belongs to Phase **3** (not 2); the Firebase Web app values are build args for Phase **5** (not 4); the budget alert precedes Phase **5** (not 4); the DNS record inventory is consumed by Phase **5** (not 4); the app first becomes publicly reachable in Phase **5** (not 4); code-only phases are **1–4** (not 1–3); the local-only escape valves are replaced in Phase **3** (not 2); the SSE/Hosting carried-forward constraint lands in Phase **4** (not 3); the JSON migration is Phase **6** (not 5); the "do not proceed to Phase 1" gate is replaced by the dependency graph in §5. |
| C3 | "Six JSON documents" is **nine**: `published`, `added`, `candidate`, `vendors`, `published-live`, `added-live`, `vendors-live`, `tracking`, `passwords`. The Phase 0 count predates the discovery of `tracking.json` and never included `passwords.json`. Cost posture corrected accordingly. |
| C4 | "A second scale-to-zero Cloud Run service" is **three deployable resources**: the `nerd-frontend` service, the `nerd-api` service, and the `nerd-scrape` **Job**. The Job is not a service and does not appear in the Phase 0 architecture summary or cost posture at all. |
| C5 | Phase 4's exit criteria contradicted Phase 4's own Part A. The criteria listed "the scrape endpoint" as remaining in `api/main.py`; Part C makes the scrape a Cloud Run **Job entrypoint**, not an HTTP route. Corrected: `api/main.py` retains `/ingest/draft` and `/healthz` only. |
| C6 | Phase 2's exit criterion permits `node:fs` to survive in `app/api/local/scrape/route.ts`. Phase 4 rewrites that route and removes the child process, so `node:fs` should reach zero. Added as a Phase 4 exit criterion; it was previously asserted by neither phase. |
| C7 | Phase 0 D0.3 recorded two `NEXT_PUBLIC_*` values; Phase 5 needs four. All four are now recorded in Phase 0. |
| C8 | Phase 0 D0.6's role list omitted the permissions Phase 5 actually exercises: Cloud Build, Artifact Registry push, and Cloud Run **Jobs** creation. Extended. |
| C9 | Firestore TTL policy for `nerd_scrape_jobs` is assumed by Phase 4 and created by no phase. Added to Phase 5. |

### 1.2 Substantive additions

| ID | Addition |
|---|---|
| A1 | **The 60-second Hosting ceiling applies to the Import Data path, not just the scrape.** The prior documents treat the Hosting timeout as a scrape-only problem. It is not. Every browser-facing request traverses Hosting, including the Next.js Route Handler that proxies `/ingest/draft`. That endpoint performs link-liveness checks over plain HTTP; a handful of slow or unresponsive hosts will exceed 60 seconds and return a 504 that no amount of `--timeout` on `nerd-api` can prevent. Phase 4 now requires a measured worst case and a hard per-request budget. |
| A2 | **Triggering the Cloud Run Job and minting the OIDC token do not require a new frontend dependency.** Phase 4 asks Next.js to mint a Google OIDC identity token and to trigger a Cloud Run Job execution, and Phase 3 forbids adding dependencies. The apparent conflict resolves: on Cloud Run, both an OIDC identity token and an OAuth access token are retrievable from the instance metadata server with plain `fetch()`. No client library, no transitive-dependency reliance. Local development needs a documented fallback, spelled out in Phase 4. |
| A3 | **`passwords.json` becomes a Firestore document containing credentials as a raw string.** This is defensible — the Admin SDK is the only reader and the Rules are deny-all — but it is a change in the exposure surface that neither prior document acknowledged. Flagged in §17 as a judgment call requiring a DECISION_LOG entry. |

### 1.3 Disposition of the external architecture evaluation

An external agent evaluated an earlier architecture proposal against Google Cloud reference material. Its findings are recorded here with their disposition so they are not reintroduced.

| Its recommendation | Its verdict | Disposition here |
|---|---|---|
| Unify frontend and backend behind an External Managed Global Application Load Balancer with serverless NEGs | Confirmed viable | **Superseded, not refuted.** The problem it solved — `run.app` public-suffix cookie limits and CORS — ceases to exist once the Python service is called server-side with an OIDC token and no browser origin touches it. Firebase Hosting rewrites provide the single origin at zero cost and zero compute-API surface. Recorded as a standing exclusion in §6. |
| Delegate long-running work to Cloud Tasks | Partially confirmed; could not validate Cloud Run timeout limits | **Superseded.** Cloud Tasks is deleted in Phase 1. Cloud Run Jobs replace it and are a better fit: a Job runs independently of any request and is not subject to Cloud Run's post-response CPU throttling. The timeout numbers it could not validate are now established in §4 and were the trigger for addition A1. |
| Deploy to `us-central1` rather than `us-west3` | Confirmed | **Adopted; already in force.** Not revisited. |
| Pass `NEXT_PUBLIC_*` at container build time | Could not validate — out of corpus | **No change.** The inability to validate reflects the evaluator's GCP-only source corpus, not doubt about the behavior. Next.js inlines `NEXT_PUBLIC_*` at build time; the plan already passes all four as `--build-arg` and Phase 5 verifies it. |
| Replace `EventSource` with `fetch()` + `ReadableStream` to carry a Bearer token | Could not validate — out of corpus | **Superseded.** Phase 4 removes SSE from the codebase entirely. Phase 4's exit criteria assert zero hits for `EventSource`, `text/event-stream`, and `ReadableStreamDefaultReader`. |

**Reading of the evaluation as a whole.** It is competent and its confirmations are accurate, but it was run against a pre-subtraction architecture. Three of its five items validate machinery this plan deletes. That is not a defect in the evaluation; it is a staleness problem, and it is the second one this migration has produced. Both prior documents drifted the same way. Treat any cold-context second opinion as valid only against the snapshot it was given, and state the snapshot when commissioning one.

---

## 2. Target architecture

```
                     idbygeorge.com
                           │
                  Firebase Hosting (CDN, managed SSL, single origin)
                           │  rewrite "**"
                           ▼
                  Cloud Run: nerd-frontend
                  (Next.js standalone, --allow-unauthenticated,
                   Firebase Auth session cookie enforced in proxy.ts)
                           │
             ┌─────────────┼──────────────────┐
             │             │                  │
             ▼             ▼                  ▼
        Firestore     Cloud Run:         Cloud Run Job:
     nerd_documents    nerd-api           nerd-scrape
     nerd_scrape_jobs  (--no-allow-       (same image as nerd-api,
                        unauthenticated,   different command;
                        OIDC from          writes progress to
                        frontend SA)       nerd_scrape_jobs)
```

Three deployable resources. Two services, one job. No load balancer, no Cloud Tasks queue, no Secret Manager, no BigQuery, no Vertex AI.

---

## 3. Placeholder tokens

Substitute once at the top of each CLI prompt.

| Token | Meaning | Example |
|---|---|---|
| `PROJECT_ID` | New GCP/Firebase project ID | `nerd-idbg-prod` |
| `BILLING_ACCOUNT_ID` | Billing account to link | `01FFAA-543A74-3BE52F` |
| `REGION` | All regional resources | `us-central1` |
| `REPO_NAME` | Artifact Registry repo | `nerd-repo` |
| `DOMAIN` | Public domain | `idbygeorge.com` |

**Region decision:** `us-central1` for everything. Tier 1 Cloud Run pricing, Firestore Native regional support, and it matches the existing `edtech-agent-2026` setup so no habits change. Independently confirmed by external evaluation. Not revisiting this.

---

## 4. The timeout budget — established numbers

These were the load-bearing unknowns in the prior documents. They are now established rather than assumed, because two phases depend on them.

| Limit | Value | Source |
|---|---|---|
| Firebase Hosting request timeout | **60 seconds**, returns HTTP 504 beyond it. Not configurable. | Firebase Hosting documentation |
| Cloud Run service request timeout | Default 300 s, maximum 3600 s | Cloud Run documentation |
| Cloud Run Job task timeout | Default 10 min, maximum 168 hours | Cloud Run documentation |
| Streaming through Hosting rewrites | Not supported | Firebase Hosting documentation |

**The consequence, stated plainly.** Firebase Hosting's 60 seconds is the binding constraint for *every browser-facing request*, and Cloud Run's larger allowance cannot relieve it. Anything a user waits on must complete in under 60 seconds or be restructured as start-and-poll. This governs two paths, not one:

1. **The live scrape** — one to two minutes by its own route handler's documentation. Restructured as a Cloud Run Job with Firestore-backed polling in Phase 4. This was correctly identified in the prior documents.
2. **Import Data / `/ingest/draft`** — duration unmeasured, and it performs link-liveness checks over plain HTTP against arbitrary third-party hosts. This was *not* identified in the prior documents. Phase 4 now requires it to be measured and bounded.

Setting `--timeout 900` on `nerd-api` (Phase 5) is harmless headroom for direct service-to-service calls, but it must not be mistaken for a 900-second user-facing budget. The user-facing budget is ~50 seconds, leaving margin under the Hosting ceiling.

---

## 5. Canonical phase map and dependency graph

| Phase | Scope | Owner | Reversible? |
|---|---|---|---|
| **0** | GCP project, billing, Firebase, Firestore, Artifact Registry | Developer (interactive) + CLI | n/a — provisioning |
| **1** | Delete the research/worker and AppSheet layers | CLI | Yes — pure subtraction |
| **2** | Port all filesystem persistence to Firestore | CLI | Yes — behind unchanged interfaces |
| **3** | Replace the local-only gate and the forgeable session cookie with real Firebase Auth | CLI | Yes |
| **4** | Slim the Python service; rehome the scrape as a polled Job; bound the ingest path | CLI | Yes |
| **5** | Build, deploy, wire Firebase Hosting, attach the domain | CLI + Developer (DNS) | **First irreversible step** |
| **6** | Migrate the nine JSON documents into Firestore; cut over | CLI + Developer (verification) | Data migration — back up first |

**Dependencies, not a strict sequence.** The prior Phase 0 document instructed "do not proceed to Phase 1 until Phase 0 exits." That is stricter than necessary and delays code work behind a console session. The actual dependencies:

- **Phase 1 depends on nothing.** It is pure deletion against the local repo and can run before, during, or after Phase 0.
- **Phase 2 depends on Phase 0** — it needs a real Firestore instance to test against — **and on Phase 1**, which reduces the surface it must port.
- **Phase 3 depends on Phase 2** (`firebase-admin` arrives there) and on Phase 0 D0.4 (real user identities to test against).
- **Phase 4 depends on Phase 2** (Firestore job state) and Phase 3 (server-side session helper).
- **Phase 5 depends on all of 0–4.**
- **Phase 6 depends on Phase 5.**

Phases 1–4 are code-only and fully testable locally. Nothing is publicly reachable until Phase 5. Each phase still ends at a stop-and-report gate; the gates are unchanged, only the ordering freedom between Phase 0 and Phase 1 is relaxed.

---

## 6. Standing constraints and deliberate exclusions

Recorded so they are not reintroduced by accident, and so a future cold-context reviewer does not "discover" them as improvements.

- **No Global Load Balancer, no serverless NEGs, no URL maps, no compute API.** Firebase Hosting rewrites are the single origin. An external evaluation confirmed a GLB would also work; it is excluded because the cross-origin problem it solves does not survive Phase 4, and it adds cost and surface for nothing. If you find yourself reaching for `gcloud compute`, stop.
- **No Cloud Tasks queue.** The worker and research orchestration are deleted in Phase 1. Nothing enqueues. Cloud Run Jobs cover the one long-running workload.
- **No Secret Manager.** With Generate Listing removed, `/ingest/draft` needs no API key — it parses pasted markdown and checks link liveness over plain HTTP.
- **No BigQuery / telemetry dataset.** `nerd_core/telemetry.py`'s only caller is `services.py`, which is deleted.
- **No `NEXT_PUBLIC_DISABLE_AUTH` and no `NERD_CLOUD_DEMO_LOCAL_WRITE` in any deployed configuration**, ever. Both are local-only escape valves. Phase 3 replaces the gate they widen rather than carrying either forward.
- **No roles, permissions model, or role hierarchy.** Three known users, all public-domain data. Authenticated-or-not is the entire authorization model.
- **WCAG 2.2 AA is a hard requirement, not a nice-to-have.** The single most easily-missed item in this migration is the ARIA live region wiring for status updates. Converting the scrape from SSE to polling changes *how updates arrive*, not the obligation: polled status transitions must still be announced through a live region (SC 4.1.3), and errors through `role="alert"`. Phase 4 requires the CLI to name the specific element it wired.
- **Desktop/web only.** Mobile browsers, mobile OS backgrounding, and mobile reconnection behavior are out of scope for every decision in this document.
- **SRD: Simple, Reliable, DRY.** Correct ordering is paramount; each process finishes before the next starts. Process speed is explicitly unimportant.

---

## 7. Cost posture

Cloud Run is not available on the Spark plan, so the project must be on Blaze with a linked billing account. Blaze retains the same free quotas as Spark; the difference is that overage bills rather than hard-stopping.

Expected steady-state spend for three users is **$0**, with this headroom:

- **Cloud Run services:** 2,000,000 requests, 180,000 vCPU-seconds, 360,000 GiB-seconds per month free.
- **Cloud Run Jobs:** `nerd-scrape` bills vCPU-seconds against the same free tier. A one-to-two-minute run invoked manually a few times a week is negligible against 180,000 vCPU-seconds. It was omitted from the prior cost posture entirely; it is not a material line item, but it should be counted rather than forgotten.
- **Firestore:** 1 GiB storage, 50,000 reads/day, 20,000 writes/day, 10 GiB egress/month free. Nine documents, the largest (`published-live`) at 128 KB. Total is well under a megabyte; every document is comfortably inside Firestore's ~1 MiB per-document limit.
- **Firebase Hosting:** CDN, custom domain, and managed SSL at no charge on the free quota.

**The one line item that will not be zero: Artifact Registry.** The free allowance is 0.5 GB, and a Next.js standalone image plus a Python image will exceed that within a few revisions. Expect single-digit cents per month. Task C0.5 adds a cleanup policy to keep it there.

**Developer action:** set a Cloud Billing budget alert at $5/month before Phase 5. Blaze does not stop at the quota; the alert is the only guardrail.

---

## 8. The persistence surface

This is what Phase 2 has to cover. Every item was read from the current snapshot, not estimated.

**Tier 1 — ETag/If-Match guarded.** Four documents behind `local-write.ts`'s closed `DataKind` union (`published`, `added`, `candidate`, `vendors`). Read via `readPublishedRaw()`, written via `writePublishedAtomic()`. ETag is SHA-256 of the exact bytes on disk.

**Tier 2 — live scrape snapshots, read-only in the app.** `published-live.json`, `added-live.json`, `vendors-live.json`. Read by three functions in `local-data.ts` (`getPublishedLiveProducts`, `getAddedLiveProducts`, `getLiveVendors`) and by two route handlers (`published-live/route.ts`, `vendors-live/route.ts`), all calling `fs.readFile` directly against `libDir()`. Written only by `scripts/scrape_ncademi_live.py`.

**Tier 3 — unguarded read-modify-write.** `tracking.json` (via `readTrackingRecords`/`writeTrackingRecords` in `local-write.ts`) and `passwords.json` (via `passwords/route.ts`). Both deliberately outside the ETag system, both documented as safe under single-operator assumptions.

**Tier 4 — rolling backups.** `backupThenWrite()` and `backupThenDelete()` maintain exactly one `${path}.bak` per target, used by `promote-live/route.ts` for the "Update Stored Data" flow.

**Path resolution.** Everything routes through `libDir()`, which returns `NERD_REPO_ROOT/frontend/lib` when that env var is set and `process.cwd()/lib` otherwise. The env var exists because `.next/standalone/server.js` calls `process.chdir(__dirname)`, which the code comments document as having caused a real production bug — a deleted product reappearing because the delete only ever reached the standalone build's copy.

**In a container there is no repo root.** `libDir()` cannot be made correct by configuration; it has to stop existing. That is the whole of Phase 2.

---

## 9. Firestore data model

Two collections.

### `nerd_documents`

One document per logical file. Document ID is the bare filename without extension: `published`, `added`, `candidate`, `vendors`, `published-live`, `added-live`, `vendors-live`, `tracking`, `passwords`.

| Field | Type | Purpose |
|---|---|---|
| `content` | string | The raw JSON text, byte-for-byte as it would have been on disk |
| `sha256` | string | SHA-256 of `content` encoded UTF-8 — the ETag |
| `updated_at` | timestamp | Server timestamp |

Backups live as sibling documents with a `__bak` suffix (`published__bak`), same shape.

**Why store the raw JSON as a string rather than a native Firestore map.** Three reasons, in order of weight:

1. The ETag contract is SHA-256 *of the exact bytes*. Any parse-and-reserialize round trip risks key reordering or whitespace normalization changing the hash, producing spurious 412s that are miserable to debug. Storing the bytes preserves the contract exactly.
2. The documents use `$schema_version` and `$meta` as top-level keys. Storing as a string sidesteps every question about Firestore field-name handling.
3. Nothing queries into these documents. Every reader loads the whole array and filters in memory — `local-data.ts` and `passwords/route.ts` both document this as the intended pattern. There is no query capability being given up.

**Concurrency becomes stronger, not weaker.** Today's flow reads the file, hashes it, compares to `If-Match`, then writes — with a time-of-check-to-time-of-use window between read and write. A Firestore transaction that re-reads `sha256` inside the transaction and aborts on mismatch closes that window. The client contract (`If-Match` header, 412 on mismatch) stays byte-identical, so no UI code changes.

### `nerd_scrape_jobs`

Job state for the polled scrape, introduced in Phase 4. One document per run, with `status`, `stage`, `messages[]`, `error`, and an `expires_at` timestamp field. A Firestore TTL policy on `expires_at` reaps old runs; that policy is created in Phase 5 (correction C9).

---

## 10. Phase 0 — Provisioning

Phase 0 is a prerequisite for Phase 2 and everything after it. It is **not** a prerequisite for Phase 1, which can proceed in parallel.

### Developer tasks (interactive — cannot be delegated to the CLI)

These require browser sessions, billing consent, or identity federation.

#### D0.1 — Create the project

```
gcloud auth login
gcloud projects create PROJECT_ID --name="N.E.R.D."
gcloud config set project PROJECT_ID
```

Project IDs are globally unique and permanent. Pick deliberately.

#### D0.2 — Link billing and confirm Blaze

```
gcloud billing projects link PROJECT_ID --billing-account=BILLING_ACCOUNT_ID
```

Then confirm in the Firebase console that the project shows **Blaze** after D0.3. Linking a Cloud Billing account is what promotes a Firebase project from Spark to Blaze.

#### D0.3 — Add Firebase to the project

Firebase console → **Add project** → select the existing `PROJECT_ID` rather than creating a new one. This is a console-only flow; there is no reliable CLI equivalent for importing an existing GCP project.

Then register a **Web app** and record **all four** of the following. Phase 5 passes every one as a Docker build arg, because Next.js inlines `NEXT_PUBLIC_*` at build time and no runtime env var can override them. (Correction C7 — the prior document recorded only the first two.)

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` — normally `PROJECT_ID.firebaseapp.com`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID` — equal to `PROJECT_ID`

#### D0.4 — Configure Authentication

Firebase console → **Authentication** → **Get started**.

- Enable the sign-in providers you want. Google sign-in is the least friction for three USU accounts; Email/Password is the fallback.
- Under **Settings → Authorized domains**, add `DOMAIN` and `www.DOMAIN`. Leave the default `PROJECT_ID.firebaseapp.com` and `PROJECT_ID.web.app` entries in place — Phase 5 verifies against those before the custom domain is live.
- Create or invite the three user accounts now, so **Phase 3** has real identities to test against.

**Note for Phase 3:** with three known users and public-domain data, allowlisting by UID or email domain in Firestore Security Rules is sufficient. Do not plan for role hierarchies.

#### D0.5 — Confirm where `DOMAIN` is registered

Determine which GCP project currently holds the `DOMAIN` registration (Cloud Domains) and whether its DNS is served by Cloud DNS or elsewhere. Record:

- Registering project ID
- Current nameservers
- Current A/AAAA/CNAME records at the apex and `www`

**Phase 5** needs this. If the domain currently points at anything live, note that too — the cutover will replace it.

#### D0.6 — Grant the CLI account its roles

The account the Claude CLI authenticates as needs, at minimum:

`roles/serviceusage.serviceUsageAdmin`, `roles/datastore.owner`, `roles/artifactregistry.admin`, `roles/run.admin`, `roles/iam.serviceAccountAdmin`, `roles/iam.serviceAccountUser`, `roles/firebasehosting.admin`, `roles/cloudbuild.builds.editor`, and `roles/storage.admin`.

The last two are correction C8: Phase 5 builds images with Cloud Build, which stages to a GCS bucket, and creates a Cloud Run **Job** in addition to two services. `roles/run.admin` covers job creation; the build roles were missing.

For a single-developer MVP, granting `roles/owner` to your own account is simpler and equivalent in practice. That is a deliberate MVP call, not an oversight — revisit it if the project ever gains contributors.

### CLI prompt — Phase 0

```
You are provisioning Phase 0 of the N.E.R.D. cloud migration. This phase is
infrastructure only. Do not touch any application code, do not create or modify
any file in the repository, and do not deploy anything.

Substitutions for this run:
  PROJECT_ID = <fill in>
  REGION     = us-central1
  REPO_NAME  = nerd-repo

Preconditions. Verify all of these before doing anything else. If any fails,
stop and report which one and the exact command output.

  1. gcloud config get-value project        -> must equal PROJECT_ID
  2. gcloud auth list                       -> an active account is present
  3. gcloud billing projects describe PROJECT_ID
                                            -> billingEnabled must be true

Task C0.1 - Enable APIs.

  gcloud services enable \
    run.googleapis.com \
    firestore.googleapis.com \
    artifactregistry.googleapis.com \
    cloudbuild.googleapis.com \
    firebase.googleapis.com \
    firebasehosting.googleapis.com \
    identitytoolkit.googleapis.com \
    iam.googleapis.com \
    --project=PROJECT_ID

  Do not add APIs beyond this list. Cloud Tasks, Secret Manager, Vertex AI,
  BigQuery, and Compute Engine are deliberately excluded - the research and
  worker layers are being removed, and there is no load balancer in this
  architecture. Cloud Run Jobs are served by run.googleapis.com; no additional
  API is needed for them.

Task C0.2 - Create the Firestore database.

  gcloud firestore databases create \
    --database="(default)" \
    --location=REGION \
    --type=firestore-native \
    --project=PROJECT_ID

  If this returns an ALREADY_EXISTS error, do not attempt to delete or
  recreate. Stop and report.

Task C0.3 - Create the Artifact Registry repository.

  gcloud artifacts repositories create REPO_NAME \
    --repository-format=docker \
    --location=REGION \
    --description="N.E.R.D. container images" \
    --project=PROJECT_ID

Task C0.4 - Configure Docker authentication.

  gcloud auth configure-docker REGION-docker.pkg.dev

Task C0.5 - Add an image cleanup policy.

  Artifact Registry's free allowance is 0.5 GB and these images will exceed it.
  Create a policy that keeps the 3 most recent versions per package and deletes
  older ones. Write the policy JSON to /tmp/ar-cleanup.json, apply it with
  gcloud artifacts repositories set-cleanup-policies, and then read the policy
  back to confirm it applied. Report the exact JSON you used.

  If the flag name or JSON schema for cleanup policies does not match what you
  expect, do not guess. Run the command with --help, read the actual syntax,
  and use that. If it still does not work, stop and report - a few cents per
  month of untracked storage is an acceptable temporary state, a wrong
  destructive policy is not.

Verification gate. Run each of these and paste the raw, unedited output. Do not
summarize.

  gcloud services list --enabled --project=PROJECT_ID \
    --format="value(config.name)" | sort

  gcloud firestore databases describe --database="(default)" \
    --project=PROJECT_ID --format="value(type,locationId)"

  gcloud artifacts repositories describe REPO_NAME \
    --location=REGION --project=PROJECT_ID \
    --format="value(name,format)"

  gcloud artifacts repositories describe REPO_NAME \
    --location=REGION --project=PROJECT_ID \
    --format="value(cleanupPolicies)"

Then produce a PASS/FAIL table with one row per task C0.1 through C0.5, where
each verdict cites the specific line of raw output that supports it. A task is
PASS only if the verification output proves it, not because the creating
command exited zero.

Stop after the gate. Do not begin any other phase.
```

### Phase 0 exit criteria

- [ ] `gcloud services list --enabled` shows all eight APIs from C0.1
- [ ] Firestore `(default)` reports type `FIRESTORE_NATIVE` and location `us-central1`
- [ ] Artifact Registry `REPO_NAME` exists, format `DOCKER`, in `us-central1`
- [ ] Firebase console shows the project on the **Blaze** plan
- [ ] A Web app is registered and **all four** `NEXT_PUBLIC_*` values are recorded
- [ ] At least one Auth provider is enabled and the three user accounts exist
- [ ] `DOMAIN` and `www.DOMAIN` are in Authorized domains
- [ ] `DOMAIN`'s registering project and current DNS records are recorded
- [ ] A $5/month budget alert is configured on `BILLING_ACCOUNT_ID`

**Gate meaning:** Phase 2 may not begin until every box is checked. Phase 1 is not gated on this.

---

## 11. Phase 1 — Subtraction

Removes the research orchestration (constraint: no Generate Listing, ever) and the AppSheet layer (constraint: AppSheet data is not retained). Pure deletion, so every later phase has less surface to touch.

### CLI prompt — Phase 1

```
You are executing Phase 1 of the N.E.R.D. cloud migration: deletion only.
Add no features. Refactor nothing beyond what deletion forces. Do not touch
persistence, auth, or deployment.

Step 1 - Read-only inventory. Before deleting anything, produce a report and
STOP. Do not proceed to Step 2 until I have reviewed it.

  For each path below, report: does it exist, how many lines, and which files
  in the repo import or reference it (use grep across the whole repo, including
  tests and docs).

    api/worker.py
    api/job_store.py
    api/appsheet_parser.py
    nerd_core/services.py
    nerd_core/telemetry.py
    frontend/hooks/useResearch.ts
    frontend/lib/appsheet-tables.ts
    frontend/lib/appsheet-tables.json
    frontend/app/api/local/migrate-appsheet/route.ts
    Dockerfile.worker
    requirements-worker.txt
    prompts/system_prompt.j2

  Also report:
    - Every file under frontend/app/tables/
    - Every component whose name contains "Appsheet" or "AppSheet"
    - Every test file referencing any of the above
    - Every import of `store` or `job_store` in api/

  Do not delete anything in this step.

Step 2 - After I approve the inventory, delete in this order, committing after
each group, and running the full test suite between groups:

  Group A: frontend/hooks/useResearch.ts and its call sites.
  Group B: api/worker.py, api/job_store.py, nerd_core/services.py,
           nerd_core/telemetry.py, Dockerfile.worker, requirements-worker.txt,
           prompts/system_prompt.j2 and its delta file.
  Group C: The AppSheet layer - api/appsheet_parser.py,
           frontend/lib/appsheet-tables.{ts,json},
           frontend/app/api/local/migrate-appsheet/route.ts,
           frontend/app/tables/, the Appsheet table component, and their tests.
  Group D: In api/main.py, remove these routes and only these routes:
           /research/initial, /jobs/{job_id}, /render,
           /research/validate-links, /admin/batch-report, and every
           /admin/candidates* and /admin/products* route.
           KEEP: /ingest/draft and /healthz.
  Group E: Remove now-unused entries from requirements.txt:
           google-genai, google-cloud-tasks, google-cloud-bigquery.
           Do NOT remove firebase-admin or google-cloud-firestore yet -
           Phase 4 decides those.

Constraints:
  - api/store.py currently does `from .job_store import db`. Deleting job_store
    breaks that import. Relocate the Firestore client initialization into
    store.py itself. This is a move, not a rewrite - do not change its behavior.
    [RESOLVED — already done. api/job_store.py no longer exists; api/store.py:66-73
    carries the relocated client init (db = AsyncClient(), guarded by
    `if not LOCAL_MODE:`) with an explanatory comment. Nothing imports job_store.
    Verified in .scratch/verification/phase4-recon-20260903-1133-raw.md at 71f1de5;
    see Decision #64(c). No action pending here.]
  - nerd_core/generators.py has a parser half and a renderer half. Delete
    NOTHING in that file in this phase. It is decided separately in Phase 4.
  - If deleting a file breaks a test, report the test and stop. Do not rewrite
    tests to make them pass.

Gate: after each group, run the full test suite and paste raw output. Report a
PASS/FAIL table with a line count delta per group. Stop after Group E.
```

### Phase 1 exit criteria

- [ ] `python3 -m pytest` passes (activate `venv312` first)
- [ ] `npm run build` succeeds in `frontend/`
- [ ] `npm run lint` clean
- [ ] `grep -r "useResearch\|appsheet\|AppSheet\|job_store\|worker" --include="*.ts" --include="*.tsx" --include="*.py"` returns only `docs/` hits
- [ ] Roughly 2,000 lines removed, no lines added beyond the `store.py` import relocation

---

## 12. Phase 2 — Firestore persistence port

The largest phase. Everything behind unchanged public interfaces so no UI component changes. Requires Phase 0 (a real Firestore instance to test against) and Phase 1 (reduced surface).

### CLI prompt — Phase 2

```
You are executing Phase 2 of the N.E.R.D. cloud migration: replacing all
filesystem persistence with Firestore. The public interface of every function
you touch must stay identical - same name, same signature, same return shape,
same error behavior. No UI component should need to change.

Data model. Collection `nerd_documents`. One document per logical file, ID =
filename without extension. Fields:
  content    (string)  - raw JSON text, exactly as it would have been on disk
  sha256     (string)  - SHA-256 hex of content encoded UTF-8
  updated_at (timestamp) - server timestamp
Backups are sibling docs with a `__bak` suffix, same shape.

Store the raw JSON as a STRING. Do not parse it into a Firestore map. The ETag
contract is SHA-256 of exact bytes; a parse/reserialize round trip can reorder
keys and change the hash.

Step 1 - Read-only survey. Report and STOP.

  Grep the whole repo for every call to node:fs and report each with its file,
  the exact target path expression, and whether it reads, writes, or deletes.
  I expect hits in at least: frontend/lib/local-write.ts,
  frontend/lib/local-data.ts, frontend/app/api/local/passwords/route.ts,
  frontend/app/api/local/promote-live/route.ts,
  frontend/app/api/local/published-live/route.ts,
  frontend/app/api/local/vendors-live/route.ts. If you find fs usage anywhere
  else in frontend/, report it - my inventory may be incomplete.

  Also report every call site of libDir() and NERD_REPO_ROOT.

Step 2 - After I approve, add firebase-admin to frontend/package.json.

  This is a deliberate exception to the frontend's no-new-dependencies rule.
  Note it in your report; a DECISION_LOG entry will be written by the developer.
  Do not add any other dependency. If you believe another one is required,
  stop and report rather than adding it.

  Create frontend/lib/firestore-admin.ts: a single module that initializes the
  Admin SDK once (guarding against re-init in dev hot reload) and exports the
  Firestore instance. Server-only - it must import "server-only".

Step 3 - Create frontend/lib/doc-store.ts. This is the new "one code path that
touches storage", replacing libDir()/pathFor()/atomicWrite(). It exports:

  readDocument(id: string): Promise<{ data: string; etag: string } | null>
    - null when the document does not exist. Callers that currently catch
      ENOENT and return an empty result rely on this.
  writeDocument(id: string, bytes: string, ifMatch?: string): Promise<void>
    - Runs in a Firestore transaction. When ifMatch is supplied, re-read
      sha256 inside the transaction and throw a distinguishable
      ETagMismatchError if it differs. Callers translate that to HTTP 412.
  deleteDocument(id: string): Promise<void>
  backupThenWrite(id: string, bytes: string): Promise<void>
    - Copies the current doc to `${id}__bak`, then writes. If the source does
      not exist, clear the stale backup and write anyway - this matches
      refreshBackup()'s current ENOENT behavior exactly.
  backupThenDelete(id: string): Promise<void>

Step 4 - Rewrite frontend/lib/local-write.ts against doc-store.ts.

  - Delete libDir(), pathFor(), atomicWrite(), refreshBackup(), and every
    node:fs and node:path import.
  - documentPath(kind) and liveSnapshotPath(kind) currently return filesystem
    paths and are consumed by promote-live/route.ts. Rename them to
    documentId(kind) and liveSnapshotId(kind), returning document IDs, and
    update that route accordingly.
  - readPublishedRaw(kind) and writePublishedAtomic(kind, bytes) keep their
    exact signatures.
  - readTrackingRecords() and writeTrackingRecords() keep their exact
    signatures and their merge/reconcile logic - only the read and write calls
    change.
  - Preserve every explanatory comment that is still true. Delete only the ones
    that describe filesystem behavior that no longer applies (the libDir()
    standalone-build explanation, the atomicWrite fsync rationale). Do NOT
    delete the comments explaining WHY the DataKind union is closed, why
    tracking.json is outside the ETag system, or why the .bak is a single-step
    undo rather than an archive. Those rationales survive the port.

Step 5 - Port the direct-fs readers in frontend/lib/local-data.ts:
  getPublishedLiveProducts, getAddedLiveProducts, getLiveVendors. Each reads
  its live snapshot and falls back to an empty array when absent. Preserve that
  fallback exactly - "no live data yet" is the expected common case, not an
  error. Keep deriveLiveProductSlug and deriveLiveVendorSlug unchanged.

Step 6 - Port the four route handlers that call fs directly:
  published-live/route.ts, vendors-live/route.ts, passwords/route.ts,
  promote-live/route.ts. Same interfaces, same status codes, same error bodies.

Step 7 - Delete NERD_REPO_ROOT handling everywhere EXCEPT
  frontend/app/api/local/scrape/route.ts, which still spawns a Python child
  process and is rehomed in Phase 4. Leave that route alone entirely.

Constraints:
  - Change no file under frontend/app/editor/, frontend/app/records/, or
    frontend/app/vendors/. If you believe a component change is required,
    stop and report - that means an interface changed and it should not have.
  - Do not change the ETag or If-Match wire format.
  - Do not delete any *.json file in frontend/lib/. Phase 6 migrates them.

Gate: report a table of every function ported, old storage mechanism, new
storage mechanism, and whether its signature changed (all should read "no").
Then run npm run build, npm run lint, and the Playwright suite, pasting raw
output. Any test that fails only because it points at the filesystem should be
reported, not rewritten.
```

### Phase 2 exit criteria

- [ ] `grep -rn "node:fs" frontend/` returns only `app/api/local/scrape/route.ts`
- [ ] `grep -rn "NERD_REPO_ROOT\|libDir" frontend/` returns only `app/api/local/scrape/route.ts`
- [ ] No file under `frontend/app/{editor,records,vendors}/` was modified
- [ ] `firebase-admin` is the only added dependency
- [ ] A save against a stale ETag still returns 412

**The first two criteria above were checked off prematurely when Phase 2 was
signed off; both are still false today.** As of `71f1de5`, `grep -n "node:fs"`
across `frontend/` matches `lib/local-write.ts:26` and `lib/local-data.ts:24` —
and *not* `app/api/local/scrape/route.ts`, which imports `node:child_process`
and `node:path` but never `node:fs`. `grep -n "NERD_REPO_ROOT\|libDir"` matches
`lib/local-write.ts` (both tokens) and `lib/local-data.ts` (`libDir`) on top of
`app/api/local/scrape/route.ts`.

This is a different situation from the two Phase 3 criteria carried forward
below, which were held back by an explicit decision taken at the time. These
two were simply written against an end state that a later phase produces. They
presuppose two things Phase 2 does not do: the scrape-route rewrite that removes
the child-process spawn and its `NERD_REPO_ROOT` handling, and the deletion of
the `local-data.ts` / `local-write.ts` / `local-only.ts` module group that owns
every remaining `node:fs` and `libDir()` reference. Both land in Phase 4 — Part
C for the scrape, and the one-root/one-commit module deletion in Decision #62.

Phase 4's exit criterion C6 — `grep -rn "node:fs\|NERD_REPO_ROOT\|libDir"
frontend/` returns **zero** hits — is strictly stronger than either of these
(zero hits, not "only the scrape route") and supersedes them. They are left
here as a record of what Phase 2 claimed, not as work Phase 2 can still close.

---

## 13. Phase 3 — Authentication

Two independent problems get fixed here.

**The session cookie is forgeable.** `frontend/app/login/page.tsx` sets `document.cookie = "__session=true; path=/; max-age=3600; SameSite=Lax"` after a successful Google popup sign-in. That is a plain unsigned client-side cookie whose value is the literal string `true`. Anyone can type it into devtools and satisfy `proxy.ts`'s check.

**`proxy.ts` exempts the entire API surface.** It returns `NextResponse.next()` for any path starting with `/api`, so every `/api/local/*` handler's only protection is `isLocalOnlyAllowed()`, which is being removed.

`frontend/proxy.ts` is the correct filename for Next.js 16 — the framework renamed `middleware.ts` to `proxy.ts` in that release. The file is live. *Judgment call worth verifying during the phase: the Next.js 16 release notes show `export default function proxy`, while the migration codemod produces a named `export function proxy`. This repo uses the named form. Confirm empirically that the proxy actually executes before relying on it — a `console.log` at the top and one request is enough.*

### CLI prompt — Phase 3

```
You are executing Phase 3 of the N.E.R.D. cloud migration: replacing the
local-only gate and the forgeable session cookie with real Firebase Auth.

Context you must verify before writing code:
  - frontend/proxy.ts is the Next.js 16 replacement for middleware.ts. Confirm
    empirically that it actually runs: add a temporary console.log at the top,
    start the dev server, make one request, and paste the server log showing
    the line fired. Remove the log afterward. If it does NOT run, stop and
    report - everything below depends on it.
  - frontend/lib/firebase.ts hardcodes authDomain: "edtech-agent-2026.
    firebaseapp.com" and projectId: "edtech-agent-2026". Both must become
    environment-driven.

Step 1 - Make firebase.ts project-agnostic.
  Move authDomain and projectId to NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN and
  NEXT_PUBLIC_FIREBASE_PROJECT_ID. Both are NEXT_PUBLIC_, so both are inlined
  at build time and must be passed as Docker build args in Phase 5. Update
  frontend/Dockerfile's ARG/ENV block accordingly.

Step 2 - Real session cookies.
  Create a Route Handler POST /api/auth/session that accepts a Firebase ID
  token in the request body, verifies it with firebase-admin, mints a session
  cookie via createSessionCookie(), and sets it as HttpOnly, Secure,
  SameSite=Lax, path=/, with a matching max-age. Add a DELETE on the same route
  that clears it.

  Update frontend/app/login/page.tsx to POST the ID token to that route
  instead of setting document.cookie directly. Remove the document.cookie
  assignment entirely.

Step 3 - Enforce.
  In proxy.ts: remove the NEXT_PUBLIC_DISABLE_AUTH bypass. Keep /login and
  /api/auth exempt. Remove the blanket /api exemption - protected API routes
  must be reachable only with a session cookie present.

  Create frontend/lib/session.ts exporting requireSession(): a server-side
  helper that reads the session cookie, verifies it with firebase-admin's
  verifySessionCookie(), and returns the decoded claims or throws.

  Replace isLocalOnlyAllowed() at every call site:
    - In local-write.ts's assertLocalOnly(): verify the session; return 401
      (not 404) when absent. The 404-instead-of-403 reasoning in its comment
      was about hiding a dev-only route's existence. That rationale no longer
      applies once the route is a real production endpoint, so the comment
      should be replaced, not preserved.
    - In local-data.ts's Server Component readers: replace the notFound()
      calls with a redirect to /login.

  Then delete frontend/lib/local-only.ts and every reference to
  NEXT_PUBLIC_DISABLE_AUTH and NERD_CLOUD_DEMO_LOCAL_WRITE across the repo,
  including frontend/.env.local if present. Report every file touched.

Step 4 - Firestore Security Rules.
  Create firestore.rules at the repo root. The Admin SDK bypasses rules, so
  these govern only direct client access - which this app does not currently
  use. Write them as deny-all for the nerd_documents and nerd_scrape_jobs
  collections. Create firebase.json declaring the rules file. Do not deploy
  them; Phase 5 does.

Constraints:
  - Do not implement roles, permissions, or an authorization model. Three
    known users, all public-domain data. Authenticated-or-not is the entire
    model. If you find yourself designing a permission system, stop.
  - Do not add a dependency. firebase-admin arrived in Phase 2; firebase is
    already present.

Gate: report every call site of isLocalOnlyAllowed and NEXT_PUBLIC_DISABLE_AUTH
before and after, showing the count went to zero. Then demonstrate, with raw
curl output: an unauthenticated request to an /api/local/* route returns 401,
and a request carrying a forged `__session=true` cookie ALSO returns 401.
That second test is the one that proves the fix.
```

### Phase 3 exit criteria

- [ ] A forged `__session=true` cookie is rejected
- [ ] `firestore.rules` and `firebase.json` exist and are committed

**Two criteria were deferred out of this phase to Phase 4, with explicit
approval at the time — see Decision #61.** They are not dropped and are not
weakened; they are carried unchanged in Phase 4's exit criteria below:

- the `NEXT_PUBLIC_DISABLE_AUTH` / `NERD_CLOUD_DEMO_LOCAL_WRITE` /
  `isLocalOnlyAllowed` zero-hit grep, and
- deleting `frontend/lib/local-only.ts`.

The reason is a dependency, not a change of intent: `app/api/local/scrape/route.ts`
still calls `assertLocalOnly()` and still reads through `lib/local-data.ts`, so
deleting the module group during Phase 3 would have broken the build. Phase 4
Part C rehomes that route, which is what unblocks both criteria. See also
Decision #62, which establishes that the three modules share that single root
and come out together.

---

## 14. Phase 4 — Python service, the scrape, and the ingest budget

### The constraint that shapes this phase

Firebase Hosting enforces a 60-second request timeout and does not support streaming responses through rewrites to Cloud Run. Cloud Run's own limits are far larger — 3600 seconds maximum for a service, 168 hours for a Job task — but none of that headroom reaches a browser sitting behind Hosting. Every user-facing request has ~50 usable seconds.

Two paths are affected, not one. The prior documents caught the first and missed the second.

**Path 1 — the live scrape.** `scripts/scrape_ncademi_live.py` takes one to two minutes by its own route handler's documentation, and `scrape/route.ts` streams `PROGRESS_JSON:` lines from the child process as SSE events. Neither survives Hosting. The replacement is a polled Cloud Run Job. This is more SRD than the current design — correct sequencing preserved, streaming complexity removed — and it satisfies the same accessibility obligation, since a polled status transition is announced through an ARIA live region exactly as an SSE-driven one is.

**Path 2 — Import Data / `/ingest/draft` (addition A1).** This runs behind the same 60-second ceiling and performs link-liveness checks over plain HTTP against arbitrary third-party hosts. Its duration has never been measured. A single unresponsive host with a default socket timeout can consume most of the budget on its own. Part D below measures it and bounds it. If the measured worst case exceeds the budget, ingest gets the same start-and-poll treatment as the scrape rather than a larger timeout, because no timeout value on `nerd-api` can raise the Hosting ceiling.

### CLI prompt — Phase 4

```
You are executing Phase 4 of the N.E.R.D. cloud migration: slimming the Python
service, rehoming the live scrape, and bounding the ingest path.

Part A - Slim the Python service.

  After Phase 1, api/main.py should retain only POST /ingest/draft and
  GET /healthz. Verify that first and report what is actually there.

  Remove Firebase token verification from Python entirely: delete verify_token,
  the bearer scheme, and every Depends(verify_token). The service will be
  deployed --no-allow-unauthenticated in Phase 5 and called server-side from
  Next.js with an OIDC identity token, so Cloud Run IAM replaces application-
  level auth. Remove the CORS middleware too - there is no browser origin
  calling this service any more.

  Remove firebase-admin and google-cloud-firestore from requirements.txt if
  and only if grep confirms zero remaining imports. NOTE: Part C adds a Job
  entrypoint that writes progress to Firestore from Python. Run this removal
  check AFTER Part C is written, not before, or you will remove a dependency
  Part C reintroduces. Report the grep output either way.

  Delete api/store.py and api/schemas.py entries that /ingest/draft does not
  reach. Determine reachability by import graph, not by guessing. Report the
  graph you traced.

  DECISION REQUIRED - stop and report, do not act:
  nerd_core/generators.py contains both parse_markdown_to_listing (the Gem
  markdown contract, load-bearing) and a rendering half (render_listing_html,
  the _gen_*_html functions, generate_ncademi_html). Report whether anything
  reachable from /ingest/draft calls the rendering half, and whether
  frontend/lib/ncademiPreview.ts duplicates it. Do not delete either renderer.

Part B - Create a Next.js server-side client for the Python service.

  Create frontend/lib/ingest-client.ts: a server-only module that calls the
  Python service's /ingest/draft with a Google OIDC identity token minted for
  the Cloud Run service's audience. Read the service URL from a non-public
  env var (INGEST_SERVICE_URL) so it is runtime-configurable, NOT baked into
  the bundle. Update ImportDataModal.tsx's call path to go through a Next.js
  Route Handler that uses this client, rather than calling the Python service
  from the browser.

  DEPENDENCY CONSTRAINT - read this before you reach for a library.
  Do NOT add @google-cloud/run, google-auth-library, or any other package.
  On Cloud Run, both tokens you need are available from the instance metadata
  server over plain fetch():

    OIDC identity token (for calling nerd-api):
      GET http://metadata.google.internal/computeMetadata/v1/instance/
          service-accounts/default/identity?audience=<nerd-api URL>
      Header: Metadata-Flavor: Google

    OAuth access token (for the Run Admin API in Part C):
      GET http://metadata.google.internal/computeMetadata/v1/instance/
          service-accounts/default/token
      Header: Metadata-Flavor: Google

  The metadata server does not exist in local development. Implement a
  documented fallback: when the metadata fetch fails, fall back to calling the
  local service directly without a token, gated on an explicit
  NERD_LOCAL_NO_AUTH_INGEST env var that is never set in any deployed config.
  Report the fallback's exact gating condition. If you believe a library is
  genuinely required, STOP and report rather than adding one.

Part C - Rehome the scrape as a polled job.

  Replace the SSE design in frontend/app/api/local/scrape/route.ts.

  New shape:
    POST /api/local/scrape        -> starts a run, returns a job ID immediately
    GET  /api/local/scrape/{id}   -> returns { status, stage, messages[], error }

  Job state lives in Firestore, collection `nerd_scrape_jobs`, with an
  `expires_at` timestamp field so a TTL policy can reap old jobs. Phase 5
  creates that TTL policy - note it as a dependency in your report.

  EXECUTION MECHANISM - this is the part that is easy to get wrong. The scrape
  must run as a CLOUD RUN JOB, not as an endpoint on a Cloud Run service.
  Cloud Run throttles CPU after a response is sent, so a service that returns
  202 and keeps working in the background will be killed partway through. A
  Cloud Run Job executes independently of any request and has its own timeout.

  Concretely:
    - Add a job entrypoint to the Python image that runs the scrape and writes
      progress into nerd_scrape_jobs. Same image as nerd-api, different command
      - do not build a third image.
    - POST /api/local/scrape (Next.js) creates the Firestore job document,
      triggers a Cloud Run Job execution via the Run Admin API using the
      metadata-server access token from Part B, and returns the job ID. It does
      not wait.
    - The job writes progress as it goes, replacing the PROGRESS_JSON: stdout
      protocol. Preserve the script's existing stage names one-to-one so the
      client needs no new vocabulary.
    - The frontend service account needs roles/run.developer (or a narrower
      role permitting run.jobs.run) to trigger executions. Report the binding.

  Keep the post-retrieval comparison logic (the "X not stored" / "X in your
  records not retrieved" diff) exactly as it is. It runs after the child exits
  today; it runs after the job completes now. Same output, same stage keys.

  Update /records' client handler: replace the ReadableStreamDefaultReader
  hand-parser with a poll every 2 seconds. ACCESSIBILITY REQUIREMENT, NOT
  OPTIONAL: each status change must still be announced through the existing
  ARIA live region (WCAG 4.1.3), and errors through role="alert". Do not
  remove or bypass the live region while changing how updates arrive. State
  explicitly in your report which live region element you wired the polled
  updates into, by file and element.

  Remove the child-process spawn entirely. After this part, node:fs and
  NERD_REPO_ROOT should have zero hits anywhere in frontend/.

  Add scripts/scrape_ncademi_live.py and its dependencies to the Python
  service's Dockerfile. It is currently invoked from a repo-root venv that will
  not exist in a container.

Part D - Measure and bound the ingest path. This is new; do not skip it.

  Firebase Hosting caps every browser-facing request at 60 seconds and returns
  504 beyond it. The Import Data flow is browser -> Next.js Route Handler
  (behind Hosting) -> /ingest/draft. /ingest/draft performs link-liveness
  checks over plain HTTP against third-party hosts. Its duration has never been
  measured.

  Step D1 - Measure. Run /ingest/draft locally against the largest realistic
  markdown payload you can find in the repo or fixtures. Report wall-clock
  duration, the number of links checked, and the slowest single link check.

  Step D2 - Bound. Regardless of the measurement, enforce both:
    - A per-link HTTP timeout of no more than 5 seconds.
    - An overall budget of 50 seconds for the whole /ingest/draft request,
      after which it returns what it has with unchecked links marked as
      "not verified" rather than failing. Partial results with an honest
      "not verified" marker are correct behavior here; a 504 is not.
  Report the exact constants you used and where they live.

  Step D3 - Report, do not act. If the measured worst case in D1 exceeded 50
  seconds even with per-link timeouts applied, say so explicitly and STOP.
  Ingest would then need the same start-and-poll treatment as the scrape, and
  that is a decision for me, not for you. Do not raise a timeout value as a
  workaround - no timeout on nerd-api can raise the Hosting ceiling.

Constraints:
  - Do not change the scrape script's parsing or scraping logic. Only its
    invocation and how it reports progress.
  - Do not port the parser to TypeScript. nerd_core's parse-and-validate chain
    stays in Python.
  - Do not add a frontend dependency. See the Part B dependency constraint.

Gate: run the full scrape locally against the new job shape and paste the
Firestore job document's final state. Report the live region wiring by file and
element. Paste the Part D measurement and the constants chosen. Run the
Playwright accessibility suite and paste raw output.
```

### Phase 4 exit criteria

- [ ] `api/main.py` exposes only `/ingest/draft` and `/healthz` — the scrape is a Job entrypoint, not a route (correction C5)
- [ ] No `Depends(verify_token)` and no CORS middleware remain in Python
- [ ] `grep -rn "EventSource\|text/event-stream\|ReadableStreamDefaultReader" frontend/` returns zero hits
- [ ] `grep -rn "node:fs\|NERD_REPO_ROOT\|libDir" frontend/` returns **zero** hits (correction C6)
- [ ] `grep -rn "NEXT_PUBLIC_DISABLE_AUTH\|NERD_CLOUD_DEMO_LOCAL_WRITE\|isLocalOnlyAllowed" .` returns zero hits outside `docs/` (deferred from Phase 3 — Decision #61)
- [ ] `frontend/lib/local-only.ts` is deleted (deferred from Phase 3 — Decision #61)
- [ ] `frontend/lib/local-data.ts` and `frontend/lib/local-write.ts` are deleted with it — one root, one commit (Decision #62)
- [ ] No new frontend dependency was added (addition A2)
- [ ] A full scrape completes end to end via the polled job
- [ ] Ingest duration measured; per-link and overall budgets in place with named constants (addition A1)
- [ ] `@axe-core/playwright` suite passes, live region confirmed wired by file and element

---

## 15. Phase 5 — Deploy

First irreversible step. Everything before this was local.

### CLI prompt — Phase 5

```
You are executing Phase 5 of the N.E.R.D. cloud migration: deployment.

Substitutions:
  PROJECT_ID = <fill in>
  REGION     = us-central1
  REPO_NAME  = nerd-repo
  DOMAIN     = idbygeorge.com

Preconditions - verify and report before acting:
  - Phase 0 exit criteria all met
  - Phases 1-4 committed, tests green
  - gcloud config get-value project equals PROJECT_ID

Step 1 - Deploy the Python service FIRST. It has no dependencies on the
frontend, and the frontend needs its URL.

  Build from Dockerfile.api, push to
  REGION-docker.pkg.dev/PROJECT_ID/REPO_NAME/nerd-api, and deploy as service
  `nerd-api` with:
    --no-allow-unauthenticated
    --region REGION
    --timeout 900
    --min-instances 0
  Capture the resulting URL and report it.

  NOTE: --timeout 900 is headroom for direct service-to-service calls. It is
  NOT a user-facing budget. Firebase Hosting caps browser-facing requests at
  60 seconds regardless of this value. Do not treat 900 as permission for a
  long user-facing operation.

Step 2 - Grant the frontend's service account permission to invoke it.

  Create a dedicated service account for the frontend rather than using the
  default compute SA. Grant it roles/run.invoker on nerd-api and
  roles/datastore.user on the project. Report both bindings.

Step 2b - Create the scrape Cloud Run Job.

  Phase 4 added a job entrypoint to the Python image. Create a Cloud Run Job
  named `nerd-scrape` from that same image with the job command, in REGION,
  with --task-timeout set to 15m and --max-retries 0. Do not execute it yet.

  Grant the frontend's service account permission to trigger executions
  (roles/run.developer, or a narrower role permitting run.jobs.run) and to act
  as the job's runtime service account. Report both bindings.

Step 2c - Create the Firestore TTL policy for scrape jobs.

  Phase 4 writes an `expires_at` timestamp field on documents in
  nerd_scrape_jobs and assumes a TTL policy reaps them. No prior phase creates
  it. Create it now:

    gcloud firestore fields ttls update expires_at \
      --collection-group=nerd_scrape_jobs \
      --enable-ttl \
      --database="(default)" \
      --project=PROJECT_ID

  If the flag syntax does not match, run --help and use the actual syntax
  rather than guessing. Read the policy back and report its state.

Step 3 - Deploy the frontend.

  Build from frontend/Dockerfile. NEXT_PUBLIC_* values are inlined at build
  time and CANNOT be changed by a runtime env var - pass every one as a
  --build-arg. All four:
    NEXT_PUBLIC_FIREBASE_API_KEY
    NEXT_PUBLIC_FIREBASE_APP_ID
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
    NEXT_PUBLIC_FIREBASE_PROJECT_ID

  INGEST_SERVICE_URL is NOT a NEXT_PUBLIC_ var and is read server-side at
  runtime - set it with --set-env-vars on the deploy, not as a build arg.

  Deploy as `nerd-frontend` with --allow-unauthenticated, --region REGION,
  and the service account from Step 2.

  Before deploying, grep the built image or the Dockerfile to confirm no
  NEXT_PUBLIC_ variable is being set only at runtime. Report the check.

Step 4 - Firebase Hosting.

  Update firebase.json to add a hosting block that rewrites "**" to the
  nerd-frontend Cloud Run service in REGION, and declares firestore.rules.
  Deploy hosting and rules with the Firebase CLI.

  Verify at the PROJECT_ID.web.app URL before touching DNS. Report the HTTP
  status and the served page title.

Step 5 - Custom domain. STOP HERE and report.

  Attaching DOMAIN requires DNS record changes at the registrar and a
  verification step in the Firebase console. Report the exact records Firebase
  asks for and hand them to the developer. Do not attempt to modify DNS.

Constraints:
  - Do not create a load balancer, a serverless NEG, a URL map, a target proxy,
    a forwarding rule, or a global IP address. Firebase Hosting rewrites are
    the single origin. If you find yourself reaching for gcloud compute, stop.
  - Do not create a Cloud Tasks queue or a Secret Manager secret.
  - Use --update-env-vars, never --set-env-vars, on any redeploy of an existing
    service. --set-env-vars is destructive and wipes every other variable.
    (The one exception is the initial deploy in Step 3, where there is nothing
    to preserve.)

Gate: report both service URLs, the nerd-scrape job resource, the TTL policy
state, every IAM binding created, the Hosting site URL, and raw curl output
showing the .web.app URL serving the app. Then stop.
```

### Developer tasks — Phase 5

After the CLI stops at Step 5:

1. Add the DNS records Firebase specifies at the registrar for `DOMAIN`. Record the previous values first.
2. Wait for verification and managed certificate issuance. This can take up to 24 hours; a pending certificate is normal, not a failure.
3. Confirm `DOMAIN` and `www.DOMAIN` are in Firebase Auth → Settings → Authorized domains.
4. Sign in end to end at `https://DOMAIN` with each of the three accounts.

### Verification the CLI cannot do

**ETag pass-through.** The editor components carry workarounds for the Cloudflare tunnel stripping `ETag` response headers. Firebase Hosting is a different proxy and may behave differently. With devtools open, save a record and confirm the `ETag` response header arrives intact. If it does, the workarounds are dead weight but harmless — leave them. If it does not, the workarounds are load-bearing and must stay. Either way, record the finding; do not remove them speculatively.

**Ingest against real network conditions.** Phase 4 Part D measures ingest locally, where DNS and egress are fast. Run one real Import Data against a listing with many external links from the deployed site and confirm it returns inside the Hosting ceiling. A local measurement is necessary but not sufficient evidence here.

**Budget alert.** Confirm the $5/month alert from Phase 0 is active before leaving the site running.

---

## 16. Phase 6 — Data migration and cutover

### CLI prompt — Phase 6

```
You are executing Phase 6: migrating the JSON documents from frontend/lib/
into Firestore.

Step 1 - Write scripts/migrate_json_to_firestore.py. It must:
  - Read each of these NINE files from frontend/lib/ and write one Firestore
    document per file into `nerd_documents`, ID = filename without extension:
      published.json, added.json, candidate.json, vendors.json,
      published-live.json, added-live.json, vendors-live.json,
      tracking.json, passwords.json
  - Skip any file that does not exist, and report which were skipped.
  - Store the file's bytes verbatim in `content`. Do not parse and
    reserialize. Compute `sha256` over the same bytes.
  - Be idempotent: re-running overwrites with the same content and produces
    the same sha256.
  - Support --dry-run, which reports what it would write - file, byte count,
    sha256 - without writing anything.

Step 2 - Run with --dry-run and paste the full output. STOP. Wait for approval.

Step 3 - After approval, run for real, then verify by reading each document
back out of Firestore, recomputing sha256 over the returned content, and
comparing to the local file's hash. Report a table: document ID, local bytes,
Firestore bytes, local sha256, Firestore sha256, MATCH or MISMATCH. Every row
must be MATCH.

Step 4 - Do NOT delete the local JSON files. They are the rollback path and
stay in git.

Gate: the verification table. Any MISMATCH stops the phase.
```

### Developer tasks — Phase 6

- **Before running:** `git tag pre-firestore-migration` and push the tag.
- **After running:** exercise every write path in the live app — edit and save a product, import a candidate, add a vendor, run a live retrieval, promote live data over stored. Confirm each persists across a hard refresh.
- **Concurrency check:** open the same record in two browser windows, save in one, then save in the other. The second save must return 412 with a conflict message, not silently clobber.
- **Accessibility check:** with NVDA or VoiceOver running, start a live retrieval and confirm each polled stage transition is announced, and that an induced error is announced through `role="alert"`. This is the check most likely to be skipped and the one the whole WCAG posture rests on.

### Loose end from the old project

`edtech-agent-2026`'s Firestore holds 43 documents in `nerd_products`, written through the old `POST /admin/products` path. They live in a project this migration abandons, so they block nothing. But before decommissioning that project, pull them and diff against `published.json` — they may contain content the local JSON files never captured. Cheap to check, unrecoverable if the project is deleted first.

---

## 17. Judgment calls flagged, not settled

- **`firebase-admin` in the frontend** breaks the six-runtime-dependency discipline. It is unavoidable for server-side Firestore and session cookies, but it is a real change to a deliberate constraint and deserves a DECISION_LOG entry rather than silent adoption.
- **`passwords.json` as a Firestore document (addition A3).** Migrating it makes credentials a string field in a collection alongside product data. The exposure is bounded — Admin SDK only, deny-all Rules, no client access path — and it is not obviously worse than a file on a container's disk. But it is a change in exposure surface that neither prior document acknowledged, and it deserves a DECISION_LOG entry stating that the risk was seen and accepted. If it is ever accessed by anything other than `passwords/route.ts`, revisit.
- **The dual renderer** (`nerd_core/generators.py`'s rendering half versus `frontend/lib/ncademiPreview.ts`) is diagnosed in Phase 4 but not resolved. Deleting the Python half touches a live file and should happen with test coverage, as its own commit, not folded into a migration phase.
- **Whole-document concurrency** is preserved rather than reconsidered. It is correct for three manual operators. If the tool ever grows concurrent editors on the same category, per-product documents become the right model and the ETag contract changes with it.
- **`proxy.ts`'s export form** — named versus default — was not verified against a running Next.js 16.2.9 instance. Phase 3's first step verifies it empirically for exactly this reason.
- **Hosting ETag pass-through** is unverified. Flagged in Phase 5 as a manual check rather than assumed either way.
- **Whether ingest fits the 60-second ceiling** is unverified until Phase 4 Part D runs. The bounding constants are a mitigation, not a proof. If D1 shows the worst case exceeds budget, ingest needs the start-and-poll treatment and that is a decision gate, not a CLI call.
- **The staleness pattern itself.** Two documents and one external evaluation have now drifted from the codebase in the same way: each was correct against the snapshot it was written from, and each went stale without announcing it. The mitigation adopted here is the "Validated against" line at the top of this document. It is a weak mitigation — it depends on whoever edits next remembering to update it. A stronger one would tie the document to a repomix content hash. Not built; flagged.

---

## 18. Retired recommendations

Recorded so a future reviewer does not rediscover them as improvements. Each was considered and set aside for a stated reason, not overlooked.

| Recommendation | Why retired |
|---|---|
| Global Application Load Balancer with serverless NEGs and a URL map | Solves a cross-origin problem that ceases to exist after Phase 4. Firebase Hosting rewrites give a single origin at no cost and no compute-API surface. Confirmed technically viable by external review; excluded on simplicity and cost. |
| Cloud Tasks for async delegation | The enqueuing layer is deleted in Phase 1. Cloud Run Jobs cover the one remaining long-running workload and are not subject to post-response CPU throttling. |
| `fetch()` + `ReadableStream` SSE client to carry a Bearer token | SSE is removed from the codebase entirely in Phase 4. Superseded by Firestore-backed polling. |
| `us-west3` | Tier 2 Cloud Run pricing and higher grid carbon intensity than `us-central1`. Settled. |
| Raising `--timeout` to work around ingest duration | Cannot work. Firebase Hosting's 60-second ceiling is not configurable and is unaffected by any Cloud Run timeout value. |
