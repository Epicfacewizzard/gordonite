import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { launch, withPhone, open, editor, waitSaved, waitStatus, tap, seedNote, paragraphDoc } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

const type = (page, text) => page.keyboard.type(text);
const TODAY_TEXT = (app) => app.notes().map((n) => app.docText(n.id));

// What the phone is holding durably (IndexedDB), independent of the server.
const pendingRecords = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('personal-hq');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const q = open.result.transaction('pending').objectStore('pending').getAll();
          q.onsuccess = () => resolve(q.result);
          q.onerror = () => reject(q.error);
        };
      }),
  );

const blockApi = (page, pattern = '**/api/**') => page.route(pattern, (r) => r.abort('connectionfailed'));
const blockPuts = (page) => page.route('**/api/notes/*', (r) => (r.request().method() === 'PUT' ? r.abort('connectionfailed') : r.continue()));
const reconnect = async (page, pattern = '**/api/**') => {
  await page.unroute(pattern);
  await page.evaluate(() => window.dispatchEvent(new Event('online'))); // what the browser fires on reconnect
};
// The header dot is the only status indicator; its words are in the accessible label.
const badge = (page) => page.getByTestId('global-status');

describe('stage 4: interrupted connections', () => {
  test('offline: edits are pending on the phone, then saved on reconnect (one note, nothing lost)', () =>
    withPhone(browser, async ({ page, context, app }) => {
      await open(page);
      await editor(page).tap();
      await type(page, 'online part');
      await waitSaved(page);
      assert.equal(await badge(page).getAttribute('data-status'), 'saved');
      assert.match(await badge(page).getAttribute('aria-label'), /Saved on server/);

      await context.setOffline(true);
      await type(page, ' and offline part');
      await waitStatus(page, 'offline');
      assert.match(await badge(page).getAttribute('aria-label'), /Pending on phone/);
      assert.deepEqual(TODAY_TEXT(app), ['online part'], 'server does not have the offline text yet');
      const held = await pendingRecords(page);
      assert.equal(held.length, 1);
      assert.match(JSON.stringify(held[0].doc), /offline part/, 'the text is stored durably on the phone');

      await type(page, ' + more while offline'); // keep writing, nothing resets
      await context.setOffline(false); // browser fires "online"
      await waitSaved(page, 15_000);
      assert.deepEqual(TODAY_TEXT(app), ['online part and offline part + more while offline']);
      assert.equal(app.notes().length, 1);
      assert.deepEqual(await pendingRecords(page), [], 'phone copy removed once the server confirmed');
      assert.equal(await editor(page).textContent(), 'online part and offline part + more while offline');
    }));

  test('a brand-new note typed offline survives a reload and is created when the server is reachable', () =>
    withPhone(browser, async ({ page, app }) => {
      await open(page);
      await blockApi(page);
      await editor(page).tap();
      await type(page, 'written on the train with no signal');
      await waitStatus(page, 'offline');
      assert.equal(app.notes().length, 0);
      await page.waitForFunction(() => true);
      assert.equal((await pendingRecords(page)).length, 1);

      await page.reload(); // phone app restarted while still offline
      await page.waitForSelector('.note-text');
      assert.equal(await editor(page).textContent(), 'written on the train with no signal', 'unsent text is back in the editor');
      assert.match(await badge(page).getAttribute('aria-label'), /Pending on phone/);
      assert.equal(await page.getByTestId('load-error').count(), 1, 'the app says the server is unreachable');

      await reconnect(page);
      await waitSaved(page, 15_000);
      assert.deepEqual(TODAY_TEXT(app), ['written on the train with no signal']);
      assert.equal(app.notes().length, 1, 'exactly one note, no duplicates');
    }));

  test('edits to an existing note made offline survive a reload and are applied on reconnect', () =>
    withPhone(browser, async ({ page, app }) => {
      const id = await seedNote(app, { date: '2026-10-05', doc: paragraphDoc('saved earlier') });
      await open(page);
      assert.equal(await editor(page).textContent(), 'saved earlier');
      await blockApi(page);
      await editor(page).tap();
      await page.keyboard.press('Control+End');
      await type(page, ' + typed offline');
      await waitStatus(page, 'offline');
      await page.reload();
      await page.waitForSelector('.note-text');
      assert.equal(await editor(page).textContent(), 'saved earlier + typed offline');
      await reconnect(page);
      await waitSaved(page, 15_000);
      assert.equal(app.docText(id), 'saved earlier + typed offline');
      assert.equal(app.notes().length, 1);
    }));

  test('lost response: the server saved but the phone never heard; retrying causes no conflict or duplicates', () =>
    withPhone(browser, async ({ page, app }) => {
      let dropped = 0;
      await page.route('**/api/notes/*', async (route) => {
        if (route.request().method() === 'PUT' && dropped < 2) {
          dropped++;
          await route.fetch(); // reaches the server and is applied...
          await route.abort('connectionreset'); // ...but the answer never arrives
        } else {
          await route.continue();
        }
      });
      await open(page);
      await editor(page).tap();
      await type(page, 'first words');
      await page.waitForFunction(() => document.querySelector('[data-testid="global-status"]')?.dataset.status === 'offline', null, { timeout: 8000 });
      await type(page, ' second words');
      await waitSaved(page, 20_000);
      assert.equal(dropped >= 1, true);
      assert.deepEqual(TODAY_TEXT(app), ['first words second words']);
      assert.equal(app.notes().length, 1);
      assert.equal(await page.getByTestId('conflict-panel').count(), 0, 'no false conflict');
      const conflicts = app.db.prepare("SELECT COUNT(*) c FROM note_versions WHERE kind='conflict'").get().c;
      assert.equal(conflicts, 0);
    }));

  test('server errors are shown as a failure (not as saved or offline), kept on the phone, and retried', () =>
    withPhone(browser, async ({ page, app }) => {
      let failures = 0;
      await open(page);
      await page.route('**/api/notes/*', (route) => {
        if (route.request().method() === 'PUT' && failures < 2) {
          failures++;
          return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'busy', message: 'database is busy' } }) });
        }
        return route.continue();
      });
      await editor(page).tap();
      await type(page, 'must not be lost');
      await waitStatus(page, 'failed', 8000);
      assert.match(await badge(page).getAttribute('aria-label'), /Save failed/);
      assert.match(await page.locator('.error.inline').innerText(), /database is busy/);
      assert.equal(app.notes().length, 0);
      assert.equal((await pendingRecords(page)).length, 1);
      await waitSaved(page, 20_000); // automatic retries with backoff
      assert.deepEqual(TODAY_TEXT(app), ['must not be lost']);
    }));

  test('the indicator never claims "saved" while the server lacks the text', () =>
    withPhone(browser, async ({ page, app }) => {
      await open(page);
      await blockApi(page);
      await editor(page).tap();
      await type(page, 'abc'); // from here on the server can never have the text
      await page.waitForTimeout(250); // one render frame for the badge to catch up with the keystrokes
      await page.evaluate(() => {
        window.__seen = new Set();
        setInterval(() => window.__seen.add(document.querySelector('[data-testid="global-status"]')?.dataset.status), 50);
      });
      await page.waitForTimeout(3500);
      const seen = new Set(await page.evaluate(() => [...window.__seen]));
      assert.ok(seen.size > 0);
      assert.equal(seen.has('saved'), false, `statuses seen: ${[...seen]}`);
      assert.equal(app.notes().length, 0);
    }));
});

