// 0.19.0: suggestions under the journal entry. Built-in rules, no AI; nothing changes until one is tapped.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { uuid } from '../../shared/ids.js';
import { dateInTz, addDays } from '../../shared/dates.js';
import { launch, TZ, withPhone, waitSaved, paragraphDoc } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

const today = () => dateInTz(new Date(), TZ);
const todayNote = (page) => page.locator('[data-testid="widget-note"] .note-text[contenteditable="true"]');
const journalDoc = (app) => {
  const note = app.notes().find((n) => n.kind === 'daily' && n.note_date === today());
  return note ? JSON.parse(note.doc) : null;
};
const seedPerson = async (app, title) => {
  const r = await app.api('PUT', `/api/notes/${uuid()}`, { baseRevision: 0, kind: 'note', title, doc: paragraphDoc('A person.'), docFormat: 1, tags: ['05-people'], date: today(), opId: uuid() });
  assert.equal(r.status, 200, JSON.stringify(r.json));
};

describe('suggestions', () => {
  test('a line that reads like something to do offers Make this a task; one tap makes it a task with its date; nothing changed before', () =>
    withPhone(browser, async ({ page, app }) => {
      await page.goto(`${app.url}/#/`);
      await todayNote(page).waitFor();
      await todayNote(page).click();
      await page.keyboard.type('Slow morning.');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Need to send the budget by Friday');
      const row = page.getByTestId('suggestion');
      await row.waitFor();
      assert.match(await row.innerText(), /send the budget/);
      assert.equal(await row.getByTestId('suggestion-task').innerText(), 'Make this a task');
      await waitSaved(page);
      assert.deepEqual(journalDoc(app).content.map((n) => n.type), ['paragraph', 'paragraph'], 'still plain writing until tapped');

      await row.getByTestId('suggestion-task').tap();
      await page.getByTestId('suggestion').waitFor({ state: 'detached' });
      await waitSaved(page);
      const stored = journalDoc(app);
      assert.deepEqual(stored.content.map((n) => n.type), ['paragraph', 'taskList']);
      const attrs = stored.content[1].content[0].attrs;
      assert.equal(stored.content[1].content[0].content[0].content[0].text, 'Need to send the budget by Friday');
      assert.match(attrs.due, /^\d{4}-\d{2}-\d{2}$/, 'the date written in the line is carried');
      assert.ok(attrs.due > today() && attrs.due <= addDays(today(), 7));
      assert.equal(attrs.checked, false);
    }));

  test('a dismissed suggestion stays dismissed for that line, also after the page is reloaded', () =>
    withPhone(browser, async ({ page, app }) => {
      await page.goto(`${app.url}/#/`);
      await todayNote(page).click();
      await page.keyboard.type('Have to call the printer');
      await page.getByTestId('suggestion').waitFor();
      await page.getByTestId('suggestion-dismiss').tap();
      await page.getByTestId('suggestion').waitFor({ state: 'detached' });
      await waitSaved(page);
      await page.reload();
      await todayNote(page).waitFor();
      await page.waitForTimeout(2200);
      assert.equal(await page.getByTestId('suggestion').count(), 0);
      assert.equal(journalDoc(app).content[0].type, 'paragraph', 'dismissing changed nothing in the note');
    }));

  test('a name that matches nobody offers Add person: the person is created and the name links itself; a known person is not offered', () =>
    withPhone(browser, async ({ page, app }) => {
      await seedPerson(app, 'Robin Ortiz');
      await page.goto(`${app.url}/#/`);
      await todayNote(page).click();
      await page.keyboard.type('Met Priya Rao at the fair, then lunch with Robin Ortiz');
      const row = page.locator('[data-testid="suggestion"][data-kind="person"]');
      await row.waitFor();
      assert.equal(await row.count(), 1, 'Robin is known, only Priya is offered');
      assert.match(await row.innerText(), /Priya Rao/);
      await row.getByTestId('suggestion-person').tap();
      await row.waitFor({ state: 'detached' });
      await waitSaved(page);
      const made = app.notes().find((n) => n.title === 'Priya Rao');
      assert.ok(made, 'a note named Priya Rao exists');
      const list = await app.api('GET', '/api/people');
      assert.ok(list.json.people.some((p) => p.title === 'Priya Rao'), 'she is in People');
    }));

  test('at phone width the suggestion fits without sideways scrolling', () =>
    withPhone(browser, async ({ page, app }) => {
      await page.goto(`${app.url}/#/`);
      await todayNote(page).click();
      await page.keyboard.type('Remind me to email the venue about the long list of things for the spring social and sponsors');
      await page.getByTestId('suggestion').waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }));
});
