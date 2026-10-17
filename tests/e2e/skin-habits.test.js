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

  test('a new habit stays on screen while the server is slow to list the habits again', () =>
    withPhone(browser, async ({ page, app }) => {
      // Over the VPN on mobile data the list can take seconds; after one second the app shows the phone's copy, which
      // was kept before the habit existed. The habit used to vanish from the screen as soon as it had been sent.
      let slow = false;
      await page.route('**/api/habits?**', async (route) => {
        if (slow) await new Promise((r) => setTimeout(r, 3000));
        await route.continue().catch(() => {});
      });
      await page.goto(`${app.url}/#/habits`);
      await page.getByTestId('habits').waitFor();
      await page.waitForTimeout(300); // the first list is kept as the phone copy
      slow = true;
      await page.getByTestId('habit-new').tap();
      await page.getByTestId('habit-name').fill('Drink water');
      await page.getByTestId('habit-save').tap();
      await until(async () => (await app.api('GET', '/api/habits')).json.habits.length === 1, 'the habit on the server');
      const card = page.getByTestId('habit-card').filter({ hasText: 'Drink water' });
      await page.waitForTimeout(1500); // sent, and the list asked for again is answered from the old phone copy
      assert.equal(await card.count(), 1, 'shown while the list is slow');
      await page.waitForTimeout(2500); // the slow list arrives
      assert.equal(await card.count(), 1, 'shown once the server lists it');
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

describe('habit options', () => {
  const habits = async (app) => (await app.api('GET', '/api/habits')).json;

  test('a number habit, 3 times a week, with a colour and reminder: made in the editor, entered on the Dashboard', () =>
    withPhone(browser, async ({ page, app }) => {
      await page.goto(`${app.url}/#/habits`);
      await page.getByTestId('habit-new').tap();
      await page.getByTestId('habit-name').fill('Water');
      await page.getByTestId('habit-question').fill('Did you drink enough?');
      await page.getByTestId('habit-kind-number').check();
      await page.getByTestId('habit-target').fill('8');
      await page.getByTestId('habit-unit').fill('glasses');
      await page.getByTestId('habit-freq').selectOption('week');
      await page.getByTestId('habit-times').fill('3');
      await page.getByTestId('habit-color-blue').check();
      await page.getByTestId('habit-reminder').fill('09:00');
      await page.getByTestId('habit-save').tap();
      await until(async () => (await habits(app)).habits.length === 1, 'the habit on the server');
      const h = (await habits(app)).habits[0];
      assert.deepEqual(
        { freq: h.freq, kind: h.kind, target: h.target, unit: h.unit, color: h.color, reminder: h.reminder, question: h.question },
        { freq: { type: 'week', times: 3 }, kind: 'number', target: 8, unit: 'glasses', color: 'blue', reminder: '09:00', question: 'Did you drink enough?' },
      );

      await page.goto(`${app.url}/#/`);
      const row = page.getByTestId('habit-today').filter({ hasText: 'Water' });
      assert.match(await row.textContent(), /at least 8 glasses · Did you drink enough\? · 0 of 3 this week · 9:00/);
      await row.getByTestId('habit-today-amount').tap();
      await page.getByTestId('habit-entry-value').fill('9');
      await page.getByTestId('habit-entry-save').tap();
      await until(async () => (await habits(app)).checks.some((c) => c.date === today() && c.value === 9), 'the number on the server');
      await page.getByTestId('habit-today').filter({ hasText: '1 of 3 this week' }).waitFor();

      await page.goto(`${app.url}/#/habits`);
      await page.getByRole('button', { name: `Water, ${today()}: 9, target met` }).waitFor();
    }));

  test('a habit’s own page shows streaks and score; a skipped day keeps the streak', () =>
    withPhone(browser, async ({ page, app }) => {
      const id = newId();
      await app.api('PUT', `/api/habits/${id}`, { name: 'Stretch', days: [0, 1, 2, 3, 4, 5, 6], created: addDays(today(), -4) });
      for (const d of [-4, -3, -1]) await app.api('PUT', `/api/habits/${id}/checks/${addDays(today(), d)}`);
      await page.goto(`${app.url}/#/habits`);
      await page.getByTestId('habit-open').filter({ hasText: 'Stretch' }).tap();
      await page.getByTestId('habit-detail').waitFor();
      assert.equal(await page.getByTestId('habit-best-streak').textContent(), '2');
      assert.equal(await page.getByTestId('habit-current-streak').textContent(), '1');
      assert.equal(await page.getByTestId('habit-total').textContent(), '3');

      // the missed day two days ago was really a day away: skip it, and the streak runs through it
      await page.getByRole('button', { name: `Stretch, ${addDays(today(), -2)}: not done` }).tap();
      await page.getByTestId('habit-entry-skip').tap();
      await until(async () => (await habits(app)).checks.some((c) => c.date === addDays(today(), -2) && c.skip), 'the skipped day on the server');
      await until(async () => (await page.getByTestId('habit-current-streak').textContent()) === '3', 'the streak through the skipped day');
      assert.notEqual(await page.getByTestId('habit-score').textContent(), '0%');
      await page.getByRole('button', { name: `Stretch, ${addDays(today(), -2)}: skipped` }).waitFor();
    }));

  test('habits are reordered with the arrows, and an archived habit leaves the Dashboard until unarchived', () =>
    withPhone(browser, async ({ page, app }) => {
      const a = newId();
      const b = newId();
      await app.api('PUT', `/api/habits/${a}`, { name: 'Alpha', days: [0, 1, 2, 3, 4, 5, 6], created: today(), sort: 10 });
      await app.api('PUT', `/api/habits/${b}`, { name: 'Bravo', days: [0, 1, 2, 3, 4, 5, 6], created: today(), sort: 20 });
      await page.goto(`${app.url}/#/habits`);
      const names = () => page.getByTestId('habit-open').allTextContents();
      await until(async () => (await names()).length === 2, 'both habits');
      assert.deepEqual(await names(), ['Alpha', 'Bravo']);
      await page.getByRole('button', { name: 'Move Bravo up' }).tap();
      await until(async () => (await names())[0] === 'Bravo', 'Bravo first');
      await until(async () => (await habits(app)).habits.map((h) => h.name).join() === 'Bravo,Alpha', 'the order on the server');

      await page.getByRole('button', { name: 'Edit Alpha' }).tap();
      await page.getByTestId('habit-archive').tap();
      await until(async () => (await habits(app)).habits.find((h) => h.id === a).archived, 'archived on the server');
      assert.deepEqual(await names(), ['Bravo']);
      await page.getByTestId('habit-archived').locator('summary').tap();
      assert.match(await page.getByTestId('habit-archived').textContent(), /Archived \(1\)Alpha/);
      await page.goto(`${app.url}/#/`);
      await page.getByTestId('habit-today').filter({ hasText: 'Bravo' }).waitFor();
      assert.equal(await page.getByTestId('habit-today').filter({ hasText: 'Alpha' }).count(), 0, 'not on the Dashboard');

      await page.goto(`${app.url}/#/habits`);
      await page.getByTestId('habit-archived').locator('summary').tap();
      await page.getByTestId('habit-archived').getByRole('button', { name: 'Unarchive' }).tap();
      await until(async () => (await names()).length === 2, 'back in the list');
      assert.equal((await habits(app)).habits.find((h) => h.id === a).archived, false);
    }));
});

describe('backdating habits', () => {
  const habits = async (app) => (await app.api('GET', '/api/habits')).json;
  const checkOn = async (app, date) => (await habits(app)).checks.find((c) => c.date === date);

  test('the Dashboard steps back a day to tick it, a habit made later moves its start back, and the streak counts it', () =>
    withPhone(browser, async ({ page, app }) => {
      const id = newId();
      await app.api('PUT', `/api/habits/${id}`, { name: 'Walk', days: [0, 1, 2, 3, 4, 5, 6], created: today() });
      await page.goto(`${app.url}/#/`);
      const widget = page.getByTestId('widget-habits');
      await widget.getByTestId('habit-today').filter({ hasText: 'Walk' }).waitFor();
      assert.equal(await widget.getByTestId('habit-day-next').isDisabled(), true, 'no stepping into tomorrow');

      await widget.getByTestId('habit-day-prev').tap();
      assert.match(await widget.getByRole('group', { name: 'Day to log' }).textContent(), /Yesterday/);
      const row = widget.getByTestId('habit-today').filter({ hasText: 'Walk' });
      assert.match(await row.textContent(), /before its start/);
      await row.locator('input[type=checkbox]').check();
      await until(() => checkOn(app, addDays(today(), -1)), 'yesterday’s tick on the server');
      await until(async () => (await habits(app)).habits[0].created === addDays(today(), -1), 'the start moved back');
      assert.match(await widget.getByTestId('habit-day-count').textContent(), /1 of 1 yesterday/);

      // a day picked in the calendar; a future day is refused
      await widget.getByTestId('habit-day-pick').fill(addDays(today(), 1));
      assert.match(await widget.getByRole('group', { name: 'Day to log' }).textContent(), /Yesterday/, 'tomorrow is not taken');
      await widget.getByTestId('habit-day-pick').fill(addDays(today(), -3));
      await widget.getByTestId('habit-today').filter({ hasText: 'Walk' }).locator('input[type=checkbox]').check();
      await until(() => checkOn(app, addDays(today(), -3)), 'the tick three days ago');

      await widget.getByTestId('habit-day-today').tap();
      await widget.getByTestId('habit-today').filter({ hasText: 'Walk' }).locator('input[type=checkbox]').check();
      await until(() => checkOn(app, today()), 'today’s tick');
      const res = await app.api('PUT', `/api/habits/${id}/checks/${addDays(today(), 1)}`);
      assert.equal(res.status, 400, 'the server still refuses a future day');

      await page.goto(`${app.url}/#/habits/${id}`);
      await page.getByTestId('habit-detail').waitFor();
      assert.equal(await page.getByTestId('habit-current-streak').textContent(), '2', 'yesterday and today');
      assert.equal(await page.getByTestId('habit-best-streak').textContent(), '2');
      assert.equal(await page.getByTestId('habit-total').textContent(), '3');
    }));

  test('a day before the start on the habit’s page opens the day: a number, skip or tick, and the start moves back', () =>
    withPhone(browser, async ({ page, app }) => {
      const id = newId();
      await app.api('PUT', `/api/habits/${id}`, { name: 'Water', days: [0, 1, 2, 3, 4, 5, 6], created: today(), kind: 'number', target: 8, unit: 'glasses' });
      await page.goto(`${app.url}/#/habits/${id}`);
      await page.getByTestId('habit-detail').waitFor();
      const twoAgo = addDays(today(), -2);
      // the calendar shows this month; two days ago may be last month
      if (twoAgo.slice(0, 7) !== today().slice(0, 7)) await page.getByRole('button', { name: 'Previous month' }).tap();
      await page.getByRole('button', { name: `Water, ${twoAgo}: before the start` }).tap();
      await page.getByTestId('habit-entry-early').waitFor();
      await page.getByTestId('habit-entry-value').fill('9');
      await page.getByTestId('habit-entry-save').tap();
      await until(async () => (await checkOn(app, twoAgo))?.value === 9, 'the number two days ago');
      await until(async () => (await habits(app)).habits[0].created === twoAgo, 'the start moved back');
      await page.getByRole('button', { name: `Water, ${twoAgo}: 9, target met` }).waitFor();
      assert.equal(await page.getByTestId('habit-best-streak').textContent(), '1');
      assert.equal(await page.getByTestId('habit-total').textContent(), '1');
      // the day after is now a missed day, not "before the start"
      const oneAgo = addDays(today(), -1);
      if (oneAgo.slice(0, 7) === twoAgo.slice(0, 7)) await page.getByRole('button', { name: `Water, ${oneAgo}: not done` }).waitFor();
    }));

  test('a past day logged offline waits on the phone and is sent when the connection is back', () =>
    withPhone(browser, async ({ page, app }) => {
      const id = newId();
      await app.api('PUT', `/api/habits/${id}`, { name: 'Read', days: [0, 1, 2, 3, 4, 5, 6], created: addDays(today(), -10), freq: { type: 'week', times: 3 } });
      await page.goto(`${app.url}/#/`);
      const widget = page.getByTestId('widget-habits');
      await widget.getByTestId('habit-today').filter({ hasText: 'Read' }).waitFor();
      await page.context().setOffline(true);
      await widget.getByTestId('habit-day-prev').tap();
      await widget.getByTestId('habit-day-prev').tap();
      const row = widget.getByTestId('habit-today').filter({ hasText: 'Read' });
      await row.locator('input[type=checkbox]').check();
      await until(async () => /1 of 3 this week/.test(await row.textContent()), 'the week’s count on the phone');
      assert.match(await widget.getByTestId('habit-day-count').textContent(), /waiting to be sent/);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('hq-habit-pending')).length), 1, 'kept on the phone');
      assert.equal(await checkOn(app, addDays(today(), -2)), undefined, 'the server has not seen it');

      await page.context().setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await until(() => checkOn(app, addDays(today(), -2)), 'the tick sent');
      await until(async () => page.evaluate(() => JSON.parse(localStorage.getItem('hq-habit-pending') ?? '[]').length === 0), 'the queue empty');
      assert.equal((await habits(app)).habits[0].created, addDays(today(), -10), 'a day after the start leaves the start alone');
    }));
});
