import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { uuid } from '../../shared/ids.js';
import { dateInTz, addDays } from '../../shared/dates.js';
import { launch, startApp, TZ, withPhone, waitSaved, openTaskDetails } from './harness.js';

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

// Since 0.18.0 a task row on the Tasks page is the tick and the task (with chips); tapping the task opens its details in
// the bottom sheet, led by the When choices (tests/e2e/redesign.test.js). The hide / due / priority menus now live on a
// task's round buttons inside the open note, so their rules are checked there; the lists they change are checked on the
// Tasks page.
const inNote = (page, text) => page.locator('.note-text li[data-checked]', { hasText: text });
const button = (page, text, kind) => inNote(page, text).locator(`[data-task-action="${kind}"]`);

// A computer: a mouse, so a task's round buttons that are not set yet appear when it is hovered.
const desktop = async (fn) => {
  const app = await startApp();
  const context = await browser.newContext({ viewport: { width: 900, height: 800 }, timezoneId: TZ });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  try {
    await fn({ page, app });
    assert.deepEqual(page.errors, []);
  } finally {
    await context.close();
    await app.close();
  }
};
describe('the hide, due and priority menus (on a task in its note, with a mouse: a touch screen shows only the buttons that are set)', () => {
  test('due menu: presets with their dates, a due date, and the same menu for a start date', () =>
    desktop(async ({ page, app }) => {
      const id = await seed(app, ['write essay']);
      await page.goto(`${app.url}/#/n/${id}`);
      await inNote(page, 'write essay').waitFor();
      assert.equal(await button(page, 'write essay', 'hide').count(), 1);
      assert.equal(await button(page, 'write essay', 'priority').count(), 1);

      await button(page, 'write essay', 'date').click();
      const menu = page.getByTestId('menu-due');
      await menu.waitFor();
      const text = await menu.innerText();
      for (const label of ['Today', 'Tomorrow', 'This weekend', 'One week', 'Three weeks', 'Choose date', 'Add start date']) assert.match(text, new RegExp(label));
      assert.match(text, /Mon, Oct 12|\w{3}, \w{3} \d{1,2}/, 'each preset shows its date');

      await page.getByTestId('pick-tomorrow').click();
      await waitSaved(page);
      assert.equal(attrsOf(app, id, 'write essay').due, addDays(today(), 1));

      // the same menu sets a start date: the task waits under "Starts later" on the Tasks page
      await button(page, 'write essay', 'date').click();
      await page.getByTestId('menu-switch').click();
      await page.getByTestId('menu-start').waitFor();
      await page.getByTestId('pick-one-week').click();
      await waitSaved(page);
      assert.equal(attrsOf(app, id, 'write essay').start, addDays(today(), 7));
      await page.goto(`${app.url}/#/tasks`);
      await page.getByTestId('toggle-later').click();
      await page.getByTestId('section-later').getByText('write essay').waitFor();
      assert.match(await rowOf(page, 'write essay').getByTestId('chip-start').innerText(), /^starts /);

      // clear the due date again
      await page.goto(`${app.url}/#/n/${id}`);
      await button(page, 'write essay', 'date').click();
      await page.getByTestId('menu-clear').click();
      await waitSaved(page);
      assert.equal(attrsOf(app, id, 'write essay').due, undefined, 'cleared, nothing stored');
      assert.deepEqual(page.errors, []);
    }));

  test('priority menu: four choices, shown on the row, and the most pressing sorts first', () =>
    desktop(async ({ page, app }) => {
      const id = await seed(app, ['alpha task', 'beta task', 'gamma task']);
      await page.goto(`${app.url}/#/n/${id}`);
      await inNote(page, 'alpha task').waitFor();

      await button(page, 'gamma task', 'priority').click();
      const menu = page.getByTestId('menu-priority');
      await menu.waitFor();
      for (const label of ['Urgent & Important', 'Urgent', 'Important', 'None']) assert.match(await menu.innerText(), new RegExp(label));
      await page.getByTestId('priority-both').click();
      await waitSaved(page);
      assert.equal(attrsOf(app, id, 'gamma task').priority, 'both');
      await button(page, 'beta task', 'priority').click();
      await page.getByTestId('priority-important').click();
      await waitSaved(page);

      await page.goto(`${app.url}/#/tasks`);
      await rowOf(page, 'alpha task').waitFor();
      const order = () => page.getByTestId('section-anytime').getByTestId('task-row').evaluateAll((rows) => rows.map((r) => r.innerText.split('\n')[0].trim()));
      assert.deepEqual(await order(), ['gamma task', 'beta task', 'alpha task'], 'urgent & important, then important, then none');
      assert.equal(await rowOf(page, 'gamma task').getAttribute('data-priority'), 'both');
      assert.equal(await rowOf(page, 'gamma task').getByTestId('chip-priority').count(), 1, 'the row shows it as a chip');

      await page.goto(`${app.url}/#/n/${id}`);
      await button(page, 'gamma task', 'priority').click();
      await page.getByTestId('priority-none').click();
      await waitSaved(page);
      assert.equal(attrsOf(app, id, 'gamma task').priority, undefined, 'None stores nothing');
      assert.deepEqual(page.errors, []);
    }));

  test('hide menu: until a day (it comes back by itself), a number of days, until shown again; and show it again', () =>
    desktop(async ({ page, app }) => {
      const id = await seed(app, ['hide me', 'hide me too']);
      await page.goto(`${app.url}/#/n/${id}`);
      await inNote(page, 'hide me too').waitFor();

      await button(page, 'hide me too', 'hide').click();
      const menu = page.getByTestId('menu-hide');
      await menu.waitFor();
      const text = await menu.innerText();
      for (const label of ['Tomorrow', 'This weekend', 'One week', 'Three weeks', 'Choose date', 'Choose number of days', 'Hide until I show it']) assert.match(text, new RegExp(label));
      assert.doesNotMatch(text, /Show again/, 'nothing to undo yet');
      await page.getByTestId('hide-one-week').click();
      await waitSaved(page);
      assert.equal(attrsOf(app, id, 'hide me too').hideUntil, addDays(today(), 7));

      await page.goto(`${app.url}/#/tasks`);
      await rowOf(page, 'hide me').first().waitFor();
      assert.equal(await page.getByTestId('section-anytime').getByText('hide me too').count(), 0, 'out of the list');
      await page.getByTestId('toggle-hidden').click();
      await page.getByTestId('section-hidden').getByText('hide me too').waitFor();
      assert.match(await page.getByTestId('chip-hidden').innerText(), /^hidden until /);

      // number of days
      await page.goto(`${app.url}/#/n/${id}`);
      await button(page, 'hide me', 'hide').first().click();
      await page.getByTestId('menu-choose-days').click();
      await page.getByTestId('menu-days-input').fill('3');
      await page.getByTestId('menu-days-go').click();
      await waitSaved(page);
      assert.equal(attrsOf(app, id, 'hide me').hideUntil, addDays(today(), 3));

      // show it again
      await inNote(page, 'hide me too').locator('[data-task-action="hide"]').click();
      await page.getByTestId('menu-show-again').click();
      await waitSaved(page);
      assert.equal(attrsOf(app, id, 'hide me too').hideUntil, undefined);
      await page.goto(`${app.url}/#/tasks`);
      await page.getByTestId('section-anytime').getByText('hide me too').waitFor();

      // until I show it
      await page.goto(`${app.url}/#/n/${id}`);
      await button(page, 'hide me too', 'hide').click();
      await page.getByTestId('menu-hide-forever').click();
      await waitSaved(page);
      assert.equal(attrsOf(app, id, 'hide me too').hidden, true);
      assert.deepEqual(page.errors, []);
    }));
});

