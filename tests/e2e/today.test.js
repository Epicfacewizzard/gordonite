import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { uuid } from '../../shared/ids.js';
import { dateInTz, addDays } from '../../shared/dates.js';
import { launch, TZ, withPhone, waitSaved, paragraphDoc, useWideScreen } from './harness.js';

// This file is about the dashboard, the wide layout of Today. The phone's single-column Today is in redesign.test.js.
useWideScreen();

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

const today = () => dateInTz(new Date(), TZ);
const todayNote = (page) => page.locator('[data-testid="widget-note"] .note-text[contenteditable="true"]');

// A note holding tasks. `items` are [text, attrs].
const seedTasks = async (app, items, { tags = ['school'], date = today() } = {}) => {
  const mk = ([text, attrs = {}]) => ({ type: 'taskItem', attrs: { checked: false, id: uuid(), ...attrs }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  const id = uuid();
  const r = await app.api('PUT', `/api/notes/${id}`, {
    baseRevision: 0,
    doc: { type: 'doc', content: [{ type: 'taskList', content: items.map(mk) }] },
    docFormat: 1,
    tags,
    date,
    opId: uuid(),
  });
  assert.equal(r.status, 200);
  return id;
};

describe('the Dashboard (the Today screen)', () => {
  test('opens on the dashboard: the date, what is overdue or due today on the right, and a note to write in', () =>
    withPhone(browser, async ({ page, app }) => {
      const t = today();
      const taskNote = await seedTasks(app, [
        ['late one', { due: addDays(t, -2) }],
        ['due now', { due: t }],
        ['this week', { due: addDays(t, 4) }],
        ['far away', { due: addDays(t, 30) }],
        ['not yet', { start: addDays(t, 3) }],
        ['put away', { hidden: true }],
        ...['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7'].map((x) => [`undated ${x}`]),
      ]);

      await page.goto(`${app.url}/#/`);
      await page.getByTestId('today').waitFor();
      assert.equal(await page.getByTestId('title').innerText(), 'Today');
      assert.match(await page.getByTestId('today-date').innerText(), /^[A-Z][a-z]+, [A-Z][a-z]+ \d{1,2}$/, 'a long date such as "Monday, October 5"');

      const inSection = (id) => page.getByTestId(`section-${id}`).getByTestId('task-row').allInnerTexts();
      await page.getByTestId('section-overdue').waitFor();
      assert.match((await inSection('overdue')).join('|'), /late one/);
      const body = await page.getByTestId('widget-tasks').innerText();
      assert.match(body, /due now/, 'the default also shows what is due today');
      assert.doesNotMatch(body, /this week|far away|not yet|put away|undated/, 'but not later tasks');
      assert.equal(await page.getByTestId('section-today').count(), 1);
      assert.equal(await page.getByTestId('section-anytime').count(), 0);
      assert.match(await page.getByTestId('task-count').innerText(), /1 overdue · 1 today · 11 open/, 'all open tasks are still counted');

      // ticking works right here and is saved into its own note
      await page.locator('[data-testid="task-row"]', { hasText: 'late one' }).locator('input').tap();
      await waitSaved(page);
      const stored = JSON.parse(app.notes().find((n) => n.id === taskNote).doc).content[0].content;
      assert.equal(stored.find((x) => x.content[0].content[0].text === 'late one').attrs.checked, true);

      // navigation
      await page.getByTestId('all-tasks').tap();
      await page.waitForFunction(() => location.hash === '#/tasks');
      await page.goBack();
      await page.getByTestId('today').waitFor();
      await page.getByTestId('tab-lookup').tap();
      await page.getByTestId('lookup-notes').tap();
      await page.getByTestId('notes-tags-link').tap();
      await page.getByTestId('tag-list').waitFor();
      await page.getByLabel('Back to Notes').tap();
      await page.getByTestId('notes-tags-link').waitFor();
      await page.getByTestId('tab-today').tap();
      await page.getByTestId('today').waitFor();
      assert.deepEqual(page.errors, []);
    }));

  test("today's note is ready to write in: the first keystroke creates it in the journal tag; the tag is the server setting", () =>
    withPhone(browser, async ({ page, app }) => {
      await page.goto(`${app.url}/#/`);
      await todayNote(page).waitFor();
      assert.equal(app.notes().length, 0, 'nothing is created by opening Today');
      assert.equal(await page.getByTestId('daily-tag-choice').count(), 1, 'the configured journal stays available even when it is not starred');

      await todayNote(page).tap();
      await page.keyboard.type('Wrote this from Today');
      await waitSaved(page);
      const [note] = app.notes();
      assert.equal(note.kind, 'daily');
      assert.equal(note.note_date, today());
      assert.deepEqual(
        app.db.prepare('SELECT t.path FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ?').all(note.id).map((r) => r.path),
        ['daily-jots'],
      );

      // the same note is today's entry in that tag's stream
      await page.goto(`${app.url}/#/t/daily-jots`);
      await page.waitForSelector('[data-testid="stream"] .note-text[contenteditable="true"]');
      assert.equal(await page.locator('[data-testid="stream"] .note-text[contenteditable="true"]').textContent(), 'Wrote this from Today');

      // the journal tag is the server setting (Settings → Dashboard); the dashboard follows it, also after a reload
      await app.api('POST', '/api/tags', { path: 'work-log' });
      await page.goto(`${app.url}/#/settings`);
      await page.getByTestId('daily-tag-select').selectOption('work-log');
      await page.getByTestId('daily-tag-message').filter({ hasText: 'Saved' }).waitFor();
      assert.equal((await app.api('GET', '/api/config')).json.dailyTag, 'work-log', 'saved on the server');
      await page.goto(`${app.url}/#/`);
      await todayNote(page).waitFor();
      assert.equal(await todayNote(page).textContent(), '', 'work-log has no entry for today yet');
      await page.reload();
      await todayNote(page).waitFor();
      assert.equal(await todayNote(page).textContent(), '', 'work-log has no entry for today yet');

      // a tag whose daily entry is switched off has nothing to write in
      const tag = (await app.api('GET', '/api/tags')).json.tags.find((x) => x.path === 'work-log');
      await app.api('PUT', `/api/tags/${tag.id}/daily`, { daily: false });
      await page.reload();
      await page.getByTestId('note-off').waitFor();
      assert.deepEqual(page.errors, []);
    }));

  test('starred tags appear as shortcuts', () =>
    withPhone(browser, async ({ page, app }) => {
      const tag = (await app.api('POST', '/api/tags', { path: 'school/fall26' })).json.tag;
      await page.goto(`${app.url}/#/`);
      await page.getByTestId('today').waitFor();
      assert.equal(await page.getByTestId('widget-pinned').count(), 0, 'nothing starred, nothing shown');
      await app.api('PUT', `/api/tags/${tag.id}/favorite`, { favorite: true });
      await page.reload();
      await page.getByTestId('widget-pinned').waitFor();
      await page.getByTestId('widget-pinned').getByText('school/fall26').tap();
      await page.waitForFunction(() => location.hash === '#/t/school/fall26');
    }));
});

// A note with a name or just a first line, dated today unless said otherwise. People are notes under 05-people.
const seedNote = async (app, { title = null, text, tags = [], date = today(), kind = title ? 'note' : 'daily' }) => {
  const id = uuid();
  const r = await app.api('PUT', `/api/notes/${id}`, { baseRevision: 0, kind, title, doc: paragraphDoc(text), docFormat: 1, tags, date, opId: uuid() });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return id;
};

describe('one journal page: people today and also today', () => {
  test('a note that names a person by first name shows them under People today, and under Everything written on their page', () =>
    withPhone(browser, async ({ page, app }) => {
      const marisol = await seedNote(app, { title: 'Marisol Quade', text: 'Neighbour', tags: ['05-people'], date: addDays(today(), -30) });
      await seedNote(app, { title: 'Tobias Ashgrove', text: 'Club treasurer', tags: ['05-people'], date: addDays(today(), -30) });
      await seedNote(app, { title: 'Tobias Brandt', text: 'Coach', tags: ['05-people'], date: addDays(today(), -30) });
      await page.goto(`${app.url}/#/`);
      await todayNote(page).waitFor();
      assert.equal(await page.getByTestId('people-today').count(), 0, 'hidden while nobody is named');
      assert.equal(await page.getByTestId('also-today').count(), 0, 'hidden while nothing else was written today');

      await todayNote(page).tap();
      await page.keyboard.type('Coffee with Marisol and Tobias about the plan');
      await waitSaved(page);
      await page.getByTestId('people-today').waitFor();
      assert.deepEqual(await page.getByTestId('people-today').locator('a').allInnerTexts(), ['Marisol Quade'], 'Tobias is two people, so names neither');
      assert.equal(await page.getByTestId('people-today').locator('a').getAttribute('href'), `#/people/${marisol}`);
      assert.deepEqual(await todayNote(page).locator('.mention').allInnerTexts(), ['Marisol'], 'while writing, the name is styled (no link, no change to the text)');
      assert.equal(await todayNote(page).textContent(), 'Coffee with Marisol and Tobias about the plan');

      // typing a name that matches nobody removes nothing; deleting the name drops the chip once typing pauses
      await page.keyboard.press('Control+A');
      await page.keyboard.type('Nobody mentioned');
      await page.getByTestId('people-today').waitFor({ state: 'detached' });
      await page.keyboard.press('Control+A');
      await page.keyboard.type('Dinner with Marisol');
      await waitSaved(page);
      await page.getByTestId('people-today').waitFor();

      await page.goto(`${app.url}/#/people/${marisol}`);
      const section = page.getByTestId('backlinks');
      await section.getByRole('heading', { name: /Everything written/ }).waitFor();
      await section.getByTestId('backlink').first().waitFor();
      assert.match(await section.innerText(), /Dinner with Marisol/);
      assert.deepEqual(page.errors, []);
    }));

  test('names in a note that is not being edited are links to the person, but not on their own page', () =>
    withPhone(browser, async ({ page, app }) => {
      const marisol = await seedNote(app, { title: 'Marisol Quade', text: 'Marisol is a neighbour', tags: ['05-people'], date: addDays(today(), -30) });
      await seedNote(app, { text: 'Yesterday I saw Marisol', date: addDays(today(), -1), tags: ['daily-jots'] });
      await page.goto(`${app.url}/#/`);
      const link = page.locator('[data-testid="prev-note"] a.mention');
      await link.waitFor();
      assert.equal(await link.getAttribute('href'), `#/people/${marisol}`);
      assert.equal(await link.innerText(), 'Marisol');
      await link.tap();
      await page.waitForFunction((id) => location.hash.endsWith(id), marisol); // a person's page is the note's own page
      await page.getByTestId('note-page').waitFor();
      await page.locator('[data-testid="note-page"] .note-text').waitFor();
      assert.equal(await page.locator('[data-testid="note-page"] .mention').count(), 0, 'a person’s own page does not mark their name as a mention of themselves');
      assert.deepEqual(page.errors, []);
    }));

  test('Also today lists the other notes dated today, and the people they name count too', () =>
    withPhone(browser, async ({ page, app }) => {
      const marisol = await seedNote(app, { title: 'Marisol Quade', text: 'Neighbour', tags: ['05-people'], date: addDays(today(), -30) });
      const lab = await seedNote(app, { title: 'Lab plan', text: 'Bring the samples; ask Marisol', tags: ['school'] });
      const work = await seedNote(app, { text: 'Standup went well', tags: ['work-log'] });
      await seedNote(app, { title: 'Last week', text: 'Not today', date: addDays(today(), -7), tags: ['school'] });
      const gone = await seedNote(app, { title: 'Thrown away', text: 'Trashed note', tags: ['school'] });
      await app.api('DELETE', `/api/notes/${gone}`);
      await seedNote(app, { text: 'Journal entry from earlier today', tags: ['daily-jots'] });

      await page.goto(`${app.url}/#/`);
      const also = page.getByTestId('also-today');
      await also.waitFor();
      const rows = await also.getByTestId('also-today-note').evaluateAll((els) => els.map((e) => [e.getAttribute('href'), e.innerText.replace(/\s+/g, ' ').trim()]));
      assert.deepEqual(rows.map((r) => r[0]).sort(), [`#/n/${lab}`, `#/n/${work}`].sort(), 'the two other notes, not the journal entry, the trashed note or last week');
      assert.ok(rows.some((r) => /^Lab plan Bring the samples/.test(r[1])), 'a named note shows its name and first line');
      assert.ok(rows.some((r) => /^work-log Standup went well$/.test(r[1])), 'an unnamed one shows its first tag and first line');
      assert.deepEqual(await page.getByTestId('people-today').locator('a').allInnerTexts(), ['Marisol Quade'], 'named in one of the other notes');

      await also.getByTestId('also-today-note').first().tap();
      await page.waitForFunction(() => location.hash.startsWith('#/n/'));
      assert.deepEqual(page.errors, []);
    }));

  test('Settings still sets the journal tag; the dashboard writes into it', () =>
    withPhone(browser, async ({ page, app }) => {
      await app.api('POST', '/api/tags', { path: 'work-log' });
      assert.equal((await app.api('PUT', '/api/settings', { dailyTag: 'work-log' })).status, 200);
      await page.goto(`${app.url}/#/`);
      await todayNote(page).waitFor();
      await todayNote(page).tap();
      await page.keyboard.type('Into the journal');
      await waitSaved(page);
      const [note] = app.notes();
      assert.deepEqual(app.db.prepare('SELECT t.path FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ?').all(note.id).map((r) => r.path), ['work-log']);
    }));
});

describe('dashboard widgets', () => {
  const regionOf = (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-region]')].map((r) => [r.dataset.region, [...r.children].map((c) => c.dataset.testid ?? 'nav')])));

  test('the note is in the centre, mood above overdue tasks on the right; Settings hides and reorders them', () =>
    withPhone(browser, async ({ page, app }) => {
      const tag = (await app.api('POST', '/api/tags', { path: 'school/fall26' })).json.tag;
      await app.api('PUT', `/api/tags/${tag.id}/favorite`, { favorite: true });
      await page.goto(`${app.url}/#/`);
      await page.getByTestId('widget-note').waitFor();
      assert.deepEqual(await regionOf(page), { center: ['widget-note'], right: ['nav', 'widget-pinned', 'widget-mood', 'widget-habits', 'widget-tasks'] });

      await page.goto(`${app.url}/#/settings`);
      await page.getByTestId('widget-prefs').waitFor();
      await page.getByTestId('widget-down-nav').tap(); // New note button below mood
      await page.getByTestId('widget-toggle-mood').tap(); // hide mood
      await page.goto(`${app.url}/#/`);
      await page.getByTestId('widget-note').waitFor();
      await page.getByTestId('widget-pinned').waitFor(); // the starred tags arrive a moment after the page
      assert.deepEqual(await regionOf(page), { center: ['widget-note'], right: ['widget-pinned', 'nav', 'widget-habits', 'widget-tasks'] });

      await page.reload();
      await page.getByTestId('widget-note').waitFor();
      await page.getByTestId('widget-pinned').waitFor(); // the starred tags arrive a moment after the page
      assert.deepEqual(await regionOf(page), { center: ['widget-note'], right: ['widget-pinned', 'nav', 'widget-habits', 'widget-tasks'] }, 'kept after a reload');

      // hide everything: the dashboard says so and points to Settings
      await page.goto(`${app.url}/#/settings`);
      for (const id of ['nav', 'pinned', 'habits', 'tasks', 'note']) await page.getByTestId(`widget-toggle-${id}`).tap();
      await page.goto(`${app.url}/#/`);
      await page.getByTestId('dashboard-empty').waitFor();
      assert.deepEqual(page.errors, []);
    }));

  test('on a wide screen the note sits left of a right column of New note, mood and tasks; on a phone they stack', () =>
    withPhone(browser, async ({ page, app }) => {
      await page.goto(`${app.url}/#/`);
      await page.getByTestId('widget-note').waitFor();
      const box = async (id) => (await page.getByTestId(id).boundingBox());
      // phone width: one column: the To do list, today's note, then the small row with mood, skin and New note behind it
      const [todo, note0, more] = [await box('widget-todo'), await box('widget-note'), await box('today-more')];
      assert.ok(todo.y <= note0.y && note0.y < more.y, 'To do, today’s note, then the small row on a phone');
      assert.equal(await page.getByTestId('widget-tasks').count(), 0, 'the side-by-side widgets are for a wide screen');

      await page.setViewportSize({ width: 1200, height: 800 });
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.dashboard-grid') ?? document.body).gridTemplateColumns.split(' ').length === 2 && !!document.querySelector('.dashboard-grid')); // the left column is empty (nothing starred), so it takes no room
      const [n, c, m, t] = [await box('today-new-note'), await box('widget-note'), await box('widget-mood'), await box('widget-tasks')];
      assert.ok(c.x + c.width <= n.x + 1 && c.x + c.width <= m.x + 1 && c.x + c.width <= t.x + 1, 'New note, mood and tasks are right of the note');
      assert.ok(n.y + n.height <= m.y + 1 && m.y + m.height <= t.y + 1, 'New note, then mood, then tasks, top to bottom');
      assert.ok(n.width < 160 && n.height < 44, 'the New note button is small, not the full column');
      assert.ok(c.width > t.width, 'the note column is the widest');
    }, { viewport: { width: 360, height: 780 } }));

  test('the starred tags sit beside the New note button, and the note has the room on the left under the date', () =>
    withPhone(browser, async ({ page, app }) => {
      const tag = (await app.api('POST', '/api/tags', { path: 'school/fall26' })).json.tag;
      await app.api('PUT', `/api/tags/${tag.id}/favorite`, { favorite: true });
      await page.setViewportSize({ width: 1200, height: 800 });
      await page.goto(`${app.url}/#/`);
      await page.getByTestId('widget-pinned').waitFor();
      const box = async (id) => page.getByTestId(id).boundingBox();
      const [date, note, nav, pinned, tasks] = [await box('today-date'), await box('widget-note'), await box('today-new-note'), await box('widget-pinned'), await box('widget-tasks')];
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.dashboard-grid')).gridTemplateColumns.split(' ').length), 2, 'no column is kept for the starred tags');
      assert.ok(Math.abs(pinned.y - nav.y) < 24 && pinned.x >= nav.x + nav.width - 1, 'the starred tags are on the same row, right of the New note button');
      assert.ok(pinned.y + pinned.height <= tasks.y + 1, 'and above the tasks');
      assert.ok(Math.abs(note.x - date.x) < 4 && date.y + date.height <= note.y, 'the date is straight above the note');
      assert.ok(note.width > tasks.width, 'the note is the widest part');
    }));

  test('a widget can be moved to another column in Settings; a column nobody uses leaves no gap; Reset puts everything back', () =>
    withPhone(browser, async ({ page, app }) => {
      await page.setViewportSize({ width: 1200, height: 800 });
      await page.goto(`${app.url}/#/settings`);
      await page.getByTestId('widget-prefs').waitFor();
      await page.getByTestId('widget-region-mood').selectOption('left'); // side to side
      await page.getByTestId('widget-region-pinned').selectOption('right');
      await page.goto(`${app.url}/#/`);
      await page.getByTestId('widget-note').waitFor();
      assert.deepEqual(await regionOf(page), { left: ['widget-mood'], center: ['widget-note'], right: ['nav', 'widget-habits', 'widget-tasks'] }, 'the mood moved to the left column (starred tags, with nothing starred, show nothing)');

      // put the mood across the top: the left column is empty, so only two columns remain
      await page.goto(`${app.url}/#/settings`);
      await page.getByTestId('widget-region-mood').selectOption('top');
      await page.goto(`${app.url}/#/`);
      await page.getByTestId('widget-note').waitFor();
      assert.deepEqual(await regionOf(page), { top: ['widget-mood'], center: ['widget-note'], right: ['nav', 'widget-habits', 'widget-tasks'] });
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.dashboard-grid')).gridTemplateColumns.split(' ').length), 2, 'no space is kept for the empty column');
      const [mood, note] = [await page.getByTestId('widget-mood').boundingBox(), await page.getByTestId('widget-note').boundingBox()];
      assert.ok(mood.y + mood.height <= note.y + 1, 'the top band is above the columns');

      await page.reload();
      await page.getByTestId('widget-note').waitFor();
      assert.deepEqual(await regionOf(page), { top: ['widget-mood'], center: ['widget-note'], right: ['nav', 'widget-habits', 'widget-tasks'] }, 'kept after a reload');

      await page.goto(`${app.url}/#/settings`);
      await page.getByTestId('widget-reset').tap();
      await page.goto(`${app.url}/#/`);
      await page.getByTestId('widget-note').waitFor();
      assert.deepEqual(await regionOf(page), { center: ['widget-note'], right: ['nav', 'widget-mood', 'widget-habits', 'widget-tasks'] }, 'back to the starting layout');
      assert.deepEqual(page.errors, []);
    }));
});

describe('the bottom tab bar', () => {
  const current = (page) => page.locator('[data-testid="tabbar"] a[aria-current="page"]').allInnerTexts();

  test('Today, Tasks and Look up are one tap away; Notes and Tags are reached from Look up; the bar steps aside while writing', () =>
    withPhone(browser, async ({ page, app }) => {
      await page.goto(`${app.url}/#/`);
      await page.getByTestId('tabbar').waitFor();
      assert.deepEqual(await current(page), ['Today']);

      for (const [tab, hash, label] of [['tasks', '#/tasks', 'Tasks'], ['lookup', '#/lookup', 'Look up'], ['today', '#/', 'Today']]) {
        await page.getByTestId(`tab-${tab}`).tap();
        await page.waitForFunction((h) => location.hash === h || (h === '#/' && (location.hash === '' || location.hash === '#/')), hash);
        await page.waitForFunction((l) => document.querySelector('[data-testid="tabbar"] a[aria-current="page"]')?.innerText === l, label);
      }
      await page.getByTestId('tab-lookup').tap();
      await page.getByTestId('lookup-notes').tap();
      await page.getByTestId('notes-tags-link').tap();
      await page.getByLabel('Tag to create').waitFor();
      assert.deepEqual(await current(page), ['Look up']);
      assert.equal(await page.getByTestId('tab-tags').count(), 0);

      // inside a stream or a note, or while starting one, the bar is not shown (they have their own toolbar)
      for (const hash of ['#/t/daily-jots', '#/new']) {
        await page.goto(`${app.url}/${hash}`);
        await page.waitForSelector('[data-testid="stream"], [data-testid="note-page"]');
        assert.equal(await page.getByTestId('tabbar').count(), 0, hash);
      }

      // while a search box has the cursor, the bar gives the keyboard the room
      await page.goto(`${app.url}/#/notes`);
      await page.getByTestId('notes-search').tap();
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="tabbar"]')).display === 'none');
      await page.getByTestId('notes-search').blur();
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="tabbar"]')).display !== 'none');
      assert.deepEqual(page.errors, []);
    }));

  test("on Today the formatting toolbar replaces the bar only while today's note has the cursor", () =>
    withPhone(browser, async ({ page, app }) => {
      await page.goto(`${app.url}/#/`);
      await todayNote(page).waitFor();
      assert.equal(await page.locator('.today .toolbar').isVisible(), false, 'not in the way while reading');
      assert.equal(await page.getByTestId('tabbar').isVisible(), true);
      await todayNote(page).tap();
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.today .toolbar')).display !== 'none');
      assert.equal(await page.getByTestId('tabbar').isVisible(), false);
      await page.keyboard.type('hi');
      await waitSaved(page);
      await page.locator('.today-date').tap(); // tap elsewhere: the cursor leaves the note
      await page.evaluate(() => document.activeElement?.blur());
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="tabbar"]')).display !== 'none');
      assert.equal(await page.locator('.today .toolbar').isVisible(), false);
    }));
});

