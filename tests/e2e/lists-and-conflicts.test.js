// Two small things found by the 0.4.3 audit: "Load more" tapped twice added the same notes twice, and the conflict
// indicator did nothing for a note that has no tag.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { uuid } from '../../shared/ids.js';
import { dateInTz, addDays } from '../../shared/dates.js';
import { launch, TZ, withPhone, waitStatus, paragraphDoc } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

const today = () => dateInTz(new Date(), TZ);

test('Load more cannot add the same notes twice, however fast it is tapped', () =>
  withPhone(browser, async ({ page, app }) => {
    // 35 free notes: the first page is 30, so there are 5 more
    for (let i = 0; i < 35; i++) {
      const res = await app.api('PUT', `/api/notes/${uuid()}`, {
        baseRevision: 0,
        kind: 'note',
        title: `Note ${String(i).padStart(2, '0')}`,
        doc: paragraphDoc(`words ${i}`),
        docFormat: 2,
        tags: ['list'],
        date: addDays(today(), -(i % 20)),
        opId: uuid(),
      });
      assert.equal(res.status, 200);
    }

    await page.goto(`${app.url}/#/notes`);
    await page.getByTestId('notes-more').waitFor();
    assert.equal(await page.getByTestId('note-row').count(), 30);

    // hold the next page open so a second tap lands while the first is still waiting
    const requests = [];
    let release;
    const held = new Promise((resolve) => (release = resolve));
    await page.route('**/api/notes?*', async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('offset') === '30') {
        requests.push(url.search);
        await held;
      }
      await route.continue();
    });

    const more = page.getByTestId('notes-more');
    await more.dispatchEvent('click');
    await more.dispatchEvent('click'); // a second tap before anything came back
    await more.dispatchEvent('click');
    await page.waitForFunction(() => document.querySelector('[data-testid="notes-more"]')?.disabled === true);
    release();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="note-row"]').length === 35);

    assert.equal(requests.length, 1, 'only one request for the next page was made');
    const ids = await page.getByTestId('note-row').evaluateAll((rows) => rows.map((r) => r.getAttribute('href')));
    assert.equal(new Set(ids).size, ids.length, 'no note is listed twice');
    assert.equal(await page.getByTestId('notes-more').count(), 0, 'and there is nothing more to load');
    assert.deepEqual(page.errors, []);
  }));

test('the conflict indicator opens a note that has no tag', () =>
  withPhone(browser, async ({ page, app, context }) => {
    const id = uuid();
    const made = await app.api('PUT', `/api/notes/${id}`, { baseRevision: 0, kind: 'note', title: 'Loose note', doc: paragraphDoc('base text'), docFormat: 2, tags: [], date: today(), opId: uuid() });
    assert.equal(made.status, 200);

    await page.goto(`${app.url}/#/n/${id}`);
    const editor = page.locator('.note-text[contenteditable="true"]');
    await editor.waitFor();

    // another device saves; this phone, still on the old revision, types and saves
    const other = await app.api('PUT', `/api/notes/${id}`, { baseRevision: 1, doc: paragraphDoc('base text <desktop>'), docFormat: 2, opId: uuid() });
    assert.equal(other.status, 200);
    await editor.tap();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' <phone>');
    await waitStatus(page, 'conflict', 15_000);

    // leave the note: the indicator in the header is the only way back to it
    await page.goto(`${app.url}/#/notes`);
    await page.getByTestId('notes-tags-link').waitFor();
    assert.equal(await page.getByTestId('global-status').getAttribute('data-status'), 'conflict');
    await page.getByTestId('global-status').tap();
    await page.waitForFunction((noteId) => location.hash === `#/n/${noteId}`, id);
    await page.getByTestId('conflict-panel').waitFor();
    assert.equal(context.pages().length, 1);
    assert.deepEqual(page.errors, []);
  }));