describe('the task row on the Tasks page and on Today', () => {
  test('a row is the tick, the task and its chips; a date typed in the text is shown dimmer; Today lists only what needs doing', () =>
    withPhone(browser, async ({ page, app }) => {
      await seed(app, ['send the deck due fri', 'plain task', 'old thing due 2020-01-01']);
      await page.goto(`${app.url}/#/tasks`);
      await rowOf(page, 'send the deck').waitFor();
      assert.equal(await rowOf(page, 'send the deck').locator('.typed-date').innerText(), 'due fri');
      assert.equal(await rowOf(page, 'plain task').locator('.typed-date').count(), 0);
      for (const testid of ['task-hide', 'task-date', 'task-priority', 'task-expand']) assert.equal(await rowOf(page, 'plain task').getByTestId(testid).count(), 0, `${testid}: the old round buttons are gone`);
      assert.equal(await rowOf(page, 'plain task').locator('input[type="checkbox"]').count(), 1, 'the tick');

      // priority is set in the sheet (under More) and shows as a chip
      await (await openTaskDetails(page, rowOf(page, 'plain task'))).getByTestId('sheet-priority-urgent').tap();
      await waitSaved(page);
      assert.equal(await rowOf(page, 'plain task').getAttribute('data-priority'), 'urgent');
      await page.getByTestId('task-sheet-done').tap();

      // Today's To do list: what is overdue, plus undated tasks written lately; not what is due on Friday
      await page.goto(`${app.url}/#/`);
      await rowOf(page, 'old thing').waitFor();
      assert.deepEqual(await page.getByTestId('widget-todo').getByTestId('task-row').evaluateAll((rows) => rows.map((r) => r.innerText.split('\n')[0].trim())), ['old thing due 2020-01-01', 'plain task']);
    }));

  test('on a computer the row looks the same: no hidden round buttons, and a click on the task opens the sheet', async () => {
    const app = await startApp();
    const context = await browser.newContext({ viewport: { width: 900, height: 800 }, timezoneId: TZ }); // no touch: hover works
    const page = await context.newPage();
    try {
      await seed(app, ['nothing set']);
      await page.goto(`${app.url}/#/tasks`);
      await rowOf(page, 'nothing set').waitFor();
      await rowOf(page, 'nothing set').hover();
      assert.equal(await rowOf(page, 'nothing set').locator('.round-btn').count(), 0, 'nothing appears on hover');
      await rowOf(page, 'nothing set').getByTestId('task-edit-text').click();
      await page.getByRole('dialog', { name: 'Task' }).waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('dialog', { name: 'Task' }).waitFor({ state: 'detached' });
    } finally {
      await context.close();
      await app.close();
    }
  });
});
