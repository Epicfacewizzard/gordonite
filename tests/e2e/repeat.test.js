// Recurring tasks in the browser: a rule typed in the words and one picked in the details; ticking on the Tasks list and
// in the note moves the due date on and keeps a history; the Done list shows the completions; Undo takes one back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, withPhone, waitSaved } from './harness.js';
import { uuid } from '../../shared/ids.js';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const item = (id, text, attrs = {}) => ({ type: 'taskItem', attrs: { id, checked: false, ...attrs }, content: [para(text)] });
async function seed(app, tasks) {
  const id = uuid();
  await app.api('PUT', `/api/notes/${id}`, { baseRevision: 0, kind: 'note', title: 'Bills', date: '2026-10-05', tags: [], docFormat: 2, doc: { type: 'doc', content: [{ type: 'taskList', content: tasks }] } });
  return id;
}
const saved = async (app, id) => (await app.api('GET', `/api/notes/${id}`)).json.note.doc.content[0].content;

test('ticking a repeating task on the Tasks list moves it on, records it, and Undo takes it back', () => withPhone(browser, async ({ app, page }) => {
  const rent = uuid();
  const id = await seed(app, [item(rent, 'Pay rent', { due: '2026-01-31', repeat: { every: 1, unit: 'month', from: 'due', day: 31 } })]);
  await page.goto(`${app.url}/#/tasks`);
  const row = page.getByTestId('task-row').filter({ hasText: 'Pay rent' });
  assert.match(await row.getByTestId('chip-repeat').innerText(), /monthly/);
  await row.locator('input[type=checkbox]').click();
  await waitSaved(page);
  const notice = page.getByTestId('repeat-notice');
  await notice.waitFor();
  assert.match(await notice.innerText(), /Next due/);
  let task = (await saved(app, id))[0].attrs;
  assert.equal(task.checked, false);
  assert.equal(task.due, '2026-02-28');
  assert.equal(task.completions.length, 1);
  assert.equal(task.completions[0].due, '2026-01-31');
  // it is in the Done list as a record
  await page.getByTestId('toggle-done').click();
  await page.getByTestId('show-all-done').click().catch(() => {});
  await page.getByTestId('completion-row').first().waitFor();
  // Undo
  await notice.getByTestId('repeat-undo').click();
  await waitSaved(page);
  task = (await saved(app, id))[0].attrs;
  assert.equal(task.due, '2026-01-31');
  assert.equal(task.completions, undefined);
}));

test('a rule typed in the words repeats, and one is picked in the details', () => withPhone(browser, async ({ app, page }) => {
  const typed = uuid(), plain = uuid();
  const id = await seed(app, [item(typed, 'Water plants every 3 days from done', { due: '2026-10-05' }), item(plain, 'Timesheet', { due: '2026-10-05' })]);
  await page.goto(`${app.url}/#/tasks`);
  const typedRow = page.getByTestId('task-row').filter({ hasText: 'Water plants' });
  assert.match(await typedRow.getByTestId('chip-repeat').innerText(), /every 3 days/);
  // pick "Every 2 weeks" for the other one from its details
  const plainRow = page.getByTestId('task-row').filter({ hasText: 'Timesheet' });
  await plainRow.getByTestId('task-expand').click();
  await plainRow.getByTestId('repeat-preset-every-2-weeks').click();
  await waitSaved(page);
  assert.deepEqual((await saved(app, id))[1].attrs.repeat, { every: 2, unit: 'week', from: 'due' });
  await plainRow.getByTestId('repeat-from-done').click();
  await waitSaved(page);
  assert.equal((await saved(app, id))[1].attrs.repeat.from, 'done');
  // skip it
  await plainRow.getByTestId('task-skip').dispatchEvent('click'); // (a plain click is not delivered while the row scrolls into view)
  await waitSaved(page);
  for (let i = 0; i < 50 && !(await saved(app, id))[1].attrs.completions; i++) await page.waitForTimeout(100);
  const attrs = (await saved(app, id))[1].attrs;
  assert.equal(attrs.completions[0].skipped, true);
  assert.ok(attrs.due > '2026-10-05');
}));

test('ticking in the open note moves the due date on in one undoable step', () => withPhone(browser, async ({ app, page }) => {
  const t = uuid();
  const id = await seed(app, [item(t, 'Pay rent', { due: '2026-10-01', repeat: { every: 1, unit: 'month', from: 'due', day: 1 } })]);
  await page.goto(`${app.url}/#/n/${id}`);
  const editor = page.locator('.note-text[contenteditable="true"]');
  await editor.locator('input[type=checkbox]').click();
  await waitSaved(page);
  let a = (await saved(app, id))[0].attrs;
  assert.equal(a.checked, false);
  assert.equal(a.due, '2026-11-01');
  assert.equal(a.completions.length, 1);
  await page.getByTestId('tb-undo').tap();
  await waitSaved(page);
  a = (await saved(app, id))[0].attrs;
  assert.equal(a.due, '2026-10-01');
  assert.equal(a.completions, undefined);
}));
