from __future__ import annotations

import os
import logging
import traceback
import asyncio
import uuid
from fastapi import FastAPI
from typing import Dict, Any

from nerd_core.generators import parse_markdown_to_listing
from nerd_core.services import (
    run_initial_research,
    run_deep_dive,
    QuotaExhaustedError,
)
# Integration: Using hardened liveness validator
from nerd_core.tools.liveness_validator import validate_link
from nerd_core.utils import resolve_and_validate_all, filter_broken_links
from nerd_core.adaptive_validation import adaptive_validate
from nerd_core.acr_validation import is_likely_vpat_acr
from . import schemas
from . import store
from .conversions import dataclass_to_pydantic
from .job_store import emit_event, complete_job, fail_job, claim_job

logger = logging.getLogger("nerd.worker")

app = FastAPI(title="N.E.R.D. Worker API")


class WorkerInitialRequest(schemas.InitialResearchRequest):
    job_id: str


class WorkerDeepDiveRequest(schemas.DeepDiveRequest):
    job_id: str


async def _validate(raw_urls: list[str], draft_markdown: str, url_cache: dict[str, str]):
    await resolve_and_validate_all(raw_urls, url_cache)
    validated_markdown, rejections = await filter_broken_links(draft_markdown)
    return validated_markdown, rejections


async def _build_result_payload(
    raw_markdown: str,
    validated_markdown: str,
    url_cache: dict[str, str],
    rejections: list[str],
    timeout_min: int,
) -> dict:
    listing_dc = parse_markdown_to_listing(validated_markdown)

    # Note: adaptive_validate now utilizes the hardened liveness_validator internally
    listing_dc.vendor_resources = await adaptive_validate(listing_dc.vendor_resources)
    listing_dc.other_resources = await adaptive_validate(listing_dc.other_resources)

    if listing_dc.acr_reports:
        is_valid, _ = await is_likely_vpat_acr(listing_dc.acr_reports[0].url)
        if not is_valid:
            listing_dc.acr_reports[0].url = "#"
            listing_dc.acr_reports[0].title = "None found"

    parsed = dataclass_to_pydantic(listing_dc)
    payload = schemas.JobResultPayload(
        raw_markdown=raw_markdown,
        parsed_listing=parsed,
        url_cache=url_cache,
        rejections=rejections,
    )
    return payload.model_dump(mode="json")


@app.post("/worker/initial")
async def worker_initial(req: WorkerInitialRequest):
    job_id = req.job_id
    worker_id = str(uuid.uuid4())

    if not await claim_job(job_id, worker_id=worker_id):
        print(f"[WORKER] Job {job_id} already claimed or missing. Skipping.")
        return {"status": "already_processed"}

    url_cache: Dict[str, str] = {}
    print(f"[WORKER] Starting initial research for job {job_id} | URL: {req.product_url}")

    try:
        draft, raw_urls = await asyncio.to_thread(
            run_initial_research, req.product_url, req.timeout_min
        )
        print(f"[WORKER] Research step 1 done for {job_id}. Found {len(raw_urls)} URLs.")

        await emit_event(job_id, "validating_links")
        validated_md, rejections = await _validate(raw_urls, draft, url_cache)
        print(f"[WORKER] Validation done for {job_id}. Rejections: {len(rejections)}")

        result = await _build_result_payload(draft, validated_md, url_cache, rejections, req.timeout_min)
        await complete_job(job_id, result)
        print(f"[WORKER] Job {job_id} COMPLETED successfully.")

        if req.save_as_candidate:
            try:
                candidate_data = dict(result["parsed_listing"])
                candidate_data["raw_markdown"] = result["raw_markdown"]
                slug = await store.upsert_candidate(candidate_data)
                print(f"[WORKER] Auto-persisted candidate '{slug}' for job {job_id}.")
            except Exception as _persist_err:
                logger.warning(
                    "Auto-persist failed for job %s (non-fatal): %s",
                    job_id,
                    _persist_err,
                )

    except QuotaExhaustedError:
        await fail_job(job_id, "quota_exhausted", 429)
    except Exception as e:
        print(f"[WORKER] Initial research job {job_id} FAILED: {type(e).__name__}: {e}")
        traceback.print_exc()
        logger.exception("Initial research job failed")
        await fail_job(job_id, type(e).__name__)

    return {"status": "processed"}


@app.post("/worker/deep-dive")
async def worker_deep_dive(req: WorkerDeepDiveRequest):
    job_id = req.job_id
    worker_id = str(uuid.uuid4())

    if not await claim_job(job_id, worker_id=worker_id):
        print(f"[WORKER] Job {job_id} already claimed or missing. Skipping.")
        return {"status": "already_processed"}

    url_cache = dict(req.url_cache)

    try:
        await emit_event(job_id, "deep_dive")
        new_draft, raw_urls = await asyncio.to_thread(
            run_deep_dive, req.product_url, req.product_name, req.current_draft, req.timeout_min
        )

        await emit_event(job_id, "validating_links")
        validated_delta, rejections = await _validate(raw_urls, new_draft, url_cache)

        full_raw_markdown = req.current_draft + "\n\n" + new_draft
        full_validated_markdown = req.current_draft + "\n\n" + validated_delta

        result = await _build_result_payload(
            full_raw_markdown, full_validated_markdown, url_cache, rejections, req.timeout_min
        )
        await complete_job(job_id, result)

    except QuotaExhaustedError:
        await fail_job(job_id, "quota_exhausted", 429)
    except Exception as e:
        print(f"[WORKER] Deep-dive job {job_id} FAILED: {type(e).__name__}: {e}")
        traceback.print_exc()
        logger.exception("Deep-dive job failed")
        await fail_job(job_id, type(e).__name__)

    return {"status": "processed"}