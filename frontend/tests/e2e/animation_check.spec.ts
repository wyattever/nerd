import { test, expect } from '@playwright/test';

test('Animation Class Visibility during Research', async ({ page }) => {
  await page.goto('http://localhost:3000');

  // Fill URL
  await page.fill('input[type="url"]', 'https://www.instructure.com/canvas');
  
  // Start Research
  await page.click('button:has-text("Generate Listing")');

  // The log role is now on the Messages container
  const messagesLog = page.locator('[role="log"]');
  await expect(messagesLog).toBeVisible();

  // Wait for at least one message
  await page.waitForSelector('[role="log"] p');

  // Check if the last paragraph has the animation span
  const lastParagraph = messagesLog.locator('p').last();
  const animationSpan = lastParagraph.locator('.ellipsis-animation');
  
  // We need to check if it appears while state is "streaming"
  // Since research is fast locally, we check immediately
  const isPresent = await animationSpan.isVisible();
  console.log(`Is ellipsis animation present in DOM? ${isPresent}`);
  
  if (!isPresent) {
      // Dump HTML of the last paragraph for debugging
      const html = await lastParagraph.innerHTML();
      console.log(`Last paragraph HTML: ${html}`);
  }

  expect(isPresent).toBe(true);
});
