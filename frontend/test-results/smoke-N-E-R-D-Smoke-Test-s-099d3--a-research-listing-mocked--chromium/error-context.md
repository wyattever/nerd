# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> N.E.R.D. Smoke Test >> should generate a research listing (mocked)
- Location: tests/e2e/smoke.spec.ts:4:7

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('[aria-live="polite"]')
Expected substring: "Status: Searching"
Received string:    "Status: Research complete."
Timeout: 10000ms

Call log:
  - Expect "toContainText" with timeout 10000ms
  - waiting for locator('[aria-live="polite"]')
    - locator resolved to <div class="sr-only" aria-live="polite">Status: Research queued. Waiting for worker...</div>
    - unexpected value "Status: Research queued. Waiting for worker..."
    23 × locator resolved to <div class="sr-only" aria-live="polite">Status: Research complete.</div>
       - unexpected value "Status: Research complete."

```

```yaml
- text: "Status: Research complete."
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test.describe('N.E.R.D. Smoke Test', () => {
  4  |   test('should generate a research listing (mocked)', async ({ page }) => {
  5  |     // Debug: capture browser logs
  6  |     page.on('console', msg => console.log('BROWSER:', msg.text()));
  7  |     page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));
  8  | 
  9  |     // 1. Setup API mocks
  10 |     await page.route('**/research/initial', async (route) => {
  11 |       console.log('Intercepted /research/initial');
  12 |       await route.fulfill({
  13 |         status: 200,
  14 |         contentType: 'application/json',
  15 |         body: JSON.stringify({ job_id: 'test-job-123' }),
  16 |       });
  17 |     });
  18 | 
  19 |     await page.route('**/jobs/test-job-123', async (route) => {
  20 |       console.log('Intercepted /jobs/test-job-123');
  21 |       const sseContent = [
  22 |         'id: 1\nevent: status\ndata: {"status": "searching_initial"}\n\n',
  23 |         'id: 2\nevent: status\ndata: {"status": "synthesizing"}\n\n',
  24 |         'id: result\nevent: result\ndata: {"raw_markdown": "# Mocked Result", "parsed_listing": {"product_name": "Mocked Product", "vendor_name": "Mocked Vendor", "product_description": "Mocked Desc", "vendor_resources": [], "other_resources": [], "ai_insights": "Mocked AI Insights", "support_contacts": [], "acr_reports": []}, "url_cache": {}, "rejections": []}\n\n',
  25 |         'event: end\ndata: {}\n\n'
  26 |       ].join('');
  27 | 
  28 |       await route.fulfill({
  29 |         status: 200,
  30 |         contentType: 'text/event-stream',
  31 |         body: sseContent,
  32 |         headers: {
  33 |           'Cache-Control': 'no-cache',
  34 |           'Connection': 'keep-alive',
  35 |         }
  36 |       });
  37 |     });
  38 | 
  39 |     // 2. Navigation
  40 |     await page.goto('/', { waitUntil: 'networkidle' });
  41 | 
  42 |     // 3. Form Interaction
  43 |     await page.fill('input[name="productUrl"]', 'https://example.com/product');
  44 |     
  45 |     // Use low-level click to avoid potential Playwright load-waiting logic
  46 |     await page.locator('button:has-text("Generate Listing")').dispatchEvent('click');
  47 | 
  48 |     // 4. Verify Status Updates (via ARIA live region)
  49 |     // We use a more robust locator and longer timeout for the streaming UI
  50 |     const liveRegion = page.locator('[aria-live="polite"]');
> 51 |     await expect(liveRegion).toContainText('Status: Searching', { timeout: 10000 });
     |                              ^ Error: expect(locator).toContainText(expected) failed
  52 |     await expect(liveRegion).toContainText('Status: Synthesizing', { timeout: 10000 });
  53 | 
  54 |     // 5. Verify Final Result
  55 |     await expect(page.locator('h1')).toContainText('Mocked Product', { timeout: 10000 });
  56 |     await expect(page.locator('.ai-insights')).toContainText('Mocked AI Insights');
  57 |   });
  58 | });
  59 | 
```