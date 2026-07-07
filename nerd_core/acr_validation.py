import httpx
from typing import Optional, Tuple, List
from nerd_core.tools.liveness_validator import validate_link

async def is_likely_vpat_acr(url: str) -> Tuple[bool, List[str]]:
    """
    Evaluates a URL to determine if it's likely a VPAT/ACR by verifying
    connectivity using the hardened liveness validator.
    """
    # Connectivity Check
    liveness_result = await validate_link(url)
    
    if not liveness_result.is_live:
        return False, [f"Unreachable: {liveness_result.reason}"]

    # Return True as a discovery-only indicator, without parsing metadata.
    return True, ["vpat_found"]