describe('what the dashboard Tasks box shows', () => {
  test('Settings chooses overdue only, plus today, plus the coming week, or everything open; the default is overdue and today', () =>
    withPhone(browser, async ({ page, app }) => {
      const t = today();
      await seedTasks(app, [['late one', { due: addDays(t, -2) }], ['due now', { due: t }], ['this week', { due: addDays(t, 4) }], ['far away', { due: addDays(t, 30) }], ['undated one']]);
      const show = async (scope) => {
        await page.goto(`${app.url}/#/settings`);
        await page.getByTestId('dashboard-tasks-scope').selectOption(scope);
        await page.goto(`${app.url}/#/`);
        await page.getByTestId('task-count').waitFor();
        await page.getByTestId('section-overdue').waitFor();
        return page.getByTestId('widget-tasks').innerText();
      };
      await page.goto(`${app.url}/#/settings`);
      assert.equal(await page.getByTestId('dashboard-tasks-scope').inputValue(), 'today', 'the default');

      let body = await show('overdue');
      assert.match(body, /late one/);
      assert.doesNotMatch(body, /due now|this week|undated one/);
      body = await show('today');
      assert.match(body, /late one/);
      assert.match(body, /due now/);
      assert.doesNotMatch(body, /this week|undated one/);
      body = await show('week');
      assert.match(body, /late one[\s\S]*due now[\s\S]*this week/);
      assert.doesNotMatch(body, /far away|undated one/);
      body = await show('all');
      assert.match(body, /this week/);
      assert.match(body, /undated one/);
      assert.doesNotMatch(body, /far away/, 'later than a week is still left for the Tasks page');

      await page.reload();
      await page.getByTestId('section-overdue').waitFor();
      assert.match(await page.getByTestId('widget-tasks').innerText(), /undated one/, 'the choice is kept');
      assert.deepEqual(page.errors, []);
    }));

  test('with nothing overdue or due today it says so', () =>
    withPhone(browser, async ({ page, app }) => {
      await seedTasks(app, [['next month', { due: addDays(today(), 30) }]]);
      await page.goto(`${app.url}/#/`);
      await page.getByTestId('nothing-due').waitFor();
      assert.match(await page.getByTestId('nothing-due').innerText(), /Nothing overdue or due today/);
    }));
});
