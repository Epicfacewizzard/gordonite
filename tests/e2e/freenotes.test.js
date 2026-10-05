import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { launch, withPhone, waitSaved, tap } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

const noteEditor = (page) => page.locator('[data-testid="note-page"] .note-text[contenteditable="true"]');
const tagsOf = (app, noteId) =>
  app.db
    .prepare('SELECT t.path FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ? ORDER BY t.path')
    .all(noteId)
    .map((r) => r.path);
const freeNotes = (app) => app.notes().filter((n) => n.kind === 'note');
// A brand-new note puts the cursor in its name field a moment after it appears; wait for that before typing.
const nameFocused = (page) => page.waitForFunction(() => document.activeElement?.dataset.testid === 'note-title');
const addTag = async (page, path) => {
  await page.getByTestId('add-tag-input').fill(path);
  await page.getByTestId('add-tag-button').tap();
};

describe('free notes: add a note, then tag it', () => {
  test('new note -> tags and sub-tags before and after saving -> found in the Notes list and in the tag stream', () =>
    withPhone(browser, async ({ page, app }) => {
      await page.goto(`${app.url}/#/`);
      await page.getByTestId('today-new-note').tap();
      await page.waitForSelector('[data-testid="note-page"]');
      assert.match(await page.evaluate(() => location.hash), /^#\/n\/[\w-]+$/);
      await noteEditor(page).waitFor();
      assert.equal(app.notes().length, 0, 'opening a new note creates nothing on the server');
      assert.match(await page.getByTestId('tag-editor').innerText(), /No tags yet/);

      // Tags can be added before anything is written (kept on the phone until the first save)...
      await addTag(page, 'ideas');
      await page.getByTestId('sub-tag').first().tap();
      assert.equal(await page.getByTestId('add-tag-input').inputValue(), 'ideas/', 'the + button starts a sub-tag');
      await page.getByTestId('add-tag-input').fill('ideas/apps');
      await page.getByTestId('add-tag-button').tap();
      assert.deepEqual(await page.getByTestId('note-tag').allInnerTexts().then((a) => a.map((t) => t.replace(/[+×\s]+$/g, '').trim())), ['ideas', 'ideas/apps']);
      assert.equal(app.notes().length, 0, 'still nothing on the server');

      // ...and the first keystroke creates the note WITH them.
      await noteEditor(page).tap();
      await page.keyboard.type('App idea');
      await waitSaved(page);
      const [note] = freeNotes(app);
      assert.ok(note, 'created as a free note');
      assert.equal(app.notes().length, 1);
      assert.deepEqual(tagsOf(app, note.id), ['ideas', 'ideas/apps']);

      // After saving, tags change on the server straight away; a free note may lose all its tags.
      await addTag(page, 'later/maybe');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="note-tag"]').length === 3);
      assert.deepEqual(tagsOf(app, note.id), ['ideas', 'ideas/apps', 'later/maybe']);
      await page.locator('[data-testid="note-tag"]', { hasText: 'later/maybe' }).getByTestId('remove-tag').tap();
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="note-tag"]').length === 2);
      assert.deepEqual(tagsOf(app, note.id), ['ideas', 'ideas/apps']);

      // The Notes page: listed with its title and tags, searchable, filterable by tag and by sub-tag.
      await page.goto(`${app.url}/#/notes`);
      await page.getByTestId('note-row').first().waitFor();
      assert.match(await page.getByTestId('note-row').first().innerText(), /App idea[\s\S]*ideas, ideas\/apps/);
      await page.getByTestId('notes-tag-filter').selectOption('ideas/apps');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="note-row"]').length === 1);
      await page.getByTestId('notes-tag-filter').selectOption('');
      await page.getByTestId('notes-search').fill('zzzz');
      await page.getByTestId('notes-empty').waitFor();
      await page.getByTestId('notes-search').fill('APP');
      await page.getByTestId('note-row').first().waitFor();
      await page.getByTestId('note-row').first().tap();
      await page.waitForSelector('[data-testid="note-page"]');
      assert.equal(await noteEditor(page).textContent(), 'App idea');

      // Two notes under one tag on the same day: "New note in this tag" from the stream.
      await page.goto(`${app.url}/#/t/ideas`);
      await page.waitForSelector('[data-testid="stream"]');
      await page.getByTestId('new-note-here').tap();
      await page.waitForSelector('[data-testid="note-page"]');
      await noteEditor(page).waitFor();
      assert.match(await page.getByTestId('tag-editor').innerText(), /ideas/, 'pre-tagged with the stream it started from');
      await noteEditor(page).tap();
      await page.keyboard.type('Book idea');
      await waitSaved(page);
      assert.equal(freeNotes(app).length, 2);

      await page.goto(`${app.url}/#/t/ideas`);
      await page.waitForSelector('[data-testid="stream"] [data-testid="note"]');
      const texts = await page.locator('[data-testid="stream"] [data-testid="note"]').allInnerTexts();
      assert.equal(texts.filter((t) => /App idea|Book idea/.test(t)).length, 2, 'both notes are in the stream, same day');
      assert.equal(await page.locator('.note-kind').count(), 2, 'free notes are marked "note"');
      assert.deepEqual(page.errors, []);
    }));

  test('an untagged note is found under "No tag", and tagging it later moves it out', () =>
    withPhone(browser, async ({ page, app }) => {
      await page.goto(`${app.url}/#/new`);
      await page.waitForSelector('[data-testid="note-page"]');
      await noteEditor(page).tap();
      await page.keyboard.type('Loose thought');
      await waitSaved(page);
      assert.equal(freeNotes(app).length, 1);
      assert.deepEqual(tagsOf(app, freeNotes(app)[0].id), []);

      await page.goto(`${app.url}/#/notes`);
      await page.getByTestId('notes-tag-filter').selectOption('__untagged');
      await page.getByTestId('note-row').first().waitFor();
      assert.match(await page.getByTestId('note-row').first().innerText(), /Loose thought[\s\S]*no tag/);

      await page.getByTestId('note-row').first().tap();
      await page.waitForSelector('[data-testid="note-page"]');
      await addTag(page, 'journal');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="note-tag"]').length === 1);
      assert.deepEqual(tagsOf(app, freeNotes(app)[0].id), ['journal']);
      assert.deepEqual(page.errors, []);
    }));
});

