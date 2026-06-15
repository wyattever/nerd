import { test, expect } from '@playwright/test';

test.describe('N.E.R.D. Smoke Test', () => {
  test('should generate a research listing (mocked)', async ({ page }) => {
    // Debug: capture browser logs
    page.on('console', msg => console.log('BROWSER:', msg.text()));
    page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

    // 1. Setup API mocks
    await page.route('**/research/initial', async (route) => {
      console.log('Intercepted /research/initial');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ job_id: 'test-job-123' }),
      });
    });

    await page.route('**/jobs/test-job-123', async (route) => {
      console.log('Intercepted /jobs/test-job-123');
      const sseContent = [
        'id: 1\nevent: status\ndata: {"status": "searching_initial"}\n\n',
        'id: 2\nevent: status\ndata: {"status": "synthesizing"}\n\n',
        'id: result\nevent: result\ndata: {"raw_markdown": "# Mocked Result", "parsed_listing": {"product_name": "Mocked Product", "vendor_name": "Mocked Vendor", "product_description": "Mocked Desc", "vendor_resources": [], "other_resources": [], "ai_insights": "Mocked AI Insights", "support_contacts": [], "acr_reports": []}, "url_cache": {}, "rejections": []}\n\n',
        'event: end\ndata: {}\n\n'
      ].join('');

      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseContent,
        headers: {
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        }
      });
    });

    // 2. Navigation
    await page.goto('/', { waitUntil: 'networkidle' });

    // 3. Form Interaction
    await page.fill('input[name="productUrl"]', 'https://example.com/product');
    
    // Use low-level click to avoid potential Playwright load-waiting logic
    await page.locator('button:has-text("Generate Listing")').dispatchEvent('click');

    // 4. Verify Status Updates (via ARIA live region)
    const liveRegion = page.locator('[aria-live="polite"]');
    // Mocks often fire faster than Playwright can catch intermediate states.
    // We check for the end state primarily.
    await expect(liveRegion).toContainText('Status: Research complete', { timeout: 10000 });

    // 5. Verify Final Result
    await expect(page.locator('h1')).toContainText('Mocked Product', { timeout: 10000 });
    await expect(page.locator('.vendor-line')).toContainText('Mocked Vendor');
    
    // Verify TanStack grid rendering (ResourceGrids component)
    // AI Insights section
    await expect(page.locator('.ai-insights')).toContainText('Mocked AI Insights');
  });
});
