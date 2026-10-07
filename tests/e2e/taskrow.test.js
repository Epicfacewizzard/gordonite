import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { uuid } from '../../shared/ids.js';
import { dateInTz, addDays } from '../../shared/dates.js';
import { launch, startApp, TZ, withPhone, waitSaved } from './harness.js';

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
      await page.getByTestId('section-hidden').getByTestId('task-row').filter({ hasText: 'hide me too' }).getByTestId('task-expand').tap(); // only the arrow opens details
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

  test('a date typed in the text is shown dimmer; the dashboard (overdue only) has the same buttons', () =>
    withPhone(browser, async ({ page, app }) => {
      await seed(app, ['send the deck due fri', 'plain task', 'old thing due 2020-01-01']);
      await page.goto(`${app.url}/#/tasks`);
      await rowOf(page, 'send the deck').waitFor();
      assert.equal(await rowOf(page, 'send the deck').locator('.typed-date').innerText(), 'due fri');
      assert.equal(await rowOf(page, 'plain task').locator('.typed-date').count(), 0);
      assert.equal(await rowOf(page, 'plain task').getByTestId('task-date').count(), 1);
      await rowOf(page, 'plain task').getByTestId('task-priority').tap();
      await page.getByTestId('priority-urgent').tap();
      await waitSaved(page);
      assert.equal(await rowOf(page, 'plain task').getAttribute('data-priority'), 'urgent');

      // the dashboard shows only what is overdue, with the same buttons
      await page.goto(`${app.url}/#/`);
      await rowOf(page, 'old thing').waitFor();
      assert.equal(await rowOf(page, 'old thing').getByTestId('task-date').count(), 1, 'the buttons are on the dashboard too');
      assert.equal(await page.getByTestId('task-row').count(), 1, 'only the overdue one is there');
    }));
});

describe('task buttons on a computer (with a pointer to hover)', () => {
  test('buttons with nothing set stay hidden until the row is hovered; set ones always show, coloured', async () => {
    const app = await startApp();
    const context = await browser.newContext({ viewport: { width: 900, height: 800 }, timezoneId: TZ }); // no touch: hover works
    const page = await context.newPage();
    try {
      const mk = (text, attrs = {}) => ({ type: 'taskItem', attrs: { checked: false, id: uuid(), ...attrs }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
      await app.api('PUT', `/api/notes/${uuid()}`, {
        baseRevision: 0,
        doc: { type: 'doc', content: [{ type: 'taskList', content: [mk('nothing set'), mk('due today', { due: today() }), mk('due later', { due: addDays(today(), 5), priority: 'both' })] }] },
        docFormat: 1,
        tags: ['school'],
        date: today(),
        opId: uuid(),
      });
      await page.goto(`${app.url}/#/tasks`);
      await rowOf(page, 'nothing set').waitFor();
      const opacity = (text, testid) => rowOf(page, text).getByTestId(testid).evaluate((el) => getComputedStyle(el).opacity);
      const color = (text, testid) => rowOf(page, text).getByTestId(testid).evaluate((el) => getComputedStyle(el).color);

      await page.mouse.move(5, 5); // pointer away from every row
      assert.deepEqual([await opacity('nothing set', 'task-hide'), await opacity('nothing set', 'task-date'), await opacity('nothing set', 'task-priority')], ['0', '0', '0']);
      assert.equal(await opacity('due today', 'task-date'), '1', 'a set button is always shown');
      assert.equal(await opacity('due today', 'task-hide'), '0', 'the unset ones on that row are not');
      assert.equal(await opacity('due later', 'task-priority'), '1');

      await rowOf(page, 'nothing set').hover();
      assert.deepEqual([await opacity('nothing set', 'task-hide'), await opacity('nothing set', 'task-date'), await opacity('nothing set', 'task-priority')], ['1', '1', '1'], 'hovering the row shows them');

      // red when due today, blue when due later
      const resolved = (cssVar) =>
        page.evaluate((v) => {
          const probe = document.createElement('span');
          probe.style.color = `var(${v})`;
          document.body.append(probe);
          const c = getComputedStyle(probe).color;
          probe.remove();
          return c;
        }, cssVar);
      assert.equal(await color('due today', 'task-date'), await resolved('--danger'), 'due today is the red');
      assert.equal(await color('due later', 'task-date'), await resolved('--due'), 'due later is the blue');
    } finally {
      await context.close();
      await app.close();
    }
  });
});
