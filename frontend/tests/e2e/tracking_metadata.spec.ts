import { test, expect } from '@playwright/test';

/**
 * Verifies the full round-trip for the four tracking metadata dropdowns
 * (Priority, Status, Gatherer, Reviewer): editing them in /editor, saving
 * via the local write API to frontend/lib/candidate.json, and confirming
 * they load correctly into the read-only dropdowns on /records.
 *
 * Candidate is the default tab on both pages (see EditorPage's and
 * RecordsPage's initial `useState<SourceTab>("candidate")`), so this test
 * only verifies that tab is active rather than clicking it -- clicking an
 * already-active tab in EditorSidebar re-fires onActiveTabChange, which
 * resets selectedSlug back to the tab's first record. That's harmless before
 * the record is selected, but would silently undo an explicit record pick if
 * done afterward, so tab selection is asserted, then the record is picked.
 *
 * The two pages share the exact same EditorSidebar component and the exact
 * same candidate.json data/default A-Z sort, so "first record in the list"
 * is deterministically the same record on both pages -- this test still
 * captures the record's name on /editor and re-locates it BY NAME on
 * /records, rather than assuming "first" twice, so a future sort-order or
 * data change that broke that assumption would fail loudly here instead of
 * silently comparing two different records.
 */

const TEST_VALUES = {
  priority: 'High',
  status: 'Needs Review',
  gatherer: 'Mindy Johnson',
  reviewer: 'George Joeckel',
} as const;

test('Tracking metadata round-trip: Editor save -> Records read-only display', async ({ page }) => {
  // --- 1. Editor: confirm Candidate tab, select the first record ---
  await page.goto('http://localhost:3000/editor');

  const candidateTabButton = page.getByRole('button', { name: 'View candidate products' });
  await expect(candidateTabButton).toHaveAttribute('aria-pressed', 'true');

  const editorSidebar = page.getByRole('navigation', { name: 'Products' });
  const firstEditorRecord = editorSidebar.locator('ul li button').first();
  await expect(firstEditorRecord).toBeVisible({ timeout: 15000 });

  const recordName = (await firstEditorRecord.locator('span').first().innerText()).trim();
  await firstEditorRecord.click();

  // --- 2. Set the four tracking dropdowns to specific test values ---
  await page.getByLabel('Priority').selectOption(TEST_VALUES.priority);
  await page.getByLabel('Status').selectOption(TEST_VALUES.status);
  await page.getByLabel('Gatherer').selectOption(TEST_VALUES.gatherer);
  await page.getByLabel('Reviewer').selectOption(TEST_VALUES.reviewer);

  // --- 3. Save and wait for the success status message ---
  await page.getByRole('button', { name: 'Save candidate' }).click();
  await expect(page.getByRole('status')).toContainText(/Saved \d+ candidate records to disk\./, {
    timeout: 15000,
  });
  // Save failures render into role="alert", not role="status" -- assert it
  // stayed empty so a 412/400/network failure fails this test loudly instead
  // of the toContainText above just timing out with a vague message. Scoped
  // to the footer: a bare page.getByRole('alert') also matches Next.js's
  // own route-change announcer (#__next-route-announcer__), which likewise
  // carries role="alert" and would make this locator resolve to two
  // elements.
  await expect(page.locator('footer').getByRole('alert')).toHaveText('');

  // --- 4. Records: confirm Candidate tab, select the exact same record ---
  await page.goto('http://localhost:3000/records');

  const recordsCandidateTabButton = page.getByRole('button', { name: 'View candidate products' });
  await expect(recordsCandidateTabButton).toHaveAttribute('aria-pressed', 'true');

  const recordsSidebar = page.getByRole('navigation', { name: 'Products' });
  const sameRecordOnRecords = recordsSidebar
    .locator('ul li button')
    .filter({ hasText: recordName })
    .first();
  await expect(sameRecordOnRecords).toBeVisible({ timeout: 15000 });
  await sameRecordOnRecords.click();

  // --- 5. Assert the disabled tracking dropdowns show the saved values ---
  const priorityField = page.getByLabel('Priority');
  const statusField = page.getByLabel('Status');
  const gathererField = page.getByLabel('Gatherer');
  const reviewerField = page.getByLabel('Reviewer');

  await expect(priorityField).toBeDisabled();
  await expect(statusField).toBeDisabled();
  await expect(gathererField).toBeDisabled();
  await expect(reviewerField).toBeDisabled();

  await expect(priorityField).toHaveValue(TEST_VALUES.priority);
  await expect(statusField).toHaveValue(TEST_VALUES.status);
  await expect(gathererField).toHaveValue(TEST_VALUES.gatherer);
  await expect(reviewerField).toHaveValue(TEST_VALUES.reviewer);
});
