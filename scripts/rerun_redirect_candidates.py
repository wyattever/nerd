"""
scripts/rerun_redirect_candidates.py — Re-runs candidates with unresolved
grounding-api-redirect URLs through the real /research/initial pipeline,
sequentially, waiting for each job to fully complete before starting the
next one.

Why this exists (not scripts/reprocess_redirects.py): that script tries to
resolve the already-stored proxy tokens directly. Grounding-api-redirect
tokens are short-lived (Decision Log #10) -- by the time a candidate file
is old enough to be flagged, the tokens are very likely expired, so direct
resolution silently fails and reprocess_redirects.py permanently replaces
the link with a fake "broken-link" placeholder. This script instead
re-runs full research from scratch (fresh Gemini call, fresh grounding
metadata, fresh resolution) via the same POST /research/initial endpoint
any normal research job uses, with save_as_candidate=True to upsert the
existing candidate record in place once complete.

Usage (from repo root, with the local API running via run_nerd(), inside
the activated venv):
    python -m scripts.rerun_redirect_candidates [--dry-run] [--sleep SECONDS]

--dry-run: list the affected candidates and their product URLs, submit
nothing.
--sleep: seconds to wait between each candidate's job completion and the
next submission (default: 10). Purely a pacing courtesy between jobs, not
a substitute for waiting on job completion -- jobs are always awaited to
completion before moving on regardless of this value.

Environment variables:
    API_BASE_URL   Base URL of the running API  (default: http://localhost:8080)
    AUTH_TOKEN     Bearer token for auth        (default: local-bypass)
"""

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

import httpx

API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8080")
AUTH_TOKEN = os.getenv("AUTH_TOKEN", "local-bypass")
CANDIDATES_DIR = Path(os.getenv("CANDIDATES_DIR", str(Path.home() / "nerd_data" / "candidates")))


def find_affected_candidates() -> list[tuple[Path, str]]:
    """Returns (file_path, product_website_url) for every candidate file
    still containing an unresolved grounding-api-redirect marker."""
    affected = []
    for f in sorted(CANDIDATES_DIR.glob("*.json")):
        content = f.read_text()
        if "grounding-api-redirect" not in content:
            continue
        data = json.loads(content)
        url = data.get("product_website_url")
        if not url or url == "#":
            print(f"  WARNING: {f.name} has no usable product_website_url, skipping.")
            continue
        affected.append((f, url))
    return affected


async def run_and_wait(session: httpx.AsyncClient, product_url: str) -> dict:
    """Submits a research job and streams events until it completes, returning
    the final result payload."""
    resp = await session.post(
        f"{API_BASE_URL}/research/initial",
        json={"product_url": product_url, "timeout_min": 4, "save_as_candidate": True},
    )
    resp.raise_for_status()
    job_id = resp.json()["job_id"]
    print(f"    Enqueued job {job_id}")

    result_payload = None
    async with session.stream("GET", f"{API_BASE_URL}/jobs/{job_id}") as response:
        response.raise_for_status()
        last_event = None
        async for line in response.aiter_lines():
            if line.startswith("event: "):
                last_event = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
                if last_event == "status":
                    print(f"    ...{data.get('status')}")
                elif last_event == "result":
                    result_payload = data
            elif line.startswith("event: end"):
                break

    return result_payload


async def main_async(dry_run: bool, sleep_seconds: int) -> None:
    affected = find_affected_candidates()
    print(f"Found {len(affected)} candidate(s) with unresolved redirects in {CANDIDATES_DIR}:\n")
    for f, url in affected:
        print(f"  {f.name}  ->  {url}")

    if not affected:
        print("\nNothing to do.")
        return

    if dry_run:
        print("\n--dry-run: submitting nothing.")
        return

    headers = {"Authorization": f"Bearer {AUTH_TOKEN}"}
    timeout = httpx.Timeout(connect=10.0, read=300.0, write=10.0, pool=5.0)

    async with httpx.AsyncClient(headers=headers, timeout=timeout) as session:
        for i, (f, url) in enumerate(affected, 1):
            print(f"\n[{i}/{len(affected)}] Re-running {f.name} ({url})...")
            try:
                result = await run_and_wait(session, url)
                if result is None:
                    print(f"  FAILED: job did not return a result (check job status/error).")
                else:
                    still_broken = "grounding-api-redirect" in json.dumps(result)
                    if still_broken:
                        print(f"  WARNING: still contains grounding-api-redirect after re-run.")
                    else:
                        print(f"  OK: re-run complete, no unresolved redirects remain.")
            except Exception as exc:
                print(f"  ERROR: {exc}")

            if i < len(affected):
                print(f"  Waiting {sleep_seconds}s before next candidate...")
                await asyncio.sleep(sleep_seconds)

    print("\nDone. Re-run tests/integrity/test_candidate_files.py to confirm.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Re-run candidates with unresolved grounding-api-redirect URLs through the real research pipeline."
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--sleep", type=int, default=10, help="Seconds between each candidate (default: 10)")
    args = parser.parse_args()

    asyncio.run(main_async(args.dry_run, args.sleep))


if __name__ == "__main__":
    main()
