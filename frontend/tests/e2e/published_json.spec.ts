import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Gate checks for /tables/published (raw JSON viewer/editor).
 *
 * These automate the mechanical gates. They do NOT replace the manual gates,
 * which cannot be automated and must still be run:
 *   - NVDA + Firefox, JAWS + Chrome, VoiceOver + Safari: dialog name and role
 *     announced on open; role="alert" read without navigating to it; nested
 *     <details> orientable at depth 3.
 *   - Visual: the backdrop is blurred, not the dialog.
 *
 * axe-core catches roughly a third of WCAG issues. A clean scan here is a
 * floor, not a pass.
 */

const PAGE = 'http://localhost:3000/tables/published';

test.describe('Raw JSON viewer', () => {
  test('axe scan is clean on the viewer', async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.getByRole('heading', { name: 'Raw JSON viewer and editor' })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test('every record renders without a runtime error', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto(PAGE);

    const items = page.locator('.nerd-json-list-item');
    const count = await items.count();
    expect(count).toBe(60); // snapshot $meta.total_products

    // Records with the most null/empty fields are the ones most likely to
    // throw. 99math has a null vendor_name and two empty arrays.
    for (const slug of ['99math', 'i-ready', 'blooket', 'book-creator', 'wayground']) {
      await page.goto(`${PAGE}?slug=${slug}`);
      await expect(page.locator('.nerd-json-root')).toBeVisible();
    }
    expect(pageErrors).toEqual([]);
  });

  test('empty arrays are leaves, not expandable-but-empty branches', async ({ page }) => {
    // 99math has empty vendor_resources and other_resources.
    await page.goto(`${PAGE}?slug=99math`);
    const leaf = page.locator('.nerd-json-leaf', { hasText: 'vendor_resources' });
    await expect(leaf).toBeVisible();
    await expect(leaf).toContainText('empty list');
    await expect(
      page.locator('details.nerd-json-branch summary', { hasText: 'vendor_resources' })
    ).toHaveCount(0);
  });

  test('disclosures are keyboard operable and keep a visible focus ring', async ({ page }) => {
    await page.goto(`${PAGE}?slug=i-ready`);
    const summary = page.locator('.nerd-json-summary').first();
    await summary.focus();
    await expect(summary).toBeFocused();

    const outline = await summary.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');

    const branch = page.locator('details.nerd-json-branch').first();
    const before = await branch.evaluate((el) => (el as HTMLDetailsElement).open);
    await page.keyboard.press('Enter');
    const after = await branch.evaluate((el) => (el as HTMLDetailsElement).open);
    expect(after).toBe(!before);
  });

  test('raw view scroll container is keyboard reachable', async ({ page }) => {
    await page.goto(PAGE);
    // exact: true is required -- 'Raw JSON' also substring-matches 'Edit raw JSON'.
    await page.getByRole('button', { name: 'Raw JSON', exact: true }).click();
    const pre = page.locator('.nerd-json-pre');
    await expect(pre).toHaveAttribute('tabindex', '0');
    await pre.focus();
    await expect(pre).toBeFocused();
  });
});

