import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { launch, withPhone, waitSaved } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

const withServiceWorker = (fn) => withPhone(browser, fn, { serviceWorker: true });

// Open the app and wait until its service worker is in charge of the page.
async function installed(page) {
  await page.goto(`${page.app.url}/#/`);
  await page.getByTestId('title').waitFor();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
  });
}

// What Android does when you pick Gordonite in the share menu: a multipart POST to the manifest's share_target.
const share = (page, { title = '', text = '', url = '', files = [] }) =>
  page.evaluate(
    ({ title, text, url, files }) => {
      const form = Object.assign(document.createElement('form'), { method: 'POST', action: '/share-target', enctype: 'multipart/form-data' });
      for (const [name, value] of Object.entries({ title, text, url })) form.append(Object.assign(document.createElement('input'), { type: 'hidden', name, value }));
      const input = Object.assign(document.createElement('input'), { type: 'file', name: 'files', multiple: true });
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(new File([f.body], f.name, { type: f.type }));
      input.files = dt.files;
      form.append(input);
      document.body.append(form);
      form.submit();
    },
    { title, text, url, files },
  );

const waitForNotePage = (page) => page.waitForFunction(() => /^#\/n\//.test(location.hash), null, { timeout: 15_000 });
const waitingShares = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('gordonite-share', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('shares', { keyPath: 'id' });
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const q = open.result.transaction('shares').objectStore('shares').getAll();
          q.onsuccess = () => (open.result.close(), resolve(q.result.length));
        };
      }),
  );

describe('the installed app', () => {
  test('a page and a file shared from another app become one new note, opened on its own page', () =>
    withServiceWorker(async ({ page, app }) => {
      await installed(page);
      await share(page, { title: 'Bus schedule', text: 'https://transit.example/route-3', files: [{ name: 'times.pdf', type: 'application/pdf', body: '%PDF-1.4 test' }] });
      await waitForNotePage(page);
      await waitSaved(page, 15_000);

      const notes = app.notes();
      assert.equal(notes.length, 1);
      assert.equal(notes[0].title, 'Bus schedule');
      assert.equal(notes[0].kind, 'note');
      const doc = JSON.parse(notes[0].doc);
      assert.deepEqual(doc.content.map((n) => n.type), ['paragraph', 'attachment', 'paragraph']);
      assert.equal(app.docText(notes[0].id).split('\n')[0], 'https://transit.example/route-3');
      assert.equal(doc.content[1].attrs.name, 'times.pdf');
      const stored = (await app.api('GET', `/api/attachments/${doc.content[1].attrs.id}`)).json.attachment;
      assert.equal(stored.noteId, notes[0].id, 'the stored file belongs to the new note');
      assert.equal(await page.locator('.note-text figure.attachment').count(), 1, 'the file is in the open note');
      assert.equal(await waitingShares(page), 0, 'nothing left waiting');
      assert.equal(page.url().includes('#/share'), false, 'the share page is not left in history');
    }));

  test('with the server out of reach the app still opens, and a share waits on the phone until it can be sent', () =>
    withServiceWorker(async ({ page, app, context }) => {
      await installed(page);
      await context.setOffline(true);
      await page.reload();
      await page.getByTestId('title').waitFor({ timeout: 10_000 });

      await share(page, { title: 'Photo of the whiteboard', files: [{ name: 'board.png', type: 'image/png', body: 'not really a png' }] });
      await page.getByTestId('share-error').waitFor({ timeout: 15_000 });
      assert.match(await page.getByTestId('share-error').textContent(), /kept on this phone/);
      assert.equal(await waitingShares(page), 1);
      assert.equal(app.notes().length, 0);

      await page.goto(`${app.url}/#/`);
      await page.getByTestId('shares-waiting').waitFor({ timeout: 10_000 });

      await context.setOffline(false);
      await page.getByTestId('shares-waiting').getByRole('link').tap();
      await waitForNotePage(page);
      await waitSaved(page, 15_000);
      assert.equal(app.notes().length, 1);
      assert.equal(app.notes()[0].title, 'Photo of the whiteboard');
      assert.equal(await waitingShares(page), 0);
    }));

  test('shared text with no server reachable still becomes a note right away, held on the phone', () =>
    withServiceWorker(async ({ page, app, context }) => {
      await installed(page);
      await context.setOffline(true);
      await share(page, { text: 'idea from the train\nsecond line' });
      await waitForNotePage(page);
      assert.equal(await page.locator('.note-text').first().textContent(), 'idea from the trainsecond line');
      assert.equal(await waitingShares(page), 0, 'the note itself is now what the phone holds');
      assert.equal(app.notes().length, 0);
      await context.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await waitSaved(page, 20_000);
      assert.equal(app.docText(app.notes()[0].id), 'idea from the train\nsecond line\n');
    }));
});
