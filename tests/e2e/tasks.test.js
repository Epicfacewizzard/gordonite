import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { uuid } from '../../shared/ids.js';
import { dateInTz, addDays } from '../../shared/dates.js';
import { launch, TZ, withPhone, open, editor, waitSaved, tap, structure, caret } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

const type = (page, text) => page.keyboard.type(text);
// Humans pause between keys; let selectionchange reach the editor (see editing.test.js).
const press = async (page, key, n = 1) => {
  for (let i = 0; i < n; i++) await page.keyboard.press(key);
  await page.waitForTimeout(40);
};

function collectTaskIds(doc) {
  const ids = [];
  const walk = (n) => {
    if (n.type === 'taskItem') ids.push(n.attrs.id);
    (n.content ?? []).forEach(walk);
  };
  walk(doc);
  return ids;
}
const savedDoc = (app) => JSON.parse(app.notes()[0].doc);

describe('stage 2: inline tasks', () => {
  test('paragraph -> task keeps text, formatting and cursor; ONE undo reverses it; tasks start unchecked', () =>
    withPhone(browser, async ({ page }) => {
      await open(page);
      await editor(page).tap();
      await type(page, 'Buy ');
      await tap(page, 'tb-bold');
      await type(page, 'oat');
      await tap(page, 'tb-bold');
      await type(page, ' milk today');
      await press(page, 'ArrowLeft', 6); // caret between "milk" and " today"
      const before = await caret(page);
      assert.equal(before.offset, 'Buy oat milk'.length);
      await page.waitForTimeout(600); // separate undo group from the typing

      await tap(page, 'tb-task');
      assert.deepEqual(await structure(page), [{ type: 'tasks', items: [{ text: 'Buy oat milk today', checked: false }] }]);
      assert.match(await editor(page).innerHTML(), /<strong>oat<\/strong>/, 'formatting survives conversion');
      const after = await caret(page);
      assert.equal(after.offset, before.offset, 'logical cursor position is preserved');
      assert.equal(after.focused, true, 'keyboard stays up');
      assert.equal(after.list, 'task');

      await type(page, 'X'); // keep writing in place
      assert.equal((await structure(page))[0].items[0].text, 'Buy oat milkX today');

      // One undo reverses the whole conversion (typed X was its own step; undo it first)
      await tap(page, 'tb-undo'); // X
      assert.equal((await structure(page))[0].items?.[0].text, 'Buy oat milk today');
      await page.waitForTimeout(100);
      await tap(page, 'tb-undo'); // conversion
      assert.deepEqual(await structure(page), [{ type: 'p', text: 'Buy oat milk today' }]);
      assert.match(await editor(page).innerHTML(), /<strong>oat<\/strong>/);
      // redo brings the task back in one step as well
      await tap(page, 'tb-redo');
      assert.equal((await structure(page))[0].type, 'tasks');
    }));

  test('bullet -> task and task -> plain text, in place', () =>
    withPhone(browser, async ({ page }) => {
      await open(page);
      await editor(page).tap();
      await tap(page, 'tb-bullet');
      await type(page, 'first');
      await press(page, 'Enter');
      await type(page, 'second');
      await press(page, 'Enter');
      await type(page, 'third');
      await press(page, 'ArrowUp');
      await tap(page, 'tb-task'); // only the middle bullet becomes a task
      const s = await structure(page);
      assert.deepEqual(s.map((b) => b.type), ['bullets', 'tasks', 'bullets']);
      assert.deepEqual(s[1].items, [{ text: 'second', checked: false }]);
      assert.equal((await caret(page)).focused, true);
      await tap(page, 'tb-task'); // and back to text
      const s2 = await structure(page);
      assert.ok(s2.some((b) => b.type === 'p' && b.text === 'second'), JSON.stringify(s2));
      assert.equal(s2.some((b) => b.type === 'tasks'), false);
    }));

  test('Enter continues tasks (unchecked), Enter on an empty task returns to text, Backspace at start drops the task status first', () =>
    withPhone(browser, async ({ page }) => {
      await open(page);
      await editor(page).tap();
      await tap(page, 'tb-task');
      await type(page, 'write report');
      await page.locator('.note-text li[data-checked] input').first().tap(); // check it
      assert.equal((await structure(page))[0].items[0].checked, true);
      assert.equal((await caret(page)).focused, true, 'checking does not dismiss the keyboard');

      await press(page, 'End');
      await press(page, 'Enter');
      await type(page, 'send report');
      let s = await structure(page);
      assert.deepEqual(s[0].items, [
        { text: 'write report', checked: true },
        { text: 'send report', checked: false },
      ]);

      await press(page, 'Enter'); // new empty task
      assert.equal((await structure(page))[0].items.length, 3);
      assert.equal((await structure(page))[0].items[2].checked, false, 'a new task starts unchecked');
      await press(page, 'Enter'); // empty task -> ordinary text
      s = await structure(page);
      assert.deepEqual(s.map((b) => b.type), ['tasks', 'p']);
      assert.equal((await caret(page)).list, null);

      // Backspace at the start of a task: status removed, text preserved
      await press(page, 'ArrowUp');
      await press(page, 'Home');
      await press(page, 'Backspace');
      s = await structure(page);
      assert.ok(s.some((b) => b.type === 'p' && b.text === 'send report'), JSON.stringify(s));
      assert.equal((await caret(page)).offset, 0);
      assert.equal((await structure(page))[0].items[0].text, 'write report', 'earlier task untouched');
    }));

  test('check/uncheck in place: stays where written, is undoable, and persists', () =>
    withPhone(browser, async ({ page, app }) => {
      await open(page);
      await editor(page).tap();
      await tap(page, 'tb-task');
      await type(page, 'one');
      await press(page, 'Enter');
      await type(page, 'two');
      await press(page, 'Enter');
      await type(page, 'three');
      await page.waitForTimeout(600);
      const boxes = page.locator('.note-text li[data-checked] input');

      await boxes.nth(1).tap(); // complete the middle one
      let items = (await structure(page))[0].items;
      assert.deepEqual(items.map((i) => [i.text, i.checked]), [['one', false], ['two', true], ['three', false]], 'completed task stays in place');
      assert.equal((await caret(page)).focused, true);

      await tap(page, 'tb-undo');
      items = (await structure(page))[0].items;
      assert.deepEqual(items.map((i) => i.checked), [false, false, false], 'check is undoable');
      await tap(page, 'tb-redo');
      assert.deepEqual((await structure(page))[0].items.map((i) => i.checked), [false, true, false]);
      await boxes.nth(1).tap(); // uncheck
      assert.deepEqual((await structure(page))[0].items.map((i) => i.checked), [false, false, false]);
      await boxes.nth(2).tap();
      await tap(page, 'tb-undo');
      await tap(page, 'tb-redo');

      await waitSaved(page);
      const doc = savedDoc(app);
      assert.deepEqual(doc.content[0].content.map((t) => t.attrs.checked), [false, false, true]);
      await page.reload();
      await page.waitForSelector('.note-text');
      assert.deepEqual((await structure(page))[0].items.map((i) => [i.text, i.checked]), [['one', false], ['two', false], ['three', true]]);
    }));

  test('task ids are stable across saves and reloads, unique after splits and duplicate pastes, and only live in the note', () =>
    withPhone(browser, async ({ page, app }) => {
      await open(page);
      await editor(page).tap();
      await tap(page, 'tb-task');
      await type(page, 'alpha');
      await press(page, 'Enter');
      await type(page, 'beta');
      await waitSaved(page);
      const ids1 = collectTaskIds(savedDoc(app));
      assert.equal(ids1.length, 2);
      assert.ok(ids1.every((x) => typeof x === 'string' && x.length >= 32));
      assert.equal(new Set(ids1).size, 2);

      await press(page, 'ArrowLeft', 2);
      await press(page, 'Enter'); // split "beta" in the middle -> two tasks, one new id
      await press(page, 'Control+a');
      await page.evaluate(() => document.execCommand('copy'));
      await waitSaved(page);
      const ids2 = collectTaskIds(savedDoc(app));
      assert.equal(ids2.length, 3);
      assert.equal(new Set(ids2).size, 3, 'a split never duplicates an id');
      assert.deepEqual(ids2.filter((i) => ids1.includes(i)).length, 2, 'existing tasks keep their ids');

      // Paste markup that carries an existing task's id (copy/paste inside the app): ids must stay unique
      await page.evaluate((id) => {
        const dt = new DataTransfer();
        dt.setData('text/html', `<ul data-type="taskList"><li data-type="taskItem" data-checked="false" data-id="${id}"><label><input type="checkbox"></label><div><p>duplicate</p></div></li></ul>`);
        dt.setData('text/plain', 'duplicate');
        document.querySelector('.note-text[contenteditable="true"]').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      }, ids1[0]);
      await waitSaved(page);
      const ids3 = collectTaskIds(savedDoc(app));
      assert.equal(new Set(ids3).size, ids3.length, `unique ids: ${JSON.stringify(ids3)}`);

      await page.reload();
      await page.waitForSelector('.note-text');
      await tap(page, 'tb-bold'); // no-op interaction
      const ids4 = collectTaskIds(savedDoc(app));
      assert.deepEqual(ids4, ids3, 'ids unchanged by reopening');

      // no separate tables hold task text
      const tables = app.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
      assert.ok(!tables.some((t) => /task/i.test(t)));
    }));

  test('formatting survives splitting a task; converting several lines at once', () =>
    withPhone(browser, async ({ page }) => {
      await open(page);
      await editor(page).tap();
      await type(page, 'line one');
      await press(page, 'Enter');
      await type(page, 'line two');
      await press(page, 'Enter');
      await type(page, 'line three');
      await press(page, 'Control+a');
      await tap(page, 'tb-task');
      const s = await structure(page);
      assert.deepEqual(s, [{ type: 'tasks', items: [{ text: 'line one', checked: false }, { text: 'line two', checked: false }, { text: 'line three', checked: false }] }]);
      assert.equal((await caret(page)).focused, true);
      // bold the middle task via toolbar then split it: both halves stay bold
      await press(page, 'Control+End');
      await press(page, 'ArrowUp');
      await press(page, 'Home');
      await page.keyboard.down('Shift');
      await press(page, 'End');
      await page.keyboard.up('Shift');
      await tap(page, 'tb-bold');
      await press(page, 'ArrowLeft'); // collapse to start
      await press(page, 'ArrowRight', 4);
      await press(page, 'Enter');
      const html = await editor(page).innerHTML();
      assert.match(html, /<strong>line<\/strong>/);
      assert.match(html, /<strong> two<\/strong>/);
    }));
});