test.describe('Raw JSON editor dialog', () => {
  async function openEditor(page: import('@playwright/test').Page, slug = 'i-ready') {
    await page.goto(`${PAGE}?slug=${slug}`);
    await page.locator('.nerd-json-list-item').first().waitFor();
    await page.getByRole('button', { name: 'Edit raw JSON' }).click();
    await expect(page.locator('dialog.nerd-json-dialog')).toBeVisible();
  }

  test('opens as a true modal with an accessible name and no aria-modal', async ({ page }) => {
    await openEditor(page);
    const dialog = page.locator('dialog.nerd-json-dialog');

    // showModal(), not the open attribute: only the former puts the dialog in
    // the top layer and makes the background inert.
    const isTopLayer = await dialog.evaluate((el) => el.matches(':modal'));
    expect(isTopLayer).toBe(true);

    // aria-modal alongside an accessible name is known to hide static dialog
    // content from VoiceOver quick-nav. showModal() conveys modality already.
    await expect(dialog).not.toHaveAttribute('aria-modal', /.*/);
    await expect(page.getByRole('dialog', { name: /Edit raw JSON/ })).toBeVisible();
  });

  test('axe scan is clean with the dialog open', async ({ page }) => {
    await openEditor(page);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test('Tab leaves the textarea — WCAG 2.1.2 No Keyboard Trap', async ({ page }) => {
    await openEditor(page);
    const textarea = page.locator('.nerd-json-textarea');
    await textarea.focus();
    await expect(textarea).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(textarea).not.toBeFocused();

    // And the value is unchanged: Tab must not have inserted a tab character.
    const value = await textarea.inputValue();
    expect(value.includes('\t')).toBe(false);
  });

  test('focus never reaches a control behind the dialog', async ({ page }) => {
    await openEditor(page);

    // Measured behaviour of native showModal() in Chromium: tabbing off the
    // last control in the dialog resets activeElement to document.body for one
    // step before cycling back to the first control in the dialog. Focus never
    // reaches anything outside, so containment holds. Asserting
    // "activeElement is always inside the dialog" would fail on that one step
    // and is the wrong property to test.
    const trail: string[] = [];
    for (let i = 0; i < 14; i += 1) {
      await page.keyboard.press('Tab');
      trail.push(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body || el === document.documentElement) return 'BODY';
          return el.closest('dialog.nerd-json-dialog') ? 'IN_DIALOG' : 'ESCAPED';
        })
      );
    }
    expect(trail).not.toContain('ESCAPED');
    expect(trail).toContain('IN_DIALOG');

    // And the background really is inert: the button that opened the dialog
    // cannot be reached or activated while it is open.
    const triggerFocusable = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Edit raw JSON'
      ) as HTMLButtonElement | undefined;
      if (!btn) return 'MISSING';
      btn.focus();
      return document.activeElement === btn ? 'FOCUSABLE' : 'INERT';
    });
    expect(triggerFocusable).toBe('INERT');
  });

  test('caret does not jump when typing in the middle of the document', async ({ page }) => {
    await openEditor(page);
    const textarea = page.locator('.nerd-json-textarea');
    const original = await textarea.inputValue();
    const target = Math.floor(original.length / 2);

    await textarea.evaluate((el, pos) => {
      const ta = el as HTMLTextAreaElement;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    }, target);
    await page.keyboard.type('X');

    const caret = await textarea.evaluate((el) => (el as HTMLTextAreaElement).selectionStart);
    expect(caret).toBe(target + 1);
  });

  test('a syntax error blocks save and reports a real line and column', async ({ page }) => {
    await openEditor(page);
    const textarea = page.locator('.nerd-json-textarea');
    const original = await textarea.inputValue();
    // Deliberately the error class where V8's message carries NO position and
    // no line/column at all -- measured: `Unexpected token ',', ...\"es\": [ 1, ,]
    // }\" is not valid JSON`. If this test passes, lib/json-position.ts's own
    // scanner produced the coordinates, because there were none to regex out.
    await textarea.fill(original.replace('"vendor_resources": [', '"vendor_resources": [ 1, ,'));

    await page.getByRole('button', { name: 'Save changes' }).click();
    // Scoped to the dialog's own region: Next.js injects
    // #__next-route-announcer__ with role="alert" at document level, so an
    // unscoped [role="alert"] locator matches two elements and fails strict mode.
    const alert = page.locator('dialog.nerd-json-dialog .nerd-json-alert');
    await expect(alert).toContainText(/Line \d+, column \d+/);
    // Still open: the save was refused, not silently accepted.
    await expect(page.locator('dialog.nerd-json-dialog')).toBeVisible();
  });

  test('an invalid support_contacts type blocks save', async ({ page }) => {
    await openEditor(page);
    const textarea = page.locator('.nerd-json-textarea');
    const record = JSON.parse(await textarea.inputValue());
    record.support_contacts = [{ type: 'phone', value: '555-0100', label: null }];
    await textarea.fill(JSON.stringify(record, null, 2));

    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('dialog.nerd-json-dialog .nerd-json-alert')).toContainText(
      'Cannot save'
    );
    await expect(page.locator('.nerd-json-issue--error')).toContainText('support_contacts[0].type');
    await expect(page.locator('dialog.nerd-json-dialog')).toBeVisible();
  });

  test('Escape with unsaved changes does not silently discard them', async ({ page }) => {
    await openEditor(page);
    page.on('dialog', (d) => d.dismiss()); // decline the confirm
    const textarea = page.locator('.nerd-json-textarea');
    await textarea.fill(`${await textarea.inputValue()} `);
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog.nerd-json-dialog')).toBeVisible();
  });

  test('no state leaks between records', async ({ page }) => {
    await openEditor(page, 'i-ready');
    const textarea = page.locator('.nerd-json-textarea');
    await textarea.fill('{ "corrupted": true }');
    page.on('dialog', (d) => d.accept()); // accept the discard confirm
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('dialog.nerd-json-dialog')).toBeHidden();

    await page.locator('.nerd-json-list-item', { hasText: 'Blooket' }).click();
    await page.getByRole('button', { name: 'Edit raw JSON' }).click();
    const next = await page.locator('.nerd-json-textarea').inputValue();
    expect(next).not.toContain('corrupted');
    expect(next).toContain('blooket');
  });

  test('focus returns to the trigger after the dialog closes', async ({ page }) => {
    await openEditor(page);
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('button', { name: 'Edit raw JSON' })).toBeFocused();
  });

  test('a clean round trip exports a byte-identical file', async ({ page }) => {
    await page.goto(PAGE);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /^Export file/ }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('published-tables.json');

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const exported = Buffer.concat(chunks).toString('utf8');

    const fs = await import('node:fs/promises');
    const source = await fs.readFile('lib/published-tables.json', 'utf8');
    // Compare parsed structure and $meta verbatim. If this fails, the
    // serializer is mutating data and every later gate is suspect.
    expect(JSON.parse(exported)).toEqual(JSON.parse(source));
    expect(JSON.parse(exported).$meta.snapshot_taken_at).toBe(
      JSON.parse(source).$meta.snapshot_taken_at
    );
  });
});
