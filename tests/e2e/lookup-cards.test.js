import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, withPhone, newId, paragraphDoc } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

test('Look up shows category destinations, returns from each page, and keeps searching notes and people', () =>
  withPhone(browser, async ({ app, page }) => {
    const personId = newId();
    const noteId = newId();
    const taskNoteId = newId();
    await app.api('PUT', `/api/notes/${personId}`, { baseRevision: 0, kind: 'note', title: 'Mina Searchable', doc: paragraphDoc('A friend'), docFormat: 1, tags: ['05-people'], date: '2026-10-05' });
    await app.api('PUT', `/api/notes/${noteId}`, { baseRevision: 0, kind: 'note', title: 'Searchable journal', doc: paragraphDoc('Findable phrase'), docFormat: 1, tags: ['daily-jots'], date: '2026-10-06' });
    await app.api('PUT', `/api/notes/${taskNoteId}`, {
      baseRevision: 0,
      kind: 'note',
      title: 'Task source',
      doc: { type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false, id: newId() }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Searchable task' }] }] }] }] },
      docFormat: 1,
      tags: ['daily-jots'],
      date: '2026-10-07',
    });
    await page.goto(`${app.url}/#/lookup`);
    const destinations = ['lookup-notes', 'lookup-all-people', 'lookup-all-projects', 'lookup-tags', 'lookup-files'];
    assert.deepEqual(await Promise.all(destinations.map((id) => page.getByTestId(id).getAttribute('href'))), ['#/notes', '#/people', '#/projects', '#/tags', '#/files']);
    assert.equal(await page.getByTestId('lookup-destinations').locator('a a').count(), 0, 'destination cards have no nested links');

    for (const [id, path] of [['lookup-notes', '#/notes'], ['lookup-all-people', '#/people'], ['lookup-all-projects', '#/projects'], ['lookup-tags', '#/tags'], ['lookup-files', '#/files']]) {
      await page.getByTestId(id).tap();
      await page.waitForFunction((h) => location.hash.startsWith(h), path);
      await page.goBack();
      await page.waitForSelector('[data-testid="lookup-destinations"]');
    }
    assert.equal(await page.getByTestId('lookup-trash').getAttribute('href'), '#/trash');
    assert.ok(await page.getByTestId('lookup-person').count() <= 4, 'empty query only shows a compact recent-people preview');

    const input = page.getByTestId('lookup-input');
    await input.fill('Mina Searchable');
    await page.getByTestId('lookup-person').waitFor();
    assert.match(await page.getByTestId('lookup-person').innerText(), /Mina Searchable/);
    await input.fill('Findable phrase');
    await page.getByTestId('lookup-note').waitFor();
    assert.match(await page.getByTestId('lookup-note').innerText(), /Searchable journal/);
    await input.fill('Searchable task');
    await page.getByTestId('lookup-task').waitFor();
    assert.match(await page.getByTestId('lookup-task').innerText(), /Searchable task/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'phone layout has no sideways scrolling');
  }));

test('wide Look up uses the available page width for its destination cards', () =>
  withPhone(browser, async ({ app, page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${app.url}/#/lookup`);
    const main = await page.locator('main.page').boundingBox();
    const cards = await page.getByTestId('lookup-destinations').boundingBox();
    assert.ok(main && main.width >= 1300, `main.page should be at least 1300px wide (got ${main?.width})`);
    assert.ok(cards && cards.width >= main.width * 0.9, `destination row should span most of main.page (main ${main?.width}, cards ${cards?.width})`);
  }, { viewport: { width: 1440, height: 900 } }));
