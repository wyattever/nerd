"""
scripts/ingest_candidates.py — Bulk URL ingestion via POST /admin/candidates/batch.

Usage (from repo root):
    python -m scripts.ingest_candidates <url_file>

url_file is a plain text file with one URL per line.
Lines that are empty or start with '#' are skipped.

Requirements:
    pip install httpx

Environment variables:
    API_BASE_URL   Base URL of the running API  (default: http://localhost:8000)
    AUTH_TOKEN     Bearer token for auth        (default: local-bypass)

A timestamped JSON job log is written alongside the input file on completion
so that any enqueued job IDs are recoverable if the script dies mid-run.
"""

import asyncio
import json
import os
import sys
from datetime import datetime
from pathlib import Path

import httpx

API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000")
AUTH_TOKEN = os.getenv("AUTH_TOKEN", "local-bypass")

# Must not exceed the server-side Field(max_length=50) on BatchResearchRequest.
BATCH_SIZE = 50


async def ingest(url_file: Path) -> None:
    raw_lines = url_file.read_text(encoding="utf-8").splitlines()
    urls = [
        line.strip()
        for line in raw_lines
        if line.strip() and not line.strip().startswith("#")
    ]

    if not urls:
        print("No URLs found in file. Nothing to do.")
        return

    print(f"Found {len(urls)} URL(s) in {url_file.name}.")
    print(f"Submitting in batches of up to {BATCH_SIZE}.")

    log_path = url_file.with_suffix(
        f".{datetime.now().strftime('%Y%m%d_%H%M%S')}.log.json"
    )
    all_jobs: list[dict] = []

    headers = {"Authorization": f"Bearer {AUTH_TOKEN}"}
    timeout = httpx.Timeout(connect=10.0, read=30.0, write=10.0, pool=5.0)

    async with httpx.AsyncClient(headers=headers, timeout=timeout) as session:
        for i in range(0, len(urls), BATCH_SIZE):
            batch = urls[i : i + BATCH_SIZE]
            batch_num = i // BATCH_SIZE + 1
            print(f"\nBatch {batch_num}: submitting {len(batch)} URL(s)...")
            try:
                response = await session.post(
                    f"{API_BASE_URL}/admin/candidates/batch",
                    json={"urls": batch},
                )
                response.raise_for_status()
                jobs = response.json().get("jobs", [])
                all_jobs.extend(jobs)
                for job in jobs:
                    print(f"  Enqueued: {job['url']}  →  job_id={job['job_id']}")
            except httpx.HTTPStatusError as exc:
                print(
                    f"  ERROR — HTTP {exc.response.status_code}: {exc.response.text}"
                )
            except Exception as exc:
                print(f"  ERROR — {exc}")

    # Write job log for recovery even if some batches errored.
    log_path.write_text(
        json.dumps(
            {
                "submitted_at": datetime.now().isoformat(),
                "source_file": str(url_file),
                "jobs": all_jobs,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nJob log: {log_path}")
    print(f"Total enqueued: {len(all_jobs)}")


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: python -m scripts.ingest_candidates <url_file>")
        sys.exit(1)

    url_file = Path(sys.argv[1])
    if not url_file.exists():
        print(f"Error: file not found: {url_file}")
        sys.exit(1)

    asyncio.run(ingest(url_file))


if __name__ == "__main__":
    main()