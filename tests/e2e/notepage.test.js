import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { uuid } from '../../shared/ids.js';
import { launch, withPhone, editor, waitSaved, tap, seedNote, paragraphDoc } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

const noteEditor = (page) => page.locator('[data-testid="note-page"] .note-text[contenteditable="true"]');

describe('a note on its own page', () => {
  test('opens from the date or the menu, edits and saves like in the stream, and Back returns to the stream', () =>
    withPhone(browser, async ({ page, app }) => {
      const a = await seedNote(app, { tags: ['ideas'], date: '2026-10-03', doc: paragraphDoc('Saturday idea') });
      await seedNote(app, { tags: ['ideas'], date: '2026-10-04', doc: paragraphDoc('Sunday idea') });

      await page.goto(`${app.url}/#/t/ideas`);
      await page.waitForSelector('[data-testid="stream"] [data-testid="note"]');
      assert.equal(await page.getByTestId('note').count(), 3, 'two seeded days plus an empty today');

      // 1. the date is a link
      await page.locator(`[data-note-id="${a}"]`).getByTestId('open-note').tap();
      await page.waitForSelector('[data-testid="note-page"]');
      assert.equal(await page.evaluate(() => location.hash), `#/n/${a}`);
      await noteEditor(page).waitFor(); // the page shell appears first; wait for the note itself
      assert.equal(await page.getByTestId('note').count(), 1, 'only this note');
      assert.equal(await page.getByTestId('title').innerText(), 'Note');
      assert.equal(await noteEditor(page).textContent(), 'Saturday idea');
      assert.equal(await page.locator('[data-testid="note-page"] .chips a').getAttribute('href'), '#/t/ideas', 'its tag links to the stream');

      // 2. editing and saving work exactly as in a stream
      await noteEditor(page).tap();
      await page.keyboard.press('Control+End');
      await page.keyboard.type(' and more');
      await waitSaved(page);
      assert.equal(app.docText(a), 'Saturday idea and more');

      // 3. Back goes to the stream, which shows the new text
      await page.getByLabel('Back', { exact: true }).tap();
      await page.waitForSelector('[data-testid="stream"]');
      assert.match(await page.locator(`[data-note-id="${a}"]`).innerText(), /Saturday idea and more/);

      // 4. the note menu has the same shortcut
      const b = app.notes().find((n) => n.note_date === '2026-10-04').id;
      await page.locator(`[data-note-id="${b}"]`).getByTestId('note-menu').tap();
      await page.getByTestId('menu-open').tap();
      await page.waitForSelector('[data-testid="note-page"]');
      assert.equal(await page.evaluate(() => location.hash), `#/n/${b}`);

      // 5. the page works when loaded directly (a bookmark, or a new browser tab)
      await page.reload();
      await noteEditor(page).waitFor();
      assert.equal(await noteEditor(page).textContent(), 'Sunday idea');
      assert.deepEqual(page.errors, []);
    }));

  test('an unknown note says so, and a note in the trash points to the trash', () =>
    withPhone(browser, async ({ page, app }) => {
      await page.goto(`${app.url}/#/n/${uuid()}`);
      await page.getByTestId('note-missing').waitFor();

      const id = await seedNote(app, { tags: ['ideas'], date: '2026-10-03', doc: paragraphDoc('gone soon') });
      assert.equal((await app.api('DELETE', `/api/notes/${id}`)).status, 200);
      await page.goto(`${app.url}/#/n/${id}`);
      await page.getByTestId('note-trashed').waitFor();
      assert.equal(await noteEditor(page).count(), 0, 'a trashed note is not editable from here');
    }));

  test('deleting from its own page returns to its stream; a task sheet links to its note', () =>
    withPhone(browser, async ({ page, app }) => {
      const taskId = uuid();
      const id = await seedNote(app, {
        tags: ['ideas'],
        date: '2026-10-03',
        doc: { type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false, id: taskId }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ship the thing' }] }] }] }] },
      });

      // From the Tasks page: tap the task, follow the link to its note.
      await page.goto(`${app.url}/#/tasks`);
      await page.getByTestId('task-open').first().tap();
      await page.getByTestId('open-task-note').tap();
      await page.waitForSelector('[data-testid="note-page"]');
      assert.equal(await page.evaluate(() => location.hash), `#/n/${id}`);

      // Delete it there: back to the stream it lived in.
      await page.getByTestId('note-menu').tap();
      await page.getByTestId('menu-delete').tap();
      await page.getByTestId('confirm-delete').tap();
      await page.waitForSelector('[data-testid="stream"]');
      assert.equal(await page.evaluate(() => location.hash), '#/t/ideas');
      assert.equal(app.notes().find((n) => n.id === id).deleted_at !== null, true);
      assert.deepEqual(page.errors, []);
    }));
});
