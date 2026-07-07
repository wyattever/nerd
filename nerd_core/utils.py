import re
import asyncio
from typing import Dict, Any, Tuple
from nerd_core.tools.liveness_validator import validate_link
from dataclasses import dataclass, field
from urllib.parse import urlparse, urlsplit, urlunsplit, parse_qsl, urlencode
from functools import lru_cache
import os
from url_normalize import url_normalize

# --- SECURITY & NETWORK UTILS ---

async def resolve_and_validate_url(url: str) -> Tuple[str, bool, str]:
    """
    Wrapper to maintain API compatibility, now using the hardened liveness validator.
    Returns (resolved_url, is_valid, reason).
    """
    # 1. Sanity checks
    if len(url) > 700:
        return url, False, "URL Too Long (Potential Hallucination)"
    if re.search(r"([^/])\1{20,}", url):
        return url, False, "Corrupted URL String"

    # 2. Use the hardened validator
    result = await validate_link(url)
    
    # 3. Map result back to the expected (url, bool, reason) format
    return url, result.is_live, result.reason


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
    markdown_link_pattern = r'\[(?P<text>.*?)\]\s?\((?P<url>https?://[^\)\s<>"]+)\)'
    raw_url_pattern = r'(?<!\()\bhttps?://[^\)\s<>"]+'

    # Extract all unique URLs first for batch processing
    links_matches = list(re.finditer(markdown_link_pattern, md_text))
    raw_urls = re.findall(raw_url_pattern, md_text)
    
    all_urls = list(set([m.group('url') for m in links_matches] + raw_urls))
    
    # Resolve all URLs in parallel
    tasks = [resolve_and_validate_url(u) for u in all_urls]
    resolved_data = await asyncio.gather(*tasks)
    seen = dict(zip(all_urls, resolved_data))

    processed_md = md_text
    rejections = []
    
    # 1. Handle standard markdown links
    for match in links_matches:
        text = match.group('text')
        url = match.group('url')
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
            if not is_valid and resolved_url not in [r.split(' ')[0] for r in rejections]:
                rejections.append(f"{resolved_url} ({reason})")
                
    return processed_md, rejections


# --- URL INTEGRITY, MASKING & NORMALIZATION ---

@dataclass
class URLMask:
    """Masks URLs with short placeholders before an LLM call, restores after."""
    _to_placeholder: dict[str, str] = field(default_factory=dict)
    _to_original: dict[str, str] = field(default_factory=dict)
    _counter: int = 0

    _URL_RE = re.compile(r'https?://[^\s<>"\')\]}]+')
    _PLACEHOLDER_RE = re.compile(r'<<URL_(\d+)>>')

    def mask(self, text: str) -> str:
        def _sub(match: re.Match) -> str:
            url = match.group(0)
            if url not in self._to_placeholder:
                self._counter += 1
                token = f"<<URL_{self._counter}>>"
                self._to_placeholder[url] = token
                self._to_original[token] = url
            return self._to_placeholder[url]
        return self._URL_RE.sub(_sub, text)

    def unmask(self, text: str, strict: bool = True) -> str:
        def _sub(match: re.Match) -> str:
            token = match.group(0)
            if token in self._to_original:
                return self._to_original[token]
            if strict:
                raise ValueError(f"LLM emitted unknown placeholder: {token}")
            return token
        return self._PLACEHOLDER_RE.sub(_sub, text)

    def audit(self, output_text: str) -> dict[str, list[str]]:
        emitted = set(self._PLACEHOLDER_RE.findall(output_text))
        issued = {t.strip("<>").split("_")[1] for t in self._to_original}
        leaked_raw_urls = self._URL_RE.findall(output_text)
        return {
            "preserved": sorted(emitted & issued),
            "dropped": sorted(issued - emitted),
            "leaked_raw_urls": leaked_raw_urls,
        }

_TRACKING_PREFIXES = ("utm_",)
_TRACKING_EXACT = {
    "fbclid", "gclid", "gclsrc", "dclid", "msclkid", "mc_eid", "mc_cid",
    "_hsenc", "_hsmi", "igshid", "ref", "ref_src", "ref_url", "yclid",
    "wbraid", "gbraid", "vero_id", "oicd", "soc_src", "soc_trk",
}

def _strip_tracking(url: str) -> str:
    parts = urlsplit(url)
    if not parts.query:
        return url
    kept = [
        (k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if not (k.lower() in _TRACKING_EXACT
                or any(k.lower().startswith(p) for p in _TRACKING_PREFIXES))
    ]
    kept.sort()
    new_query = urlencode(kept)
    return urlunsplit(parts._replace(query=new_query))

def normalize_url(url: str) -> str:
    if not url or not url.strip():
        return ""
    url = url.strip()
    url = _strip_tracking(url)
    url = url_normalize(url, default_scheme="https", filter_params=False)
    parts = urlsplit(url)
    path = parts.path
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/")
    return urlunsplit(parts._replace(path=path, fragment=""))

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
    return set(re.findall(r'https?://[^\)\s]+', markdown_string))