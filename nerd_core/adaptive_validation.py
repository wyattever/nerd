import asyncio
from typing import List, Dict

from nerd_core.utils import resolve_and_validate_url
from nerd_core.generators import ResourceLink


async def _fast_pass(urls: List[str]) -> Dict[str, bool]:
    """
    Runs a fast, concurrent HEAD-based check on a list of URLs.
    Returns a dictionary mapping each original URL to its validity.
    """
    if not urls:
        return {}
        
    tasks = [resolve_and_validate_url(url) for url in urls]
    results = await asyncio.gather(*tasks)
    
    validity_map = {}
    for i, url in enumerate(urls):
        _, is_valid, _ = results[i]
        validity_map[url] = is_valid
        
    return validity_map


async def adaptive_validate(resources: List[ResourceLink], cap: int = 5) -> List[ResourceLink]:
    """
    Performs a single-pass validation on a list of resources, ensuring the
    final list contains at most `cap` valid links, preserving the highest
    confidence resources.

    Browser-based validation (Pass 2) has been removed to reduce GCP 
    Compute/Memory costs.
    """
    if not resources:
        return []

    # Pass 1: Fast, concurrent HEAD requests on all candidates.
    all_urls = [res.url for res in resources]
    fast_pass_results = await _fast_pass(all_urls)
    
    # Survivors are resources that passed the HEAD request check.
    # The order is preserved from the original sorted resources list.
    survivors = [res for res in resources if fast_pass_results.get(res.url, False)]
    
    # Return the top `cap` resources.
    return survivors[:cap]