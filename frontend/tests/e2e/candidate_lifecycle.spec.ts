import { test, expect } from '@playwright/test';

test('Candidate Lifecycle: Inject -> Edit -> Update -> Delete', async ({ page }) => {
  await page.goto('http://localhost:3000');

  // 1. Inject Candidate
  const candidateSelect = page.locator('select').nth(1); // Second select is Candidates
  await candidateSelect.selectOption({ label: 'E2E Test Candidate' });
  await page.click('button:has-text("View Candidate")');

  // Verify Injection
  const productName = page.locator('h1#product-name');
  await expect(productName).toBeVisible();
  await expect(productName).toContainText('E2E Test Candidate');

  // 2. Edit (Verify isDirty)
  const updateBtn = page.locator('button:has-text("Update Candidate")');
  await expect(updateBtn).toBeDisabled();

  await page.click('button:has-text("Validate Links")');
  
  // Wait for validation modal
  const modal = page.locator('role=dialog');
  await expect(modal).toBeVisible({ timeout: 30000 });
  
  await page.click('button:has-text("Apply Changes")');
  
  // Verify isDirty
  await expect(updateBtn).toBeEnabled();

  // 3. Update
  await updateBtn.click();
  const log = page.locator('[role="log"]');
  await expect(log).toContainText('Candidate listing has been updated', { timeout: 10000 });
  await expect(updateBtn).toBeDisabled();

  // 4. Delete
  page.on('dialog', dialog => dialog.accept()); // Handle confirmation
  await page.click('button:has-text("Delete Candidate")');
  
  await expect(log).toContainText('UI cleared and dropdowns refreshed', { timeout: 10000 });
  await expect(productName).not.toBeVisible();
});
