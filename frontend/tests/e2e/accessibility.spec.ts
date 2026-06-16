import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('Accessibility Scan - Primary View', async ({ page }) => {
  await page.goto('http://localhost:3000');

  // Run Axe Scan
  const accessibilityScanResults = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  expect(accessibilityScanResults.violations).toEqual([]);
});

test('ARIA Live Region Updates', async ({ page }) => {
  await page.goto('http://localhost:3000');

  // Check initial state of the log
  const log = page.locator('[role="log"]');
  await expect(log).toBeVisible();
  
  // Trigger an action that updates the log (e.g., failed research)
  await page.fill('input[type="url"]', 'https://invalid-url-test');
  await page.click('button:has-text("Generate Listing")');

  // Verify aria-live region content updates
  // We use textContent with waitFor to ensure it's polite and captured
  await expect(log).toContainText('crawler', { timeout: 10000 });
  await expect(log).toContainText('DOM', { timeout: 10000 });
  
  // ARIA tree assertion (Playwright 1.44+)
  // await expect(log).toMatchAriaSnapshot(`- log "System messages and progress log"`);
});
