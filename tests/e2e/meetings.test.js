// 0.22.0: one project page over an existing tag and its sub-tags (nothing moved or retagged), with meetings made from a
// pasted transcript. Fictional data.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { uuid } from '../../shared/ids.js';
import { dateInTz } from '../../shared/dates.js';
import { launch, TZ, withPhone, paragraphDoc } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

const today = () => dateInTz(new Date(), TZ);
const put = async (app, body) => {
  const id = uuid();
  const r = await app.api('PUT', `/api/notes/${id}`, { baseRevision: 0, docFormat: 1, date: today(), opId: uuid(), kind: 'note', ...body });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return id;
};
const tagsOf = (app, id) => app.db.prepare('SELECT t.path FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ?').all(id).map((r) => r.path);

describe('a project over an existing tag, and meetings', () => {
  test('adopt a tag with sub-tags from the form; then add a meeting with a pasted transcript and see it all on one page', () =>
    withPhone(browser, async ({ page, app }) => {
      const sam = await put(app, { title: 'Sam Lee', tags: ['05-people'], doc: paragraphDoc('A person.') });
      const events = await put(app, { title: 'Fair plan', tags: ['21-club/events'], doc: paragraphDoc('Plan the fair') });
      const money = await put(app, { title: 'Money', tags: ['21-club/finance'], doc: paragraphDoc('Numbers') });

      await page.goto(`${app.url}/#/projects`);
      await page.getByTestId('project-new-btn').or(page.getByRole('button', { name: /new project/i })).first().tap();
      await page.getByTestId('project-name').fill('The Club');
      await page.getByTestId('project-tag').fill('21-club');
      await page.getByTestId('project-create').tap();
      await page.getByTestId('project-meetings').waitFor();
      await page.getByTestId('project-notes').getByText('Money').waitFor();
      const before = [events, money].map((id) => tagsOf(app, id).join());
      assert.match(await page.getByTestId('project-notes').innerText(), /Fair plan[\s\S]*Money|Money[\s\S]*Fair plan/, 'both sub-tag notes are on the page at once');
      assert.deepEqual([events, money].map((id) => tagsOf(app, id).join()), ['21-club/events', '21-club/finance'], 'nothing retagged');
      assert.deepEqual(before, ['21-club/events', '21-club/finance']);

      await page.getByTestId('project-new-meeting').tap();
      await page.getByTestId('meeting-title').fill('Spring kickoff');
      await page.getByTestId('meeting-attendee-select').selectOption(sam);
      await page.getByTestId('meeting-minutes').fill('Agreed on the fair date.');
      await page.getByTestId('meeting-commitments').fill('Sam Lee: send the logo by Friday\nbook the hall');
      await page.getByTestId('meeting-transcript').fill('Priya: hello everyone\nSam: I will send the logo');
      assert.equal(await page.getByTestId('meeting-create').isDisabled(), true, 'a transcript needs its source');
      await page.getByTestId('meeting-source').fill('A made-up recorder app');
      await page.getByTestId('meeting-create').tap();

      const row = page.getByTestId('project-meeting');
      await row.waitFor();
      const text = await row.innerText();
      assert.match(text, /Spring kickoff/);
      assert.match(text, /Sam Lee/);
      assert.match(text, /2 commitments open|1 of 2|2 of 2/);
      assert.match(await row.getByTestId('meeting-transcript-link').innerText(), /A made-up recorder app/);
      await page.getByTestId('project-others').getByText('send the logo by Friday').waitFor();
      await page.getByTestId('project-open').getByText('book the hall').waitFor();
      await page.getByTestId('project-people').getByText('Sam Lee').waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scrolling');

      // the transcript is its own note with its source, kept as pasted
      await row.getByTestId('meeting-transcript-link').tap();
      await page.waitForFunction(() => location.hash.startsWith('#/n/'));
      await page.locator('.note-text').first().waitFor();
      const body = await page.locator('.note-text').first().innerText();
      assert.match(body, /Source: A made-up recorder app/);
      assert.match(body, /Priya: hello everyone/);
    }));
});