describe('names, the daily switch and the tag trail', () => {
  test('a new note asks for its name first; the name is saved with the note, shows in the stream and the list, and can be changed or cleared', () =>
    withPhone(browser, async ({ page, app }) => {
      await page.goto(`${app.url}/#/new?tag=trips`);
      await page.waitForSelector('[data-testid="note-page"]');
      await page.getByTestId('note-title').waitFor();
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), 'note-title', 'the name field has the cursor');
      assert.equal(await page.getByTestId('note-title').getAttribute('placeholder'), 'Untitled');

      await page.keyboard.type('Trip to China');
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('note-text')), true, 'Enter moves on to the text');
      await page.keyboard.type('Pack warm clothes');
      await waitSaved(page);
      const [note] = freeNotes(app);
      assert.equal(note.title, 'Trip to China');
      assert.deepEqual(tagsOf(app, note.id), ['trips']);

      // a name alone is enough to create a note
      await page.goto(`${app.url}/#/new`);
      await nameFocused(page);
      await page.keyboard.type('Only a name');
      await waitSaved(page);
      assert.equal(freeNotes(app).length, 2);

      // it survives a reload, and shows in the stream and in the Notes list
      await page.goto(`${app.url}/#/n/${note.id}`);
      await page.getByTestId('note-title').waitFor();
      assert.equal(await page.getByTestId('note-title').inputValue(), 'Trip to China');
      await page.goto(`${app.url}/#/t/trips`);
      await page.waitForSelector('[data-testid="stream"] [data-testid="note"]');
      assert.equal(await page.getByTestId('open-note').first().innerText(), 'Trip to China');
      await page.goto(`${app.url}/#/notes`);
      await page.getByTestId('note-row').first().waitFor();
      assert.match((await page.getByTestId('note-row').allInnerTexts()).join('|'), /Trip to China/);
      await page.getByTestId('notes-search').fill('china');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="note-row"]').length === 1);

      // rename, then clear: back to untitled
      await page.goto(`${app.url}/#/n/${note.id}`);
      await page.getByTestId('note-title').fill('China, 2027');
      await waitSaved(page);
      assert.equal(app.notes().find((n) => n.id === note.id).title, 'China, 2027');
      await page.getByTestId('note-title').fill('');
      await waitSaved(page);
      assert.equal(app.notes().find((n) => n.id === note.id).title, null);
      await page.goto(`${app.url}/#/t/trips`);
      await page.waitForSelector('[data-testid="stream"] [data-testid="note"]');
      assert.equal(await page.getByTestId('open-note').first().innerText(), 'Untitled');
      assert.deepEqual(page.errors, []);
    }));

  test('daily entries have no name field: they are named by their date', () =>
    withPhone(browser, async ({ page, app }) => {
      await page.goto(`${app.url}/#/t/daily-jots`);
      await page.waitForSelector('.note-text[contenteditable="true"]');
      await page.locator('.note-text[contenteditable="true"]').tap();
      await page.keyboard.type('today I did things');
      await waitSaved(page);
      const id = app.notes()[0].id;
      await page.goto(`${app.url}/#/n/${id}`);
      await page.waitForSelector('[data-testid="note-page"]');
      assert.equal(await page.getByTestId('note-title').count(), 0);
    }));

  test('a tag can turn its daily entry off (a topic you only write notes in) and back on', () =>
    withPhone(browser, async ({ page, app }) => {
      // A tag first made by writing a free note starts with no daily entry.
      await page.goto(`${app.url}/#/new?tag=trip/china`);
      await nameFocused(page);
      await page.keyboard.type('Visa');
      await waitSaved(page);

      await page.goto(`${app.url}/#/t/trip/china`);
      await page.waitForSelector('[data-testid="stream"] [data-testid="note"]');
      assert.equal(await page.locator('[data-testid="stream"] .note-text[contenteditable="true"]').count(), 0, 'no editor waiting for today');
      assert.equal(await page.getByTestId('daily-toggle').isChecked(), false);
      assert.equal(await page.getByTestId('new-note-here').count(), 1, 'new note is offered');

      // Turn it on: today's entry appears, and it stays on after a reload.
      await page.getByTestId('daily-toggle').check();
      await page.waitForSelector('[data-testid="stream"] .note-text[contenteditable="true"]');
      await page.reload();
      await page.waitForSelector('[data-testid="stream"] [data-testid="note"]');
      assert.equal(await page.getByTestId('daily-toggle').isChecked(), true);
      assert.equal(await page.locator('[data-testid="stream"] .note-text[contenteditable="true"]').count(), 1);

      // A tag that has never been used is an ordinary daily stream; a tag with no notes at all can be switched off.
      await page.goto(`${app.url}/#/t/brand-new`);
      await page.waitForSelector('[data-testid="stream"] .note-text[contenteditable="true"]');
      await page.getByTestId('daily-toggle').uncheck();
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="stream"] .note-text[contenteditable="true"]').length === 0);
      await page.getByTestId('no-notes').waitFor();
      assert.equal(app.notes().length, 1, 'switching it creates no note');
      assert.deepEqual(page.errors, []);
    }));

  test('the tag name in the header is a trail: tap a parent to go up to it', () =>
    withPhone(browser, async ({ page, app }) => {
      await page.goto(`${app.url}/#/t/school/fall26/math`);
      await page.waitForSelector('[data-testid="stream"]');
      assert.equal(await page.getByTestId('title').innerText(), 'school/fall26/math');
      assert.deepEqual(await page.getByTestId('crumb').allInnerTexts(), ['school', 'fall26'], 'the last part is where you are, not a link');
      await page.getByTestId('crumb').nth(1).tap();
      await page.waitForFunction(() => location.hash === '#/t/school/fall26' && document.querySelector('[data-testid="title"]')?.innerText === 'school/fall26');
      await page.getByTestId('crumb').first().tap();
      await page.waitForFunction(() => location.hash === '#/t/school');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="crumb"]').length === 0); // a top-level tag has nothing above it
      assert.equal(await page.getByTestId('title').innerText(), 'school');
    }));
});
