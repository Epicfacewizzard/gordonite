import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { launch, withPhone, open, editor, waitSaved, tap, structure, caret, seedNote, paragraphDoc } from './harness.js';
import { addDays } from '../../shared/dates.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

const type = (page, text) => page.keyboard.type(text);
const press = async (page, key, n = 1) => {
  for (let i = 0; i < n; i++) await page.keyboard.press(key);
  await page.waitForTimeout(40);
};
const TODAY = '2026-10-05'; // fixed by the clock in tests that need it
const closeSheet = (page) => page.getByRole('button', { name: 'Close' }).tap();

describe('stage 3: tags and daily streams', () => {
  test('home lists tags; opening a tag shows today as an editable entry and creates nothing', () =>
    withPhone(browser, async ({ page, app }) => {
      await seedNote(app, { tags: ['daily-jots'], date: '2026-10-01', doc: paragraphDoc('older') });
      await seedNote(app, { tags: ['school/fall26'], date: '2026-10-02', doc: paragraphDoc('class notes') });
      await page.goto(`${app.url}/#/tags`);
      await page.waitForSelector('[data-testid="tag-list"] a');
      const names = await page.locator('[data-testid="tag-link"] .tag-name').allTextContents();
      assert.deepEqual(names, ['daily-jots', 'school/fall26']);
      await page.locator('[data-testid="tag-link"]', { hasText: 'school/fall26' }).tap();
      await page.waitForSelector('[data-testid="stream"]');
      assert.equal(await page.getByTestId('title').textContent(), 'school/fall26');
      assert.equal(await editor(page).count(), 1, "today's entry is editable");
      assert.equal(await editor(page).textContent(), '');
      await page.waitForTimeout(1200);
      assert.equal(app.notes().length, 2, 'nothing created by opening');
    }));

  test('exact-tag streams: a parent tag does not include child tags', () =>
    withPhone(browser, async ({ page, app }) => {
      await seedNote(app, { tags: ['school'], date: '2026-10-01', doc: paragraphDoc('parent only') });
      await seedNote(app, { tags: ['school/fall26'], date: '2026-10-02', doc: paragraphDoc('child only') });
      await open(page, 'school');
      const text = await page.locator('.stream').innerText();
      assert.match(text, /parent only/);
      assert.doesNotMatch(text, /child only/);
    }));

  test('a note with several tags is one page: edit through either tag', () =>
    withPhone(browser, async ({ page, app }) => {
      await open(page, 'daily-jots');
      await editor(page).tap();
      await type(page, 'shared page');
      await waitSaved(page);

      await tap(page, 'note-menu');
      await tap(page, 'menu-tags');
      await page.getByTestId('add-tag-input').fill('School/Fall26');
      await tap(page, 'add-tag-button');
      await page.waitForSelector('[data-testid="note-tags"] >> text=school/fall26');
      await closeSheet(page);

      await page.goto(`${app.url}/#/t/school/fall26`);
      await page.waitForSelector('[data-testid="stream"][data-tag="school/fall26"]');
      assert.match(await page.locator('.note-text').first().innerText(), /shared page/);
      assert.equal(app.notes().length, 1);

      await editor(page).tap();
      await press(page, 'Control+End');
      await type(page, ' + edited via school');
      await waitSaved(page);
      assert.equal(app.notes().length, 1, 'still the same page');
      assert.equal(app.docText(app.notes()[0].id), 'shared page + edited via school');

      await page.goto(`${app.url}/#/t/daily-jots`);
      await page.reload();
      await page.waitForSelector('.note-text');
      assert.match(await page.locator('.note-text').first().innerText(), /shared page \+ edited via school/);
      // The other tag shows as a chip on the note
      assert.match(await page.locator('.chips.small').innerText(), /school\/fall26/);
    }));

  test('tags: cannot remove the last tag; a clash with another note that day is explained', () =>
    withPhone(browser, async ({ page, app }) => {
      await seedNote(app, { tags: ['b-tag'], date: '2026-10-05', doc: paragraphDoc('b today') });
      await open(page, 'a-tag');
      await editor(page).tap();
      await type(page, 'a today');
      await waitSaved(page);
      await tap(page, 'note-menu');
      await tap(page, 'menu-tags');
      assert.equal(await page.locator('[data-testid="note-tags"] button').count(), 0, 'no remove button on the only tag');
      await page.getByTestId('add-tag-input').fill('b-tag');
      await tap(page, 'add-tag-button');
      await page.waitForSelector('.error[role="alert"]');
      assert.match(await page.locator('.error[role="alert"]').innerText(), /already has a note/);
    }));

  test('long stream: only one editor is mounted; tapping an older note moves the editor there', () =>
    withPhone(browser, async ({ page, app }) => {
      for (let i = 1; i <= 30; i++) {
        await seedNote(app, { date: addDays('2026-09-30', -i), doc: paragraphDoc(`entry ${i}`, 'second paragraph') });
      }
      await page.goto(`${app.url}/#/t/daily-jots`);
      await page.waitForSelector('.note-text[contenteditable="true"]');
      await page.waitForSelector('[data-testid="load-older"]');
      assert.equal(await page.locator('[data-testid="note"]').count(), 15, "today's entry + first page of 14");
      assert.equal(await page.locator('.ProseMirror').count(), 1, 'a single live editor, not one per note');

      await page.locator('[data-testid="note-static"]', { hasText: 'entry 3' }).first().locator('p').first().tap();
      await page.waitForFunction(() => document.querySelector('[data-note-id][data-active="true"] .ProseMirror')?.textContent.includes('entry 3'));
      assert.equal(await page.locator('.ProseMirror').count(), 1);
      await page.waitForFunction(() => document.activeElement?.classList.contains('note-text'));
      assert.equal((await caret(page)).focused, true, 'tapping focuses the note');
      await page.waitForTimeout(400); // ProseMirror ignores selection changes right after placing the caret; people are slower than that
      assert.equal((await caret(page)).offset, 'entry 3'.length, 'caret lands where the finger tapped');
      await press(page, 'Control+Home');
      await type(page, 'EDITED ');
      await waitSaved(page);
      const notes = app.notes();
      assert.equal(notes.length, 30, "today's empty entry was not saved");
      assert.ok(notes.some((n) => app.docText(n.id).startsWith('EDITED entry 3')));

      await tap(page, 'load-older');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="note"]').length === 29);
      assert.equal(await page.locator('.ProseMirror').count(), 1);
    }));

  test('tapping a checkbox in a past note toggles it in place (through the editor, so it is undoable)', () =>
    withPhone(browser, async ({ page, app }) => {
      const doc = {
        type: 'doc',
        content: [{ type: 'taskList', content: ['a', 'b', 'c'].map((t, i) => ({ type: 'taskItem', attrs: { checked: false, id: `00000000-0000-4000-8000-00000000000${i}` }, content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })) }],
      };
      await seedNote(app, { date: '2026-10-01', doc });
      await open(page);
      await page.locator('[data-testid="note-static"] input[type="checkbox"]').nth(1).tap();
      await page.waitForFunction(() => document.querySelectorAll('.ProseMirror li[data-checked="true"]').length === 0 || true);
      await page.waitForSelector('[data-active="true"] .ProseMirror li[data-checked="true"]');
      const items = (await page.locator('[data-active="true"] .ProseMirror li').evaluateAll((l) => l.map((x) => [x.textContent.replace(/Task item checkbox.*?(?=[a-c]$)/, ''), x.dataset.checked])));
      assert.deepEqual(items.map((i) => i[1]), ['false', 'true', 'false'], 'only the tapped task toggled, order unchanged');
      await waitSaved(page);
      assert.equal(JSON.parse(app.notes()[0].doc).content[0].content[1].attrs.checked, true);
      await tap(page, 'tb-undo');
      assert.equal(await page.locator('[data-active="true"] .ProseMirror li[data-checked="true"]').count(), 0);
    }));
});

