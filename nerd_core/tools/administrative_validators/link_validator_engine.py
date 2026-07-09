import asyncio
import uuid
import os
from typing import List, Dict, Optional
from datetime import datetime, timedelta
from pydantic import BaseModel, Field

from crawlee.browsers import BrowserPool, PlaywrightBrowserPlugin
from crawlee.crawlers import PlaywrightCrawler, PlaywrightCrawlingContext
from crawlee.storage_clients import MemoryStorageClient
from playwright._impl._errors import Error as PlaywrightError
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
    timestamp: datetime = Field(default_factory=datetime.now)

class LinkValidatorEngine:
    def __init__(self, artifacts_dir: str = "artifacts"):
        self.artifacts_dir = artifacts_dir
        os.makedirs(self.artifacts_dir, exist_ok=True)

    async def run(self, urls: List[str]) -> Dict[str, LinkValidationResult]:
        """
        Runs the link validation engine on a list of URLs.
        """
        final_results: Dict[str, LinkValidationResult] = {}
        
        # Filter for valid URL patterns
        valid_urls = [u for url in urls if (u := str(url).strip()) and u.startswith("http")]
        
        # Record skipped placeholders
        for skipped in set(urls) - set(valid_urls):
            final_results[skipped] = LinkValidationResult(
                url=skipped,
                is_valid=False,
                reason="Invalid or placeholder URL",
                timestamp=datetime.now()
            )

        if not valid_urls:
            return final_results

        # Chromium launch flags as required
        plugin = PlaywrightBrowserPlugin(
            browser_launch_options={
                "headless": True,
                "args": [
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",   # Critical: prevents /dev/shm exhaustion in Docker
                    "--disable-gpu",             # Eliminates GPU subprocess, reduces memory ~50-100MB
                    "--disable-software-rasterizer",  # Further reduces rendering process overhead
                ]
            }
        )

        # BrowserPool explicitly configured
        browser_pool = BrowserPool(
            plugins=[plugin],
        )

        # Crawler with required concurrency and timeouts
        crawler = PlaywrightCrawler(
            browser_pool=browser_pool,
            concurrency_settings=ConcurrencySettings(
                max_concurrency=2,
                desired_concurrency=2,
            ),
            request_handler=self._request_handler,
            request_handler_timeout=timedelta(seconds=20),
            storage_client=MemoryStorageClient(),
            max_request_retries=0,
            ignore_http_error_status_codes=[404, 403, 401, 500, 502, 503, 504],
        )
        crawler.failed_request_handler(self._failed_request_handler)
        
        try:
            # Global timeout for the batch
            await asyncio.wait_for(crawler.run(valid_urls), timeout=120)
        except asyncio.TimeoutError:
            pass  # Return partial results from dataset

        # Result collection via get_data() as required
        dataset_data = await crawler.get_data()
        for item in dataset_data.items:
            res = LinkValidationResult(**item)
            final_results[res.url] = res

        return final_results

    async def _request_handler(self, context: PlaywrightCrawlingContext) -> None:
        url = context.request.url
        page = context.page
        
        try:
            # Navigation with explicit timeout and wait_until as required
            # Note: PlaywrightCrawler might have already navigated, but we follow the required pattern
            response = await page.goto(url, timeout=15000, wait_until="domcontentloaded")
            
            # Initial status check
            status = response.status if response else 200

            # Check for Standard 4xx/5xx Errors
            if not (200 <= status < 400):
                result = await self._record_failure(page, url, status, f"HTTP {status}")
                await context.push_data(result.model_dump())
                return
            
            # Heuristic Soft 404 Detection (JS Rendered DOM)
            try:
                content = (await page.locator('body').inner_text(timeout=5000)).lower()
            except Exception:
                content = ""

            is_soft_404 = any(indicator in content for indicator in SOFT_404_INDICATORS)
            
            if is_soft_404:
                result = await self._record_failure(page, url, status, "Soft 404 (Content Match)")
            else:
                result = LinkValidationResult(
                    url=url,
                    is_valid=True,
                    status_code=status,
                    timestamp=datetime.now()
                )
        except PlaywrightError as e:
            reason = self._get_failure_reason(e)
            result = LinkValidationResult(
                url=url,
                is_valid=False,
                reason=reason,
                timestamp=datetime.now()
            )
        except Exception as e:
            result = LinkValidationResult(
                url=url,
                is_valid=False,
                reason=f"Unexpected error: {str(e)[:120]}",
                timestamp=datetime.now()
            )

        # Do not use mutable closure state; use push_data
        await context.push_data(result.model_dump())

    async def _failed_request_handler(self, context: PlaywrightCrawlingContext, error: Exception) -> None:
        """Handles cases where the initial navigation fails."""
        url = context.request.url
        reason = self._get_failure_reason(error)
        
        result = LinkValidationResult(
            url=url,
            is_valid=False,
            reason=reason,
            timestamp=datetime.now()
        )
        await context.push_data(result.model_dump())

    def _get_failure_reason(self, error: Exception) -> str:
        """Categorizes Playwright/navigation errors."""
        error_msg = str(error)
        if "ERR_NAME_NOT_RESOLVED" in error_msg:
            return "DNS resolution failed"
        elif "ERR_CONNECTION_REFUSED" in error_msg:
            return "Connection refused"
        elif "ERR_CONNECTION_TIMED_OUT" in error_msg or "Timeout" in error_msg:
            return "Navigation timeout"
        else:
            return f"Navigation error: {error_msg[:120]}"

    async def _record_failure(self, page, url: str, status: int, reason: str) -> LinkValidationResult:
        """Captures a screenshot and returns a failure result."""
        filename = f"{uuid.uuid4().hex}.png"
        filepath = os.path.join(self.artifacts_dir, filename)
        
        try:
            await page.screenshot(path=filepath, full_page=False, timeout=5000)
            screenshot_rel_path = f"/artifacts/{filename}"
        except Exception:
            # Log screenshot failure but continue
            screenshot_rel_path = None

        return LinkValidationResult(
            url=url,
            is_valid=False,
            status_code=status,
            reason=reason,
            screenshot_path=screenshot_rel_path,
            timestamp=datetime.now()
        )
