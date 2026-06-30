import httpx
import re
from typing import Optional, Tuple, List

# A selection of common markers found in VPAT/ACR documents.
# This is not exhaustive, but covers the most frequent indicators.
VPAT_MARKERS = {
    "vpat": re.compile(r'vpat', re.I),
    "accessibility conformance report": re.compile(r'accessibility conformance report', re.I),
    "wcag": re.compile(r'wcag\s*2', re.I),
    "section 508": re.compile(r'section\s*508', re.I),
    "en 301 549": re.compile(r'en\s*301\s*549', re.I),
    "level a": re.compile(r'level\s*a\s*(conformance|supports|does not support)', re.I),
    "level aa": re.compile(r'level\s*aa\s*(conformance|supports|does not support)', re.I),
    "level aaa": re.compile(r'level\s*aaa\s*(conformance|supports|does not support)', re.I),
    "iti": re.compile(r'information technology industry council', re.I),
}

async def is_likely_vpat_acr(url: str, page_text: Optional[str] = None) -> Tuple[bool, List[str]]:
    """
    Evaluates a URL or its text content to determine if it's likely a VPAT/ACR.

    It checks for the presence of at least two distinct structural markers
    indicative of an ITI (Information Technology Industry Council) VPAT document.

    Args:
        url: The URL of the page to check.
        page_text: Optional. If provided, this text is analyzed directly
                   instead of fetching the URL.

    Returns:
        A tuple containing:
        - bool: True if 2 or more distinct markers are found, False otherwise.
        - list[str]: A list of the distinct marker keys that were found.
    """
    if page_text is None:
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
                headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'}
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                # Use a sample of the text to avoid overwhelming memory with huge PDFs
                page_text = response.text[:100000] 
        except (httpx.RequestError, httpx.HTTPStatusError) as e:
            # If the page can't be fetched, we can't validate it.
            return False, [f"HTTP Error: {e}"]

    found_markers = set()
    for key, pattern in VPAT_MARKERS.items():
        if pattern.search(page_text):
            found_markers.add(key)

    is_likely = len(found_markers) >= 2
    return is_likely, sorted(list(found_markers))
