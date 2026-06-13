import re
import socket
import ipaddress
import hashlib
from urllib.parse import urlparse, urlsplit, urlunsplit, parse_qsl, urlencode
from functools import lru_cache
import httpx
import os
from dataclasses import dataclass, field
from url_normalize import url_normalize

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

# --- SECURITY & NETWORK UTILS ---

def _is_blocked_ip(ip_str):
    """True if the resolved IP is loopback/private/link-local/reserved (SSRF guard)."""
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return True  # unparseable => block
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


@lru_cache(maxsize=1024)
def resolve_and_validate_url(url):
    """Resolve redirects (like Google Search Proxy) and validate the final destination.
    
    Returns (resolved_url, is_valid, reason). 
    """
    is_proxy = "grounding-api-redirect" in url
    
    # 1. Sanity check for hallucinations/corruption
    if len(url) > 700:
        return url, False, "URL Too Long (Potential Hallucination)"
    if re.search(r"([^/])\1{20,}", url):
        return url, False, "Corrupted URL String"

    try:
        with httpx.Client(
            timeout=15.0,
            follow_redirects=True,
            headers={"User-Agent": BROWSER_UA},
        ) as client:
            # We follow redirects to get the direct URL
            resp = client.head(url)
            if resp.status_code == 405:
                resp = client.get(url)
            
            final_url = str(resp.url)
            
            # 2. Safety/SSRF Validation on the FINAL URL
            parsed = urlparse(final_url)
            if parsed.scheme != "https":
                return final_url, False, "HTTPS required"
            
            host = parsed.hostname
            if not host or host.lower() in ("metadata.google.internal", "localhost"):
                return final_url, False, "Restricted Host"

            # Resolve IP to check for private ranges
            try:
                infos = socket.getaddrinfo(host, None)
                resolved_ips = {info[4][0] for info in infos}
                if any(_is_blocked_ip(ip) for ip in resolved_ips):
                    return final_url, False, "Restricted IP Range"
            except Exception:
                return final_url, False, "DNS Error"

            # 3. Status Validation
            code = resp.status_code
            if 200 <= code < 400:
                return final_url, True, "OK"
            if code in (401, 403, 429):
                return final_url, True, f"Unverified ({code})"
            
            return final_url, False, f"Status {code}"

    except (httpx.TimeoutException, httpx.ConnectError) as e:
        # For proxies, if we can't resolve, keep the original but mark unverified
        return url, True, f"Unverified ({type(e).__name__})"
    except Exception as e:
        return url, False, type(e).__name__


def resolve_and_validate_all(urls: list[str], cache: dict[str, str] = None) -> dict[str, str]:
    """Helper to resolve a batch of URLs, using an external cache if provided."""
    if cache is None:
        cache = {}
    
    results = {}
    for url in urls:
        if url in cache:
            results[url] = cache[url]
            continue
            
        resolved, is_valid, reason = resolve_and_validate_url(url)
        if not is_valid:
            results[url] = f"ERROR: {reason}"
        else:
            results[url] = resolved
            cache[url] = resolved
            
    return results


