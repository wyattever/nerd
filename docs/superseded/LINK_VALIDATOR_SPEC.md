# Production-Grade Link Validation Microservice Spec

This document outlines the architecture and implementation for a high-fidelity link validation microservice using **Crawlee for Python**, **Playwright**, and **FastAPI**.

## 1. Environment Setup

To support headless browser execution and WAF-resilient crawling, the following dependencies are required.

```bash
# Install Crawlee with Playwright support
pip install "crawlee[playwright]"

# Install Playwright browser binaries and system dependencies
playwright install chromium
playwright install-deps chromium
```

## 2. Crawler Logic & Concurrency Tuning

The engine utilizes `PlaywrightCrawler` to ensure JavaScript is executed (handling SPAs) and browser fingerprints are managed.

### Key Configuration:
*   **Polite Concurrency:** `max_concurrency=3` to avoid DDoS-like behavior.
*   **Rate Limiting:** `max_tasks_per_minute=20` to stay under enterprise firewall thresholds.
*   **WAF Bypass:** Leverage Crawlee's browser fingerprinting and header management.

### `validator.py` (Draft Implementation)

```python
import asyncio
from typing import List, Dict
from crawlee.playwright_crawler import PlaywrightCrawler, PlaywrightCrawlingContext
from crawlee.models import ConcurrencySettings

# Heuristic indicators for Soft 404 detection
SOFT_404_INDICATORS = [
    "page not found",
    "404 error",
    "product no longer available",
    "this link is broken",
    "sorry, we couldn't find",
    "access denied",
    "site maintenance"
]

class LinkValidatorEngine:
    def __init__(self):
        self.results: Dict[url, bool] = {}

    async def run(self, urls: List[str]) -> Dict[str, bool]:
        # Reset local results for this batch
        self.results = {url: False for url in urls}
        
        crawler = PlaywrightCrawler(
            concurrency_settings=ConcurrencySettings(
                max_concurrency=3,
                max_tasks_per_minute=20
            ),
            request_handler=self._request_handler,
            # Additional browser options for WAF resilience
            browser_type='chromium',
            headless=True
        )

        await crawler.run(urls)
        return self.results

    async def _request_handler(self, context: PlaywrightCrawlingContext) -> None:
        url = context.request.url
        page = context.page
        
        # 1. Evaluate HTTP Status Code via Playwright Response
        # Note: Playwright captures the status of the final terminal response after redirects.
        response = await page.request.get(url) # Headless check
        status = response.status
        
        if not (200 <= status < 400):
            context.log.info(f"Link {url} rejected with status {status}")
            self.results[url] = False
            return

        # 2. Heuristic Soft 404 Detection (JS Rendered DOM)
        # We wait for network idle to ensure SPAs are fully loaded.
        await page.goto(url, wait_until='networkidle')
        
        # Extract lower-case text from the body to check against indicators
        content = await page.locator('body').inner_text()
        content_lower = content.lower()

        is_soft_404 = any(indicator in content_lower for indicator in SOFT_404_INDICATORS)
        
        if is_soft_404:
            context.log.warning(f"Link {url} flagged as Soft 404 based on content.")
            self.results[url] = False
        else:
            self.results[url] = True
```

## 3. FastAPI Orchestration

To prevent headless browsers from blocking the FastAPI event loop, we execute the crawler in an asynchronous background job. 

### Integration Strategy:
*   **Job Store:** Use an in-memory dictionary or Firestore (production) to track job status.
*   **Separation of Concerns:** FastAPI handles the request validation and OIDC auth; a background task triggers the `LinkValidatorEngine`.

### `main.py` (Draft Implementation)

```python
from fastapi import FastAPI, BackgroundTasks, HTTPException
from pydantic import BaseModel
from typing import List, Dict
import uuid

app = FastAPI()
validator = LinkValidatorEngine()

# State store for async jobs
jobs: Dict[str, Dict] = {}

class ValidationRequest(BaseModel):
    urls: List[str]

class ValidationStatus(BaseModel):
    job_id: str
    status: str
    results: Dict[str, bool] | None = None

async def run_validation_task(job_id: str, urls: List[str]):
    try:
        jobs[job_id]["status"] = "processing"
        results = await validator.run(urls)
        jobs[job_id]["results"] = results
        jobs[job_id]["status"] = "complete"
    except Exception as e:
        jobs[job_id]["status"] = "error"
        jobs[job_id]["error"] = str(e)

@app.post("/validate", response_model=ValidationStatus)
async def enqueue_validation(req: ValidationRequest, bg: BackgroundTasks):
    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "queued", "results": None}
    
    # Offload heavy browser work to a background task
    bg.add_task(run_validation_task, job_id, req.urls)
    
    return ValidationStatus(job_id=job_id, status="queued")

@app.get("/validate/{job_id}", response_model=ValidationStatus)
async def get_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return ValidationStatus(job_id=job_id, **jobs[job_id])
```

## 4. Production Readiness (Docker)

To deploy this microservice, use a Playwright-ready base image.

```dockerfile
FROM mcr.microsoft.com/playwright/python:v1.44.0-jammy

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Playwright dependencies are pre-installed in the Microsoft image,
# but we ensure the python bindings are synced.
RUN playwright install chromium

COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
```

---

**End of Specification.**
*Awaiting evaluation report before proceeding with implementation.*