describe('stage 4: conflicts keep both versions', () => {
  // The phone has unsent edits while another device saves a different version.
  async function makeConflict({ page, app }, { phoneText = ' <phone>', desktopDoc = paragraphDoc('base text <desktop>') } = {}) {
    const id = await seedNote(app, { date: '2026-10-05', doc: paragraphDoc('base text') });
    await open(page);
    await blockPuts(page);
    await editor(page).tap();
    await page.keyboard.press('Control+End');
    await type(page, phoneText);
    await waitStatus(page, 'offline');
    const r = await app.api('PUT', `/api/notes/${id}`, { baseRevision: 1, doc: desktopDoc, docFormat: 1, tags: ['daily-jots'], date: '2026-10-05' });
    assert.equal(r.status, 200);
    await reconnect(page, '**/api/notes/*');
    await page.waitForSelector('[data-testid="conflict-panel"]');
    return id;
  }

  test('nothing is overwritten: the phone version stays in the editor and on the server, the other version stays live', () =>
    withPhone(browser, async (ctx) => {
      const { page, app } = ctx;
      const id = await makeConflict(ctx);
      assert.equal(await page.getByTestId('global-status').getAttribute('data-status'), 'conflict');
      assert.match(await badge(page).getAttribute('aria-label'), /Conflict/);
      assert.equal(await editor(page).textContent(), 'base text <phone>', 'the editor still shows what was typed');
      assert.equal(app.docText(id), 'base text <desktop>', 'the other version was not overwritten');
      const versions = (await app.api('GET', `/api/notes/${id}/versions`)).json.versions;
      assert.ok(versions.some((v) => v.kind === 'conflict' && v.preview === 'base text <phone>'), 'phone version stored on the server');
      assert.equal((await pendingRecords(page)).length, 1, 'and still held on the phone');
      await page.reload();
      await page.waitForSelector('[data-testid="conflict-panel"]');
      assert.equal(await editor(page).textContent(), 'base text <phone>', 'the conflict survives a reload');
    }));

  test('resolve: combine both', () =>
    withPhone(browser, async (ctx) => {
      const { page, app } = ctx;
      const id = await makeConflict(ctx);
      await tap(page, 'resolve-combine');
      await page.waitForFunction(() => !document.querySelector('[data-testid="conflict-panel"]'));
      await waitSaved(page);
      const text = app.docText(id);
      assert.match(text, /base text <desktop>/);
      assert.match(text, /Merged from the other version/);
      assert.match(text, /base text <phone>/);
      assert.match(await editor(page).textContent(), /base text <desktop>[\s\S]*base text <phone>/);
      assert.deepEqual(await pendingRecords(page), []);
    }));

  test('resolve: use my text (the other version stays in History)', () =>
    withPhone(browser, async (ctx) => {
      const { page, app } = ctx;
      const id = await makeConflict(ctx);
      await tap(page, 'resolve-mine');
      await waitSaved(page);
      assert.equal(app.docText(id), 'base text <phone>');
      const versions = (await app.api('GET', `/api/notes/${id}/versions`)).json.versions;
      assert.ok(versions.some((v) => v.preview === 'base text <desktop>'), 'replaced version recoverable from History');
    }));

  test('resolve: use the other version (phone text stays in History)', () =>
    withPhone(browser, async (ctx) => {
      const { page, app } = ctx;
      const id = await makeConflict(ctx);
      await tap(page, 'resolve-server');
      await waitSaved(page);
      assert.equal(await editor(page).textContent(), 'base text <desktop>');
      assert.equal(app.docText(id), 'base text <desktop>');
      const versions = (await app.api('GET', `/api/notes/${id}/versions`)).json.versions;
      assert.ok(versions.some((v) => v.kind === 'conflict' && v.preview === 'base text <phone>'));
      assert.deepEqual(await pendingRecords(page), []);
    }));

  test('pending edits found on reopening, after the note changed elsewhere, become a conflict (not an overwrite)', () =>
    withPhone(browser, async ({ page, app }) => {
      const id = await seedNote(app, { date: '2026-10-05', doc: paragraphDoc('shared start') });
      await open(page);
      await blockApi(page);
      await editor(page).tap();
      await page.keyboard.press('Control+End');
      await type(page, ' + phone words');
      await waitStatus(page, 'offline');
      await app.api('PUT', `/api/notes/${id}`, { baseRevision: 1, doc: paragraphDoc('shared start + desktop words'), docFormat: 1, tags: ['daily-jots'], date: '2026-10-05' });
      await page.unroute('**/api/**');
      await page.reload(); // reopen the app: recovered edits meet the changed note
      await page.waitForSelector('[data-testid="conflict-panel"]', { timeout: 15_000 });
      assert.equal(app.docText(id), 'shared start + desktop words');
      assert.equal(await editor(page).textContent(), 'shared start + phone words');
      const versions = (await app.api('GET', `/api/notes/${id}/versions`)).json.versions;
      assert.ok(versions.some((v) => v.kind === 'conflict' && v.preview === 'shared start + phone words'));
    }));

  test('note deleted elsewhere while editing: text is kept and can restore the note', () =>
    withPhone(browser, async ({ page, app }) => {
      const id = await seedNote(app, { date: '2026-10-05', doc: paragraphDoc('will be deleted') });
      await open(page);
      await blockPuts(page);
      await editor(page).tap();
      await page.keyboard.press('Control+End');
      await type(page, ' but I kept typing');
      await waitStatus(page, 'offline');
      await app.api('DELETE', `/api/notes/${id}`);
      await reconnect(page, '**/api/notes/*');
      await page.waitForSelector('[data-testid="conflict-panel"][data-reason="deleted"]');
      assert.equal(await editor(page).textContent(), 'will be deleted but I kept typing');
      await tap(page, 'resolve-mine');
      await waitSaved(page, 15_000);
      assert.equal(app.docText(id), 'will be deleted but I kept typing');
      assert.equal(app.notes()[0].deleted_at, null, 'note restored');
    }));

  test("two devices create today's note: the second is not duplicated, its text is kept, and can be combined", () =>
    withPhone(browser, async ({ page, app }) => {
      await open(page); // phone shows an empty entry for today
      await seedNote(app, { date: '2026-10-05', doc: paragraphDoc('created on the desktop first') });
      await editor(page).tap();
      await type(page, 'phone also started today');
      await page.waitForSelector('[data-testid="conflict-panel"][data-reason="slot"]');
      assert.equal(app.notes().length, 1, 'no duplicate daily note');
      const holder = app.notes()[0].id;
      const versions = (await app.api('GET', `/api/notes/${holder}/versions`)).json.versions;
      assert.ok(versions.some((v) => v.kind === 'conflict' && v.preview === 'phone also started today'));
      await tap(page, 'resolve-combine');
      await page.waitForFunction(() => !document.querySelector('[data-testid="conflict-panel"]'));
      await waitSaved(page, 15_000);
      assert.equal(app.notes().length, 1);
      const text = app.docText(holder);
      assert.match(text, /created on the desktop first/);
      assert.match(text, /phone also started today/);
      assert.equal(await page.locator('[data-testid="note"]').count(), 1, 'the stream shows a single entry for today');
    }));
});

