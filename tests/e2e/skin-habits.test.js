import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dateInTz, addDays } from '../../shared/dates.js';
import { launch, TZ, withPhone, newId, textOf } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

const today = () => dateInTz(new Date(), TZ);
const until = async (check, what, timeout = 10_000) => {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};
const pick = (page, group, name) => page.getByTestId(`skin-${group}`).getByRole('button', { name, exact: true }).tap();
const skinNote = (app) => app.notes().find((n) => n.title?.startsWith('Skin log'));
const skinLines = (app) => textOf(JSON.parse(skinNote(app).doc)).split('\n').filter((l) => /^\d{4}:/.test(l));

describe('skin log', () => {
  test('an entry goes into the month note and is saved as a record; it can be edited, reassessed on the same line, and deleted', () =>
    withPhone(browser, async ({ page, app }) => {
      await page.goto(`${app.url}/#/skin`);
      await page.getByTestId('skin').waitFor();
      await page.getByTestId('skin-time').fill('21:00');
      await pick(page, 'symptoms', 'Itch');
      await pick(page, 'areas', 'Legs');
      await page.locator('[data-area="Legs"]').getByRole('button', { name: 'Post' }).tap();
      await pick(page, 'products', 'Betaderm');
      assert.equal(await page.getByTestId('skin-preview').textContent(), '2100: Itch on posterior legs. Betaderm applied on posterior legs.');
      await page.getByTestId('skin-add').tap();
      await page.getByTestId('skin-done').waitFor();
      await until(() => skinNote(app), 'the month note');
      assert.equal(skinNote(app).title.startsWith('Skin log ·'), true);
      await until(async () => (await app.api('GET', '/api/skin')).json.entries.length === 1, 'the record');
      assert.deepEqual(skinLines(app), ['2100: Itch on posterior legs. Betaderm applied on posterior legs.']);

      // edit: the form comes back with what was picked; add an area
      await page.getByTestId('skin-entry-edit').first().tap();
      assert.equal(await page.getByTestId('skin-symptoms').getByRole('button', { name: 'Itch', exact: true }).getAttribute('aria-pressed'), 'true');
      await pick(page, 'areas', 'Neck');
      await page.getByTestId('skin-add').tap();
      await until(() => skinLines(app)[0]?.includes('neck'), 'the edited line');
      assert.deepEqual(skinLines(app), ['2100: Itch on posterior legs and neck. Betaderm applied on posterior legs and neck.'], 'replaced, not added');

      // reassess: only response and skin now; said at the end of the same line
      await page.getByTestId('skin-entry-reassess').first().tap();
      assert.equal(await page.getByTestId('skin-areas').count(), 0, 'where is the entry’s own');
      await page.getByTestId('skin-time').fill('21:45');
      await pick(page, 'response', 'Partial relief');
      await page.getByTestId('skin-add').tap();
      await until(() => skinLines(app)[0]?.includes('Reassessed'), 'the reassessment');
      assert.deepEqual(skinLines(app), ['2100: Itch on posterior legs and neck. Betaderm applied on posterior legs and neck. Reassessed at 2145: partial relief.']);

      // delete: the line goes too
      await page.getByTestId('skin-entry-edit').first().tap();
      page.once('dialog', (d) => d.accept());
      await page.getByTestId('skin-delete').tap();
      await until(() => skinLines(app).length === 0, 'the line removed');
      await until(async () => (await app.api('GET', '/api/skin')).json.entries.length === 0, 'the record deleted');
    }));

  test('same as last time fills in the last entry’s picks', () =>
    withPhone(browser, async ({ page, app }) => {
      await page.goto(`${app.url}/#/skin`);
      await pick(page, 'products', 'Protopic');
      await pick(page, 'areas', 'Neck');
      await page.getByTestId('skin-add').tap();
      await page.getByTestId('skin-done').waitFor();
      await page.getByTestId('skin-same').tap();
      assert.match(await page.getByTestId('skin-preview').textContent(), /^\d{4}: Protopic applied on neck\.$/);
    }));
});

describe('habits', () => {
  test('a habit made on the Habits page is ticked on the Dashboard and kept on the server', () =>
    withPhone(browser, async ({ page, app }) => {
      await page.goto(`${app.url}/#/habits`);
      await page.getByTestId('habit-new').tap();
      await page.getByTestId('habit-name').fill('Drink water');
      await page.getByTestId('habit-save').tap();
      await page.getByTestId('habit-card').filter({ hasText: 'Drink water' }).waitFor();
      await until(async () => (await app.api('GET', '/api/habits')).json.habits.length === 1, 'the habit on the server');

      await page.goto(`${app.url}/#/`);
      const row = page.getByTestId('habit-today').filter({ hasText: 'Drink water' });
      await row.locator('input').tap();
      await until(async () => (await app.api('GET', '/api/habits')).json.checks.some((c) => c.date === today()), 'the check-in');
      await page.reload();
      await page.getByTestId('habit-today').filter({ hasText: 'Drink water' }).locator('input:checked').waitFor();
    }));

  test('logging Betaderm in the skin log starts the linked course: the habit is due and ticked for today', () =>
    withPhone(browser, async ({ page, app }) => {
      const id = newId();
      await app.api('PUT', `/api/habits/${id}`, { name: 'Betaderm course', days: [0, 1, 2, 3, 4, 5, 6], created: addDays(today(), -5), trigger: { product: 'Betaderm', days: 7 } });
      await page.goto(`${app.url}/#/`);
      await page.getByTestId('widget-habits').waitFor();
      assert.equal(await page.getByTestId('habit-today').count(), 0, 'not due before a course starts');

      await page.goto(`${app.url}/#/skin`);
      await pick(page, 'products', 'Betaderm');
      await pick(page, 'areas', 'Legs');
      await page.getByTestId('skin-add').tap();
      await until(async () => (await app.api('GET', '/api/habits')).json.habits[0]?.courses.length === 1, 'the course');
      const { habits, checks } = (await app.api('GET', '/api/habits')).json;
      assert.deepEqual(habits[0].courses, [{ from: today(), to: addDays(today(), 6) }]);
      assert.ok(checks.some((c) => c.habitId === id && c.date === today() && c.source === 'skin'));

      await page.goto(`${app.url}/#/`);
      await page.getByTestId('habit-today').filter({ hasText: 'Betaderm course' }).locator('input:checked').waitFor();
    }));
});
