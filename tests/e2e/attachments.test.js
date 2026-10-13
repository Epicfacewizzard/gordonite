import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { uuid } from '../../shared/ids.js';
import { dateInTz } from '../../shared/dates.js';
import { launch, TZ, withPhone, open, editor, waitSaved, tap } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const png = (name) => ({ name, mimeType: 'image/png', buffer: PNG });
const pdf = (name) => ({ name, mimeType: 'application/pdf', buffer: PDF });

const savedDoc = (app) => JSON.parse(app.notes()[0].doc);
const attachmentsIn = (doc) => doc.content.filter((n) => n.type === 'attachment');
const images = (page) => page.locator('.note-text figure.attachment-image img');
const cards = (page) => page.locator('.note-text figure.attachment-file');

// Put a File into a clipboard or drag payload the way a browser does, and fire the event on the note.
const fire = (page, kind, { name, type, base64 }) =>
  page.evaluate(
    ({ kind, name, type, base64 }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], name, { type }));
      const target = document.querySelector('.note-text[contenteditable="true"]');
      const rect = target.getBoundingClientRect();
      const init = { bubbles: true, cancelable: true, clientX: rect.left + 20, clientY: rect.top + 10 };
      const event = kind === 'paste' ? new ClipboardEvent('paste', { ...init, clipboardData: data }) : new DragEvent('drop', { ...init, dataTransfer: data });
      target.dispatchEvent(event);
    },
    { kind, name, type, base64 },
  );

