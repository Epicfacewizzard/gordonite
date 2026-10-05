import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { uuid } from '../../shared/ids.js';
import { dateInTz, addDays } from '../../shared/dates.js';
import { launch, TZ, withPhone, waitSaved } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

const today = () => dateInTz(new Date(), TZ);
const tasksIn = (app, noteId) => JSON.parse(app.notes().find((n) => n.id === noteId).doc).content[0].content;
const attrsOf = (app, noteId, text) => tasksIn(app, noteId).find((x) => x.content[0].content[0].text === text).attrs;

async function seed(app, texts) {
  const id = uuid();
  const item = (text) => ({ type: 'taskItem', attrs: { checked: false, id: uuid() }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  const r = await app.api('PUT', `/api/notes/${id}`, {
    baseRevision: 0,
    doc: { type: 'doc', content: [{ type: 'taskList', content: texts.map(item) }] },
    docFormat: 1,
    tags: ['school'],
    date: today(),
    opId: uuid(),
  });
  assert.equal(r.status, 200);
  return id;
}
const rowOf = (page, text) => page.locator('[data-testid="task-row"]', { hasText: text });

describe('the task row: hide, due and priority buttons', () => {
  test('due menu: presets with their dates, a due date, and the same menu for a start date', () =>
    withPhone(browser, async ({ page, app }) => {
      const id = await seed(app, ['write essay']);
      await page.goto(`${app.url}/#/tasks`);
      await rowOf(page, 'write essay').waitFor();
      assert.equal(await rowOf(page, 'write essay').getByTestId('task-hide').count(), 1);
      assert.equal(await rowOf(page, 'write essay').getByTestId('task-priority').count(), 1);

      await rowOf(page, 'write essay').getByTestId('task-date').tap();
      const menu = page.getByTestId('menu-due');
      await menu.waitFor();
      const text = await menu.innerText();
      for (const label of ['Today', 'Tomorrow', 'This weekend', 'One week', 'Three weeks', 'Choose date', 'Add start date']) assert.match(text, new RegExp(label));
      assert.match(text, /Mon, Oct 12|\w{3}, \w{3} \d{1,2}/, 'each preset shows its date');

      await page.getByTestId('pick-tomorrow').tap();
      await waitSaved(page);
      assert.equal(attrsOf(app, id, 'write essay').due, addDays(today(), 1));
      await page.getByTestId('section-upcoming').getByText('write essay').waitFor();
      assert.match(await rowOf(page, 'write essay').getByTestId('chip-due').innerText(), /^due /);

      // the same menu sets a start date: the task waits under "Starts later"
      await rowOf(page, 'write essay').getByTestId('task-date').tap();
      await page.getByTestId('menu-switch').tap();
      await page.getByTestId('menu-start').waitFor();
      await page.getByTestId('pick-one-week').tap();
      await waitSaved(page);
      assert.equal(attrsOf(app, id, 'write essay').start, addDays(today(), 7));
      await page.getByTestId('toggle-later').tap();
      await page.getByTestId('section-later').getByText('write essay').waitFor();

      // clear the due date again
      await rowOf(page, 'write essay').getByTestId('task-date').tap();
      await page.getByTestId('menu-clear').tap();
      await waitSaved(page);
      assert.equal(attrsOf(app, id, 'write essay').due, undefined, 'cleared, nothing stored');
      assert.deepEqual(page.errors, []);
    }));

  test('priority menu: four choices, shown on the row, and the most pressing sorts first', () =>
    withPhone(browser, async ({ page, app }) => {
      const id = await seed(app, ['alpha task', 'beta task', 'gamma task']);
      await page.goto(`${app.url}/#/tasks`);
      await rowOf(page, 'alpha task').waitFor();
      const order = () => page.getByTestId('section-anytime').getByTestId('task-row').evaluateAll((rows) => rows.map((r) => r.innerText.split('\n')[0].trim()));
      assert.deepEqual(await order(), ['alpha task', 'beta task', 'gamma task']);

      await rowOf(page, 'gamma task').getByTestId('task-priority').tap();
      const menu = page.getByTestId('menu-priority');
      await menu.waitFor();
      for (const label of ['Urgent & Important', 'Urgent', 'Important', 'None']) assert.match(await menu.innerText(), new RegExp(label));
      await page.getByTestId('priority-both').tap();
      await waitSaved(page);
      assert.equal(attrsOf(app, id, 'gamma task').priority, 'both');
      await rowOf(page, 'beta task').getByTestId('task-priority').tap();
      await page.getByTestId('priority-important').tap();
      await waitSaved(page);
      assert.deepEqual(await order(), ['gamma task', 'beta task', 'alpha task'], 'urgent & important, then important, then none');
      assert.equal(await rowOf(page, 'gamma task').getAttribute('data-priority'), 'both');

      await rowOf(page, 'gamma task').getByTestId('task-priority').tap();
      await page.getByTestId('priority-none').tap();
      await waitSaved(page);
      assert.equal(attrsOf(app, id, 'gamma task').priority, undefined, 'None stores nothing');
      assert.deepEqual(page.errors, []);
    }));

  test('hide menu: until a day (it comes back by itself), a number of days, until shown again; and show it again', () =>
    withPhone(browser, async ({ page, app }) => {
      const id = await seed(app, ['hide me', 'hide me too']);
      await page.goto(`${app.url}/#/tasks`);
      await rowOf(page, 'hide me').first().waitFor();

      await rowOf(page, 'hide me too').getByTestId('task-hide').tap();
      const menu = page.getByTestId('menu-hide');
      await menu.waitFor();
      const text = await menu.innerText();
      for (const label of ['Tomorrow', 'This weekend', 'One week', 'Three weeks', 'Choose date', 'Choose number of days', 'Hide until I show it']) assert.match(text, new RegExp(label));
      assert.doesNotMatch(text, /Show again/, 'nothing to undo yet');
      await page.getByTestId('hide-one-week').tap();
      await waitSaved(page);
      assert.equal(attrsOf(app, id, 'hide me too').hideUntil, addDays(today(), 7));
      assert.equal(await page.getByTestId('section-anytime').getByText('hide me too').count(), 0, 'out of the list');
      await page.getByTestId('toggle-hidden').tap();
      await page.getByTestId('section-hidden').getByText('hide me too').waitFor();
      assert.match(await page.getByTestId('chip-hidden').innerText(), /^hidden until /);

      // number of days
      await rowOf(page, 'hide me').first().getByTestId('task-hide').tap();
      await page.getByTestId('menu-choose-days').tap();
      await page.getByTestId('menu-days-input').fill('3');
      await page.getByTestId('menu-days-go').tap();
      await waitSaved(page);
      assert.equal(attrsOf(app, id, 'hide me').hideUntil, addDays(today(), 3));

      // show it again
      await page.getByTestId('section-hidden').getByText('hide me too').tap(); // it is in the folded Hidden section
      await page.getByTestId('task-sheet-done').tap();
      await page.locator('[data-testid="section-hidden"] [data-testid="task-row"]', { hasText: 'hide me too' }).getByTestId('task-hide').tap();
      await page.getByTestId('menu-show-again').tap();
      await waitSaved(page);
      assert.equal(attrsOf(app, id, 'hide me too').hideUntil, undefined);
      await page.getByTestId('section-anytime').getByText('hide me too').waitFor();

      // until I show it
      await rowOf(page, 'hide me too').getByTestId('task-hide').tap();
      await page.getByTestId('menu-hide-forever').tap();
      await waitSaved(page);
      assert.equal(attrsOf(app, id, 'hide me too').hidden, true);
      assert.deepEqual(page.errors, []);
    }));

  test('a date typed in the text is shown dimmer; the Today screen has the same buttons', () =>
    withPhone(browser, async ({ page, app }) => {
      await seed(app, ['send the deck due fri', 'plain task']);
      await page.goto(`${app.url}/#/`);
      await rowOf(page, 'send the deck').waitFor();
      assert.equal(await rowOf(page, 'send the deck').locator('.typed-date').innerText(), 'due fri');
      assert.equal(await rowOf(page, 'plain task').locator('.typed-date').count(), 0);
      assert.equal(await rowOf(page, 'plain task').getByTestId('task-date').count(), 1, 'the buttons are on Today too');
      await rowOf(page, 'plain task').getByTestId('task-priority').tap();
      await page.getByTestId('priority-urgent').tap();
      await waitSaved(page);
      assert.equal(await rowOf(page, 'plain task').getAttribute('data-priority'), 'urgent');
    }));
});
