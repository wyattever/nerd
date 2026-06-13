"""
eval/provider.py — Promptfoo Custom Python Provider for N.E.R.D.
================================================================
Bridges Promptfoo's eval harness to the Vertex AI / Google Search
Grounding stack in src/services.py.
"""

from __future__ import annotations

import logging
import sys
import os

# ---------------------------------------------------------------------------
# Path bootstrap — lets the provider import src/* when Promptfoo's worker
# process cwd is the project root (the standard layout).
# ---------------------------------------------------------------------------
_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from src.services import run_initial_research, QuotaExhaustedError  # noqa: E402
from src.utils import resolve_and_validate_all, normalize_url        # noqa: E402

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Worker-scoped URL resolution cache.
# Keyed by raw redirect URI; value is the resolved canonical URL.
# Resets when the worker process restarts (i.e. between promptfoo runs).
# ---------------------------------------------------------------------------
_URL_CACHE: dict[str, str] = {}


def call_api(
    prompt: str,          # rendered prompt string from Promptfoo (ignored here)
    options: dict,        # provider options dict from YAML config
    context: dict,        # test-case variables, metadata, eval IDs
) -> dict:
    """
    Execute one N.E.R.D. research call and return a Promptfoo ProviderResponse.

    The `output` field is a newline-separated list of normalized canonical
    URLs found by the agent.

    On QuotaExhaustedError the provider returns an `error` key so Promptfoo
    marks the result as FAILED (not as a score-0 pass). This ensures 429 noise
    doesn't drag down the aggregate Recall baseline.
    """
    vars_: dict = context.get("vars", {})
    product_url: str = vars_.get("product_url", "").strip()
    product_name: str = vars_.get("product_name", product_url)

    if not product_url:
        return {
            "output": "",
            "error": "Missing required var: product_url",
        }

    # 1. Call the production research pipeline
    try:
        draft_markdown, raw_redirect_urls = run_initial_research(product_url)
    except QuotaExhaustedError as exc:
        logger.warning("Quota exhausted for %s: %s", product_url, exc)
        return {
            "output": "",
            "error": f"QUOTA_EXHAUSTED: {exc}",
            "metadata": {
                "product_url": product_url,
                "product_name": product_name,
                "error_type": "retryable",
            },
        }
    except Exception as exc:
        logger.exception("Unexpected error for %s", product_url)
        return {
            "output": "",
            "error": f"PROVIDER_ERROR: {type(exc).__name__}: {exc}",
            "metadata": {
                "product_url": product_url,
                "product_name": product_name,
                "error_type": "fatal",
            },
        }

    # 2. Resolve grounding-api-redirect URIs -> canonical URLs
    url_map: dict[str, str] = resolve_and_validate_all(
        raw_redirect_urls, _URL_CACHE
    )
    canonical_urls = list(url_map.values())

    # 3. Normalize all canonical URLs for consistent assertion scoring
    normalized = [
        normalize_url(u)
        for u in canonical_urls
        if u and not u.startswith("ERROR:")
    ]
    # Deduplicate while preserving order
    seen: set[str] = set()
    deduped: list[str] = []
    for u in normalized:
        if u and u not in seen:
            seen.add(u)
            deduped.append(u)

    # 4. Build the output string (one URL per line)
    output_str = "\n".join(deduped)

    return {
        "output": output_str,
        "tokenUsage": {
            "numRequests": 1,
        },
        "metadata": {
            "product_url": product_url,
            "product_name": product_name,
            "raw_redirect_count": len(raw_redirect_urls),
            "resolved_count": len(deduped),
        },
    }