describe('files in notes', () => {
  test('the paperclip adds an image and a PDF as one step; they survive saving, reloading and the dashboard', () =>
    withPhone(browser, async ({ page, app }) => {
      await open(page);
      await editor(page).tap();
      await page.keyboard.type('Move in day');
      await page.getByTestId('attach-input').setInputFiles([png('Kitchen sink.png'), pdf('Inspection Report.pdf')]);

      await images(page).first().waitFor();
      await cards(page).first().waitFor();
      assert.equal(await images(page).evaluate((img) => img.complete && img.naturalWidth > 0), true, 'the image loads from the server');
      assert.equal(await images(page).first().getAttribute('alt'), 'Kitchen sink.png');
      assert.match(await cards(page).first().innerText(), /PDF[\s\S]*Inspection Report\.pdf/);
      assert.equal(await page.locator('.upload-status').count(), 0, 'no stuck "uploading" message');

      // one undo takes both out, redo brings both back
      await tap(page, 'tb-undo');
      assert.equal(await page.locator('.note-text figure.attachment').count(), 0);
      await tap(page, 'tb-redo');
      assert.equal(await page.locator('.note-text figure.attachment').count(), 2);

      await waitSaved(page);
      const doc = savedDoc(app);
      const files = attachmentsIn(doc);
      assert.deepEqual(files.map((f) => f.attrs.name), ['Kitchen sink.png', 'Inspection Report.pdf']);
      assert.equal(files[0].attrs.mime, 'image/png');
      assert.equal(doc.content.at(-1).type, 'paragraph', 'a line is left below to keep writing');
      const stored = (await app.api('GET', '/api/attachments')).json.attachments;
      assert.ok(stored.every((a) => a.noteId === app.notes()[0].id), 'the saved note claimed both files');

      await page.reload();
      await images(page).first().waitFor();
      assert.equal(await cards(page).count(), 1);

      // the read-only views draw them too: the dashboard's note and the note's own page
      await page.goto(`${app.url}/#/`);
      await page.locator('figure.attachment-image img').first().waitFor();
      await page.goto(`${app.url}/#/n/${app.notes()[0].id}`);
      await page.locator('figure.attachment-file').first().waitFor();
    }));

  test('taking a file out of a note does not delete the file', () =>
    withPhone(browser, async ({ page, app }) => {
      await open(page);
      await editor(page).tap();
      await page.getByTestId('attach-input').setInputFiles([png('Floor.png')]);
      await images(page).first().waitFor();
      await waitSaved(page);
      const id = (await app.api('GET', '/api/attachments')).json.attachments[0].id;

      await page.locator('.note-text .attachment-remove').first().tap();
      assert.equal(await page.locator('.note-text figure.attachment').count(), 0);
      await waitSaved(page);
      assert.equal(attachmentsIn(savedDoc(app)).length, 0);
      assert.equal((await app.api('GET', `/api/attachments/${id}`)).status, 200, 'the file is still stored');
      assert.equal((await fetch(`${app.url}/api/attachments/${id}/file`)).status, 200);
    }));

  test('a pasted screenshot and a dropped file are uploaded and placed in the note', () =>
    withPhone(browser, async ({ page, app }) => {
      await open(page);
      await editor(page).tap();
      await page.keyboard.type('Pasted:');
      await fire(page, 'paste', { name: 'image.png', type: 'image/png', base64: PNG.toString('base64') });
      await images(page).first().waitFor();
      await fire(page, 'drop', { name: 'Statement.pdf', type: 'application/pdf', base64: PDF.toString('base64') });
      await cards(page).first().waitFor();
      await waitSaved(page);
      assert.deepEqual(attachmentsIn(savedDoc(app)).map((f) => f.attrs.name).sort(), ['Statement.pdf', 'image.png']);
    }));

  test('a failed upload says so, leaves the note alone, and can be dismissed', () =>
    withPhone(browser, async ({ page, app }) => {
      await open(page);
      await editor(page).tap();
      await page.keyboard.type('Before');
      await page.route('**/api/attachments?**', (route) => route.abort('connectionfailed'));
      await page.getByTestId('attach-input').setInputFiles([png('Lost.png')]);
      await page.getByTestId('upload-status').waitFor();
      assert.match(await page.getByTestId('upload-status').innerText(), /Lost\.png/);
      assert.equal(await page.locator('.note-text figure.attachment').count(), 0);
      await page.getByTestId('upload-status').getByRole('button', { name: 'Dismiss' }).tap();
      assert.equal(await page.getByTestId('upload-status').count(), 0);
      await page.unroute('**/api/attachments?**');
      await page.getByTestId('attach-input').setInputFiles([png('Found.png')]); // and the next attempt works
      await images(page).first().waitFor();
    }));

  test('the Files page: add without a note, filter, search, open, remove', () =>
    withPhone(browser, async ({ page, app }) => {
      await page.goto(`${app.url}/#/settings`);
      await page.getByTestId('files-link').tap();
      await page.getByTestId('files-empty').waitFor();

      await page.getByTestId('files-input').setInputFiles([png('Kitchen sink.png'), pdf('Insurance Policy.pdf'), pdf('Management Agreement.pdf')]);
      await page.locator('[data-testid="file-list"] li').nth(2).waitFor();
      assert.equal(await page.locator('[data-testid="file-list"] li').count(), 3);
      assert.match(await page.getByTestId('files').innerText(), /not in a note/);
      assert.match(await page.getByTestId('files').innerText(), /3 files/);

      await page.getByRole('button', { name: 'PDFs', exact: true }).tap();
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="file-list"] li').length === 2);
      await page.getByTestId('files-search').fill('insurance');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="file-list"] li').length === 1);
      assert.match(await page.locator('[data-testid="file-list"] li').innerText(), /Insurance Policy\.pdf/);

      // open: the link goes straight to the stored file
      const href = await page.locator('[data-testid="file-list"] .file-name').getAttribute('href');
      assert.match(href, /^\/api\/attachments\/[\w-]+\/file$/);

      // remove asks first
      await page.getByTestId('file-remove').tap();
      await page.getByTestId('file-remove-confirm').tap();
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="file-list"] li').length === 0);
      assert.equal((await app.api('GET', '/api/attachments')).json.attachments.length, 2);
    }));

  test('a note that is only a file is not shown as empty, and a tap on the file opens it instead of the editor', () =>
    withPhone(browser, async ({ page, app }) => {
      const file = (await (await fetch(`${app.url}/api/attachments?name=Plan.pdf`, { method: 'POST', headers: { 'x-gordonite-upload': '1', 'content-type': 'application/pdf' }, body: PDF })).json()).attachment;
      const today = dateInTz(new Date(), TZ);
      const earlier = new Date(Date.now() - 2 * 86_400_000);
      const date = dateInTz(earlier, TZ);
      const doc = { type: 'doc', content: [{ type: 'attachment', attrs: { id: file.id, name: file.name, mime: file.mime, size: file.size } }, { type: 'paragraph' }] };
      const r = await app.api('PUT', `/api/notes/${uuid()}`, { baseRevision: 0, doc, docFormat: 2, tags: ['daily-jots'], date, opId: uuid() });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.notEqual(date, today);
      await page.goto(`${app.url}/#/t/daily-jots`);
      await page.locator('figure.attachment-file').first().waitFor();
      assert.equal(await page.getByText('Empty note. Tap to write.').count(), 0);
      const popup = page.context().waitForEvent('page');
      await page.locator('figure.attachment-file a.attachment-open').first().tap();
      const opened = await popup;
      assert.match(opened.url(), new RegExp(`/api/attachments/${file.id}/file$`));
      await opened.close();
      assert.equal(await editor(page).count(), 1, 'only today\'s editor is open (the tap did not wake the old note)');
    }));
});
