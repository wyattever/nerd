# N.E.R.D. Senior-Engineer Technical Report: Cross-Origin SSE/Auth, Worker Flow Efficiency, and Deploy/Env Synchronization

## TL;DR

- **The cross-origin `__session` cookie pattern is structurally broken** because `run.app` is on the Public Suffix List, making `nerd-frontend.run.app` and `nerd-api.run.app` *cross-site* (not just cross-origin) — and native `EventSource` cannot send an `Authorization` header. Fix: either collapse both services behind one origin (custom domain + load balancer, strongly preferred), or replace `EventSource` with a `fetch()`+`ReadableStream` SSE client that carries a Firebase ID token as `Authorization: Bearer`.
- **The deploy bug is a build-time/runtime mismatch:** `NEXT_PUBLIC_API_BASE_URL` is inlined into the JS bundle at `next build` time, so setting it as a Cloud Run runtime env var does nothing; `deploy.sh` also sets the wrong name (`BACKEND_URL`). Fix: pass it as a Docker `--build-arg` so `next build` bakes it in, and delete `BACKEND_URL`.
- **The worker should move to the native async genai client** (`client.aio.models.generate_content`), parallelize independent URL validation with `asyncio.gather` + a `Semaphore`, handle `429/RESOURCE_EXHAUSTED` distinctly via `google.genai.errors.ClientError.code`, align Cloud Run `--timeout` (default 300 s, max 3600 s) with worst-case job time, and become idempotent per `job_id` because Cloud Tasks retries at-least-once.

---

## Executive Summary — Critical Issues in Priority Order

This report addresses three production defects in N.E.R.D. (FastAPI/Python 3.12 + Next.js 14, deployed as three cross-origin Cloud Run services: `nerd-api`, `nerd-worker`, `nerd-frontend`). The blocking issues, in priority order:

