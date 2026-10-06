import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, withPhone, paragraphDoc, waitSaved } from './harness.js';
import { uuid } from '../../shared/ids.js';
let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser.close(); });
test('nested folders filter shared notes, return to selection and persist editing on a phone layout', () => withPhone(browser, async ({ app, page }) => {
  const id = uuid();
  for (const [noteId, title, tags] of [[id, 'Shared study note', ['school/clinical/evaluations', 'projects/study']], [uuid(), 'Unrelated', ['projects/home']]]) {
    const r = await app.api('PUT', `/api/notes/${noteId}`, { baseRevision: 0, kind: 'note', title, date: '2026-10-05', tags, docFormat: 1, doc: paragraphDoc('Sample body') });
    assert.equal(r.status, 200);
  }
  await page.goto(`${app.url}/#/notes`);
  await page.getByTestId('note-row').first().waitFor();
  await page.locator('summary').filter({ hasText: 'school' }).tap();
  await page.locator('[data-folder="school"]').tap();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="note-row"]').length === 1);
  assert.match(await page.getByTestId('note-row').innerText(), /Shared study note/);
  await page.getByTestId('notes-include-sub').uncheck();
  await page.getByTestId('notes-empty').waitFor();
  await page.getByTestId('notes-include-sub').check();
  await page.getByTestId('note-row').waitFor();
  await page.locator('summary').filter({ hasText: 'clinical' }).tap();
  await page.locator('[data-folder="school/clinical/evaluations"]').tap();
  await page.waitForFunction(() => !document.querySelector('[aria-label="Notes in selected folder"]').getAttribute('aria-busy')?.includes('true'));
  assert.equal(await page.getByTestId('note-row').count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByTestId('note-row').tap();
  const editor = page.locator('.note-text[contenteditable="true"]');
  await editor.waitFor();
  await editor.tap();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' edited');
  await waitSaved(page);
  assert.match(app.docText(id), /edited/);
  await page.goBack();
  await page.getByTestId('note-row').waitFor();
  assert.equal(await page.getByTestId('notes-tag-filter').inputValue(), 'school/clinical/evaluations');
  await page.getByTestId('notes-tag-filter').selectOption('projects/study');
  await page.getByTestId('note-row').tap();
  await editor.waitFor();
  assert.match(await editor.innerText(), /edited/);
  assert.equal(app.notes().length, 2, 'opening another folder does not duplicate the note');
}));

