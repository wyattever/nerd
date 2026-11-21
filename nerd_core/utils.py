import re
import asyncio
from typing import Dict, Any, Tuple
from nerd_core.tools.liveness_validator import validate_link
from urllib.parse import urlparse
from functools import lru_cache
import os

# --- SECURITY & NETWORK UTILS ---

async def resolve_and_validate_url(url: str) -> Tuple[str, bool, str]:
    """
    Wrapper using the hardened liveness validator.
    Returns (resolved_url, is_valid, reason).
    """
    # 1. Sanity checks
    if len(url) > 700:
        return url, False, "URL Too Long (Potential Hallucination)"
    if re.search(r"([^/])\1{20,}", url):
        return url, False, "Corrupted URL String"

    # 2. Use the hardened validator
    result = await validate_link(url)
    
    # 3. Map result back to the expected (resolved_url, bool, reason) format
    resolved = result.resolved_url if result.resolved_url else url
    return resolved, result.is_live, result.reason


async def resolve_and_validate_all(urls: list[str], cache: dict[str, str] = None) -> dict[str, str]:
    """Helper to resolve a batch of URLs concurrently."""
    if cache is None:
        cache = {}
    
    results = {}
    tasks = []
    urls_to_resolve = []
    seen_in_batch = set()

    for url in urls:
        if url in cache:
            results[url] = cache[url]
        elif url not in seen_in_batch:
            seen_in_batch.add(url)
            urls_to_resolve.append(url)
            tasks.append(resolve_and_validate_url(url))

    if tasks:
        resolved_batch = await asyncio.gather(*tasks)
        batch_map = dict(zip(urls_to_resolve, resolved_batch))
        
        for url in urls:
            if url in batch_map:
                resolved, is_valid, reason = batch_map[url]
                if not is_valid:
                    results[url] = f"ERROR: {reason}"
                else:
                    results[url] = resolved
                    cache[url] = resolved
            
    return results


async def filter_broken_links(md_text: str) -> Tuple[str, list[str]]:
    """Resolve and label links concurrently without deleting them."""
    markdown_link_pattern = r"\[(?P<text>.*?)\]\s?\((?P<url>https?://[^\)\s<>\x22]+)\)"
    raw_url_pattern = r"(?<!\()\bhttps?://[^\)\s<>\x22]+"

    # Extract all unique URLs first for batch processing
    links_matches = list(re.finditer(markdown_link_pattern, md_text))
    raw_urls = re.findall(raw_url_pattern, md_text)
    
    all_urls = list(set([m.group("url") for m in links_matches] + raw_urls))
    
    # Resolve all URLs in parallel
    tasks = [resolve_and_validate_url(u) for u in all_urls]
    resolved_data = await asyncio.gather(*tasks)
    seen = dict(zip(all_urls, resolved_data))

    processed_md = md_text
    rejections = []
    
    # 1. Handle standard markdown links
    for match in links_matches:
        text = match.group("text")
        url = match.group("url")
        resolved_url, is_valid, reason = seen[url]
        
        if resolved_url != url:
            processed_md = processed_md.replace(f"({url})", f"({resolved_url})")
        
        if not is_valid or "Unverified" in reason:
            label = f" (Status: {reason})"
            if label not in processed_md:
                processed_md = processed_md.replace(
                    f"[{text}]({resolved_url})", 
                    f"[{text}]({resolved_url}){label}"
                )
            if not is_valid:
                rejections.append(f"{resolved_url} ({reason})")

    # 2. Handle raw URLs
    raw_matches = re.findall(raw_url_pattern, processed_md)
    for url in raw_matches:
        if url in seen:
            resolved_url, is_valid, reason = seen[url]
            if resolved_url != url:
                processed_md = processed_md.replace(url, resolved_url)
            if not is_valid and resolved_url not in [r.split(" ")[0] for r in rejections]:
                rejections.append(f"{resolved_url} ({reason})")
                
    return processed_md, rejections


# --- CSS LOADING & URL EXTRACTION ---

@lru_cache(maxsize=4)
def _load_css_cached(path, _mtime):
    with open(path, "r") as f:
        return f.read()

def load_css():
    path = "ncademi_combined.css"
    if os.path.exists(path):
        mtime = os.path.getmtime(path)
        return _load_css_cached(path, mtime)
    return "@import url('https://ncademi.org/wp-content/themes/ncademitheme/style.css');"

def extract_known_urls(markdown_string):
    return set(re.findall(r"https?://[^\)\s]+", markdown_string))