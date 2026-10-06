import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, withPhone, waitSaved, caret } from './harness.js';
import { uuid } from '../../shared/ids.js';
import { Store } from '../../server/store.js';
let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });
const paragraph = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
async function note(app, title, doc) {
  const id = uuid();
  await app.api('PUT', `/api/notes/${id}`, { baseRevision: 0, kind: 'note', title, date: '2026-10-05', tags: [], docFormat: 1, doc });
  return id;
}

test('phone list controls indent/outdent with focus, undo and persistence; keyboard Tab works', () => withPhone(browser, async ({ app, page }) => {
  const id = await note(app, 'Nested bullets', { type: 'doc', content: [{ type: 'bulletList', content: ['Parent', 'Child'].map((text) => ({ type: 'listItem', content: [paragraph(text)] })) }] });
  await page.goto(`${app.url}/#/n/${id}`);
  const editor = page.locator('.note-text[contenteditable="true"]');
  await editor.locator('p').last().tap(); await page.keyboard.press('End');
  await page.getByTestId('tb-indent').tap();
  assert.equal(await editor.locator('ul ul').count(), 1);
  assert.equal((await caret(page)).focused, true);
  await page.keyboard.type(' text'); await waitSaved(page);
  assert.equal((await app.api('GET', `/api/notes/${id}`)).json.note.doc.content[0].content[0].content[1].type, 'bulletList');
  await page.getByTestId('tb-outdent').tap();
  assert.equal(await editor.locator('ul ul').count(), 0);
  await page.getByTestId('tb-undo').tap();
  assert.equal(await editor.locator('ul ul').count(), 1);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await editor.locator('ul ul').count(), 0);
  await page.keyboard.press('Tab');
  assert.equal(await editor.locator('ul ul').count(), 1);
  await waitSaved(page); await page.reload();
  await editor.locator('ul ul').waitFor();
  assert.equal(await editor.locator('ul ul').count(), 1);
  assert.deepEqual(page.errors, []);
}));

test('timezone is shared, durable, validated and leaves note dates/content intact', () => withPhone(browser, async ({ app, page }) => {
  const id = await note(app, 'Unmoved note', { type: 'doc', content: [paragraph('Writing stays here')] });
  await page.goto(`${app.url}/#/settings`);
  await page.getByTestId('timezone-select').selectOption('Asia/Tokyo');
  await page.getByTestId('timezone-save').tap();
  await page.getByText('Timezone saved on server.').waitFor();
  assert.equal((await app.api('GET', '/api/config')).json.tz, 'Asia/Tokyo');
  const freshConfig = { ...app.config, tz: 'America/Edmonton' };
  assert.equal(new Store(app.db, freshConfig).getSettings().tz, 'Asia/Tokyo', 'new server store reads persisted override');
  assert.equal((await app.api('PUT', '/api/settings', { tz: 'Invalid/Zone' })).status, 400);
  assert.equal((await app.api('GET', `/api/notes/${id}`)).json.note.date, '2026-10-05');
  assert.equal(app.docText(id), 'Writing stays here');
  const exported = (await app.api('GET', '/api/export/json')).json;
  assert.equal(exported.homeTimeZone, 'Asia/Tokyo');
  await app.api('PUT', '/api/settings', { tz: 'America/Edmonton' });
  assert.equal((await app.api('POST', '/api/import?mode=replace', exported)).status, 200);
  assert.equal((await app.api('GET', '/api/config')).json.tz, 'Asia/Tokyo', 'restore includes timezone');
  await page.reload();
  assert.equal(await page.getByTestId('timezone-select').inputValue(), 'Asia/Tokyo');
  assert.deepEqual(page.errors, []);
}));

test('wiki links open stable note IDs, keep alias text and original document, show missing/duplicate choices', () => withPhone(browser, async ({ app, page }) => {
  const target = await note(app, 'Alina', { type: 'doc', content: [paragraph('Profile')] });
  const doc = { type: 'doc', content: [paragraph('Meet [[05 People/Friends/Alina|my friend]] and [[Missing person]] and [[Duplicate]].')] };
  const source = await note(app, 'Linked note', doc);
  const duplicate1 = await note(app, 'Duplicate', { type: 'doc', content: [paragraph('First')] });
  const duplicate2 = await note(app, 'Duplicate', { type: 'doc', content: [paragraph('Second')] });
  await page.goto(`${app.url}/#/n/${source}`);
  await page.getByRole('link', { name: 'Open link to my friend', exact: true }).tap();
  await page.waitForURL(`**/#/n/${target}`);
  assert.deepEqual((await app.api('GET', `/api/notes/${source}`)).json.note.doc, doc, 'opening does not edit or rewrite imported text');
  await page.goto(`${app.url}/#/n/${source}`);
  await page.getByRole('link', { name: 'Open link to Missing person', exact: true }).tap();
  await page.getByText('No saved note matches this name.', { exact: false }).waitFor();
  await page.goto(`${app.url}/#/n/${source}`);
  await page.getByRole('link', { name: 'Open link to Duplicate', exact: true }).tap();
  await page.getByText('More than one note has this name.', { exact: false }).waitFor();
  assert.equal(await page.locator(`a[href="#/n/${duplicate1}"]`).count(), 1);
  assert.equal(await page.locator(`a[href="#/n/${duplicate2}"]`).count(), 1);
  assert.deepEqual(page.errors, []);
}));

test('opening page preference survives reopening, leaves direct links intact and Today reachable', () => withPhone(browser, async ({ app, page }) => {
  const id = await note(app, 'Direct link', { type: 'doc', content: [paragraph('Explicit note')] });
  await page.goto(`${app.url}/#/settings`);
  await page.getByTestId('opening-page').selectOption('/notes');
  await page.goto(`${app.url}/`);
  await page.waitForURL('**/#/notes');
  await page.getByTestId('tab-today').tap();
  assert.equal(new URL(page.url()).hash, '#/');
  await page.goto(`${app.url}/#/n/${id}`);
  await page.getByTestId('note-title').waitFor();
  assert.equal(new URL(page.url()).hash, `#/n/${id}`);
  await page.goto(`${app.url}/#/settings`);
  assert.equal(await page.getByTestId('opening-page').inputValue(), '/notes');
  assert.equal((await app.api('GET', '/api/config')).json.openingPage, undefined, 'preference is not shared server data');
}));
