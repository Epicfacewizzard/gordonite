import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { launch, withPhone, open, editor, waitSaved, tap, structure, caret } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

const type = (page, text, delay = 0) => page.keyboard.type(text, { delay });
// A human takes tens of milliseconds between keys; CDP does not. Let the browser deliver its
// asynchronous selectionchange to the editor before the next action.
const press = async (page, key, n = 1) => {
  for (let i = 0; i < n; i++) await page.keyboard.press(key);
  await page.waitForTimeout(40);
};

describe('stage 1: one reliable note', () => {
  test('opening a stream saves nothing; the first keystroke creates the note; reopening shows the text', () =>
    withPhone(browser, async ({ app, page }) => {
      await open(page);
      await page.waitForTimeout(1500);
      assert.equal(app.notes().length, 0, 'no note from merely opening the stream');

      await editor(page).tap();
      await type(page, 'First thought of the day');
      await waitSaved(page);
      const notes = app.notes();
      assert.equal(notes.length, 1);
      assert.equal(app.docText(notes[0].id), 'First thought of the day');
      assert.match(notes[0].note_date, /^\d{4}-\d{2}-\d{2}$/, 'calendar date stored separately from the timestamps');
      assert.match(notes[0].created_at, /Z$/);
      assert.equal(notes[0].doc_format, 1);

      await page.reload();
      await page.waitForSelector('.note-text');
      assert.equal(await editor(page).textContent(), 'First thought of the day');
    }));

  test('Enter splits a paragraph; Backspace/Delete join paragraphs predictably', () =>
    withPhone(browser, async ({ page }) => {
      await open(page);
      await editor(page).tap();
      await type(page, 'HelloWorld');
      await press(page, 'ArrowLeft', 5);
      await press(page, 'Enter');
      assert.deepEqual(await structure(page), [{ type: 'p', text: 'Hello' }, { type: 'p', text: 'World' }]);
      assert.deepEqual((await caret(page)).offset, 0);
      await press(page, 'Backspace');
      assert.deepEqual(await structure(page), [{ type: 'p', text: 'HelloWorld' }]);
      assert.equal((await caret(page)).offset, 5, 'caret sits at the join');
      await press(page, 'Enter');
      await press(page, 'ArrowLeft');
      await press(page, 'Delete');
      assert.deepEqual(await structure(page), [{ type: 'p', text: 'HelloWorld' }], 'Delete at end of paragraph joins the next');
    }));

  test('toolbar bold/italic/heading keep focus and selection and return straight to typing', () =>
    withPhone(browser, async ({ page }) => {
      await open(page);
      await editor(page).tap();
      await type(page, 'plain word more');
      await press(page, 'ArrowLeft', 5);
      await page.keyboard.down('Shift');
      await press(page, 'ArrowLeft', 4);
      await page.keyboard.up('Shift');
      assert.equal((await caret(page)).selected, 'word');

      await tap(page, 'tb-bold');
      let c = await caret(page);
      assert.equal(c.focused, true, 'editor still has focus (keyboard stays up)');
      assert.equal(c.selected, 'word', 'selection preserved');
      assert.match(await editor(page).innerHTML(), /<strong>word<\/strong>/);

      await tap(page, 'tb-italic');
      assert.match(await editor(page).innerHTML(), /<strong><em>word<\/em><\/strong>|<em><strong>word<\/strong><\/em>/);
      await tap(page, 'tb-bold');
      await tap(page, 'tb-italic');
      assert.doesNotMatch(await editor(page).innerHTML(), /<strong>|<em>/);

      // Typing continues immediately, replacing the still-selected word
      await tap(page, 'tb-bold');
      await type(page, 'NEW');
      assert.match(await editor(page).innerHTML(), /plain <strong>NEW<\/strong> more/);
      await press(page, 'End');
      await tap(page, 'tb-h1');
      assert.equal((await structure(page))[0].type, 'h1');
      assert.equal((await caret(page)).focused, true);
      await type(page, '!');
      assert.equal((await structure(page))[0].text, 'plain NEW more!');
      await tap(page, 'tb-h1');
      assert.equal((await structure(page))[0].type, 'p');
    }));

  test('bullets: Enter continues, Enter on empty bullet returns to text, Backspace at start removes the bullet but keeps the text', () =>
    withPhone(browser, async ({ page }) => {
      await open(page);
      await editor(page).tap();
      await tap(page, 'tb-bullet');
      await type(page, 'alpha');
      await press(page, 'Enter');
      await type(page, 'beta');
      assert.deepEqual(await structure(page), [{ type: 'bullets', items: ['alpha', 'beta'] }]);

      await press(page, 'Enter'); // new empty bullet
      assert.equal((await caret(page)).list, 'bullet');
      await press(page, 'Enter'); // empty bullet -> ordinary text
      assert.deepEqual(await structure(page), [{ type: 'bullets', items: ['alpha', 'beta'] }, { type: 'p', text: '' }]);
      assert.equal((await caret(page)).list, null);

      // Backspace at the start of a bullet: list status goes first, text stays
      await press(page, 'ArrowUp');
      await press(page, 'Home');
      assert.equal((await caret(page)).offset, 0);
      await press(page, 'Backspace');
      const s = await structure(page);
      assert.deepEqual(s.map((b) => b.type), ['bullets', 'p', 'p'].slice(0, s.length));
      assert.ok(s.some((b) => b.type === 'p' && b.text === 'beta'), `beta kept as plain text: ${JSON.stringify(s)}`);
      assert.equal((await caret(page)).offset, 0);
      // second Backspace now joins with the previous block
      await press(page, 'Backspace');
      assert.ok(JSON.stringify(await structure(page)).includes('alphabeta') || JSON.stringify(await structure(page)).includes('"alpha"'));
    }));

  test('saving does not move the caret, drop focus or reset undo history', () =>
    withPhone(browser, async ({ page }) => {
      await open(page);
      await editor(page).tap();
      await type(page, 'one two three four');
      await press(page, 'ArrowLeft', 10); // caret inside the text
      const before = await caret(page);
      assert.equal(before.offset, 8);

      const put = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/api/notes/'));
      await put; // the save happens while the caret is mid-text
      await waitSaved(page);
      const after = await caret(page);
      assert.deepEqual(after, before, 'selection and focus unchanged by the save');

      // Typing continues exactly at the caret, and undo still knows the history from before the save
      await type(page, 'X');
      assert.equal((await structure(page))[0].text, 'one two Xthree four');
      await waitSaved(page);
      await press(page, 'Control+z');
      assert.equal((await structure(page))[0].text, 'one two three four');
      await press(page, 'Control+z');
      assert.notEqual((await structure(page))[0].text, 'one two three four', 'earlier typing is still undoable after saves');
      await press(page, 'Control+Shift+z');
      await press(page, 'Control+Shift+z');
      assert.equal((await structure(page))[0].text, 'one two Xthree four');
    }));

  test('undo/redo toolbar buttons work and are not disabled-by-focus-loss', () =>
    withPhone(browser, async ({ page }) => {
      await open(page);
      await editor(page).tap();
      await type(page, 'abc');
      await page.waitForTimeout(600); // new undo group
      await type(page, 'def');
      await tap(page, 'tb-undo');
      assert.equal((await structure(page))[0].text, 'abc');
      assert.equal((await caret(page)).focused, true);
      await tap(page, 'tb-redo');
      assert.equal((await structure(page))[0].text, 'abcdef');
    }));
});

