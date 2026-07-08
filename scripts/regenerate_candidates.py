import asyncio
import json
import os
import sys
from pathlib import Path

import httpx

API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000")
AUTH_TOKEN = os.getenv("AUTH_TOKEN", "local-bypass")

# Maximum wall-clock seconds to wait for a single job to complete.
JOB_TIMEOUT_SEC = 600  # 10 minutes

# Directory containing candidate JSON files, relative to repo root
# (or an absolute path if CANDIDATES_DIR is set).
CANDIDATES_DIR = os.getenv("CANDIDATES_DIR", "NCADEMI_candidates")

# Paths to candidate JSON files, relative to CANDIDATES_DIR.
# Update this list to the full set before running the batch.
CANDIDATE_FILES = [
    f"{CANDIDATES_DIR}/https-www-brainpop-com-classroom-solutions-product-0a57ed16.json",
    f"{CANDIDATES_DIR}/https-www-ck12-org-07e1b41a.json",
    f"{CANDIDATES_DIR}/https-www-deltamath-com-95a68574.json",
]

REPO_ROOT = Path(__file__).parent.parent


async def stream_to_completion(
    session: httpx.AsyncClient,
    job_id: str,
) -> dict:
    """
    Streams GET /jobs/{job_id} until event: end.
    Returns the parsed result payload dict.
    Raises RuntimeError on protocol violations, httpx errors on transport failures.
    """
    result: dict | None = None
    url = f"{API_BASE_URL}/jobs/{job_id}"

    # read=30s is safely above the 20-second SSE heartbeat interval.
    stream_timeout = httpx.Timeout(connect=10.0, read=30.0, write=10.0, pool=5.0)

    async with session.stream("GET", url, timeout=stream_timeout) as response:
        response.raise_for_status()
        event_type = ""
        async for line in response.aiter_lines():
            if line.startswith("event:"):
                event_type = line[len("event:"):].strip()
            elif line.startswith("data:"):
                data_str = line[len("data:"):].strip()
                if event_type == "result":
                    try:
                        result = json.loads(data_str)
                    except json.JSONDecodeError as exc:
                        raise RuntimeError(
                            f"Could not parse result payload for job {job_id}: {exc}"
                        )
                elif event_type == "end":
                    if result is None:
                        raise RuntimeError(
                            f"Job {job_id}: received 'end' event without a "
                            f"preceding 'result' event."
                        )
                    return result
            elif line == "":
                # Blank line resets event type per SSE spec.
                event_type = ""

    raise RuntimeError(
        f"Job {job_id}: SSE stream closed without an 'end' event."
    )


async def regenerate_candidate(
    session: httpx.AsyncClient, json_path: Path
) -> None:
    print(f"\n[REGEN] {json_path.name}")

    if not json_path.exists():
        print(f"  SKIP — file not found")
        return

    with open(json_path, "r", encoding="utf-8") as f:
        existing = json.load(f)

    product_url = existing.get("product_website_url", "").strip()
    if not product_url or product_url == "#":
        print(f"  SKIP — no product_website_url")
        return

    print(f"  URL: {product_url}")

    # Enqueue the research job.
    enqueue_resp = await session.post(
        f"{API_BASE_URL}/research/initial",
        json={
            "product_url": product_url,
            "timeout_min": 4,
            "save_as_candidate": True,
        },
    )
    enqueue_resp.raise_for_status()
    job_id = enqueue_resp.json()["job_id"]
    print(f"  Job: {job_id}")

    # Stream to completion with ceiling timeout.
    try:
        result = await asyncio.wait_for(
            stream_to_completion(session, job_id),
            timeout=JOB_TIMEOUT_SEC,
        )
    except asyncio.TimeoutError:
        print(f"  ERROR — timed out after {JOB_TIMEOUT_SEC}s")
        return
    except Exception as exc:
        print(f"  ERROR — {exc}")
        return

    parsed = result.get("parsed_listing")
    if not parsed:
        print(f"  ERROR — result payload missing 'parsed_listing'")
        return

    # Atomic write: tmp then rename so the file is never half-written.
    tmp_path = json_path.with_suffix(".tmp")
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(parsed, f, indent=2, ensure_ascii=False)
        tmp_path.replace(json_path)
        print(f"  SUCCESS")
    except Exception as exc:
        print(f"  ERROR — write failed: {exc}")
        if tmp_path.exists():
            tmp_path.unlink()


async def main() -> None:
    candidate_paths = [
        Path(p) if Path(p).is_absolute() else REPO_ROOT / p
        for p in CANDIDATE_FILES
    ]

    headers = {"Authorization": f"Bearer {AUTH_TOKEN}"}
    # read timeout is None here — stream_to_completion sets its own per-call.
    timeout = httpx.Timeout(connect=10.0, read=None, write=10.0, pool=5.0)

    async with httpx.AsyncClient(headers=headers, timeout=timeout) as session:
        # Sequential — one job at a time to respect Vertex AI quota.
        for path in candidate_paths:
            await regenerate_candidate(session, path)

    print("\n--- Regeneration complete ---")


if __name__ == "__main__":
    asyncio.run(main())