// 0.21.0: other people's tasks. A task can be someone else's (the `owner` attribute): it leaves the owner's own lists and
// shows under "Waiting on others", on the project page and on that person's page. One tap in the task sheet sets or clears it.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { uuid } from '../../shared/ids.js';
import { dateInTz } from '../../shared/dates.js';
import { launch, TZ, withPhone, waitSaved, paragraphDoc } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

const today = () => dateInTz(new Date(), TZ);
const taskItem = (text, attrs = {}) => ({ type: 'taskItem', attrs: { checked: false, id: uuid(), ...attrs }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const put = async (app, body) => {
  const id = uuid();
  const r = await app.api('PUT', `/api/notes/${id}`, { baseRevision: 0, docFormat: 1, date: today(), opId: uuid(), kind: 'daily', ...body });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return id;
};
const attrsOf = (app, id, text) => JSON.parse(app.notes().find((n) => n.id === id).doc).content[0].content.find((x) => x.content[0].content[0].text === text).attrs;
const row = (page, text) => page.locator('[data-testid="task-row"]', { hasText: text });

describe('other people’s tasks', () => {
  test('one tap in the task sheet makes a task someone else’s; it leaves My tasks for Waiting on others, the project and their page; Me brings it back', () =>
    withPhone(browser, async ({ page, app }) => {
      const samId = await put(app, { kind: 'note', title: 'Sam Lee', tags: ['05-people'], doc: paragraphDoc('A person.') });
      const made = await app.api('POST', '/api/projects', { name: 'Spring Fair', area: 'club', tag: '20-css/spring-fair' });
      assert.equal(made.status, 201, JSON.stringify(made.json));
      const noteId = await put(app, { tags: ['20-css/spring-fair'], doc: { type: 'doc', content: [{ type: 'taskList', content: [taskItem('Sam Lee to send the budget'), taskItem('book the hall')] }] } });

      await page.goto(`${app.url}/#/tasks`);
      await row(page, 'send the budget').waitFor();
      await row(page, 'send the budget').getByTestId('task-edit-text').tap();
      const sheet = page.getByRole('dialog', { name: 'Task' });
      await sheet.getByTestId('field-owner').waitFor();
      assert.equal(await sheet.getByTestId('owner-me').getAttribute('aria-pressed'), 'true');
      await sheet.getByTestId('owner-person').first().tap(); // the person named in the words: one tap
      await waitSaved(page);
      assert.equal(attrsOf(app, noteId, 'Sam Lee to send the budget').owner, samId);
      await sheet.getByTestId('task-sheet-done').tap();

      // gone from my sections, listed under Waiting on others with whose it is
      const others = page.getByTestId('section-others');
      await others.waitFor();
      assert.match(await others.innerText(), /send the budget/);
      assert.match(await others.innerText(), /Sam Lee’s task/);
      assert.equal(await page.locator('[data-testid="section-anytime"]', { hasText: 'send the budget' }).count(), 0);
      assert.match(await page.locator('[data-testid="section-anytime"]').innerText(), /book the hall/);
      assert.match(await page.getByTestId('task-count').innerText(), /1 open/);

      // the project page and the person's page
      await page.goto(`${app.url}/#/projects/${made.json.project.id}`);
      await page.getByTestId('project-others').waitFor();
      assert.match(await page.getByTestId('project-others').innerText(), /send the budget/);
      assert.doesNotMatch(await page.getByTestId('project-open').innerText(), /send the budget/);
      await page.goto(`${app.url}/#/people/${samId}`);
      await page.getByTestId('person-owns').waitFor();
      assert.match(await page.getByTestId('person-owns').innerText(), /send the budget/);

      // Me clears it
      await page.goto(`${app.url}/#/tasks`);
      await row(page, 'send the budget').getByTestId('task-edit-text').tap();
      await page.getByTestId('owner-me').tap();
      await waitSaved(page);
      assert.equal(attrsOf(app, noteId, 'Sam Lee to send the budget').owner, undefined, 'nothing stored once it is mine again');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }));

  test('a suggestion for "Sam will send ..." makes it Sam’s task in one tap', () =>
    withPhone(browser, async ({ page, app }) => {
      const samId = await put(app, { kind: 'note', title: 'Sam Lee', tags: ['05-people'], doc: paragraphDoc('A person.') });
      const journal = await put(app, { tags: ['daily-jots'], doc: { type: 'doc', content: [para('Sam Lee will send the budget by Friday')] } });
      await page.goto(`${app.url}/#/debrief`);
      const s = page.locator('[data-testid="suggestion"][data-kind="owner"]');
      await s.waitFor();
      assert.match(await s.getByTestId('suggestion-owner').innerText(), /Make this Sam Lee’s task/);
      await s.getByTestId('suggestion-owner').tap();
      await waitSaved(page);
      const doc = JSON.parse(app.notes().find((n) => n.id === journal).doc);
      assert.equal(doc.content[0].type, 'taskList');
      assert.equal(doc.content[0].content[0].attrs.owner, samId);
      assert.match(doc.content[0].content[0].attrs.due, /^\d{4}-\d{2}-\d{2}$/);
      await page.getByTestId('debrief').waitFor();
      assert.equal(await page.locator('[data-testid="debrief-open"]', { hasText: 'send the budget' }).count(), 0, 'not in my open tasks');
    }));
});
