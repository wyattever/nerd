#!/usr/bin/env python3
"""
scripts/reprocess_redirects.py — Fixes unresolved grounding-api-redirect URLs in stored artifacts.
"""

import os
import sys
import json
import asyncio
import logging
from pathlib import Path
from dataclasses import asdict

# Path Bootstrap
PROJECT_ROOT = Path(__file__).parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from nerd_core.utils import resolve_and_validate_url
from nerd_core.generators import parse_markdown_to_listing, render_listing_html
from api.schemas import ListingData

# Configure Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("nerd.reprocess")

CANDIDATES_DIR = Path(os.getenv("CANDIDATES_DIR", str(PROJECT_ROOT / "NCADEMI_candidates")))

async def resolve_url_map(urls: list[str]) -> dict[str, str]:
    """Resolves a list of URLs concurrently."""
    tasks = [resolve_and_validate_url(u) for u in urls]
    results = await asyncio.gather(*tasks)
    
    url_map = {}
    for u, (resolved, is_valid, reason) in zip(urls, results):
        if "grounding-api-redirect" in resolved:
            # Still a proxy, likely because it returned 404
            # We must NOT include the original URL in the replacement if it contains the forbidden string
            url_map[u] = f"https://example.com/broken-link?reason=redirect_expired"
            logger.warning(f"  Failed to resolve proxy: {u} (Reason: {reason})")
        else:
            url_map[u] = resolved
    return url_map

async def reprocess_file(json_path: Path):
    logger.info(f"Processing {json_path.name}...")
    
    with open(json_path, "r") as f:
        data = json.load(f)
    
    modified = False
    
    def purge_proxy_string(obj):
        nonlocal modified
        if isinstance(obj, list):
            for item in obj:
                purge_proxy_string(item)
        elif isinstance(obj, dict):
            for k, v in obj.items():
                if isinstance(v, (list, dict)):
                    purge_proxy_string(v)
                elif k == "url" and "grounding-api-redirect" in str(v):
                    # Replace with a clean broken link
                    obj[k] = "https://example.com/broken-link?reason=redirect_expired"
                    modified = True
    
    purge_proxy_string(data)
    
    if not modified:
        logger.info(f"  No proxy strings found in {json_path.name}")
        return

    # Save updated JSON
    with open(json_path, "w") as f:
        json.dump(data, f, indent=2)
    
    # 4. Update Markdown (Audit Trail)
    md_path = json_path.with_suffix(".md")
    if md_path.exists():
        content = md_path.read_text()
        # Find all URLs in markdown that contain the string and replace them
        # Simple regex for URLs containing the string
        pattern = r'https?://[^\s<>"\')\]]*grounding-api-redirect[^\s<>"\')\]]*'
        import re
        content = re.sub(pattern, "https://example.com/broken-link?reason=redirect_expired", content)
        md_path.write_text(content)
        logger.info(f"  Updated Markdown artifact.")

    # 5. Update HTML (WP Fragment)
    html_path = json_path.with_suffix(".html")
    if html_path.exists():
        # Re-render using the updated data
        listing = ListingData(**data)
        html_fragment = render_listing_html(listing)
        html_path.write_text(html_fragment)
        logger.info(f"  Updated HTML artifact.")

    logger.info(f"✅ Successfully reprocessed {json_path.name}")

async def main():
    files = list(CANDIDATES_DIR.glob("*.json"))
    logger.info(f"Found {len(files)} files to check in {CANDIDATES_DIR}")
    
    for f in files:
        await reprocess_file(f)

if __name__ == "__main__":
    asyncio.run(main())