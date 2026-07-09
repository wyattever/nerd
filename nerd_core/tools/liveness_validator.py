import httpx
import asyncio
import socket
import ipaddress
import logging
from dataclasses import dataclass
from typing import Optional, Set

logger = logging.getLogger("nerd.validator")

@dataclass
class ValidationResult:
    is_live: bool
    status_code: Optional[int]
    reason: str

def is_safe_ip(ip_str: str) -> bool:
    """Blocks private, loopback, link-local, and multicast ranges to prevent SSRF."""
    try:
        ip = ipaddress.ip_address(ip_str)
        return not (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast)
    except ValueError:
        return False

async def get_resolved_ips(hostname: str) -> Set[str]:
    """Resolves hostname to a set of IP strings."""
    addr_info = await asyncio.to_thread(socket.getaddrinfo, hostname, None)
    return {info[4][0] for info in addr_info}

async def validate_link(url: str, max_redirects: int = 3) -> ValidationResult:
    """
    Hardened validator: follows redirects manually to check SSRF safety at each hop.
    """
    async with httpx.AsyncClient(http2=True, timeout=10.0) as client:
        current_url = url
        for _ in range(max_redirects + 1):
            try:
                host = httpx.URL(current_url).host
                ips = await get_resolved_ips(host)
                
                if not all(is_safe_ip(ip) for ip in ips):
                    return ValidationResult(False, 0, "SSRF Blocked: Private IP detected")

                resp = await client.get(current_url, follow_redirects=False)
                
                if resp.is_redirect:
                    current_url = resp.headers.get("location")
                    if not current_url:
                        return ValidationResult(False, resp.status_code, "Redirect missing location")
                    continue
                
                return ValidationResult(
                    resp.is_success, 
                    resp.status_code, 
                    "Success" if resp.is_success else "HTTP Error"
                )
                
            except httpx.HTTPStatusError as e:
                return ValidationResult(False, e.response.status_code, str(e))
            except Exception as e:
                status = getattr(e.response, "status_code", None) if hasattr(e, "response") else None
                logger.error(f"Validation failed for {current_url}: {str(e)}")
                return ValidationResult(False, status, str(e))
                
        return ValidationResult(False, 0, "Too many redirects")