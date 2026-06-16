import { test, expect } from '@playwright/test';

test('Full Research Run - Canvas', async ({ page }) => {
  // Capture console logs
  const consoleLogs: string[] = [];
  page.on('console', msg => {
    consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', err => {
    consoleLogs.push(`[ERROR] ${err.message}`);
  });

  await page.goto('http://localhost:3000');

  // Input URL
  await page.fill('input[type="url"]', 'https://www.instructure.com/canvas');
  
  // Start Research
  await page.click('button:has-text("Generate Listing")');

  // Monitor terminal log
  const terminal = page.locator('[role="log"]');
  await expect(terminal).toBeVisible();

  console.log('--- STARTING SSE LOG CAPTURE ---');
  
  let lastLinesCount = 0;
  // Poll for terminal changes
  while (true) {
    const lines = await terminal.locator('p').allTextContents();
    if (lines.length > lastLinesCount) {
      for (let i = lastLinesCount; i < lines.length; i++) {
        console.log(`UI_LOG: ${lines[i]}`);
      }
      lastLinesCount = lines.length;
    }

    // Check if research is complete
    if (await page.locator('h1#product-name').isVisible()) {
      console.log('--- RESEARCH COMPLETE: ListingCard Rendered ---');
      break;
    }

    // Check for error
    const errorMsg = page.locator('[role="alert"]');
    if (await errorMsg.isVisible()) {
        console.log(`--- RESEARCH FAILED: ${await errorMsg.textContent()} ---`);
        break;
    }

    await page.waitForTimeout(500);
  }

  // Final check of results
  const productName = await page.locator('h1#product-name').textContent();
  console.log(`FINAL_PRODUCT: ${productName}`);

  console.log('--- BROWSER CONSOLE ---');
  consoleLogs.forEach(log => console.log(log));
});