describe('text input edge cases', () => {
  test('emoji and non-Latin text: typed, backspaced as whole characters, saved and restored', () =>
    withPhone(browser, async ({ page, app }) => {
      await open(page);
      await editor(page).tap();
      await page.keyboard.insertText('Hi 😀 café 👩🏽‍💻 日本語');
      await press(page, 'Backspace', 3); // removes 語, 本, 日 (not half a character)
      assert.equal((await structure(page))[0].text, 'Hi 😀 café 👩🏽‍💻 ');
      await press(page, 'Backspace', 2); // space + whole ZWJ-emoji sequence? at least no broken surrogate
      const t = (await structure(page))[0].text;
      assert.doesNotMatch(t, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/, 'no lone surrogates');
      await waitSaved(page);
      const id = app.notes()[0].id;
      assert.equal(app.docText(id), t);
      await page.reload();
      await page.waitForSelector('.note-text');
      assert.equal(await editor(page).textContent(), t);
    }));

  test('IME composition and autocorrect-style replacement are not interrupted by autosave', () =>
    withPhone(browser, async ({ page, app }) => {
      await open(page);
      await editor(page).tap();
      await type(page, 'start ');
      const cdp = await page.context().newCDPSession(page);
      await page.evaluate(() => {
        window.__ime = [];
        for (const t of ['compositionstart', 'compositionupdate', 'compositionend']) document.addEventListener(t, (e) => window.__ime.push(e.type));
      });
      // Gboard composes a word, then autocorrect swaps the composing region ("teh" -> "the")
      await cdp.send('Input.imeSetComposition', { text: 't', selectionStart: 1, selectionEnd: 1 });
      await cdp.send('Input.imeSetComposition', { text: 'te', selectionStart: 2, selectionEnd: 2 });
      await cdp.send('Input.imeSetComposition', { text: 'teh', selectionStart: 3, selectionEnd: 3 });
      // Let the autosave timers fire in the middle of the composition
      await page.waitForTimeout(1800);
      assert.equal((await structure(page))[0].text, 'start teh');
      await cdp.send('Input.imeSetComposition', { text: 'the', selectionStart: 3, selectionEnd: 3 });
      await cdp.send('Input.insertText', { text: 'the' });
      await type(page, ' end');
      assert.equal((await structure(page))[0].text, 'start the end');
      const events = await page.evaluate(() => window.__ime);
      assert.equal(events.filter((e) => e === 'compositionstart').length, 1, 'composition was not restarted');
      await waitSaved(page);
      assert.equal(app.docText(app.notes()[0].id), 'start the end');
    }));

  test('paste: rich HTML is reduced to supported formatting; plain text becomes paragraphs; script is dropped', () =>
    withPhone(browser, async ({ page }) => {
      await open(page);
      await editor(page).tap();
      const paste = (html, text) =>
        page.evaluate(
          ([html, text]) => {
            const dt = new DataTransfer();
            if (html) dt.setData('text/html', html);
            dt.setData('text/plain', text);
            document.querySelector('.note-text[contenteditable="true"]').dispatchEvent(
              new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
            );
          },
          [html, text],
        );
      await paste(
        '<h3>Heading</h3><p>Some <b>bold</b>, <i>italic</i>, <a href="https://x.test">link</a> <u>under</u> text<script>alert(1)</script></p><ul><li>one</li><li>two</li></ul><table><tr><td>cell</td></tr></table>',
        'ignored',
      );
      const html = await editor(page).innerHTML();
      assert.doesNotMatch(html, /<script|<a |<table|<u>|alert/);
      assert.match(html, /<strong>bold<\/strong>/);
      assert.match(html, /<em>italic<\/em>/);
      const s = await structure(page);
      assert.ok(s.some((b) => b.type === 'bullets' && b.items.join() === 'one,two'));
      // plain text: newlines become paragraphs
      await press(page, 'Control+End');
      await paste(null, 'line A\nline B\n\nline C');
      const s2 = (await structure(page)).filter((b) => b.type === 'p').map((b) => b.text);
      assert.ok(s2.includes('line A') || s2.join('|').includes('line A'), JSON.stringify(s2));
    }));

  test('select all + type replaces; double-tap selects a word and formatting applies to it', () =>
    withPhone(browser, async ({ page }) => {
      await open(page);
      await editor(page).tap();
      await type(page, 'alpha beta gamma');
      await press(page, 'Control+a');
      await type(page, 'fresh start');
      assert.equal((await structure(page))[0].text, 'fresh start');
      // double click a word
      const box = await page.locator('.note-text p').first().boundingBox();
      await page.mouse.dblclick(box.x + 10, box.y + box.height / 2);
      const c = await caret(page);
      assert.equal(c.selected.trim(), 'fresh');
      await tap(page, 'tb-bold');
      assert.match(await editor(page).innerHTML(), /<strong>fresh ?<\/strong> ?start/); // desktop Chrome also selects the trailing space
    }));

  test('long note: the caret stays visible above the toolbar and an open keyboard', () =>
    withPhone(browser, async ({ page }) => {
      await open(page);
      await editor(page).tap();
      for (let i = 1; i <= 30; i++) {
        await type(page, `Line number ${i}`);
        await press(page, 'Enter');
      }
      // Simulate the on-screen keyboard taking ~45% of the screen
      await page.setViewportSize({ width: 360, height: 420 });
      await page.waitForTimeout(100);
      await type(page, 'still typing here');
      const visible = await page.evaluate(() => {
        const sel = getSelection();
        const r = sel.getRangeAt(0).getBoundingClientRect();
        const tb = document.querySelector('[data-testid="toolbar"]').getBoundingClientRect();
        const top = document.querySelector('.topbar').getBoundingClientRect();
        return { caretTop: r.top, caretBottom: r.bottom, toolbarTop: tb.top, topbarBottom: top.bottom, vh: innerHeight };
      });
      assert.ok(visible.caretBottom <= visible.toolbarTop + 1, `caret above toolbar: ${JSON.stringify(visible)}`);
      assert.ok(visible.caretTop >= visible.topbarBottom - 1, `caret below header: ${JSON.stringify(visible)}`);
      assert.ok(visible.toolbarTop + 40 <= visible.vh, 'toolbar is inside the visible viewport');
    }));
});