describe('combined Tasks view', () => {
  test('lists open tasks from every stream; ticking one saves it into its own note', () =>
    withPhone(browser, async ({ page, app }) => {
      const mk = (text) => ({ type: 'taskItem', attrs: { checked: false, id: uuid() }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
      const put = (tags, date, ...items) =>
        app.api('PUT', `/api/notes/${uuid()}`, {
          baseRevision: 0,
          doc: { type: 'doc', content: [{ type: 'taskList', content: items }] },
          docFormat: 1,
          tags,
          date,
          opId: uuid(),
        });
      await put(['school/fall26'], '2026-10-05', mk('read chapter four'), mk('email the professor'));
      await put(['daily-jots'], '2026-10-04', mk('water the plants'));

      await page.goto(`${app.url}/#/tasks`);
      await page.waitForSelector('[data-testid="task-row"]');
      assert.deepEqual(await page.getByTestId('task-group').evaluateAll((g) => g.map((x) => x.dataset.stream)), ['daily-jots', 'school/fall26']);
      assert.match(await page.getByTestId('task-count').innerText(), /3 open tasks/);

      await page.locator('[data-testid="task-row"]', { hasText: 'email the professor' }).locator('input').tap();
      await waitSaved(page);
      assert.match(await page.getByTestId('task-count').innerText(), /2 open tasks/);
      const note = app.notes().find((n) => n.doc.includes('email the professor'));
      const ticked = JSON.parse(note.doc).content[0].content.map((t) => t.attrs.checked);
      assert.deepEqual(ticked, [false, true], 'only the tapped task changed, inside its own note');
      assert.equal(note.revision, 2);

      await page.reload();
      await page.waitForSelector('[data-testid="task-row"]');
      assert.match(await page.getByTestId('task-count').innerText(), /2 open tasks/, 'the tick survives a reload');
      assert.deepEqual(page.errors, []);
    }));
});

describe('task dates: due, start, hidden', () => {
  const today = () => dateInTz(new Date(), TZ);

  test('Tasks page sorts into Overdue / Today / Upcoming / Anytime, folds away later and hidden, and the sheet changes a task', () =>
    withPhone(browser, async ({ page, app }) => {
      const t = today();
      const mk = (text, attrs = {}) => {
        const id = uuid();
        return { type: 'taskItem', attrs: { checked: false, id, ...attrs }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
      };
      const noteId = uuid();
      const r = await app.api('PUT', `/api/notes/${noteId}`, {
        baseRevision: 0,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'taskList',
              content: [
                mk('late one', { due: addDays(t, -2) }),
                mk('due now', { due: t }),
                mk('coming up', { due: addDays(t, 3) }),
                mk('no date at all'),
                mk('not yet', { start: addDays(t, 5) }),
                mk('put away', { hidden: true }),
              ],
            },
          ],
        },
        docFormat: 1,
        tags: ['school'],
        date: t,
        opId: uuid(),
      });
      assert.equal(r.status, 200);

      await page.goto(`${app.url}/#/tasks`);
      await page.waitForSelector('[data-testid="task-row"]');
      const inSection = (id) => page.getByTestId(`section-${id}`).getByTestId('task-row').allInnerTexts();
      assert.match((await inSection('overdue')).join('|'), /late one/);
      assert.match((await inSection('today')).join('|'), /due now/);
      assert.match((await inSection('upcoming')).join('|'), /coming up/);
      assert.match((await inSection('anytime')).join('|'), /no date at all/);
      assert.match(await page.getByTestId('task-count').innerText(), /4 open tasks/, 'later and hidden tasks are not counted as to do');
      assert.equal(await page.getByTestId('section-later').getByTestId('task-row').count(), 0, 'folded away by default');
      assert.equal(await page.getByTestId('section-hidden').getByTestId('task-row').count(), 0);
      await page.getByTestId('toggle-later').tap();
      assert.match((await inSection('later')).join('|'), /not yet/);
      await page.getByTestId('toggle-hidden').tap();
      assert.match((await inSection('hidden')).join('|'), /put away/);

      // Pick a due date for the undated task: it moves to Upcoming and is saved in its note.
      await page.locator('[data-testid="task-row"]', { hasText: 'no date at all' }).getByTestId('task-open').tap();
      await page.getByTestId('input-due').fill(addDays(t, 1));
      await waitSaved(page);
      await page.getByTestId('task-sheet-done').tap();
      assert.match((await inSection('upcoming')).join('|'), /no date at all/);
      const stored = () => JSON.parse(app.notes()[0].doc).content[0].content;
      assert.equal(stored()[3].attrs.due, addDays(t, 1), 'saved inside the note');

      // Hide it: it leaves Upcoming and appears under Hidden.
      await page.locator('[data-testid="task-row"]', { hasText: 'no date at all' }).getByTestId('task-open').tap();
      await page.getByTestId('input-hidden').check();
      await waitSaved(page);
      await page.getByTestId('task-sheet-done').tap();
      assert.doesNotMatch((await inSection('upcoming')).join('|'), /no date at all/);
      assert.match((await inSection('hidden')).join('|'), /no date at all/);
      assert.equal(stored()[3].attrs.hidden, true);

      // Clearing both puts the stored task back exactly as an ordinary task (no empty attributes).
      await page.locator('[data-testid="task-row"]', { hasText: 'no date at all' }).getByTestId('task-open').tap();
      await page.getByTestId('input-hidden').uncheck();
      await page.getByTestId('clear-due').tap();
      await waitSaved(page);
      assert.deepEqual(Object.keys(stored()[3].attrs).sort(), ['checked', 'id']);
      assert.deepEqual(page.errors, []);
    }));

  test('in the editor: the date button sets a due date on the task under the caret, shows it on the task, and a typed phrase counts too', () =>
    withPhone(browser, async ({ page, app }) => {
      await open(page);
      await editor(page).tap();
      assert.equal(await page.getByTestId('tb-taskdates').getAttribute('aria-disabled'), 'true', 'only enabled inside a task');
      await type(page, 'plain text');
      await press(page, 'Enter');
      await type(page, 'ship it due tomorrow');
      await tap(page, 'tb-task');
      await page.waitForTimeout(600); // keep the date change a separate undo step
      assert.equal(await page.getByTestId('tb-taskdates').getAttribute('aria-disabled'), null);

      await tap(page, 'tb-taskdates');
      assert.match(await page.getByTestId('field-due').innerText(), /from “due tomorrow” in the text/, 'typed phrase is understood');
      const picked = addDays(today(), 4);
      await page.getByTestId('input-due').fill(picked);
      await page.getByTestId('task-sheet-done').tap();
      await waitSaved(page);

      const li = page.locator('.note-text li[data-checked]');
      assert.match((await li.getAttribute('data-task-meta')) ?? '', /^due /, 'the task shows its date');
      const task = JSON.parse(app.notes()[0].doc).content.find((n) => n.type === 'taskList').content[0];
      assert.equal(task.attrs.due, picked, 'the picked date wins over the typed one and is stored on the task');
      assert.equal(task.attrs.hidden, undefined, 'no empty attributes are stored');

      // One undo reverses the pick.
      await page.waitForTimeout(600);
      await tap(page, 'tb-undo');
      await waitSaved(page);
      assert.equal(await li.getAttribute('data-task-meta'), null);
      assert.deepEqual(page.errors, []);
    }));
});
