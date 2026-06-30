import asyncio
from typing import List, Dict

from nerd_core.utils import resolve_and_validate_url
from nerd_core.link_validator_engine import LinkValidatorEngine
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
    Performs a two-pass validation on a list of resources, ensuring the
    final list contains at most `cap` valid links, preserving the highest
    confidence resources.

    Pass 1 uses fast HEAD requests. If more than `cap` resources survive,
    Pass 2 uses a full browser validation on the lowest-confidence survivors
    to intelligently trim the list.
    """
    if not resources:
        return []

    # Pass 1: Fast, concurrent HEAD requests on all candidates.
    all_urls = [res.url for res in resources]
    fast_pass_results = await _fast_pass(all_urls)
    
    survivors = [res for res in resources if fast_pass_results.get(res.url, False)]
    
    # If we are already at or below the cap, we're done.
    if len(survivors) <= cap:
        return survivors
        
    # Pass 2: Full browser validation for the excess, lowest-confidence links.
    # The `resources` list is assumed to be sorted by confidence descending,
    # so the excess items are at the tail of the `survivors` list.
    excess_survivors = survivors[cap:]
    urls_for_pass_2 = [res.url for res in excess_survivors]
    
    engine = LinkValidatorEngine()
    pass_2_results = await engine.run(urls_for_pass_2)
    
    failed_urls_pass_2 = {url for url, result in pass_2_results.items() if not result.is_valid}
    
    # Filter the survivors list, removing any that failed the deep validation.
    # Since `resources` was sorted, `survivors` is also sorted.
    final_list = [res for res in survivors if res.url not in failed_urls_pass_2]
    
    # Return the top `cap` resources from the final validated list.
    return final_list[:cap]