describe('crossing midnight', () => {
  // 23:55 on Oct 4 in America/Edmonton
  const AT = new Date('2026-10-05T05:55:00Z');

  test('writing is not moved or interrupted; the new day is offered, not forced', () =>
    withPhone(
      browser,
      async ({ page, app }) => {
        await open(page);
        assert.match(await page.locator('.note-date').first().innerText(), /Today/);
        assert.equal(await page.locator('[data-testid="note"]').first().getAttribute('data-date'), '2026-10-04');
        await editor(page).tap();
        await type(page, 'late night thought');
        await press(page, 'ArrowLeft', 8);
        const before = await caret(page);
        await waitSaved(page);

        await page.clock.fastForward(6 * 60 * 1000); // now 00:01 on Oct 5
        await page.waitForSelector('[data-testid="new-day"]');
        const after = await caret(page);
        assert.deepEqual(after, before, 'cursor and focus untouched by the date change');
        assert.equal(await page.locator('[data-testid="note"]').count(), 1, 'no card was inserted above the one being written');

        await type(page, ' really'); // still the same note, still dated Oct 4
        await waitSaved(page);
        const notes = app.notes();
        assert.equal(notes.length, 1);
        assert.equal(notes[0].note_date, '2026-10-04');
        assert.equal(app.docText(notes[0].id), 'late night really thought');
        assert.match(await page.locator('.note-date').first().innerText(), /Yesterday/);

        await page.getByTestId('new-day').tap();
        await page.waitForFunction(() => document.querySelectorAll('[data-testid="note"]').length === 2);
        assert.equal(await page.locator('[data-testid="note"]').first().getAttribute('data-date'), '2026-10-05');
        await page.waitForFunction(() => document.activeElement?.classList.contains('note-text'));
        assert.equal((await caret(page)).focused, true);
        await type(page, 'fresh day');
        await waitSaved(page);
        const all = app.notes();
        assert.deepEqual(all.map((n) => n.note_date), ['2026-10-04', '2026-10-05']);
        assert.equal(app.docText(all[1].id), 'fresh day');
        assert.equal(app.docText(all[0].id), 'late night really thought', 'yesterday untouched by today');
      },
      { clockTime: AT },
    ));

  test('when nothing is being typed, the new day simply appears', () =>
    withPhone(
      browser,
      async ({ page }) => {
        await open(page);
        assert.equal(await page.locator('[data-testid="note"]').first().getAttribute('data-date'), '2026-10-04');
        await page.clock.fastForward(6 * 60 * 1000);
        await page.waitForFunction(() => document.querySelector('[data-testid="note"]')?.dataset.date === '2026-10-05');
        assert.equal(await page.getByTestId('new-day').count(), 0);
      },
      { clockTime: AT },
    ));
});

