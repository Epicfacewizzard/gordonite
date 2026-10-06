import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, withPhone, waitSaved } from './harness.js';
import { uuid } from '../../shared/ids.js';
import { updateTask } from '../../shared/tasks.js';
let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });

test('dismissed task has an X, cannot be checked, stays in its original note history, and reactivates', () => withPhone(browser, async ({ app, page }) => {
  const id = uuid(), taskId = uuid();
  const doc = { type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { id: taskId, checked: false, dismissedAt: '2026-10-05T18:00:00.000Z' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Dismissed item' }] }] }] }] };
  await app.api('PUT', `/api/notes/${id}`, { baseRevision: 0, kind: 'note', title: 'Original', date: '2026-10-05', tags: ['test'], docFormat: 1, doc });
  assert.equal(updateTask(doc, taskId, { checked: true }).content[0].content[0].attrs.checked, false);
  await page.goto(`${app.url}/#/n/${id}`);
  const editor = page.locator('.note-text[contenteditable="true"]');
  const checkbox = editor.locator('input[type=checkbox]');
  assert.equal(await checkbox.isDisabled(), true);
  assert.equal(await checkbox.isVisible(), false);
  assert.equal(await editor.getByRole('img', { name: 'Dismissed task' }).isVisible(), false);
  assert.equal((await app.api('GET', `/api/notes/${id}`)).json.note.doc.content[0].content[0].attrs.checked, false);
  await page.getByTestId('task-archive').locator(':scope > summary').tap();
  await page.getByTestId('archive-calendar').tap();
  await page.getByTestId('task-archive').getByRole('button', { name: 'All dates', exact: true }).tap();
  await page.getByTestId('task-archive').getByRole('button', { name: 'Bring back' }).tap();
  await checkbox.waitFor({ state: 'visible' });
  assert.equal(await checkbox.isEnabled(), true);
  await checkbox.check(); await waitSaved(page);
  assert.equal((await app.api('GET', `/api/notes/${id}`)).json.note.doc.content[0].content[0].attrs.checked, true);
  await page.getByTestId('tb-undo').tap(); await waitSaved(page);
  assert.equal((await app.api('GET', `/api/notes/${id}`)).json.note.doc.content[0].content[0].attrs.checked, false);
}));

test('tag suggestions select existing tags, exclude attached tags, and keep compact phone layout', () => withPhone(browser, async ({ app, page }) => {
  await app.api('POST', '/api/tags', { path: 'school/clinical' });
  const id = uuid();
  await app.api('PUT', `/api/notes/${id}`, { baseRevision: 0, kind: 'note', title: 'Tags', date: '2026-10-05', tags: ['school'], docFormat: 1, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Note' }] }] } });
  await page.goto(`${app.url}/#/n/${id}`);
  await page.getByTestId('add-tag-input').fill('school');
  await page.getByTestId('tag-suggestions').waitFor();
  assert.equal(await page.getByTestId('tag-suggestion').count(), 1);
  await page.getByTestId('tag-suggestion').tap();
  assert.equal(await page.getByTestId('add-tag-input').inputValue(), 'school/clinical');
  await page.getByTestId('add-tag-button').tap();
  await page.getByTestId('note-tags').getByRole('link', { name: 'school/clinical', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
}));
