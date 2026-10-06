import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, withPhone, waitSaved, startApp } from './harness.js';
import { uuid } from '../../shared/ids.js';
let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

test('history date correction stays in the originating note, is undoable and survives reopen', () => withPhone(browser, async ({ app, page }) => {
  page.setDefaultTimeout(5000);
  const id = uuid(), taskId = uuid();
  const item = { type: 'taskItem', attrs: { id: taskId, checked: true, completedAt: '2026-10-05T18:15:34.123Z' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Finished poster' }] }] };
  await app.api('PUT', `/api/notes/${id}`, { baseRevision: 0, kind: 'note', date: '2026-10-05', tags: ['test'], docFormat: 1, doc: { type: 'doc', content: [{ type: 'taskList', content: [item] }] } });
  await page.goto(`${app.url}/#/n/${id}`);
  const archive = page.getByTestId('task-archive');
  await archive.locator(':scope > summary').tap();
  await archive.getByRole('button', { name: 'Change recorded date for Finished poster' }).tap();
  await page.getByTestId('history-date').fill('2026-09-28');
  await page.getByTestId('history-date-apply').tap();
  await waitSaved(page);
  const read = async () => (await app.api('GET', `/api/notes/${id}`)).json.note.doc.content[0].content[0];
  assert.equal((await read()).attrs.completedAt, '2026-09-28T18:15:34.123Z');
  assert.equal((await read()).attrs.id, taskId);
  assert.match(await archive.locator('[data-history-day="2026-09-28"]').innerText(), /Finished poster/);
  await page.getByTestId('tb-undo').tap(); await waitSaved(page);
  assert.equal((await read()).attrs.completedAt, item.attrs.completedAt);
  await page.getByTestId('tb-redo').tap(); await waitSaved(page);
  await page.reload();
  assert.equal((await read()).attrs.completedAt, '2026-09-28T18:15:34.123Z');
  assert.equal((await read()).attrs.checked, true);

}, { clockTime: new Date('2026-10-05T22:30:00Z') }));

test('desktop grip drag corrects the recorded day', async () => {
  const app = await startApp();
  const context = await browser.newContext({ viewport: { width: 915, height: 884 } });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    const id = uuid(), first = uuid(), second = uuid();
    const make = (taskId, text, completedAt) => ({ type: 'taskItem', attrs: { id: taskId, checked: true, completedAt }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
    await app.api('PUT', `/api/notes/${id}`, { baseRevision: 0, kind: 'note', date: '2026-10-05', tags: ['test'], docFormat: 1, doc: { type: 'doc', content: [{ type: 'taskList', content: [make(first, 'Finished poster', '2026-10-05T18:00:00.000Z'), make(second, 'Venue booked', '2026-10-04T18:00:00.000Z')] }] } });
    await page.goto(`${app.url}/#/n/${id}`);
    const archive = page.getByTestId('task-archive'); await archive.locator(':scope > summary').click();
    await archive.getByRole('button', { name: 'Change recorded date for Finished poster' }).dragTo(archive.locator('[data-history-day="2026-10-04"]'));
    await waitSaved(page);
    const attrs = (await app.api('GET', `/api/notes/${id}`)).json.note.doc.content[0].content[0].attrs;
    assert.equal(attrs.completedAt, '2026-10-04T18:00:00.000Z'); assert.equal(attrs.id, first);
  } finally { await context.close(); await app.close(); }
});