1. **[SSE BLOCKER #1 — `run.app` is on the Public Suffix List]** `nerd-frontend.run.app` and `nerd-api.run.app` are **cross-site** to each other, not merely cross-origin. `run.app` is a registered entry on the Public Suffix List (PSL), so each `*.run.app` service name is its own eTLD+1. The `__session` cookie set by the API is a **third-party cookie** from the frontend's top-level context and cannot be scoped to a shared parent. Cookie-based SSE auth is structurally broken in this topology.
2. **[SSE BLOCKER #2 — native `EventSource` cannot send headers]** The browser `EventSource` API only issues GET requests and provides **no mechanism to set custom headers** (e.g. `Authorization: Bearer`). This is precisely why teams fall back to cookie auth for SSE — but cookie auth is broken here (Blocker #1). The clean fix is to abandon native `EventSource` for a `fetch()` + `ReadableStream` SSE client carrying a Firebase ID token in `Authorization`.
3. **[DEPLOY BLOCKER — `NEXT_PUBLIC_*` is build-time inlined]** `NEXT_PUBLIC_API_BASE_URL` is inlined into the JS bundle at `next build` time, not read at container runtime. Setting it as a Cloud Run runtime env var has zero effect on the already-built bundle. Compounding this, `deploy.sh` sets the wrong variable name (`BACKEND_URL`), so the frontend falls back to `localhost:8000` in cloud and never reaches the API.

Secondary issues: serial `to_thread`-wrapped Gemini calls and serial URL validation in the worker (should use the native async genai client + `asyncio.gather`); coarse `except Exception` error handling that discards `QuotaExhaustedError` detail; and a Cloud Run request-timeout vs. long-job mismatch.

The single highest-leverage fix that eliminates **both** SSE blockers at once is to **put the frontend and API behind one origin** (custom domain + load balancer path routing). If that is not adopted, the fetch-based Bearer-token SSE client below is the required alternative.

---

## Key Findings

- **`run.app` is a public suffix.** Two sibling `*.run.app` services are cross-site; the browser will reject any attempt to set a `__session` cookie scoped to the shared `run.app` parent, and treats the API's cookie as a third-party cookie in the frontend's context. This is the same failure Heroku (`herokuapp.com`) and AWS App Runner (`awsapprunner.com`) document. CHIPS/partitioned cookies do **not** fix it.
- **Native `EventSource` can opt into credentials (`withCredentials`) but cannot set request headers** — a deliberate spec decision (WHATWG HTML issue #2177 remains open). So Bearer-token auth requires `fetch()`+`ReadableStream`.
- **Starlette `CORSMiddleware` with `allow_credentials=True` + explicit `allow_origins=[FRONTEND_URL]` is correct** for credentialed CORS: it echoes the specific origin and emits `Access-Control-Allow-Credentials: true` (wildcard `*` is forbidden with credentials).
- **Cloud Run bounds SSE:** default request timeout 300 s, max 3600 s; streaming keeps the connection active but does not extend the timeout.
- **Next.js bakes `NEXT_PUBLIC_*` at build time** and "will no longer respond to changes to these environment variables" afterward.
- **google-genai exposes a precise error hierarchy** (`APIError` → `ClientError`/`ServerError`) with `.code`, `.status`, `.details`; 429 quota errors arrive as `ClientError` with `.code == 429`, `.status == 'RESOURCE_EXHAUSTED'`.

---

## AREA 1 — Corrected SSE/Auth Implementation for Cross-Origin Production

### 1.1 Can native `EventSource` send credentials cross-origin?

Partly — and not in the way this stack needs. `EventSource` exposes a read-only `withCredentials` property; constructing `new EventSource(url, { withCredentials: true })` causes the underlying request to be made in CORS "include" credentials mode, which sends cookies. Per MDN, credentials (cookies, TLS client certs, auth headers) "are not sent in cross-origin requests" by default, and a client opts in for `EventSource()` "by setting the `EventSource.withCredentials` property to true."

So cookies *can* be attached to a cross-origin `EventSource` request **if** (a) the server satisfies credentialed CORS, and (b) the cookie itself is allowed to exist and be sent in a third-party context. In N.E.R.D., condition (b) fails because of the Public Suffix List (Section 1.3).

**Credentialed CORS server requirements** (MDN): when credentials are involved, `Access-Control-Allow-Origin` **cannot be the wildcard `*`** — it must echo the specific requesting origin — and `Access-Control-Allow-Credentials: true` must be present. Attempting wildcard + credentials "results in an error" in the browser.

**Starlette `CORSMiddleware` handles this correctly** when configured as N.E.R.D. has it: `allow_credentials=True` with an explicit `allow_origins=[FRONTEND_URL]` list. Starlette echoes the configured origin and emits `Access-Control-Allow-Credentials: true`. (Note: the FastAPI/Starlette docs explicitly warn that `allow_origins=["*"]` "will only allow certain types of communication, excluding everything that involves credentials." A recently merged Starlette change makes even the wildcard+credentials simple-response path echo the explicit origin, but N.E.R.D. already uses an explicit origin, so it is correct today.)

### 1.2 The core `EventSource` limitation: no custom headers

Native `EventSource` **cannot set request headers**. The constructor signature accepts only a URL and an options bag limited to `withCredentials`; there is no headers field. This is a deliberate spec decision (the WHATWG HTML issue #2177 "Setting headers for EventSource" remains open and unimplemented), modeling SSE after `<img>`/`<script>` loads. Consequently you cannot send `Authorization: Bearer <firebaseIdToken>` on a native `EventSource`. The only native-`EventSource` auth options are therefore (a) cookies, or (b) a token in the URL query string — and the latter leaks the token into server logs, browser history, and `Referer` headers.

This is the crux of the N.E.R.D. design tension: SSE pushed the team toward cookie auth precisely because `EventSource` can't carry a Bearer header — but cookie auth is exactly what the cross-site topology breaks.

### 1.3 The decisive problem: `run.app` is on the Public Suffix List

This is the issue that makes the current cookie pattern unsalvageable. A "public suffix" is a domain under which independent parties can register names; browsers refuse to let a site set a cookie scoped to a public suffix. As publicsuffix.org explains, browsers historically "denied setting wide-ranging cookies for top-level domains with no dots… websites could set a cookie for `.co.uk` which would be passed onto every website registered under `co.uk`," and the mitigation was "to create a list." **`run.app` is on that list.** Therefore:

- `nerd-frontend.run.app` and `nerd-api.run.app` each constitute their own **eTLD+1 / registrable domain**. They are **cross-site**, not just cross-origin.
- The API **cannot** set a `__session` cookie with `Domain=run.app` (shared parent) — browsers silently reject cookies scoped to a public suffix.
- A `__session` cookie set by `nerd-api.run.app` is, from the frontend's top-level site (`nerd-frontend.run.app`), an **unrelated third-party cookie**.

This is the same well-documented failure mode Heroku users hit with `herokuapp.com` and AWS App Runner users hit with `awsapprunner.com` — both also on the PSL (App Runner's docs explicitly recommend the `__Host-` cookie prefix because `*.awsapprunner.com` is PSL-registered). The Google serverless community has confirmed the same for `run.app` and `web.app`: cookies are rejected because the domain "is on a list called the public suffix list and is considered too broad."

**Consequence:** even with perfect credentialed CORS and `SameSite=None; Secure`, the cross-origin `__session` cookie is a third-party cookie that is fragile-by-design and increasingly blocked.

### 1.4 Third-party cookie state (2025–2026) and CHIPS

For any cross-site cookie to even be *eligible* to send, it must be `SameSite=None; Secure` — a requirement "in place since Chrome 80 to ensure proper cross-site functionality." But the broader trajectory is hostile to third-party cookies:

- **Chrome's deprecation has been repeatedly delayed and then walked back.** Google announced in July 2024 it would not unilaterally deprecate third-party cookies, and on **April 22, 2025**, Anthony Chavez (Google VP, Privacy Sandbox) confirmed in the official Privacy Sandbox blog: *"We've made the decision to maintain our current approach to offering users third-party cookie choice in Chrome, and will not be rolling out a new standalone prompt for third-party cookies."* As of 2025–2026, third-party cookies remain enabled by default in regular Chrome browsing — but Incognito blocks them by default, Safari (ITP) and Firefox block them outright, and users can disable them globally. (Separately, Google retired most Privacy Sandbox advertising APIs on October 17, 2025, while continuing to support CHIPS, FedCM, and Private State Tokens.)
- **CHIPS / Partitioned cookies** are the sanctioned path for legitimate cross-site cookies. Adding the `Partitioned` attribute (with mandatory `SameSite=None; Secure`) double-keys the cookie by top-level site. MDN and Privacy Sandbox docs show: `Set-Cookie: __Host-example=...; SameSite=None; Secure; Path=/; Partitioned;`.

**Why CHIPS does not save the current `__session` design:** a partitioned cookie "is tied to the top-level site where it's initially set and cannot be accessed from elsewhere." Partitioning is for a third-party embedded *within* a top-level site (e.g. an iframe/widget). It does **not** make a cookie set by `nerd-api.run.app` readable as a first-party session by the API across navigations the way a real session cookie needs; it also doesn't overcome the PSL prohibition on sharing across the two `run.app` names. CHIPS solves "embedded widget remembers state per top-level site," not "two sibling `run.app` services share a login session."

**Bottom line:** the cross-origin `__session` cookie pattern is fragile because (1) `run.app` PSL membership makes the services cross-site and forbids a shared cookie domain; (2) it depends on third-party cookies that are blocked in Safari/Firefox/Incognito today and globally disable-able in Chrome; and (3) CHIPS doesn't fit the sibling-service session-sharing use case.

### 1.5 Recommended architecture fixes (priority order)

**(a) STRONGLY PREFERRED — collapse to a single origin.** Put `nerd-frontend` and `nerd-api` behind one hostname using a Google Cloud external Application Load Balancer with **serverless NEGs** and path-based URL-map routing (e.g. `/api/*` → `nerd-api` backend, everything else → `nerd-frontend` backend), fronted by a custom domain you control (so cookies scope to *your* eTLD+1, not `run.app`). The gcloud recipe creates a serverless NEG per service, a backend service per NEG, and a URL map with path matchers:

```bash
# One serverless NEG per Cloud Run service
gcloud compute network-endpoint-groups create api-neg \
  --region=us-central1 --network-endpoint-type=serverless \
  --cloud-run-service=nerd-api
gcloud compute network-endpoint-groups create frontend-neg \
  --region=us-central1 --network-endpoint-type=serverless \
  --cloud-run-service=nerd-frontend

# A backend service per NEG (EXTERNAL_MANAGED)
gcloud compute backend-services create api-backend --global --load-balancing-scheme=EXTERNAL_MANAGED
gcloud compute backend-services add-backend api-backend --global \
  --network-endpoint-group=api-neg --network-endpoint-group-region=us-central1
gcloud compute backend-services create frontend-backend --global --load-balancing-scheme=EXTERNAL_MANAGED
gcloud compute backend-services add-backend frontend-backend --global \
  --network-endpoint-group=frontend-neg --network-endpoint-group-region=us-central1

# URL map: /api/* -> api-backend, everything else -> frontend-backend
gcloud compute url-maps create nerd-map --default-service frontend-backend
gcloud compute url-maps add-path-matcher nerd-map \
  --path-matcher-name=apimatcher --default-service=frontend-backend \
  --path-rules="/api/*=api-backend"
# ...then target-https-proxy + managed cert (your custom domain) + global forwarding rule.
```

This makes frontend and API **same-origin**, which:
   - eliminates the third-party-cookie problem entirely (the `__session` cookie becomes first-party to your custom domain),
   - eliminates the credentialed-CORS dance, and
   - lets you keep native `EventSource` if you wish (cookies now flow first-party).

   This is the single change that resolves both SSE blockers. Use a custom domain rather than relying on `*.run.app`.

**(b) IF STAYING CROSS-ORIGIN — use fetch-based SSE with a Bearer token.** Since `EventSource` can't send `Authorization`, replace it with `fetch()` + `ReadableStream`, sending the Firebase ID token as `Authorization: Bearer`. This is the recommended approach for authenticated HTTP streaming and avoids both cookies and URL-token leakage. (A token-in-query-string `EventSource` is a last resort and is discouraged because the token lands in logs/history.)

### 1.6 Corrected `fetch`-based SSE client (TypeScript) for `useResearchApi.ts`

Replaces native `EventSource`. Sends a Bearer token, parses `event:`/`data:` frames from the response body stream, supports `AbortController` cancellation, and tracks `Last-Event-ID` for reconnection.

```typescript
// hooks/useResearchApi.ts (excerpt)
// Fetch-based SSE consumer: works cross-origin AND sends Authorization.

export interface SSEEvent {
  event: string;        // defaults to "message" per SSE spec
  data: string;
  id?: string;
}

export interface StreamJobOptions {
  jobId: string;
  getIdToken: () => Promise<string>;     // e.g. firebase.auth().currentUser.getIdToken()
  apiBaseUrl: string;                    // NEXT_PUBLIC_API_BASE_URL (see Area 3)
  onEvent: (evt: SSEEvent) => void;
  onError?: (err: unknown) => void;
  signal?: AbortSignal;
}

export async function streamJob({
  jobId, getIdToken, apiBaseUrl, onEvent, onError, signal,
}: StreamJobOptions): Promise<void> {
  let lastEventId: string | undefined;
  let attempt = 0;

  while (!signal?.aborted) {
    try {
      const token = await getIdToken();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: "text/event-stream",
      };
      if (lastEventId) headers["Last-Event-ID"] = lastEventId;

      const resp = await fetch(`${apiBaseUrl}/jobs/${encodeURIComponent(jobId)}`, {
        method: "GET",
        headers,
        signal,
        // NOTE: no credentials:'include' needed — auth is the Bearer header, not a cookie.
      });

      if (resp.status === 401 || resp.status === 403) {
        onError?.(new Error(`SSE auth failed: ${resp.status}`));
        return; // token invalid/expired — let caller refresh & restart
      }
      if (!resp.ok || !resp.body) {
        throw new Error(`SSE connect failed: ${resp.status}`);
      }
      attempt = 0; // reset backoff on a successful connect

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      // Read the body incrementally; each reader.read() resolves as bytes arrive.
      while (true) {
        const { value, done } = await reader.read();
        if (done) break; // server closed the stream (e.g. Cloud Run timeout)
        buf += decoder.decode(value, { stream: true });

        // SSE events are separated by a blank line ("\n\n").
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const rawEvent = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const parsed = parseSSEFrame(rawEvent);
          if (parsed) {
            if (parsed.id) lastEventId = parsed.id;
            onEvent(parsed);
          }
        }
      }
      // Stream ended cleanly; loop will reconnect with Last-Event-ID if not aborted.
    } catch (err) {
      if (signal?.aborted) return;
      onError?.(err);
    }
    // Exponential backoff before reconnect (cap ~10s).
    attempt += 1;
    const delay = Math.min(1000 * 2 ** (attempt - 1), 10_000);
    await new Promise((r) => setTimeout(r, delay));
  }
}

function parseSSEFrame(raw: string): SSEEvent | null {
  let event = "message";
  let id: string | undefined;
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line === "" || line.startsWith(":")) continue; // comment / heartbeat
    const idx = line.indexOf(":");
    const field = idx === -1 ? line : line.slice(0, idx);
    const val = idx === -1 ? "" : line.slice(idx + 1).replace(/^ /, "");
    if (field === "event") event = val;
    else if (field === "data") dataLines.push(val);
    else if (field === "id") id = val;
    // "retry" intentionally ignored here; we manage our own backoff.
  }
  if (dataLines.length === 0 && event === "message") return null;
  return { event, data: dataLines.join("\n"), id };
}
```

Key points: `response.body.getReader()` yields chunks as they arrive rather than buffering the whole body; events are split on the `\n\n` boundary with a carry buffer for partial frames; `Last-Event-ID` enables server-side replay on reconnect; and a 401/403 path lets the caller refresh the Firebase token and restart.

### 1.7 Corrected FastAPI SSE endpoint with Firebase token verification

Validates the Firebase ID token from the `Authorization` header (via `firebase-admin`), then returns a `StreamingResponse` with `media_type="text/event-stream"` and the correct anti-buffering headers.

```python
# nerd-api: routers/jobs.py
import asyncio
import json
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from firebase_admin import auth as fb_auth

router = APIRouter()
# auto_error=False so we can return 401 (FastAPI's HTTPBearer otherwise returns 403).
bearer = HTTPBearer(auto_error=False)


async def verify_firebase(
    cred: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> dict:
    if cred is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token",
                            headers={"WWW-Authenticate": "Bearer"})
    try:
        # verify_id_token is CPU-light but does I/O on first key fetch; run off-loop.
        return await asyncio.to_thread(
            fb_auth.verify_id_token, cred.credentials, clock_skew_seconds=10
        )
    except fb_auth.ExpiredIdTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Expired token",
                            headers={"WWW-Authenticate": "Bearer"})
    except (fb_auth.InvalidIdTokenError, fb_auth.RevokedIdTokenError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token",
                            headers={"WWW-Authenticate": "Bearer"})


@router.get("/jobs/{job_id}")
async def stream_job(job_id: str, request: Request, user: dict = Depends(verify_firebase)):
    uid = user["uid"]

    async def event_generator():
        # Suggest a client retry floor; our TS client manages its own backoff.
        yield "retry: 3000\n\n"
        last_id = request.headers.get("Last-Event-ID")
        async for evt in job_event_source(job_id, uid, resume_after=last_id):
            if await request.is_disconnected():
                break
            yield f"id: {evt['seq']}\n"
            yield f"event: {evt['type']}\n"
            yield f"data: {json.dumps(evt['payload'])}\n\n"
        yield "event: done\ndata: {}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",   # disable proxy buffering so each chunk flushes
        },
    )
```

`X-Accel-Buffering: no` and `Cache-Control: no-cache` are the standard SSE headers to prevent intermediary buffering/caching; `is_disconnected()` lets the generator stop when the client goes away. (FastAPI ≥ 0.135 also ships a native `EventSourceResponse` at `fastapi.sse` that auto-sets these headers and emits 15-second keep-alive pings; either approach is fine.)

### 1.8 Cloud Run SSE gotchas

- **Request timeout bounds the stream.** Per the Cloud Run docs ("Configure request timeout for services"): *"The timeout is set by default to 5 minutes (300 seconds) and can be extended up to 60 minutes (3600 seconds)."* An SSE connection is a single long-lived request and **will be terminated at the timeout** regardless of activity. Set it explicitly: `gcloud run deploy nerd-api --timeout=3600`.
- **Streaming is supported but does not extend the timeout.** Per Google's guidance, streaming "keeps the HTTP connection active … [but] does not extend Cloud Run's maximum request timeout, and clients or proxies might still have their own timeout behavior."
- **Buffering.** `X-Accel-Buffering: no` matters because intermediaries may otherwise buffer the response; combined with `Cache-Control: no-cache` it ensures each `yield` flushes promptly.
- **Jobs that can exceed the timeout.** If a research job can run longer than the (max 60-min) request timeout, do **not** rely on a single SSE connection. Use the reconnection-with-`Last-Event-ID` pattern (built into the client above; the server replays from `resume_after`) and/or a **polling fallback** (`GET /jobs/{id}/status`). The Cloud Run request-timeout docs state explicitly: *"For a timeout longer than 15 minutes, Google recommends implementing retries and making sure the service is tolerant to clients re-connecting … either by ensuring requests are idempotent, or by designing request handlers in such a way that they can resume from the point where they left off."*

---

## AREA 2 — Worker / Services Flow-Efficiency Review

### 2.1 `asyncio.to_thread` around synchronous `generate_content` — acceptable, but the native async client is better

Wrapping the blocking google-genai `_client.models.generate_content(...)` calls in `asyncio.to_thread` is a *correct* stopgap: it offloads blocking I/O to a thread so the event loop isn't blocked. But `to_thread` runs on the default thread pool, whose size is bounded (`min(32, os.cpu_count()+4)` by default), so under concurrency you can saturate threads and add thread-scheduling overhead.

**Recommendation: migrate to the SDK's native async client.** The google-genai SDK provides `client.aio.models.generate_content(...)` — "a separate async implementation of every method under `client.aio`." This avoids the thread hop entirely and integrates cleanly with `asyncio.gather`. (For higher throughput, install `google-genai[aiohttp]`.) Use the async context manager / `await client.aio.aclose()` to release resources.

```python
# worker.py — async genai client + parallelized fan-out
from google import genai
from google.genai import types, errors

client = genai.Client()  # picks up creds/Vertex config from env
GROUNDING = types.GenerateContentConfig(
    tools=[types.Tool(google_search=types.GoogleSearch())],
    temperature=1.0,
    http_options=types.HttpOptions(timeout=timeout_min * 60 * 1000),  # ms
)

async def run_initial_research(prompt: str):
    return await client.aio.models.generate_content(
        model=MODEL, contents=prompt, config=GROUNDING)

async def run_deep_dive(prompt: str):
    return await client.aio.models.generate_content(
        model=MODEL, contents=prompt, config=GROUNDING)
```

### 2.2 Serial execution inefficiencies — parallelize with `gather` + bounded concurrency

The deep-dive flow currently runs `resolve_and_validate_all(raw_urls, url_cache)` and then `filter_broken_links(draft_markdown)` sequentially, and URL validations within them appear serial. URL validation is independent, network-bound work — an ideal `asyncio.gather` candidate. Bound concurrency with an `asyncio.Semaphore` so you don't open hundreds of sockets or trip rate limits.

```python
import asyncio

async def validate_urls(urls: list[str], cache: dict, limit: int = 10) -> dict[str, bool]:
    sem = asyncio.Semaphore(limit)
    async def check(u: str) -> tuple[str, bool]:
        if u in cache:
            return u, cache[u]
        async with sem:
            ok = await is_reachable(u)   # async HEAD/GET with timeout
        cache[u] = ok
        return u, ok
    results = await asyncio.gather(*(check(u) for u in urls))
    return dict(results)
```

Independent **initial-research** branches (e.g. multiple seed queries) and independent grounding calls can likewise be issued concurrently with `gather` — but cap concurrency per the genai quota, since 429s surface under parallel load (Section 2.5).

### 2.3 `_validate` double-fetching — share one validation pass

`resolve_and_validate_all` and `filter_broken_links` likely both fetch overlapping URL sets, double-paying network cost. Refactor to a **single resolve+validate pass that populates `url_cache`**, then have `filter_broken_links` consume the cache rather than re-fetching. Where the two genuinely operate on different URL sets, run them concurrently:

```python
async def _validate(raw_urls, draft_markdown, url_cache):
    # Resolve/validate once; both consumers read the shared cache.
    await resolve_and_validate_all(raw_urls, url_cache)
    draft_urls = extract_urls(draft_markdown)
    await validate_urls(draft_urls, url_cache)          # reuses cache, no double-fetch
    return filter_broken_links(draft_markdown, url_cache)  # pure, cache-driven
```

### 2.4 `synthesize_insights` in the critical path — make it concurrent or deferred

`synthesize_insights` runs synchronously inside `_build_result_payload` (itself wrapped in `to_thread`), so it blocks job completion. Two better options:

- **Overlap it.** If synthesis depends only on the draft (not on link validation), launch it concurrently with validation via `gather`, then join: `draft_payload, insights = await asyncio.gather(build_payload(), synthesize_insights_async())`.
- **Make it optional/streamed.** Emit the core result as soon as it's ready (let the user see the report), then stream `insights` as a follow-up SSE event. This removes synthesis from the completion-blocking path entirely and improves perceived latency.

### 2.5 Error handling — stop collapsing everything into `type(e).__name__`; handle quota distinctly

Catching broad `except Exception` and calling `fail_job(type(e).__name__)` discards the status code, message, and `RESOURCE_EXHAUSTED` status — losing the information needed to retry intelligently. The google-genai SDK has a precise, documented exception hierarchy in `google.genai.errors`:

- **`APIError`** (base, subclasses `Exception`) with attributes `.code` (int HTTP status), `.message`, `.status` (RPC string, e.g. `'RESOURCE_EXHAUSTED'`), `.details` (raw JSON), and `.response`.
- **`ClientError(APIError)`** for 4xx, **`ServerError(APIError)`** for 5xx.

A quota/rate-limit error surfaces as **`ClientError` with `.code == 429`** and `.status == 'RESOURCE_EXHAUSTED'` (confirmed by the SDK's own issue reports: `google.genai.errors.ClientError: 429 RESOURCE_EXHAUSTED. {'error': {'code': 429, … 'status': 'RESOURCE_EXHAUSTED', 'details': […]}}`). The SDK also has **built-in retry** (via `tenacity`) for codes `408, 429, 500, 502, 503, 504` with exponential backoff (≈1→60 s, ~5 attempts) — but note it **ignores the server-suggested `RetryInfo`/`retryDelay`** and uses fixed backoff; to honor the server's delay you must parse `e.details` yourself. The SDK does **not** depend on `google-api-core`, so do not try to catch these with `google.api_core.exceptions`.

```python
from google.genai import errors

async def process_job(job_id: str):
    try:
        ...
    except errors.ClientError as e:
        if e.code == 429:  # RESOURCE_EXHAUSTED — quota/rate limit
            retry_after = parse_retry_delay(e.details)  # from google.rpc.RetryInfo if present
            fail_job(job_id, status="rate_limited", code=429,
                     message=e.message, retry_after=retry_after, retryable=True)
        else:
            fail_job(job_id, status="client_error", code=e.code,
                     message=e.message, retryable=False)
    except errors.ServerError as e:           # 5xx — transient
        fail_job(job_id, status="upstream_error", code=e.code,
                 message=e.message, retryable=True)
    except errors.APIError as e:
        fail_job(job_id, status="api_error", code=e.code, message=e.message)
    except Exception as e:                    # last-resort: keep full detail
        logger.exception("job %s failed", job_id)
        fail_job(job_id, status="internal_error", message=repr(e))
```

Report structured errors (code, status, message, `retryable`, `retry_after`) rather than just a class name, so the frontend can distinguish "try again shortly" (429/5xx) from "this request is malformed" (other 4xx).

### 2.6 Timeout model — align Cloud Run `--timeout` with worker max processing time

A single `generate_content` call configured with up to a **4-minute** (`timeout_min*60*1000` ms) HTTP timeout runs *inside* a Cloud Run request whose default timeout is **300 s**. If the worker also does research + deep-dive + validation + synthesis sequentially, total processing easily exceeds 300 s and Cloud Run kills the request mid-flight. Two fixes:

1. **Align the layers.** Set Cloud Run `--timeout` to the worker's realistic max processing time **plus margin**, up to the 3600 s ceiling. Remember the timeout hierarchy: client ≥ LB/proxy ≥ Cloud Run ≥ application ≥ downstream. Each outer layer must be ≥ the inner one or it severs the connection early.
2. **Decouple long work from the request.** The robust pattern is: accept the job, return `202` immediately, run processing via **Cloud Tasks** (which provides configurable retry policies — "Cloud Run itself does not have a built-in retry mechanism for HTTP requests. If a request fails, it fails. For retry logic, you integrate with Cloud Tasks"), and let the client poll or stream status. This keeps request lifetimes short and bounded.

### 2.7 Idempotency and retries — guard against duplicate processing

Cloud Tasks **will retry** on failure (and at-least-once delivery means a job can be delivered more than once). The current worker has no guard against processing the same `job_id` twice, risking duplicate Gemini spend and duplicate result writes. Make the worker **idempotent per `job_id`**: on entry, atomically claim the job (e.g. compare-and-set its state from `queued`→`processing` in Firestore/DB); if already `processing`/`done`, no-op or return the existing result. Google's own long-timeout guidance is to "ensur[e] requests are idempotent" precisely because reconnects/retries create duplicate requests. Pair this with a Cloud Tasks queue configured with sane `--max-attempts` and backoff.

---

## AREA 3 — Corrected `deploy.sh` / Frontend Dockerfile for `NEXT_PUBLIC_API_BASE_URL`

### 3.1 Root cause

Next.js **inlines `NEXT_PUBLIC_*` environment variables into the client JS bundle at `next build` time** — it textually replaces every `process.env.NEXT_PUBLIC_API_BASE_URL` reference with a string literal during the build. The official Next.js docs state the value "will be inlined into any JavaScript sent to the browser," and warn: *"After being built, your app will no longer respond to changes to these environment variables … all `NEXT_PUBLIC_` variables will be frozen with the value evaluated at build time."*

Two compounding defects in N.E.R.D.:

1. **Build-time vs runtime mismatch.** Setting `NEXT_PUBLIC_API_BASE_URL` as a Cloud Run **runtime** env var has **no effect** — the value was already baked into the bundle (or baked as `undefined`/localhost fallback) at image-build time.
2. **Wrong variable name.** `deploy.sh` sets `BACKEND_URL`, but the code reads `NEXT_PUBLIC_API_BASE_URL`. So the build sees no value, the code's `localhost:8000` default is inlined, and the deployed frontend tries to reach `localhost:8000` in the cloud — which fails.

### 3.2 Corrected approach

For a frontend whose API URL is known per-environment at build time, the simplest correct fix is to **pass the value as a Docker build `ARG` → `ENV` so it's present in the environment when `next build` runs**. This is the recommended pattern: "the Dockerfile must pass them as … build arguments when building the image," because the values "are inlined into the bundle during the build and cannot be changed later."

The trade-off: a build-arg image is **environment-specific** — you must rebuild per environment. If you need one image promoted across staging/prod without rebuilding, use a **runtime-env pattern instead**: read the value on the server at request time (App Router server component with dynamic rendering / `unstable_noStore`), or inject a `window.__RUNTIME_ENV__` via a `<script>` in the root layout / an `env.js` written at container start, or expose a `/config` API route. Next.js itself recommends the App-Router dynamic-render approach to "use a singular Docker image that can be promoted through multiple environments with different values." **Recommendation for N.E.R.D.:** adopt the build-arg approach now (smallest change, fixes the bug); consider the runtime-env pattern later if multi-environment image promotion becomes a requirement.

### 3.3 Corrected frontend `Dockerfile` (multi-stage, `output: 'standalone'`)

```dockerfile
# syntax=docker/dockerfile:1

########## deps ##########
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

########## build ##########
FROM node:20-alpine AS build
WORKDIR /app

# The critical line: accept the API base URL as a BUILD ARG and promote it to ENV
# so that `next build` inlines the correct value into the client bundle.
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build      # next build — NEXT_PUBLIC_API_BASE_URL is baked in here

########## runtime ##########
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Cloud Run provides PORT (default 8080); Next standalone server respects it.
ENV PORT=8080

# Assumes next.config.js has: output: 'standalone'
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

EXPOSE 8080
CMD ["node", "server.js"]
```

The decisive change is `ARG NEXT_PUBLIC_API_BASE_URL` → `ENV NEXT_PUBLIC_API_BASE_URL` **before** `npm run build`. Without it, the build has no value and inlines the localhost fallback.

### 3.4 Corrected `deploy.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="your-project"
REGION="us-central1"

# 1) Deploy the API first so we can discover its URL.
gcloud run deploy nerd-api \
  --source ./api \
  --region "$REGION" \
  --timeout=3600 \
  --allow-unauthenticated   # or lock down + IAP/LB as appropriate

# 2) Capture the API's Cloud Run URL.
API_URL="$(gcloud run services describe nerd-api \
  --region "$REGION" --format='value(status.url)')"
echo "Discovered nerd-api URL: ${API_URL}"

# 3) Build the FRONTEND image, passing the API URL as a BUILD ARG.
#    This is the fix: the value must be present at BUILD time, not run time.
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/nerd/nerd-frontend:$(git rev-parse --short HEAD)"
gcloud builds submit ./frontend \
  --tag "$IMAGE" \
  --substitutions=_API_URL="$API_URL"
# (Cloud Build's docker build step must forward:
#    --build-arg NEXT_PUBLIC_API_BASE_URL=$_API_URL
#  e.g. in cloudbuild.yaml:
#    args: ['build','--build-arg','NEXT_PUBLIC_API_BASE_URL=${_API_URL}','-t','$IMAGE','.'])

# Equivalent plain Docker build (if not using Cloud Build):
# docker build \
#   --build-arg NEXT_PUBLIC_API_BASE_URL="$API_URL" \
#   -t "$IMAGE" ./frontend
# docker push "$IMAGE"

# 4) Deploy the frontend.
#    IMPORTANT: do NOT set NEXT_PUBLIC_API_BASE_URL as a runtime env var here —
#    it has no effect on an already-built bundle. And STOP setting BACKEND_URL;
#    the frontend never reads it.
gcloud run deploy nerd-frontend \
  --image "$IMAGE" \
  --region "$REGION" \
  --allow-unauthenticated
```

Two explicit corrections vs. the current script: (1) the API URL is passed at **build time** via `--build-arg NEXT_PUBLIC_API_BASE_URL=...`, not as a runtime env var; and (2) the erroneous `BACKEND_URL` runtime variable is **removed** because no frontend code reads it. The build-time vs run-time distinction is the whole ballgame: runtime env changes cannot alter values already inlined by `next build`.

---

## Recommendations (Staged)

**Stage 0 — Unblock deploy (hours).** Fix the Dockerfile build-arg + `deploy.sh` so `NEXT_PUBLIC_API_BASE_URL` is baked at build time and `BACKEND_URL` is removed. Verify by inspecting the built bundle for the correct API URL string. *Benchmark to change course:* if you anticipate promoting one image across staging/prod, switch to the runtime-env (`window.__RUNTIME_ENV__` or App-Router dynamic render) pattern instead.

**Stage 1 — Fix SSE auth (days).** Decide the topology:
- If you can provision a custom domain + load balancer: **collapse to one origin** (Section 1.5a). This is the recommended end state — it deletes both SSE blockers and lets cookies be first-party. *Benchmark:* choose this whenever you control DNS and can run an external ALB with serverless NEGs.
- Otherwise: ship the **fetch-based Bearer-token SSE client** (1.6) + **Firebase-verifying FastAPI endpoint** (1.7), and **remove the `__session` cookie dependency** for SSE. *Benchmark:* required if you must stay on raw `*.run.app` hostnames.

In both cases set `gcloud run deploy nerd-api --timeout=3600` and add `Last-Event-ID` reconnect + a polling fallback for jobs that may exceed the timeout.

**Stage 2 — Worker efficiency (days).** Migrate to `client.aio.models.generate_content`; parallelize URL validation with `gather` + `Semaphore`; de-duplicate the resolve/validate passes via a shared `url_cache`; move `synthesize_insights` off the completion-blocking path. *Benchmark:* if p95 job time still approaches the Cloud Run timeout, move processing to Cloud Tasks with a `202`+poll pattern.

**Stage 3 — Robustness (ongoing).** Implement distinct `ClientError`/`ServerError`/429 handling with structured error reporting and server-suggested `retry_after`; make the worker idempotent per `job_id` (atomic claim) since Cloud Tasks retries at-least-once.

---

## Caveats

- **Third-party-cookie timeline is fluid.** Chrome reversed its hard deprecation (July 2024) and dropped the standalone choice prompt (confirmed April 22, 2025); third-party cookies remain on by default in mainline Chrome as of 2025–2026 but are blocked in Safari/Firefox/Incognito. Do not design new auth around third-party cookies regardless — the `run.app` PSL issue breaks the N.E.R.D. cookie pattern independently of Chrome's timeline.
- **PSL membership can change**, but `run.app` is currently listed; treat sibling `*.run.app` services as cross-site.
- **Cloud Run max request timeout is 60 minutes**; truly long jobs need an async/decoupled design (Cloud Tasks + poll), not a longer SSE socket.
- **google-genai built-in retry ignores server `retryDelay`** and uses fixed exponential backoff; parse `e.details` if you need to honor the server's suggested wait. Exact retry-on-by-default behavior has varied across SDK versions — pin and verify your version.
- **Several illustrative code patterns** (SSE parsing, worker refactors, the load-balancer recipe) are adapted to N.E.R.D.'s described structure and gcloud conventions; test them against the actual `worker.py` / `useResearchApi.ts` / your project's networking before merging. The exact `target-https-proxy`/managed-cert/forwarding-rule steps for option 1.5(a) are abbreviated.