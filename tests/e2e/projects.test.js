// Projects and Waiting on (docs/PROJECTS.md): the Projects tab and a project's page, a task linked to a person and
// waiting for their reply (Tasks screen, task details, the person's page).
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { launch, withPhone, newId, paragraphDoc } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

const taskDoc = (...items) => ({
  type: 'doc',
  content: [{ type: 'taskList', content: items.map(([text, attrs = {}]) => ({ type: 'taskItem', attrs: { checked: false, id: newId(), ...attrs }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })) }],
});
const putNote = async (app, { title, tags, doc }) => {
  const id = newId();
  const r = await app.api('PUT', `/api/notes/${id}`, { baseRevision: 0, kind: 'note', title, doc, docFormat: 2, tags, date: '2026-10-05' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return id;
};
const until = async (check, what, timeout = 10_000) => {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

describe('projects and waiting on', () => {
  test('a task waiting on a person is in its own section, with chips; its details set and clear waiting', () =>
    withPhone(browser, async ({ page, app }) => {
      const sarah = await putNote(app, { title: 'Sarah', tags: ['05-people/css'], doc: paragraphDoc('Venue contact') });
      await putNote(app, { title: 'Snack plan', tags: ['20-css/snack'], doc: taskDoc(['Book the venue', { person: sarah, waitingSince: '2026-10-01' }], ['Buy cups']) });
      const created = await app.api('POST', '/api/projects', { name: 'Snack Olympics', area: 'club', tag: '20-css/snack' });
      assert.equal(created.status, 201);

      await page.goto(`${app.url}/#/tasks`);
      const waiting = page.getByTestId('section-waiting');
      await waiting.waitFor();
      assert.match(await waiting.innerText(), /Book the venue/);
      assert.match(await waiting.getByTestId('chip-waiting').innerText(), /^waiting \d+ days?$/);
      assert.equal(await waiting.getByTestId('chip-person').innerText(), '@Sarah');
      assert.equal(await waiting.getByTestId('chip-project').innerText(), 'Snack Olympics');
      assert.equal(await page.getByTestId('section-anytime').getByText('Buy cups').count(), 1, 'the other task stays where it was');

      // details: "Got a reply" ends the waiting but keeps the person
      await waiting.getByTestId('task-expand').tap();
      await page.getByTestId('task-got-reply').tap();
      await until(async () => (await app.api('GET', '/api/tasks')).json.tasks.find((t) => t.text === 'Book the venue')?.waitingSince === null, 'waiting to be cleared');
      assert.equal((await app.api('GET', '/api/tasks')).json.tasks.find((t) => t.text === 'Book the venue').person, sarah);
      await page.getByTestId('section-waiting').waitFor({ state: 'detached' });

      // and set again from the details of another task
      const cups = page.getByTestId('task-row').filter({ hasText: 'Buy cups' });
      await cups.getByTestId('task-expand').tap();
      await cups.getByTestId('input-person').selectOption(sarah);
      await cups.getByTestId('input-waiting').check();
      await until(async () => (await app.api('GET', '/api/tasks')).json.tasks.find((t) => t.text === 'Buy cups')?.waitingSince, 'waiting to be saved');
      await page.getByTestId('section-waiting').getByTestId('task-edit-text').filter({ hasText: 'Buy cups' }).waitFor();
      assert.deepEqual(page.errors ?? [], []);
    }));

  test("the person's page lists the tasks with them; a project page lists its notes, open and waiting tasks", () =>
    withPhone(browser, async ({ page, app }) => {
      const sarah = await putNote(app, { title: 'Sarah', tags: ['05-people/css'], doc: paragraphDoc('Venue contact') });
      await putNote(app, { title: 'Snack plan', tags: ['20-css/snack'], doc: taskDoc(['Book the venue', { person: sarah, waitingSince: '2026-10-01' }], ['Buy cups']) });
      await page.goto(`${app.url}/#/n/${sarah}`);
      const tasks = page.getByTestId('person-tasks');
      await tasks.waitFor();
      assert.match(await tasks.innerText(), /Book the venue/);
      assert.equal(await tasks.getByTestId('chip-waiting').count(), 1);
      assert.doesNotMatch(await tasks.innerText(), /Buy cups/);

      // a project made in the app from an existing tag
      await page.goto(`${app.url}/#/projects`);
      await page.getByTestId('project-add').tap();
      await page.getByTestId('project-name').fill('Snack Olympics');
      await page.getByTestId('project-area-club').tap();
      await page.getByTestId('project-tag').fill('20-css/snack');
      await page.getByTestId('project-create').tap();
      await page.getByTestId('project-page').waitFor();
      assert.equal(await page.getByTestId('project-title').innerText(), 'Snack Olympics');
      await page.getByTestId('project-waiting').getByText('Book the venue').waitFor();
      assert.match(await page.getByTestId('project-waiting').innerText(), /@Sarah/);
      assert.match(await page.getByTestId('project-open').innerText(), /Buy cups/);
      await page.getByTestId('project-notes').locator('a', { hasText: 'Snack plan' }).waitFor();

      // the list shows it under its area with counts
      await page.goto(`${app.url}/#/projects`);
      const card = page.getByTestId('area-club').getByTestId('project-card');
      await card.waitFor();
      assert.match(await card.innerText(), /2 open tasks · 1 waiting · 1 note/);

      // adding a note to the project
      await putNote(app, { title: 'Loose ideas', tags: ['inbox'], doc: paragraphDoc('dragon') });
      await card.getByRole('link', { name: 'Snack Olympics' }).tap();
      await page.getByTestId('project-add-notes-btn').tap();
      await page.getByTestId('project-note-search').fill('Loose');
      await page.getByTestId('project-note-add').tap();
      await page.getByTestId('project-notes').locator('a', { hasText: 'Loose ideas' }).waitFor();
      assert.deepEqual(page.errors ?? [], []);
    }));
});
