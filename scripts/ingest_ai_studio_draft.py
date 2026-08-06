"""
scripts/ingest_ai_studio_draft.py — Validate an AI-Studio-generated markdown
draft using the real N.E.R.D. pipeline logic, then submit it as a candidate
via the running API (POST /admin/candidates) — never writes to Firestore
directly.

Why this exists: AI Studio's free tier can generate a research draft at zero
GC cost, but that draft must go through the exact same validation the real
worker pipeline runs (resolve_and_validate_all, filter_broken_links,
parse_markdown_to_listing, adaptive_validate, ACR check) before it's fit to
become a candidate. This script imports those functions directly from
nerd_core rather than reimplementing them, and submits the result through
the already-running API rather than touching Firestore itself — the API
process already has the correct GOOGLE_CLOUD_PROJECT set via run_nerd(),
so this script can never repeat the acp-vertex-core incident.

Usage (from repo root, with the local API running via run_nerd()):
    python -m scripts.ingest_ai_studio_draft <markdown_file> [--dry-run]

markdown_file: a plain text file containing the AI Studio output, expected
to follow the format in prompts/research_schema_prompt.txt (which mirrors
prompts/system_prompt.j2).

--dry-run: run full validation and print the resulting payload, but do not
POST to the API. Always run with --dry-run first.

Environment variables:
    API_BASE_URL   Base URL of the running API  (default: http://localhost:8080)
    AUTH_TOKEN     Bearer token for auth        (default: local-bypass)
"""

import argparse
import asyncio
import json
import os
import re
import sys
from pathlib import Path

import httpx

sys.path.append(os.getcwd())

from nerd_core.pipeline import validate_draft
from api.conversions import dataclass_to_pydantic

API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8080")
AUTH_TOKEN = os.getenv("AUTH_TOKEN", "local-bypass")

_URL_RE = re.compile(r'https?://[^\s<>"\')\]]+')


async def validate_and_build(draft_markdown: str) -> dict:
    """Calls nerd_core.pipeline.validate_draft -- the same sequence
    api/worker.py runs, extracted in Commit 1 of the Import Data build.
    See nerd-import-data-architecture-v4.md §4.1, §11.2.

    raw_urls is still deduped and extracted here (not left to
    validate_draft's default) to preserve this script's original
    behavior exactly -- validate_draft's own extraction does not dedupe,
    since api/worker.py never needed to (its raw_urls come from Gemini's
    return value, not a regex scan of markdown)."""
    raw_urls = list(set(_URL_RE.findall(draft_markdown)))

    result = await validate_draft(draft_markdown, raw_urls=raw_urls)

    parsed = dataclass_to_pydantic(result.listing)
    payload = parsed.model_dump(mode="json")
    payload["raw_markdown"] = draft_markdown

    print(f"Rejections during link validation: {len(result.rejections)}")
    for r in result.rejections:
        print(f"  - {r}")
    print(f"Vendor resources: {result.diagnostics.surviving_vendor_count} surviving of {result.diagnostics.parsed_vendor_count} parsed")
    print(f"Other resources: {result.diagnostics.surviving_other_count} surviving of {result.diagnostics.parsed_other_count} parsed")
    if result.diagnostics.dropped_urls:
        print(f"Dropped URLs ({len(result.diagnostics.dropped_urls)}):")
        for u in result.diagnostics.dropped_urls:
            print(f"  - {u}")
    print(f"ACR reports: {len(result.listing.acr_reports)}")
    if result.diagnostics.acr_reset:
        print("ACR was reset to 'None found' (failed liveness/format check)")

    return payload


async def submit_candidate(payload: dict) -> None:
    headers = {"Authorization": f"Bearer {AUTH_TOKEN}"}
    async with httpx.AsyncClient(headers=headers, timeout=30.0) as session:
        response = await session.post(f"{API_BASE_URL}/admin/candidates", json=payload)
        response.raise_for_status()
        result = response.json()
        print(f"\nSubmitted successfully: {result}")


async def main_async(markdown_file: Path, dry_run: bool) -> None:
    draft_markdown = markdown_file.read_text(encoding="utf-8")

    print(f"Validating draft from {markdown_file.name}...")
    payload = await validate_and_build(draft_markdown)

    if payload.get("vendor_resources") == [] and payload.get("other_resources") == []:
        print(
            "\nWARNING: both vendor_resources and other_resources are empty after "
            "validation. This draft likely has no usable accessibility content, or "
            "failed to parse correctly. Refusing to submit even without --dry-run."
        )
        return

    if dry_run:
        print("\n--- DRY RUN: payload below, NOT submitted ---")
        print(json.dumps(payload, indent=2)[:3000])
        print("... (truncated)" if len(json.dumps(payload)) > 3000 else "")
        return

    await submit_candidate(payload)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Validate and ingest an AI-Studio-generated markdown draft as a N.E.R.D. candidate."
    )
    parser.add_argument("markdown_file", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not args.markdown_file.exists():
        print(f"Error: file not found: {args.markdown_file}")
        sys.exit(1)

    asyncio.run(main_async(args.markdown_file, args.dry_run))


if __name__ == "__main__":
    main()
