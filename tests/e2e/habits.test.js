import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, withPhone } from './harness.js';
import { dateInTz } from '../../shared/dates.js';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });
test('Dashboard check-ins, full history, editing and backups work inside the actual app', async () =>
  withPhone(browser, async ({ page, app }) => {
    const today = dateInTz(new Date(), 'America/Edmonton');
    await page.goto(app.url + '/#/');
    const widget = page.getByTestId('widget-habits');
    await widget.waitFor();
    const first = widget.getByRole('checkbox').first();
    await first.check();
    await widget.getByRole('link', { name: 'History & manage' }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid=title]')?.textContent.trim() === 'Habits');
    const square = page.getByRole('button', { name: 'Read a few pages, ' + today + ': completed', exact: true });
    assert.equal(await square.getAttribute('aria-pressed'), 'true');
    await page.reload();
    await square.waitFor();
    await square.click();
    await page.getByRole('button', { name: 'New habit', exact: true }).click();
    await page.getByLabel('Habit name', { exact: true }).fill('<A small habit>');
    await page.getByLabel('Small goal (optional)', { exact: true }).fill('One step');
    await page.getByRole('button', { name: 'Save habit', exact: true }).click();
    await page.getByRole('heading', { name: '<A small habit>', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Edit <A small habit>', exact: true }).click();
    await page.getByLabel('Habit name', { exact: true }).fill('A short walk');
    await page.getByRole('button', { name: 'Save habit', exact: true }).click();
    await page.getByRole('heading', { name: 'A short walk', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Next week', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Previous week', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Next week', exact: true }).isEnabled(), true);
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await page.getByText('Sample data & backups', { exact: true }).click();
    await page.getByRole('button', { name: 'Show backup', exact: true }).click();
    const backup = await page.locator('#habit-backup').inputValue();
    assert.equal(JSON.parse(backup).habits.length, 4);
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Start fresh', exact: true }).click();
    assert.equal(await page.locator('.habit-card').count(), 0);
    await page.locator('#habit-restore').fill(backup);
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Restore backup', exact: true }).click();
    assert.equal(await page.locator('.habit-card').count(), 4);
    await page.locator('#habit-restore').fill('{"format":1,"habits":[{}]}');
    await page.getByRole('button', { name: 'Restore backup', exact: true }).click();
    await page.getByText('This backup contains invalid habit data. Nothing was replaced.', { exact: true }).waitFor();
    assert.equal(await page.locator('.habit-card').count(), 4);
    await page.getByRole('button', { name: 'Edit A short walk', exact: true }).click();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Delete habit', exact: true }).click();
    assert.equal(await page.locator('.habit-card').count(), 3);
    await page.getByTestId('tab-today').click();
    await widget.waitFor();
    assert.equal(await widget.getByRole('checkbox').first().isChecked(), false);
    assert.deepEqual(page.errors, []);
  }));

test('habit page fits light and dark phone layouts, including the editor', async () =>
  withPhone(browser, async ({ page, app }) => {
    await page.goto(app.url + '/#/habits');
    await page.locator('.habit-card').first().waitFor();
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const colorScheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }
      await page.getByRole('button', { name: 'New habit', exact: true }).click();
      assert.equal(await page.locator('.habit-dialog').evaluate((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }), true);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    assert.deepEqual(page.errors, []);
  }));
