"""
scraper.py — Golden Dataset Builder for N.E.R.D. Eval Pipeline
==============================================================
Scrapes live NCADEMI directory product pages to build the eval_data.json
Golden Dataset used by Promptfoo and the DSPy/GEPA optimizer.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import NamedTuple, Optional

import httpx
from bs4 import BeautifulSoup

# ---------------------------------------------------------------------------
# Path bootstrap
# ---------------------------------------------------------------------------
_PROJECT_ROOT = Path(__file__).parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

try:
    from src.utils import normalize_url
except ImportError:
    def normalize_url(url: str) -> str:  # type: ignore[misc]
        return url.strip()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Default product list - fallback if indexing fails
# ---------------------------------------------------------------------------
NCADEMI_PRODUCT_INDEX = "https://ncademi.org/provide/directory/products/"

DEFAULT_OUTPUT = Path("eval/eval_data.json")

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; ncademi-eval-scraper/1.0; "
        "+https://ncademi.org)"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

_OTHER_SOURCES_TEXT = "from other sources"


class ScrapedProduct(NamedTuple):
    product_name: str
    input_url: str
    vendor_name: str
    ground_truth_vendor: list[str]
    ground_truth_other: list[str]


def _is_valid_href(href: Optional[str]) -> bool:
    """Reject anchors, mailto, tel, and relative paths."""
    if not href:
        return False
    lower = href.lower()
    return (
        lower.startswith("http://") or lower.startswith("https://")
    ) and not lower.startswith("mailto:") and not lower.startswith("tel:")


def _extract_links_from_next_ul(h3_tag) -> list[str]:
    """Find the <ul> immediately after an <h3> and extract all UNIQUE href values."""
    sibling = h3_tag.find_next_sibling()
    while sibling:
        tag_name = sibling.name
        if tag_name == "ul":
            seen: set[str] = set()
            result: list[str] = []
            for a in sibling.find_all("a", href=True):
                href = a["href"]
                if not _is_valid_href(href):
                    continue
                normalized = normalize_url(href)
                if normalized and normalized not in seen:
                    seen.add(normalized)
                    result.append(normalized)
            return result
        # Stop if we hit another block-level element (next section started)
        if tag_name in ("h2", "h3", "h4", "div", "section"):
            break
        sibling = sibling.find_next_sibling()
    return []


def _scrape_page(html: str, page_url: str) -> Optional[ScrapedProduct]:
    soup = BeautifulSoup(html, "html.parser")

    # Product name
    h1 = soup.find("h1", class_="page-title") or soup.find("h1")
    product_name = h1.get_text(strip=True) if h1 else "Unknown"

    vendor_urls: list[str] = []
    other_urls:  list[str] = []
    vendor_name: str = "Unknown"

    for h3 in soup.find_all("h3"):
        text = h3.get_text(strip=True)
        text_lower = text.lower()

        if _OTHER_SOURCES_TEXT in text_lower:
            # "From Other Sources"
            other_urls = _extract_links_from_next_ul(h3)

        elif text_lower.startswith("from "):
            # "From Adobe", "From Google", etc.
            vendor_name = text[5:].strip()  # len("From ") == 5
            vendor_urls = _extract_links_from_next_ul(h3)

    return ScrapedProduct(
        product_name=product_name,
        input_url=page_url,
        vendor_name=vendor_name,
        ground_truth_vendor=vendor_urls,
        ground_truth_other=other_urls,
    )


def _fetch_with_retry(
    client: httpx.Client,
    url: str,
    max_retries: int = 3,
    base_delay: float = 1.0,
) -> Optional[httpx.Response]:
    for attempt in range(max_retries):
        try:
            response = client.get(url, timeout=15.0)
            if response.status_code == 200:
                return response
            if response.status_code in (403, 404):
                logger.error("Permanent error %s for %s", response.status_code, url)
                return None
            delay = base_delay * (2 ** attempt)
            logger.warning("HTTP %s for %s — retrying in %.1fs", response.status_code, url, delay)
            time.sleep(delay)
        except (httpx.ConnectError, httpx.TimeoutException) as exc:
            delay = base_delay * (2 ** attempt)
            logger.warning("Network error for %s: %s — retrying in %.1fs", url, exc, delay)
            time.sleep(delay)
    return None


def get_all_product_urls(index_url: str = NCADEMI_PRODUCT_INDEX) -> list[str]:
    """Scrapes the directory index page to discover all product URLs."""
    logger.info("Indexing products from %s...", index_url)
    with httpx.Client(headers=_HEADERS, follow_redirects=True) as client:
        resp = _fetch_with_retry(client, index_url)
        if not resp:
            return []
        
        soup = BeautifulSoup(resp.text, "html.parser")
        # Product links are in lists, typically after ## A, ## B headers
        # We look for all links that match the /products/product-slug/ pattern
        links = []
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if "/products/" in href and href != index_url and href.endswith("/"):
                links.append(href)
        
        # Deduplicate and sort
        unique_links = sorted(list(set(links)))
        logger.info("Found %d products in directory.", len(unique_links))
        return unique_links


def _product_to_record(p: ScrapedProduct) -> dict:
    return {
        "product_name": p.product_name,
        "input_url": p.input_url,
        "ground_truth_vendor": p.ground_truth_vendor,
        "ground_truth_other": p.ground_truth_other,
        "metadata": {
            "vendor_name": p.vendor_name,
            "scraped_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "source_page": p.input_url,
            "difficulty": "unset",
            "known_failure_mode": "",
        },
    }


def build_golden_dataset(
    urls: list[str],
    output_path: Path = DEFAULT_OUTPUT,
    dry_run: bool = False,
    merge: bool = False,
    polite_delay: float = 1.0,
) -> list[dict]:
    existing_records: list[dict] = []
    existing_urls: set[str] = set()

    if merge and output_path.exists():
        with open(output_path) as f:
            existing_records = json.load(f)
        existing_urls = {r["input_url"] for r in existing_records}
        logger.info("Merge mode: loaded %d existing records", len(existing_records))

    new_records: list[dict] = []
    skipped = 0

    with httpx.Client(headers=_HEADERS, follow_redirects=True) as client:
        for i, url in enumerate(urls):
            if url in existing_urls:
                skipped += 1
                continue

            logger.info("Scraping [%d/%d]: %s", i + 1, len(urls), url)
            response = _fetch_with_retry(client, url)

            if response is None:
                logger.warning("Could not fetch %s — skipped.", url)
            else:
                product = _scrape_page(response.text, url)
                if product:
                    record = _product_to_record(product)
                    new_records.append(record)
                    logger.info("  ✓ %s | vendor: %d | other: %d", 
                                product.product_name, 
                                len(product.ground_truth_vendor), 
                                len(product.ground_truth_other))

            if i < len(urls) - 1:
                time.sleep(polite_delay)

    full_dataset = existing_records + new_records

    if dry_run:
        print(json.dumps(full_dataset, indent=2))
    else:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(full_dataset, f, indent=2, ensure_ascii=False)
        logger.info("Written to %s", output_path)

    return full_dataset


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build the N.E.R.D. Golden Dataset from live NCADEMI pages.",
    )
    parser.add_argument("--urls", nargs="+", metavar="URL")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--merge", action="store_true")
    parser.add_argument("--delay", type=float, default=1.0)
    args = parser.parse_args()

    if args.urls:
        target_urls = args.urls
    else:
        # Default to indexing the whole directory
        target_urls = get_all_product_urls()
        if not target_urls:
            logger.error("Failed to index products. Use --urls to specify manually.")
            sys.exit(1)

    build_golden_dataset(
        urls=target_urls,
        output_path=args.output,
        dry_run=args.dry_run,
        merge=args.merge,
        polite_delay=args.delay,
    )


if __name__ == "__main__":
    main()
