import { test, expect } from '@playwright/test';

test('Heartbeat Logging Verification', async ({ page }) => {
  await page.goto('http://localhost:3000');

  // Fill URL
  await page.fill('input[type="url"]', 'https://www.instructure.com/canvas');
  
  // Start Research
  await page.click('button:has-text("Generate Listing")');

  const messagesLog = page.locator('[role="log"]');
  await expect(messagesLog).toBeVisible();

  console.log('--- STARTING HEARTBEAT MONITORING (10 seconds) ---');
  
  const startTime = Date.now();
  let lastCount = 0;
  const logSnapshots: string[][] = [];

  // Poll for 10 seconds to see if lines increase every second
  while (Date.now() - startTime < 10000) {
    const lines = await messagesLog.locator('p').allTextContents();
    if (lines.length !== lastCount) {
        console.log(`[T+${Math.round((Date.now() - startTime)/1000)}s] Lines: ${lines.length}`);
        lastCount = lines.length;
        logSnapshots.push(lines);
    }
    await page.waitForTimeout(500);
  }

  const finalLines = await messagesLog.locator('p').allTextContents();
  console.log(`Total lines after 10s: ${finalLines.length}`);
  
  // If we only see ~5 lines, heartbeat isn't working (as we expect 1/sec + macro updates)
  expect(finalLines.length).toBeGreaterThan(8); 
});
