"""
eval/build_grounding_cache.py — Pre-resolve Production Grounding URLs for GEPA
===============================================================================
This script bridges the two halves of the N.E.R.D. eval architecture:

  Production path  (nerd_core/services.py + real Google Search Grounding)
        ↓  resolves redirect URLs to canonical form
  eval/grounding_cache.json  (keyed by product input_url)
        ↓  loaded by optimize.py as `cached_predicted_urls`
  GEPA scoring  (DSPy/LiteLLM path, no grounding available)

Why this exists: DSPy routes LM calls through LiteLLM, which silently
drops Google Search Grounding metadata. So GEPA cannot call the grounded
pipeline directly. Instead, this script runs the production grounded calls
ONCE, caches the resolved canonical URLs, and optimize.py uses the cache
for scoring during the optimization loop.

Run this once before running optimize.py, and re-run whenever:
  - You add new products to eval_data.json
  - The golden dataset is significantly updated
  - More than ~30 days have passed (grounding redirect URIs expire)

Usage
-----
  python eval/build_grounding_cache.py
  python eval/build_grounding_cache.py --force   # re-run even if cache exists
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from nerd_core.services import run_initial_research, QuotaExhaustedError  # noqa: E402
from nerd_core.utils import resolve_and_validate_all, normalize_url        # noqa: E402

EVAL_DIR        = Path(__file__).parent
GOLDEN_DATASET  = EVAL_DIR / "eval_data.json"
GROUNDING_CACHE = EVAL_DIR / "grounding_cache.json"


def build_cache(force: bool = False, delay: int = 0) -> None:
    if not GOLDEN_DATASET.exists():
        logger.error("Golden Dataset not found: %s", GOLDEN_DATASET)
        sys.exit(1)

    with open(GOLDEN_DATASET) as f:
        dataset: list[dict] = json.load(f)

    # Load existing cache to support incremental updates
    cache: dict[str, list[str]] = {}
    if GROUNDING_CACHE.exists() and not force:
        with open(GROUNDING_CACHE) as f:
            cache = json.load(f)
        logger.info("Loaded existing cache: %d entries", len(cache))

    url_resolution_cache: dict[str, str] = {}

    for i, record in enumerate(dataset):
        product_url = record.get("input_url", "")
        product_name = record.get("product_name", product_url)

        if product_url in cache and not force:
            logger.info(
                "[%d/%d] SKIP (cached): %s", i + 1, len(dataset), product_name
            )
            continue

        logger.info(
            "[%d/%d] Running grounded research: %s",
            i + 1, len(dataset), product_name,
        )
        try:
            _draft, raw_redirect_urls = run_initial_research(product_url)
            url_map = resolve_and_validate_all(raw_redirect_urls, url_resolution_cache)
            canonical_urls = [
                normalize_url(u)
                for u in url_map.values()
                if u and not u.startswith("ERROR:")
            ]
            cache[product_url] = canonical_urls
            logger.info("  → %d canonical URLs resolved", len(canonical_urls))

        except QuotaExhaustedError:
            logger.warning("  429 quota exhausted — skipping %s", product_name)
            continue
        except Exception as exc:
            logger.error("  Error for %s: %s", product_name, exc)
            continue

        # Write incrementally so a mid-run crash doesn't lose all progress
        with open(GROUNDING_CACHE, "w") as f:
            json.dump(cache, f, indent=2)

        if delay > 0 and i < len(dataset) - 1:
            logger.info("  Sleeping for %d seconds...", delay)
            time.sleep(delay)

    logger.info(
        "Grounding cache complete: %d/%d products cached → %s",
        len(cache), len(dataset), GROUNDING_CACHE,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build the grounding URL cache for GEPA optimization."
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-run all products even if already cached.",
    )
    parser.add_argument(
        "--delay",
        type=int,
        default=0,
        help="Seconds to delay between research requests (measured process).",
    )
    args = parser.parse_args()
    build_cache(force=args.force, delay=args.delay)


if __name__ == "__main__":
    main()
