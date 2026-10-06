import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { uuid } from '../../shared/ids.js';
import { dateInTz, addDays } from '../../shared/dates.js';
import { launch, TZ, withPhone, waitSaved, editor, tap } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

const today = () => dateInTz(new Date(), TZ);
const attrsOf = (app, noteId, text) =>
  JSON.parse(app.notes().find((n) => n.id === noteId).doc)
    .content.flatMap((b) => b.content ?? [])
    .find((x) => x.content?.[0]?.content?.[0]?.text === text).attrs;

// A daily note with tasks: items are [text, attrs].
async function seed(app, items, { date = today(), tags = ['school'] } = {}) {
  const id = uuid();
  const mk = ([text, attrs = {}]) => ({ type: 'taskItem', attrs: { checked: false, id: uuid(), ...attrs }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  const r = await app.api('PUT', `/api/notes/${id}`, {
    baseRevision: 0,
    doc: { type: 'doc', content: [{ type: 'taskList', content: items.map(mk) }] },
    docFormat: 1,
    tags,
    date,
    opId: uuid(),
  });
  assert.equal(r.status, 200);
  return id;
}
const li = (page, text) => page.locator('.note-text li[data-checked]', { hasText: text });

describe('tasks inside a note look and work like on the Tasks page', () => {
  test('in a read-only note: strip colours, buttons that are set, and a menu that changes the task without waking the editor', () =>
    withPhone(browser, async ({ page, app }) => {
      const t = today();
      const id = await seed(
        app,
        [
          ['pay the bill', { due: t, priority: 'both' }],
          ['call home', { due: addDays(t, 1) }],
          ['water plants', { due: addDays(t, 9) }],
          ['plain one'],
        ],
        { date: addDays(t, -1) },
      );
      await page.goto(`${app.url}/#/t/school`);
      await page.locator(`[data-note-id="${id}"] .note-text li[data-checked]`).first().waitFor();
      const card = page.locator(`[data-note-id="${id}"]`);
      assert.equal(await card.getAttribute('data-active'), 'false', 'an older day is read-only here');
      const bar = (text) => card.locator('li[data-checked]', { hasText: text }).getAttribute('data-bar');
      assert.deepEqual([await bar('pay the bill'), await bar('call home'), await bar('water plants'), await bar('plain one')], ['red', 'yellow', 'none', 'none']);

      // on a touch screen only buttons that hold something are shown; the rest need the toolbar's calendar button
      const visible = (text) => card.locator('li[data-checked]', { hasText: text }).locator('[data-task-action]:visible').evaluateAll((els) => els.map((e) => e.dataset.taskAction));
      assert.deepEqual(await visible('pay the bill'), ['date', 'priority']);
      assert.deepEqual(await visible('plain one'), []);

      // change its due date from the button: the menu opens, the note is saved, the strip turns yellow
      await card.locator('li[data-checked]', { hasText: 'pay the bill' }).locator('[data-task-action="date"]').tap();
      await page.getByTestId('menu-due').waitFor();
      await page.getByTestId('pick-tomorrow').tap();
      await waitSaved(page);
      assert.equal(attrsOf(app, id, 'pay the bill').due, addDays(t, 1));
      await page.waitForFunction((noteId) => document.querySelector(`[data-note-id="${noteId}"] li[data-checked]`)?.dataset.bar === 'yellow', id);
      assert.equal(await card.getAttribute('data-active'), 'false', 'the editor was not woken by it');
      assert.equal(await page.locator('[data-testid="stream"] .note-text[contenteditable="true"]').count(), 1, 'still only today\'s entry is editable');

      // the priority button too
      await card.locator('li[data-checked]', { hasText: 'pay the bill' }).locator('[data-task-action="priority"]').tap();
      await page.getByTestId('priority-urgent').tap();
      await waitSaved(page);
      assert.equal(attrsOf(app, id, 'pay the bill').priority, 'urgent');
      assert.deepEqual(page.errors, []);
    }));

  test('in the editor: strip and buttons on each task; a button changes the task as one undoable edit; typing still works', () =>
    withPhone(browser, async ({ page, app }) => {
      const t = today();
      const id = await seed(app, [['ship the thing', { due: t, priority: 'both' }], ['and another']]);
      await page.goto(`${app.url}/#/n/${id}`);
      await page.locator('.note-text[contenteditable="true"] li[data-checked]').first().waitFor();

      assert.equal(await li(page, 'ship the thing').getAttribute('data-bar'), 'red');
      assert.deepEqual(
        await li(page, 'ship the thing').locator('[data-task-action]:visible').evaluateAll((els) => els.map((e) => e.dataset.taskAction)),
        ['date', 'priority'],
      );

      // a button in the editor: menu, then one undoable change
      await page.waitForTimeout(600); // a separate undo step from anything before
      await li(page, 'ship the thing').locator('[data-task-action="priority"]').tap();
      await page.getByTestId('priority-urgent').tap();
      await waitSaved(page);
      assert.equal(attrsOf(app, id, 'ship the thing').priority, 'urgent');
      await page.waitForTimeout(600);
      await tap(page, 'tb-undo');
      await waitSaved(page);
      assert.equal(attrsOf(app, id, 'ship the thing').priority, 'both', 'one undo takes the change back');

      // typing a date into a task recolours its strip (a date word at the end counts)
      await li(page, 'and another').locator('div p').tap();
      await page.keyboard.press('End');
      await page.keyboard.type(' tomorrow');
      await waitSaved(page);
      await page.waitForFunction(() => [...document.querySelectorAll('.note-text li[data-checked]')].find((l) => l.innerText.includes('and another tomorrow'))?.dataset.bar === 'yellow');
      assert.equal(await editor(page).evaluate((el) => el.querySelectorAll('li[data-checked]').length), 2, 'typing did not disturb the list');
      assert.deepEqual(page.errors, []);
    }));

  test('a change made on the Tasks page shows in the note', () =>
    withPhone(browser, async ({ page, app }) => {
      const id = await seed(app, [['review the plan'], ['other thing']]);
      await page.goto(`${app.url}/#/tasks`);
      await page.locator('[data-testid="task-row"]', { hasText: 'review the plan' }).getByTestId('task-priority').tap();
      await page.getByTestId('priority-both').tap();
      await page.locator('[data-testid="task-row"]', { hasText: 'review the plan' }).getByTestId('task-date').tap();
      await page.getByTestId('pick-today').tap();
      await waitSaved(page);

      await page.goto(`${app.url}/#/n/${id}`);
      await li(page, 'review the plan').waitFor();
      assert.equal(await li(page, 'review the plan').getAttribute('data-bar'), 'red');
      assert.equal(await li(page, 'review the plan').getAttribute('data-priority'), 'both');
      assert.deepEqual(
        await li(page, 'review the plan').locator('[data-task-action]:visible').evaluateAll((els) => els.map((e) => e.dataset.taskAction)),
        ['date', 'priority'],
      );
    }));
});
