import asyncio
from typing import List, Dict

# Integration: Using your hardened validator
from nerd_core.tools.liveness_validator import validate_link
from nerd_core.generators import ResourceLink


async def _fast_pass(urls: List[str]) -> Dict[str, bool]:
    """
    Runs an asynchronous, SSRF-hardened liveness check on a list of URLs.
    Returns a dictionary mapping each original URL to its validity status.
    """
    if not urls:
        return {}
        
    # Launch hardened validation for all candidates concurrently
    tasks = [validate_link(url) for url in urls]
    results = await asyncio.gather(*tasks)
    
    validity_map = {}
    for i, url in enumerate(urls):
        result = results[i]
        # Treat as valid if is_live is True
        validity_map[url] = result.is_live
        
    return validity_map


async def adaptive_validate(resources: List[ResourceLink], cap: int = 5) -> List[ResourceLink]:
    """
    Performs a single-pass validation on a list of resources using the
    hardened liveness validator.
    
    Ensures the final list contains at most `cap` valid links, 
    preserving the highest confidence resources.
    """
    if not resources:
        return []

    # Pass 1: Fast, concurrent hardened validation on all candidates.
    all_urls = [res.url for res in resources]
    fast_pass_results = await _fast_pass(all_urls)
    
    # Update each ResourceLink object based on validation results
    for res in resources:
        if not fast_pass_results.get(res.url, False):
            res.is_broken = True
    
    # Survivors are resources that passed the check.
    # The order is preserved from the original sorted resources list.
    survivors = [res for res in resources if not res.is_broken]
    
    # Return the top `cap` resources.
    return survivors[:cap]