import httpx
import asyncio
import socket
import ipaddress
import logging
from dataclasses import dataclass
from typing import Optional, Set
from urllib.parse import urljoin

logger = logging.getLogger("nerd.validator")

@dataclass
class ValidationResult:
    is_live: bool
    status_code: Optional[int]
    reason: str
    resolved_url: str = ""

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

_BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

async def validate_link(url: str, max_redirects: int = 5) -> ValidationResult:
    """
    Hardened validator: follows redirects manually to check SSRF safety at each hop.
    Captures and returns the terminal resolved_url.
    """
    async with httpx.AsyncClient(timeout=10.0, headers=_BROWSER_HEADERS) as client:
        current_url = url
        for _ in range(max_redirects + 1):
            try:
                host = httpx.URL(current_url).host
                if not host:
                    return ValidationResult(False, 0, "Invalid URL host", resolved_url=current_url)
                    
                ips = await get_resolved_ips(host)
                
                if not all(is_safe_ip(ip) for ip in ips):
                    return ValidationResult(False, 0, "SSRF Blocked: Private IP detected", resolved_url=current_url)

                resp = await client.get(current_url, follow_redirects=False)
                
                if resp.is_redirect:
                    location = resp.headers.get("location")
                    if not location:
                        return ValidationResult(False, resp.status_code, "Redirect missing location", resolved_url=current_url)
                    current_url = urljoin(current_url, location)
                    continue
                
                return ValidationResult(
                    is_live=resp.is_success,
                    status_code=resp.status_code,
                    reason="Success" if resp.is_success else f"HTTP {resp.status_code}",
                    resolved_url=current_url
                )
                
            except httpx.HTTPStatusError as e:
                return ValidationResult(False, e.response.status_code, str(e), resolved_url=current_url)
            except Exception as e:
                status = getattr(e.response, "status_code", None) if hasattr(e, "response") else None
                logger.error(f"Validation failed for {current_url}: {str(e)}")
                return ValidationResult(False, status, str(e), resolved_url=current_url)
                
        return ValidationResult(False, 0, "Too many redirects", resolved_url=current_url)