describe('trash and history through the UI', () => {
  test('delete moves a note to the trash; restore brings it back with its text', () =>
    withPhone(browser, async ({ page, app }) => {
      await open(page);
      await editor(page).tap();
      await type(page, 'delete me then restore me');
      await waitSaved(page);
      await tap(page, 'note-menu');
      await tap(page, 'menu-delete');
      await tap(page, 'confirm-delete');
      await page.waitForFunction(() => !document.querySelector('.sheet'));
      assert.equal(app.notes()[0].deleted_at !== null, true);
      assert.equal(await editor(page).textContent(), '', 'stream shows a fresh empty entry for today');

      await page.goto(`${app.url}/#/trash`);
      await page.waitForSelector('[data-testid="trash-list"] li');
      assert.match(await page.locator('[data-testid="trash-list"]').innerText(), /Show text/);
      await tap(page, 'restore-note');
      await page.waitForFunction(() => !document.querySelector('[data-testid="trash-list"] li'));
      await open(page);
      assert.match(await editor(page).textContent(), /delete me then restore me/);
      assert.equal(app.notes().length, 1);
    }));

  test('history: a cleared note can be recovered from its versions', () =>
    withPhone(browser, async ({ page, app }) => {
      await open(page);
      await editor(page).tap();
      await type(page, 'Important paragraph that must not be lost when I clear this note.');
      await waitSaved(page);
      await press(page, 'Control+a');
      await press(page, 'Backspace');
      await waitSaved(page);
      assert.equal(app.notes().length, 1, 'clearing does not delete the note');
      assert.equal(app.docText(app.notes()[0].id), '');

      await tap(page, 'note-menu');
      await tap(page, 'menu-history');
      await page.waitForSelector('[data-testid="version-list"] button');
      assert.match(await page.locator('[data-testid="version-list"]').innerText(), /Important paragraph/);
      await page.locator('[data-testid="version-list"] button').first().tap();
      await tap(page, 'restore-version');
      await page.waitForFunction(() => !document.querySelector('.sheet'));
      await page.waitForFunction(() => document.querySelector('.ProseMirror')?.textContent.includes('Important paragraph'));
      assert.match(app.docText(app.notes()[0].id), /Important paragraph/);
    }));
});
