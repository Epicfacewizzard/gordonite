import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { launch, withPhone, open, editor } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

// The spacing of the two paragraphs in the first note on the page: line height and the gap after the first.
const metrics = (page, selector) =>
  page.locator(selector).first().evaluate((el) => {
    const ps = el.querySelectorAll('p');
    const s = getComputedStyle(ps[0]);
    return { lineHeight: parseFloat(s.lineHeight) / parseFloat(s.fontSize), gap: parseFloat(s.marginBottom) / parseFloat(s.fontSize) };
  });

describe('line spacing setting', () => {
  test('the default is tighter than the original look; Tight and Relaxed change it, with a live preview, and it is remembered', () =>
    withPhone(browser, async ({ page, app }) => {
      await page.goto(`${app.url}/#/tags`);
      await page.getByTestId('settings-link').tap();
      await page.getByTestId('settings').waitFor();
      assert.equal(await page.getByTestId('title').innerText(), 'Settings');
      assert.equal(await page.getByTestId('spacing-normal').isChecked(), true, 'Normal is the default');

      const preview = '[data-testid="spacing-preview"]';
      const normal = await metrics(page, preview);
      assert.ok(normal.lineHeight < 1.5 && normal.gap < 0.45, `tighter than the original (got ${JSON.stringify(normal)})`);

      await page.getByTestId('spacing-relaxed').check();
      const relaxed = await metrics(page, preview);
      assert.deepEqual([relaxed.lineHeight.toFixed(2), relaxed.gap.toFixed(2)], ['1.50', '0.45'], 'Relaxed is the original look');

      await page.getByTestId('spacing-tight').check();
      const tight = await metrics(page, preview);
      assert.ok(tight.lineHeight < normal.lineHeight && tight.gap < normal.gap, 'Tight is tighter than Normal');
      assert.equal(await page.evaluate(() => document.documentElement.dataset.spacing), 'tight');

      // remembered on this device: after a reload, and in a real note's editor too
      await page.reload();
      await page.getByTestId('settings').waitFor();
      assert.equal(await page.getByTestId('spacing-tight').isChecked(), true);
      await open(page, 'daily-jots');
      await editor(page).tap();
      await page.keyboard.type('first');
      await page.keyboard.press('Enter');
      await page.keyboard.type('second');
      const inNote = await metrics(page, '.note-text[contenteditable="true"]');
      assert.deepEqual([inNote.lineHeight.toFixed(2), inNote.gap.toFixed(2)], [tight.lineHeight.toFixed(2), tight.gap.toFixed(2)], 'real notes follow the setting');
      assert.deepEqual(page.errors, []);
    }));
});
