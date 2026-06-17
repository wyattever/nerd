import asyncio
import uuid
import os
from typing import List, Dict, Optional
from datetime import datetime, timedelta
from pydantic import BaseModel

from crawlee.crawlers import PlaywrightCrawler, PlaywrightCrawlingContext
from crawlee import ConcurrencySettings

# Heuristic indicators for Soft 404 detection
SOFT_404_INDICATORS = [
    "page not found",
    "404 error",
    "product no longer available",
    "this link is broken",
    "sorry, we couldn't find",
    "access denied",
    "site maintenance",
    "not found on this server"
]

class LinkValidationResult(BaseModel):
    url: str
    is_valid: bool
    status_code: Optional[int] = None
    reason: Optional[str] = None
    screenshot_path: Optional[str] = None
    timestamp: datetime = datetime.now()

class LinkValidatorEngine:
    def __init__(self, artifacts_dir: str = "artifacts"):
        self.artifacts_dir = artifacts_dir
        self.results: Dict[str, LinkValidationResult] = {}
        os.makedirs(self.artifacts_dir, exist_ok=True)

    async def run(self, urls: List[str]) -> Dict[str, LinkValidationResult]:
        """
        Runs the link validation engine on a list of URLs.
        """
        self.results = {}
        
        # Filter for valid URL patterns to prevent Pydantic/Crawler crashes
        valid_urls = [u for url in urls if (u := str(url).strip()) and u.startswith("http")]
        
        # Record skipped placeholders as invalid but with a clear reason
        for skipped in set(urls) - set(valid_urls):
            self.results[skipped] = LinkValidationResult(
                url=skipped,
                is_valid=False,
                reason="Invalid or placeholder URL",
                timestamp=datetime.now()
            )

        if not valid_urls:
            self.results["debug_info"] = LinkValidationResult(
                url="debug_info", is_valid=False, reason=f"No valid URLs found in input of length {len(urls)}", timestamp=datetime.now()
            )
            return self.results

        # Canary to prove we reached this point
        self.results["canary"] = LinkValidationResult(
            url="canary", is_valid=True, reason=f"Started with {len(valid_urls)} valid URLs", timestamp=datetime.now()
        )

        crawler = PlaywrightCrawler(
            concurrency_settings=ConcurrencySettings(
                max_concurrency=2,
                desired_concurrency=2,
                max_tasks_per_minute=20
            ),
            request_handler=self._request_handler,
            request_handler_timeout=timedelta(seconds=20),
            browser_type='chromium',
            headless=True,
            max_request_retries=0,
            navigation_timeout=timedelta(seconds=15),
            ignore_http_error_status_codes=[404, 403, 401, 500, 502, 503, 504]
        )
        crawler.failed_request_handler(self._failed_request_handler)
        try:
            await asyncio.wait_for(crawler.run(valid_urls), timeout=120)
        except asyncio.TimeoutError:
            self.results["timeout_debug"] = LinkValidationResult(
                url="timeout_debug", is_valid=False, reason="asyncio timeout hit", timestamp=datetime.now()
            )
        
        if not self.results or len(self.results) <= 1: # only canary
             self.results["crawler_debug"] = LinkValidationResult(
                url="crawler_debug", is_valid=False, reason="Crawler finished but results still empty", timestamp=datetime.now()
            )

        return self.results

    async def _request_handler(self, context: PlaywrightCrawlingContext) -> None:
        url = context.request.url
        page = context.page
        
        # Get status from the response if available
        status = 200
        if context.response:
            status = context.response.status

        # 2. Check for Standard 4xx/5xx Errors (that we ignored above)
        if not (200 <= status < 400):
            context.log.info(f"Link {url} rejected with status {status}")
            await self._record_failure(page, url, status, f"HTTP {status}")
            return
        
        # 3. Heuristic Soft 404 Detection (JS Rendered DOM)
        try:
            content = (await context.page.locator('body').inner_text(timeout=5000)).lower()
        except Exception:
            content = ""

        is_soft_404 = any(indicator in content for indicator in SOFT_404_INDICATORS)
        
        if is_soft_404:
            context.log.warning(f"Link {url} flagged as Soft 404 based on content.")
            await self._record_failure(page, url, status, "Soft 404 (Content Match)")
        else:
            self.results[url] = LinkValidationResult(
                url=url,
                is_valid=True,
                status_code=status,
                timestamp=datetime.now()
            )

    async def _failed_request_handler(self, context: PlaywrightCrawlingContext, error: Exception) -> None:
        url = context.request.url
        context.log.error(f"Request to {url} failed: {str(error)}")
        
        # Try to extract status code if it was an HttpClientStatusCodeError
        status = 0
        reason = str(error)
        
        from crawlee.errors import HttpClientStatusCodeError
        if isinstance(error, HttpClientStatusCodeError):
            status = error.status_code
            reason = f"HTTP {status}"

        # Note: In failed_request_handler, the page might not be in a useful state
        # but we try to record the failure anyway.
        self.results[url] = LinkValidationResult(
            url=url,
            is_valid=False,
            status_code=status,
            reason=reason,
            timestamp=datetime.now()
        )

    async def _record_failure(self, page, url: str, status: int, reason: str) -> None:
        """Captures a screenshot and records a failure result."""
        filename = f"{uuid.uuid4().hex}.png"
        filepath = os.path.join(self.artifacts_dir, filename)
        
        try:
            await page.screenshot(path=filepath, full_page=False, timeout=5000)
            screenshot_rel_path = f"/artifacts/{filename}"
        except Exception as e:
            print(f"Failed to take screenshot for {url}: {e}")
            screenshot_rel_path = None

        self.results[url] = LinkValidationResult(
            url=url,
            is_valid=False,
            status_code=status,
            reason=reason,
            screenshot_path=screenshot_rel_path,
            timestamp=datetime.now()
        )
