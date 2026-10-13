// One task list for every screen (client/src/task-data.js): it follows other devices when the page is focused again,
// and it follows what is typed into a note on this device without waiting for a save or a reload.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { uuid } from '../../shared/ids.js';
import { dateInTz } from '../../shared/dates.js';
import { launch, TZ, withPhone, waitSaved, tap } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

const today = () => dateInTz(new Date(), TZ);
const item = (text, attrs = {}) => ({ type: 'taskItem', attrs: { checked: false, id: uuid(), ...attrs }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const rows = (page) => page.getByTestId('task-row');
const rowTexts = (page) => page.locator('[data-testid="task-row"] .task-text').allInnerTexts();

test('the Tasks page shows what another device changed as soon as the page is focused again', () =>
  withPhone(browser, async ({ page, app }) => {
    const noteId = uuid();
    const first = item('read chapter four');
    const res = await app.api('PUT', `/api/notes/${noteId}`, {
      baseRevision: 0,
      doc: { type: 'doc', content: [{ type: 'taskList', content: [first] }] },
      docFormat: 2,
      tags: ['school'],
      date: today(),
      opId: uuid(),
    });
    assert.equal(res.status, 200);

    await page.goto(`${app.url}/#/tasks`);
    await rows(page).first().waitFor();
    assert.deepEqual(await rowTexts(page), ['read chapter four']);

    // another device adds a task and ticks the first
    const other = await app.api('PUT', `/api/notes/${noteId}`, {
      baseRevision: res.json.revision,
      doc: { type: 'doc', content: [{ type: 'taskList', content: [{ ...first, attrs: { ...first.attrs, checked: true } }, item('added on the other device')] }] },
      docFormat: 2,
      opId: uuid(),
    });
    assert.equal(other.status, 200);
    assert.deepEqual(await rowTexts(page), ['read chapter four'], 'nothing has asked the server yet');

    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByTestId('task-row').filter({ hasText: 'added on the other device' }).waitFor();
    // the first task was ticked on the other device, so it has moved to Done (folded away) and only one is open
    assert.deepEqual(await rowTexts(page), ['added on the other device']);
    assert.match(await page.getByTestId('task-count').innerText(), /1 open task/);
    assert.deepEqual(page.errors, []);
  }));

test('a task typed into today’s note shows up in the dashboard’s Tasks box before anything is saved or reloaded', () =>
  withPhone(browser, async ({ page, app }) => {
    await page.goto(`${app.url}/#/`);
    const note = page.locator('[data-testid="widget-note"] .note-text[contenteditable="true"]');
    await note.waitFor();
    assert.equal(await page.getByTestId('widget-tasks').locator('[data-testid="task-row"]').count(), 0);

    await note.tap();
    await tap(page, 'tb-task');
    // a date typed in the words counts: "due" with today's date puts it in the box the dashboard shows by default
    await page.keyboard.type(`water the plants due ${today()}`);
    await page.waitForFunction(() => /water the plants/.test(document.querySelector('[data-testid="widget-tasks"]')?.innerText ?? ''), null, { timeout: 5000 });
    assert.equal(await page.getByTestId('widget-tasks').locator('[data-testid="task-row"]').count(), 1);

    // changing the words changes the row; removing the task takes it out again
    await page.keyboard.type(' twice');
    await page.waitForFunction(() => /twice/.test(document.querySelector('[data-testid="widget-tasks"]')?.innerText ?? ''), null, { timeout: 5000 });
    await waitSaved(page);
    assert.match(app.docText(app.notes()[0].id), /water the plants due .* twice/);

    // ticking in the box changes the note being edited, as one edit in that editor, and the box agrees
    await page.getByTestId('widget-tasks').locator('[data-testid="task-row"] input').tap();
    await waitSaved(page);
    const stored = JSON.parse(app.notes()[0].doc);
    assert.equal(JSON.stringify(stored).includes('"checked":true'), true);
    assert.deepEqual(page.errors, []);
  }));

test('a task removed on the Tasks page is gone from the list at once and stays gone after a reload', () =>
  withPhone(browser, async ({ page, app }) => {
    const noteId = uuid();
    const a = item('keep this one');
    const b = item('remove this one');
    const res = await app.api('PUT', `/api/notes/${noteId}`, {
      baseRevision: 0,
      doc: { type: 'doc', content: [{ type: 'taskList', content: [a, b] }] },
      docFormat: 2,
      tags: ['school'],
      date: today(),
      opId: uuid(),
    });
    assert.equal(res.status, 200);

    await page.goto(`${app.url}/#/tasks`);
    await rows(page).nth(1).waitFor();
    const row = page.locator('[data-testid="task-row"]', { hasText: 'remove this one' });
    await row.getByTestId('task-expand').tap();
    await row.getByTestId('task-delete').tap();
    await row.getByTestId('task-delete-confirm').tap();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="task-row"]').length === 1);
    await waitSaved(page);
    assert.deepEqual(await rowTexts(page), ['keep this one']);
    assert.doesNotMatch(app.docText(noteId), /remove this one/);

    await page.reload();
    await rows(page).first().waitFor();
    assert.deepEqual(await rowTexts(page), ['keep this one']);
    assert.deepEqual(page.errors, []);
  }));
