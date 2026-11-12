// 0.18.0, the visible part of "write once": three tabs, a journal-first Today with a short To do list, a task sheet led
// by one-tap When choices, the "who is this again?" card on a person's page, and Look up.
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
const attrsOf = (app, noteId, text) => JSON.parse(app.notes().find((n) => n.id === noteId).doc).content[0].content.find((x) => x.content[0].content[0].text === text).attrs;

const seedTasks = async (app, items, { tags = ['school'], date = today() } = {}) => {
  const mk = ([text, attrs = {}]) => ({ type: 'taskItem', attrs: { checked: false, id: uuid(), ...attrs }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  const id = uuid();
  const r = await app.api('PUT', `/api/notes/${id}`, { baseRevision: 0, doc: { type: 'doc', content: [{ type: 'taskList', content: items.map(mk) }] }, docFormat: 1, tags, date, opId: uuid() });
  assert.equal(r.status, 200);
  return id;
};
const seedNote = async (app, { title = null, text, tags = [], date = today(), kind = title ? 'note' : 'daily' }) => {
  const id = uuid();
  const r = await app.api('PUT', `/api/notes/${id}`, { baseRevision: 0, kind, title, doc: paragraphDoc(text), docFormat: 1, tags, date, opId: uuid() });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return id;
};
const rowOf = (page, text) => page.locator('[data-testid="task-row"]', { hasText: text });

describe('three tabs', () => {
  test('Today, Tasks and Look up; Look up stays lit on people, projects and notes and links to every other place', () =>
    withPhone(browser, async ({ page, app }) => {
      await page.goto(`${app.url}/#/`);
      await page.getByTestId('tabbar').waitFor();
      assert.deepEqual(await page.locator('[data-testid="tabbar"] a').allInnerTexts(), ['Today', 'Tasks', 'Look up']);
      const current = () => page.locator('[data-testid="tabbar"] a[aria-current="page"]').allInnerTexts();
      assert.deepEqual(await current(), ['Today']);
      await page.getByTestId('tab-tasks').tap();
      await page.waitForFunction(() => location.hash === '#/tasks');
      assert.deepEqual(await current(), ['Tasks']);
      await page.getByTestId('tab-lookup').tap();
      await page.getByTestId('lookup').waitFor();
      assert.deepEqual(await current(), ['Look up']);
      for (const [testid, hash] of [['lookup-all-people', '#/people'], ['lookup-all-projects', '#/projects'], ['lookup-notes', '#/notes'], ['lookup-tags', '#/tags'], ['lookup-files', '#/files'], ['lookup-trash', '#/trash']]) {
        await page.goto(`${app.url}/#/lookup`);
        await page.getByTestId(testid).tap();
        await page.waitForFunction((h) => location.hash === h, hash);
        assert.deepEqual(await current(), ['Look up'], hash);
      }
      assert.equal(await page.getByTestId('settings-link').count(), 1, 'Settings stays in the header');
      assert.deepEqual(page.errors, []);
    }));
});

describe('Today on a phone', () => {
  test('To do: overdue, due today and recent undated tasks (three at most, with a link to the rest); then the journal; mood is behind one link', () =>
    withPhone(browser, async ({ page, app }) => {
      const t = today();
      await seedTasks(app, [
        ['late one', { due: addDays(t, -2) }],
        ['due now', { due: t }],
        ['this week', { due: addDays(t, 4) }],
        ['fresh undated one'],
        ['fresh undated two'],
      ]);
      await seedTasks(app, [['old undated']], { date: addDays(t, -10) });
      await page.goto(`${app.url}/#/`);
      await page.getByTestId('widget-todo').waitFor();
      await rowOf(page, 'late one').waitFor();
      const shown = await page.getByTestId('widget-todo').getByTestId('task-row').allInnerTexts();
      assert.equal(shown.length, 3, 'three at most');
      assert.match(shown[0], /late one/, 'overdue first');
      assert.match(shown[1], /due now/, 'then due today');
      assert.match(shown[2], /fresh undated/);
      assert.doesNotMatch(await page.getByTestId('widget-todo').innerText(), /this week|old undated/);
      assert.equal((await page.getByTestId('all-tasks').innerText()).trim(), '1 more');
      await page.getByTestId('all-tasks').tap();
      await page.waitForFunction(() => location.hash === '#/tasks');
      await page.goBack();

      // the page order: To do, then the journal, with Mood & habits behind one small row at the bottom
      const box = async (testid) => (await page.getByTestId(testid).boundingBox()).y;
      await todayNote(page).waitFor();
      assert.ok((await box('widget-todo')) < (await box('widget-note')) && (await box('widget-note')) < (await box('today-more')));
      assert.equal(await page.getByTestId('widget-mood').count(), 0, 'mood is not on the page until asked for');
      await page.getByTestId('today-more-toggle').tap();
      await page.getByTestId('widget-mood').waitFor();
      assert.equal(await page.getByTestId('today-skin').count(), 1);
      assert.equal(await page.getByTestId('today-new-note').count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scrolling');
      assert.deepEqual(page.errors, []);
    }));

  test('with nothing to do the To do heading is not shown', () =>
    withPhone(browser, async ({ page, app }) => {
      await page.goto(`${app.url}/#/`);
      await todayNote(page).waitFor();
      assert.equal(await page.getByTestId('widget-todo').getByTestId('task-row').count(), 0);
      assert.doesNotMatch(await page.getByTestId('widget-todo').innerText(), /To do/);
    }));
});

describe('the task sheet', () => {
  test('a row is the tick and the task; tapping the task opens the sheet with When choices that set the due date in one tap', () =>
    withPhone(browser, async ({ page, app }) => {
      const id = await seedTasks(app, [['write essay']]);
      await page.goto(`${app.url}/#/tasks`);
      await rowOf(page, 'write essay').waitFor();
      assert.equal(await rowOf(page, 'write essay').locator('button').count(), 1, 'one tap target: the task');
      assert.equal(await rowOf(page, 'write essay').getByTestId('task-hide').count(), 0);

      await rowOf(page, 'write essay').getByTestId('task-edit-text').tap();
      const sheet = page.getByRole('dialog', { name: 'Task' });
      await sheet.waitFor();
      assert.deepEqual(await sheet.locator('[data-testid^="when-"]').allInnerTexts(), ['Today', 'Tomorrow', 'Next Friday', 'Next week', 'No date']);
      assert.equal(await sheet.getByTestId('task-more-body').count(), 0, 'every other option is folded away');

      await sheet.getByTestId('when-tomorrow').tap();
      await waitSaved(page);
      assert.equal(attrsOf(app, id, 'write essay').due, addDays(today(), 1));
      assert.equal(await sheet.getByTestId('when-tomorrow').getAttribute('aria-pressed'), 'true');
      await sheet.getByTestId('when-today').tap();
      await waitSaved(page);
      assert.equal(attrsOf(app, id, 'write essay').due, today());
      await sheet.getByTestId('when-friday').tap();
      await sheet.getByTestId('when-nextweek').tap();
      await waitSaved(page);
      const next = attrsOf(app, id, 'write essay').due;
      assert.ok(next > addDays(today(), 1) && new Date(`${next}T00:00:00Z`).getUTCDay() === 1, 'next week is a Monday after tomorrow');
      await sheet.getByTestId('when-none').tap();
      await waitSaved(page);
      assert.equal(attrsOf(app, id, 'write essay').due, undefined, 'No date stores nothing');
      assert.deepEqual(page.errors, []);
    }));

  test('More holds start, hide, priority, repeat, project, person, dismiss and delete; the text is edited in the sheet', () =>
    withPhone(browser, async ({ page, app }) => {
      const id = await seedTasks(app, [['alpha task'], ['beta task']]);
      await page.goto(`${app.url}/#/tasks`);
      await rowOf(page, 'alpha task').waitFor();
      await rowOf(page, 'alpha task').getByTestId('task-edit-text').tap();
      const sheet = page.getByRole('dialog', { name: 'Task' });
      await sheet.getByTestId('task-more').tap();
      for (const testid of ['field-project', 'field-person', 'field-due', 'field-start', 'field-hideUntil', 'field-priority', 'task-dismiss', 'task-delete', 'input-hidden']) {
        assert.equal(await sheet.getByTestId(testid).count(), 1, testid);
      }
      await sheet.getByTestId('sheet-priority-urgent').tap();
      await waitSaved(page);
      assert.equal(attrsOf(app, id, 'alpha task').priority, 'urgent');
      assert.equal(await rowOf(page, 'alpha task').getAttribute('data-priority'), 'urgent');
      assert.equal(await rowOf(page, 'alpha task').getByTestId('chip-priority').count(), 1, 'shown on the row as a chip');

      // the words are edited in the sheet
      await sheet.getByTestId('task-text-editor').click();
      await page.keyboard.press('End');
      await page.keyboard.type(' v2');
      await waitSaved(page);
      assert.ok(JSON.parse(app.notes().find((n) => n.id === id).doc).content[0].content.some((x) => x.content[0].content[0].text === 'alpha task v2'));
      await sheet.getByTestId('task-sheet-done').tap();
      await sheet.waitFor({ state: 'detached' });
      await rowOf(page, 'alpha task v2').waitFor();
      assert.deepEqual(page.errors, []);
    }));
});

describe('a person page and Look up', () => {
  const makePerson = async (app, { title, text = 'Neighbour', date = today(), profile = null }) => {
    const id = await seedNote(app, { title, text, tags: ['05-people'], date });
    if (profile) assert.equal((await app.api('PUT', `/api/people/${id}`, { profile })).status, 200);
    return id;
  };

  test('the card answers who this is: how met, last time, things to remember and open tasks; Everything written sits right under it', () =>
    withPhone(browser, async ({ page, app }) => {
      const marisol = await makePerson(app, { title: 'Marisol Quade', profile: { howMet: 'Next door', metWhen: 'Spring 2026', remember: ['likes matcha'] } });
      await seedNote(app, { text: 'Coffee with Marisol about the fence', date: addDays(today(), -3), tags: ['daily-jots'] });
      await seedNote(app, { text: 'Marisol lent me a ladder', date: addDays(today(), -9), tags: ['daily-jots'] });
      await seedTasks(app, [['Return the ladder']]);
      await page.goto(`${app.url}/#/n/${marisol}`);
      const card = page.getByTestId('person-card');
      await card.getByTestId('person-card-met').waitFor();
      assert.match(await card.getByTestId('person-card-met').innerText(), /Next door · Spring 2026/);
      assert.match(await card.getByTestId('person-card-last').innerText(), /Coffee with Marisol about the fence/, 'the newest note that mentions them, and its line');
      assert.match(await card.getByTestId('person-card-remember').innerText(), /likes matcha/);

      // open tasks with them
      const noteId = app.notes().find((n) => JSON.parse(n.doc).content[0]?.type === 'taskList').id;
      await app.api('PUT', `/api/notes/${noteId}`, { baseRevision: 1, doc: { type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false, id: uuid(), person: marisol }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Return the ladder' }] }] }] }] }, docFormat: 1, tags: ['school'], date: today(), opId: uuid() });
      await page.reload();
      await card.getByTestId('person-tasks').waitFor();
      assert.match(await card.getByTestId('person-task').innerText(), /Return the ladder/);

      // Everything written follows the card; the existing details stay below it
      const section = page.getByTestId('backlinks');
      await section.getByRole('heading', { name: /Everything written/ }).waitFor();
      assert.equal(await section.getByTestId('backlink').count(), 2);
      const y = async (loc) => (await loc.boundingBox()).y;
      assert.ok((await y(card)) < (await y(section)) && (await y(section)) < (await y(page.getByTestId('person-profile'))), 'card, then Everything written, then the details');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scrolling');
      assert.deepEqual(page.errors, []);
    }));

  test('Look up: browse cards, recent people and projects; typing searches notes, people and tasks', () =>
    withPhone(browser, async ({ page, app }) => {
      await makePerson(app, { title: 'Recent Rae', text: 'Met at the fair', profile: { role: 'Fair volunteer' } });
      const olga = await makePerson(app, { title: 'Old Olga', text: 'Long-time friend', profile: { lastTalked: addDays(today(), -40) } });
      const otto = await makePerson(app, { title: 'Older Otto', text: 'Cousin', profile: { lastTalked: addDays(today(), -4) } });
      const longAgo = new Date(Date.now() - 90 * 86_400_000).toISOString();
      for (const id of [olga, otto]) app.db.prepare('UPDATE notes SET created_at = ? WHERE id = ?').run(longAgo, id); // not new faces
      await seedNote(app, { title: 'Gala plan', text: 'The lantern budget is under review', tags: ['school'] });
      await seedTasks(app, [['Order lanterns for the gala']]);
      assert.equal((await app.api('POST', '/api/projects', { name: 'Lunar Gala', area: 'club' })).status, 201);

      await page.goto(`${app.url}/#/lookup`);
      await page.getByTestId('lookup-met').waitFor();
      assert.match(await page.getByTestId('lookup-met').innerText(), /Recent Rae[\s\S]*Fair volunteer/, 'the one line about them');
      assert.equal(await page.getByTestId('lookup-projects').getByTestId('lookup-project').count(), 1);
      assert.match(await page.getByTestId('lookup-projects').innerText(), /Lunar Gala/);
      assert.doesNotMatch(await page.getByTestId('lookup-met').innerText(), /Olga|Otto/, 'only the new face is under Met recently');
      await page.getByTestId('lookup-all-people').waitFor();
      assert.equal(await page.getByTestId('lookup-people').count(), 0, 'the full people directory has its own destination');
      await page.getByTestId('lookup-input').fill('lantern');
      await page.getByTestId('lookup-notes-found').waitFor();
      assert.match(await page.getByTestId('lookup-notes-found').innerText(), /Gala plan/);
      assert.match(await page.getByTestId('lookup-tasks-found').innerText(), /Order lanterns for the gala/);
      await page.getByTestId('lookup-input').fill('olga');
      await page.getByTestId('lookup-people-found').waitFor();
      assert.deepEqual(await page.getByTestId('lookup-person').locator('b').allInnerTexts(), ['Old Olga']);
      await page.getByTestId('lookup-input').fill('zzzzqq');
      await page.getByTestId('lookup-nothing').waitFor();
      await page.getByTestId('lookup-input').fill('');
      await page.getByTestId('lookup-met').waitFor();
      assert.deepEqual(page.errors, []);
    }));
});