describe('stage 4: backups and export through the UI', () => {
  test('back up now, download links, markdown/JSON export and a merge import work', () =>
    withPhone(browser, async ({ page, app }) => {
      await seedNote(app, { date: '2026-10-05', doc: paragraphDoc('keep this safe') });
      await page.goto(`${app.url}/#/data`);
      await page.waitForSelector('[data-testid="backup-now"]');
      assert.equal(await page.getByTestId('last-backup').textContent(), 'never');
      await tap(page, 'backup-now');
      await page.waitForFunction(() => document.querySelector('[data-testid="last-backup"]').textContent !== 'never');
      assert.equal(await page.locator('[data-testid="backup-list"] li').count(), 1);

      const [json] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-json').click()]);
      assert.match(json.suggestedFilename(), /^personal-hq-export-.*\.json$/);
      const [md] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-md').click()]);
      assert.match(md.suggestedFilename(), /\.zip$/);

      // import the JSON export into an empty second server through the UI
      const exportPath = await json.path();
      const { startApp, newPhone } = await import('./harness.js');
      const app2 = await startApp();
      const { page: page2, context: ctx2 } = await newPhone(browser, app2);
      await page2.goto(`${app2.url}/#/data`);
      await page2.waitForSelector('[data-testid="import-file"]');
      await page2.getByTestId('import-file').setInputFiles(exportPath);
      await page2.waitForSelector('[data-testid="import-report"]');
      assert.equal(app2.notes().length, 1);
      assert.equal(app2.docText(app2.notes()[0].id), 'keep this safe');
      await ctx2.close();
      await app2.close();
    }));
});

