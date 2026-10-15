import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dateInTz } from '../../shared/dates.js';
import { launch, TZ, withPhone, waitSaved, newId, paragraphDoc, textOf } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

const today = () => dateInTz(new Date(), TZ);
const withApp = (fn) => withPhone(browser, fn, { serviceWorker: true });
const dot = (page) => page.getByTestId('global-status');

// A free note holding one open task, made on "another device".
async function seedErrands(app) {
  const id = newId();
  const doc = { type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false, id: newId() }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'buy stamps' }] }] }] }] };
  const r = await app.api('PUT', `/api/notes/${id}`, { baseRevision: 0, doc, docFormat: 2, tags: ['errands'], date: today(), kind: 'note', title: 'Errands' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return id;
}

// Is this answer kept in the phone's copy yet?
const kept = (page, key) =>
  page.evaluate(
    (key) =>
      new Promise((resolve) => {
        const open = indexedDB.open('gordonite-copy', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('responses', { keyPath: 'key' });
        open.onsuccess = () => {
          const q = open.result.transaction('responses').objectStore('responses').get(key);
          q.onsuccess = () => (open.result.close(), resolve(!!q.result));
          q.onerror = () => resolve(false);
        };
        open.onerror = () => resolve(false);
      }),
    key,
  );

async function openOnline(page) {
  await page.goto(`${page.app.url}/#/`);
  await page.getByTestId('today').waitFor();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
  });
}

describe('working with no connection', () => {
  test('notes and tasks seen before can be read offline; today’s note and a task tick are kept and sent on reconnect', () =>
    withApp(async ({ page, app, context }) => {
      const dailyId = newId();
      await app.api('PUT', `/api/notes/${dailyId}`, { baseRevision: 0, doc: paragraphDoc('morning words'), docFormat: 2, tags: ['daily-jots'], date: today() });
      const errandsId = await seedErrands(app);

      await openOnline(page);
      await page.waitForFunction(() => document.querySelector('[data-testid="global-status"]')?.dataset.status === 'saved');
      // the app fills its copy by itself while online, including notes that hold open tasks
      for (let i = 0; i < 50 && !(await kept(page, `/api/notes/${errandsId}`)); i++) await page.waitForTimeout(100);
      assert.equal(await kept(page, `/api/notes/${errandsId}`), true, 'the task’s note is kept on the phone');

      await context.setOffline(true);
      await page.reload();
      await page.getByTestId('today').waitFor({ timeout: 10_000 });
      await page.locator('.note-text', { hasText: 'morning words' }).first().waitFor({ timeout: 10_000 });
      await page.getByTestId('offline-bar').waitFor();
      assert.equal(await dot(page).getAttribute('data-status'), 'unreachable', 'grey, not green: the server is out of reach');

      // the Notes list and a note on its own page, from the copy
      await page.goto(`${app.url}/#/notes`);
      await page.getByTestId('notes-list').getByText('Errands', { exact: true }).first().waitFor({ timeout: 10_000 });
      await page.goto(`${app.url}/#/n/${errandsId}`);
      await page.locator('.note-text', { hasText: 'buy stamps' }).waitFor({ timeout: 10_000 });

      // write in today's note and tick the task, both offline
      await page.goto(`${app.url}/#/`);
      const todayNote = page.locator('.note-text', { hasText: 'morning words' }).first();
      await todayNote.waitFor({ timeout: 10_000 });
      await todayNote.tap();
      await page.keyboard.press('End');
      await page.keyboard.type(' + on the bus');
      await page.goto(`${app.url}/#/tasks`);
      const row = page.getByTestId('task-row').filter({ hasText: 'buy stamps' });
      await row.waitFor({ timeout: 10_000 });
      await row.locator('input').tap();
      await page.waitForFunction(() => ['offline', 'pending', 'saving'].includes(document.querySelector('[data-testid="global-status"]')?.dataset.status));
      assert.equal(app.docText(dailyId), 'morning words', 'nothing reached the server yet');

      await context.setOffline(false);
      await waitSaved(page, 30_000);
      assert.equal(app.docText(dailyId), 'morning words + on the bus');
      const errands = JSON.parse(app.db.prepare('SELECT doc FROM notes WHERE id = ?').get(errandsId).doc);
      assert.equal(errands.content[0].content[0].attrs.checked, true, 'the tick reached the note');
      assert.equal(app.notes().length, 2, 'no duplicate notes');
      await page.waitForFunction(() => !document.querySelector('[data-testid="offline-bar"]'));
    }));

  test('with nothing kept yet, today’s note can still be written offline and is created on reconnect', () =>
    withApp(async ({ page, app, context }) => {
      await openOnline(page);
      await page.evaluate(() => new Promise((r) => (indexedDB.deleteDatabase('gordonite-copy').onsuccess = r)));
      await context.setOffline(true);
      await page.reload();
      const note = page.locator('[data-testid="widget-note"] .note-text').first();
      await note.waitFor({ timeout: 10_000 });
      assert.equal(await page.getByTestId('load-error').count(), 0, 'no "cannot reach the server" instead of the note');
      await note.tap();
      await page.keyboard.type('jotted with no signal');
      await page.waitForFunction(() => document.querySelector('[data-testid="global-status"]')?.dataset.status === 'offline', null, { timeout: 10_000 });

      await context.setOffline(false);
      await waitSaved(page, 30_000);
      const notes = app.notes();
      assert.equal(notes.length, 1);
      assert.equal(notes[0].note_date, today());
      assert.equal(textOf(JSON.parse(notes[0].doc)), 'jotted with no signal');
    }));

  test('Settings can forget the copy; what waits to be sent is not touched', () =>
    withApp(async ({ page }) => {
      await openOnline(page);
      await page.goto(`${page.app.url}/#/settings`);
      await page.getByTestId('phone-copy-count').waitFor();
      await page.getByTestId('phone-copy-forget').tap();
      await page.getByText('Forgotten.').waitFor();
      assert.equal(await page.getByTestId('phone-copy-count').textContent(), '0 items kept.');
      assert.equal(await kept(page, '/api/config'), false);
    }));
});