def filter_broken_links(md_text):
    """Resolve and label links without deleting them. 
    
    Replaces proxy links with direct ones and appends status if not 100% OK.
    """
    # Robust pattern for finding all URLs, with special handling for standard markdown [text](url)
    # to extract labels for later status appending if needed. Allows optional space [text] (url).
    markdown_link_pattern = r'\[(?P<text>.*?)\]\s?\((?P<url>https?://[^\)\s<>"]+)\)'
    raw_url_pattern = r'(?<!\()\bhttps?://[^\)\s<>"]+'

    processed_md = md_text
    rejections = []
    seen = {}
    
    # 1. First, handle standard markdown links [text](url)
    matches = list(re.finditer(markdown_link_pattern, md_text))
    for match in matches:
        text = match.group('text')
        url = match.group('url')
        
        if url not in seen:
            seen[url] = resolve_and_validate_url(url)
        
        resolved_url, is_valid, reason = seen[url]
        
        # Replace the original markdown link with the resolved one
        if resolved_url != url:
            processed_md = processed_md.replace(f"({url})", f"({resolved_url})")
        
        # Append status label if not fully valid
        if not is_valid or "Unverified" in reason:
            label = f" (Status: {reason})"
            if label not in processed_md:
                processed_md = processed_md.replace(
                    f"[{text}]({resolved_url})", 
                    f"[{text}]({resolved_url}){label}"
                )
            if not is_valid:
                rejections.append(f"{resolved_url} ({reason})")

    # 2. Second, catch any remaining raw URLs that aren't inside parentheses (already handled)
    # This ensures Google redirect URLs that weren't put into [text](url) blocks are also fixed.
    raw_matches = re.findall(raw_url_pattern, processed_md)
    for url in raw_matches:
        if url not in seen:
            seen[url] = resolve_and_validate_url(url)
        
        resolved_url, is_valid, reason = seen[url]
        
        if resolved_url != url:
            processed_md = processed_md.replace(url, resolved_url)
        
        if not is_valid and resolved_url not in [r.split(' ')[0] for r in rejections]:
            rejections.append(f"{resolved_url} ({reason})")
                
    return processed_md, rejections


# --- URL INTEGRITY & TOKEN PROTECTION ---

@dataclass
class URLMask:
    """Masks URLs with short placeholders before an LLM call, restores after.

    Placeholders use a format the model is highly unlikely to alter:
    a sentinel word + integer, e.g. <<URL_1>>.
    """
    _to_placeholder: dict[str, str] = field(default_factory=dict)
    _to_original: dict[str, str] = field(default_factory=dict)
    _counter: int = 0

    _URL_RE = re.compile(r'https?://[^\s<>"\')\]}]+')
    _PLACEHOLDER_RE = re.compile(r'<<URL_(\d+)>>')

    def mask(self, text: str) -> str:
        """Replace every URL in `text` with a stable placeholder."""
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
        """Swap placeholders back to original URLs."""
        def _sub(match: re.Match) -> str:
            token = match.group(0)
            if token in self._to_original:
                return self._to_original[token]
            if strict:
                raise ValueError(f"LLM emitted unknown placeholder: {token}")
            return token
        return self._PLACEHOLDER_RE.sub(_sub, text)

    def audit(self, output_text: str) -> dict[str, list[str]]:
        """Post-generation integrity check."""
        emitted = set(self._PLACEHOLDER_RE.findall(output_text))
        issued = {t.strip("<>").split("_")[1] for t in self._to_original}
        leaked_raw_urls = self._URL_RE.findall(output_text)
        return {
            "preserved": sorted(emitted & issued),
            "dropped": sorted(issued - emitted),
            "leaked_raw_urls": leaked_raw_urls,
        }


# --- URL NORMALIZATION FOR EVALUATION ---

_TRACKING_PREFIXES = ("utm_",)
_TRACKING_EXACT = {
    "fbclid", "gclid", "gclsrc", "dclid", "msclkid", "mc_eid", "mc_cid",
    "_hsenc", "_hsmi", "igshid", "ref", "ref_src", "ref_url", "yclid",
    "wbraid", "gbraid", "vero_id", "oicd", "soc_src", "soc_trk",
}

def _strip_tracking(url: str) -> str:
    """Remove tracking params by denylist, preserving order of the rest."""
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
    """Canonicalize a URL for Recall comparison."""
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


# --- HELPERS ---

@lru_cache(maxsize=4)
def _load_css_cached(path, _mtime):
    with open(path, "r") as f:
        return f.read()

def load_css():
    """Read the large CSS once and cache it."""
    path = "ncademi_combined.css"
    if os.path.exists(path):
        mtime = os.path.getmtime(path)
        return _load_css_cached(path, mtime)
    return "@import url('https://ncademi.org/wp-content/themes/ncademitheme/style.css');"

def extract_known_urls(markdown_string):
    """Extract all URLs from a markdown string."""
    return set(re.findall(r'https?://[^\)\s]+', markdown_string))
