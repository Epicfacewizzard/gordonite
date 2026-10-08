import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { uuid } from '../../shared/ids.js';
import { dateInTz } from '../../shared/dates.js';
import { launch, TZ, withPhone, waitSaved } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

const today = () => dateInTz(new Date(), TZ);
const item = (text) => ({ type: 'taskItem', attrs: { checked: false, id: uuid() }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

// A note with these tasks, saved on the server.
async function seed(app, texts, { date = today(), tags = ['school'] } = {}) {
  const id = uuid();
  const r = await app.api('PUT', `/api/notes/${id}`, { baseRevision: 0, kind: 'note', title: 'Shift test', date, tags, docFormat: 1, doc: { type: 'doc', content: [{ type: 'taskList', content: texts.map(item) }] } });
  assert.equal(r.status, 200);
  return id;
}
const stored = (app, id, text) => {
  const found = [];
  const walk = (n) => { if (n.type === 'taskItem') found.push(n); (n.content ?? []).forEach(walk); };
  walk(JSON.parse(app.db.prepare('SELECT doc FROM notes WHERE id = ?').get(id).doc));
  return found.find((t) => t.content[0].content[0].text === text).attrs;
};
const rowOf = (page, text) => page.locator('[data-testid="task-row"]', { hasText: text });

test('Shift-click on the Tasks page dismisses; a plain click still ticks', () =>
  withPhone(browser, async ({ page, app }) => {
    const id = await seed(app, ['dismiss me', 'tick me']);
    await page.goto(`${app.url}/#/tasks`);
    await rowOf(page, 'dismiss me').waitFor();

    await rowOf(page, 'dismiss me').locator('input[type="checkbox"]').click({ modifiers: ['Shift'] });
    await page.getByTestId('section-dismissed').waitFor();
    await waitSaved(page);
    const dismissed = stored(app, id, 'dismiss me');
    assert.ok(dismissed.dismissedAt, 'it is dismissed');
    assert.equal(dismissed.checked, false, 'and not ticked');

    await rowOf(page, 'tick me').locator('input[type="checkbox"]').click();
    await waitSaved(page);
    const ticked = stored(app, id, 'tick me');
    assert.equal(ticked.checked, true);
    assert.ok(!ticked.dismissedAt, 'a plain click does not dismiss');
    assert.deepEqual(page.errors, []);
  }));

test('the Settings switch turns Shift-click dismissing off, so Shift-click just ticks', () =>
  withPhone(browser, async ({ page, app }) => {
    const id = await seed(app, ['plain tick']);
    await page.goto(`${app.url}/#/settings`);
    assert.equal(await page.getByTestId('shift-dismiss').isChecked(), true, 'on by default');
    await page.getByTestId('shift-dismiss').uncheck();
    await page.goto(`${app.url}/#/tasks`);
    await rowOf(page, 'plain tick').locator('input[type="checkbox"]').click({ modifiers: ['Shift'] });
    await waitSaved(page);
    const attrs = stored(app, id, 'plain tick');
    assert.equal(attrs.checked, true);
    assert.ok(!attrs.dismissedAt);
  }));

test('Shift-click works in a note being edited (and a plain click still ticks)', () =>
  withPhone(browser, async ({ page, app }) => {
    const id = await seed(app, ['dismiss in editor', 'tick in editor']);
    await page.goto(`${app.url}/#/n/${id}`);
    const editor = page.locator('.note-text[contenteditable="true"]');
    await editor.waitFor();
    const box = (text) => editor.locator('li[data-task-move-id]', { hasText: text }).locator('input[type="checkbox"]');

    await box('dismiss in editor').click({ modifiers: ['Shift'] });
    await waitSaved(page);
    const dismissed = stored(app, id, 'dismiss in editor');
    assert.ok(dismissed.dismissedAt);
    assert.equal(dismissed.checked, false);

    await box('tick in editor').click();
    await waitSaved(page);
    assert.equal(stored(app, id, 'tick in editor').checked, true);
    assert.deepEqual(page.errors, []);
  }));

test('Shift-click works on the read-only view of an older note in a stream', () =>
  withPhone(browser, async ({ page, app }) => {
    const id = await seed(app, ['dismiss from the stream'], { date: '2026-09-01' });
    await page.goto(`${app.url}/#/t/school`);
    const note = page.locator('[data-testid="note"][data-date="2026-09-01"]');
    await note.getByTestId('note-static').waitFor();
    await note.locator('input[type="checkbox"]').click({ modifiers: ['Shift'] });
    await waitSaved(page);
    assert.ok(stored(app, id, 'dismiss from the stream').dismissedAt);
    assert.deepEqual(page.errors, []);
  }));
