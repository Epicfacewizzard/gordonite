// Writing that used to produce a document the server refused: bold applied across a line break (Shift+Enter).
// The editor puts the bold mark on the line break as well as on the text; the note then could not be saved.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, withPhone, open, editor, waitSaved, tap } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

const type = (page, text) => page.keyboard.type(text);

test('bold across a line break saves, and the note reopens as written', () =>
  withPhone(browser, async ({ page, app }) => {
    await open(page);
    await editor(page).tap();
    await type(page, 'first line');
    await page.keyboard.press('Shift+Enter');
    await type(page, 'second line');
    await page.keyboard.press('Control+a');
    await tap(page, 'tb-bold');
    await waitSaved(page);

    const note = app.notes()[0];
    const doc = JSON.parse(note.doc);
    const inline = doc.content[0].content;
    assert.deepEqual(inline.map((n) => n.type), ['text', 'hardBreak', 'text']);
    assert.ok(inline.every((n) => n.marks?.some((m) => m.type === 'bold')), 'the bold is on the text and on the line break');
    assert.equal(note.revision >= 1, true);

    await page.reload();
    await page.waitForSelector('.note-text[contenteditable="true"]');
    assert.match(await editor(page).innerHTML(), /<strong>first line<br[^>]*>second line<\/strong>|<strong>first line<\/strong><br[^>]*><strong>second line<\/strong>/);
    assert.equal(await page.getByTestId('global-status').getAttribute('data-status'), 'saved');
    assert.deepEqual(page.errors, []);
  }));
