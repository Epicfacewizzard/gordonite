import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, withPhone, seedNote, paragraphDoc } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

test('linked notes replace the resolver so Back and Forward follow the note chain', () =>
  withPhone(browser, async ({ app, page }) => {
    const a = await seedNote(app, { date: '2026-10-01', doc: paragraphDoc('Source note [[Destination note]]') });
    const b = await seedNote(app, { date: '2026-10-02', doc: paragraphDoc('Destination note', '[[Third note]]') });
    const c = await seedNote(app, { date: '2026-10-03', doc: paragraphDoc('Third note') });
    app.db.prepare('UPDATE notes SET title = ? WHERE id = ?').run('Destination note', b);
    app.db.prepare('UPDATE notes SET title = ? WHERE id = ?').run('Third note', c);
    await page.goto(`${app.url}/#/n/${a}`);
    await page.locator('a[href="#/link/Destination%20note"]').click();
    await page.waitForURL(`**/#/n/${b}`);
    await page.locator('a[href="#/link/Third%20note"]').click();
    await page.waitForURL(`**/#/n/${c}`);
    await page.getByLabel('Back', { exact: true }).click();
    await page.waitForURL(`**/#/n/${b}`);
    await page.getByLabel('Back', { exact: true }).click();
    await page.waitForURL(`**/#/n/${a}`);
    await page.goForward();
    await page.waitForURL(`**/#/n/${b}`);
    await page.reload();
    await page.getByTestId('note-page').waitFor();
    await page.getByLabel('Back', { exact: true }).click();
    await page.waitForURL(`**/#/n/${a}`);
    assert.equal(app.docText(a), 'Source note [[Destination note]]');
    assert.equal(app.docText(b), 'Destination note\n[[Third note]]');
  }));