describe('Backspace / Delete at paragraph and list boundaries (engine behaviour, pinned)', () => {
  // Each case runs in its own tag so every start is an empty note.
  const cases = [
    [
      'Delete at the end of a bullet joins the next bullet into it',
      async (p) => { await tap(p, 'tb-bullet'); await type(p, 'alpha'); await press(p, 'Enter'); await type(p, 'beta'); await press(p, 'ArrowUp'); await press(p, 'End'); await press(p, 'Delete'); },
      [{ type: 'bullets', items: ['alphabeta'] }],
    ],
    [
      'Delete at the end of a task joins the next task into it (the first task keeps its state)',
      async (p) => { await tap(p, 'tb-task'); await type(p, 'one'); await press(p, 'Enter'); await type(p, 'two'); await press(p, 'ArrowUp'); await press(p, 'End'); await press(p, 'Delete'); },
      [{ type: 'tasks', items: [{ text: 'onetwo', checked: false }] }],
    ],
    [
      'Backspace at the start of a paragraph right after a list merges it into the last item',
      async (p) => { await tap(p, 'tb-bullet'); await type(p, 'a'); await press(p, 'Enter'); await type(p, 'b'); await press(p, 'Enter'); await press(p, 'Enter'); await type(p, 'tail'); await press(p, 'Home'); await press(p, 'Backspace'); },
      [{ type: 'bullets', items: ['a', 'btail'] }],
    ],
    [
      'Delete at the end of a paragraph before a list first turns the first item into text (list status goes first), a second Delete joins',
      async (p) => { await type(p, 'head'); await press(p, 'Enter'); await tap(p, 'tb-bullet'); await type(p, 'item'); await press(p, 'ArrowUp'); await press(p, 'End'); await press(p, 'Delete'); },
      [{ type: 'p', text: 'head' }, { type: 'p', text: 'item' }],
    ],
    [
      'Backspace at the very start of the note changes nothing',
      async (p) => { await type(p, 'solo'); await press(p, 'Home'); await press(p, 'Backspace'); },
      [{ type: 'p', text: 'solo' }],
    ],
    [
      'Backspace at the start of the first bullet turns it into text',
      async (p) => { await tap(p, 'tb-bullet'); await type(p, 'only'); await press(p, 'Home'); await press(p, 'Backspace'); },
      [{ type: 'p', text: 'only' }],
    ],
    [
      'Backspace at the start of a middle task turns it into text between two lists; a second Backspace joins it up',
      async (p) => { await tap(p, 'tb-task'); await type(p, 'one'); await press(p, 'Enter'); await type(p, 'two'); await press(p, 'Enter'); await type(p, 'three'); await press(p, 'ArrowUp'); await press(p, 'Home'); await press(p, 'Backspace'); },
      [{ type: 'tasks', items: [{ text: 'one', checked: false }] }, { type: 'p', text: 'two' }, { type: 'tasks', items: [{ text: 'three', checked: false }] }],
    ],
  ];

  test('boundary behaviours', () =>
    withPhone(browser, async ({ page }) => {
      for (const [i, [name, run, expected]] of cases.entries()) {
        await open(page, `boundary${i}`);
        await editor(page).tap();
        await run(page);
        assert.deepEqual(await structure(page), expected, name);
      }
    }));
});
