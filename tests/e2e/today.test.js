import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { uuid } from '../../shared/ids.js';
import { dateInTz, addDays } from '../../shared/dates.js';
import { launch, TZ, withPhone, waitSaved } from './harness.js';

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
  test('opens on the dashboard: the date, only what is overdue on the right, and a note to write in', () =>
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
      assert.equal(await page.getByTestId('title').innerText(), 'Dashboard');
      assert.match(await page.getByTestId('today-date').innerText(), /^[A-Z][a-z]+, [A-Z][a-z]+ \d{1,2}$/, 'a long date such as "Monday, October 5"');

      const inSection = (id) => page.getByTestId(`section-${id}`).getByTestId('task-row').allInnerTexts();
      await page.getByTestId('section-overdue').waitFor();
      assert.match((await inSection('overdue')).join('|'), /late one/);
      const body = await page.getByTestId('widget-tasks').innerText();
      assert.doesNotMatch(body, /due now|this week|far away|not yet|put away|undated/, 'the dashboard column shows only what is overdue');
      assert.equal(await page.getByTestId('section-today').count(), 0);
      assert.equal(await page.getByTestId('section-anytime').count(), 0);
      assert.match(await page.getByTestId('task-count').innerText(), /1 overdue · 11 open/, 'all open tasks are still counted');

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
      await page.getByTestId('tab-notes').tap();
      await page.getByTestId('notes-tags-link').tap();
      await page.getByTestId('tag-list').waitFor();
      await page.getByLabel('Back to Notes').tap();
      await page.getByTestId('notes-tags-link').waitFor();
      await page.getByTestId('tab-today').tap();
      await page.getByTestId('today').waitFor();
      assert.deepEqual(page.errors, []);
    }));

  test("today's note is ready to write in: the first keystroke creates it in the chosen daily tag; the tag can be changed", () =>
    withPhone(browser, async ({ page, app }) => {
      await page.goto(`${app.url}/#/`);
      await todayNote(page).waitFor();
      assert.equal(app.notes().length, 0, 'nothing is created by opening Today');
      assert.match(await page.getByTestId('daily-tag-from').innerText(), /daily-jots/, 'the default');

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

      // switch the tag the dashboard writes in (now a setting); it is remembered on the server, so it survives a reload
      await app.api('POST', '/api/tags', { path: 'work-log' });
      await page.goto(`${app.url}/#/settings`);
      await page.getByTestId('daily-tag-select').waitFor();
      assert.equal(await page.getByTestId('daily-tag-select').inputValue(), 'daily-jots');
      await page.getByTestId('daily-tag-select').selectOption('work-log');
      await page.getByTestId('daily-tag-message').getByText('Saved.').waitFor();
      await page.goto(`${app.url}/#/`);
      await todayNote(page).waitFor();
      assert.match(await page.getByTestId('daily-tag-from').innerText(), /work-log/);
      assert.equal(await todayNote(page).textContent(), '', 'work-log has no entry for today yet');
      await page.reload();
      await todayNote(page).waitFor();
      assert.match(await page.getByTestId('daily-tag-from').innerText(), /work-log/);
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

describe('choosing where the dashboard note comes from', () => {
  const choice = (page, tag) => page.locator(`[data-testid="daily-tag-choice"][data-tag="${tag}"]`);

  test('starred tags are one-tap choices under the note; the choice is saved for every device', () =>
    withPhone(browser, async ({ page, app }) => {
      const star = async (path, daily = true) => {
        const tag = (await app.api('POST', '/api/tags', { path })).json.tag;
        await app.api('PUT', `/api/tags/${tag.id}/favorite`, { favorite: true });
        if (!daily) await app.api('PUT', `/api/tags/${tag.id}/daily`, { daily: false });
      };
      await app.api('POST', '/api/tags', { path: 'not-starred' });
      await star('work-log');
      await star('school/fall26');
      await star('topic-only', false);
      await page.goto(`${app.url}/#/`);
      await page.getByTestId('daily-tag-from').waitFor();
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="daily-tag-choice"]').length === 4);
      assert.deepEqual(await page.getByTestId('daily-tag-choice').evaluateAll((els) => els.map((e) => e.dataset.tag)), ['daily-jots', 'school/fall26', 'topic-only', 'work-log'], 'the current tag and the starred ones, not the others');
      assert.equal(await choice(page, 'daily-jots').getAttribute('aria-checked'), 'true');
      assert.equal(await choice(page, 'topic-only').isDisabled(), true, 'a tag with its daily entry off cannot be picked');

      await choice(page, 'work-log').tap();
      await page.waitForFunction(() => document.querySelector('[data-testid="daily-tag-choice"][data-tag="work-log"]')?.getAttribute('aria-checked') === 'true');
      assert.equal((await app.api('GET', '/api/config')).json.dailyTag, 'work-log', 'saved on the server');
      assert.equal(await choice(page, 'daily-jots').getAttribute('aria-checked'), 'false', 'the tag just left stays offered for this visit, so there is a way back');

      // writing now goes into the chosen tag, and the choice survives a reload
      await todayNote(page).waitFor();
      await todayNote(page).tap();
      await page.keyboard.type('Picked from the dashboard');
      await waitSaved(page);
      const [note] = app.notes();
      assert.deepEqual(app.db.prepare('SELECT t.path FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ?').all(note.id).map((r) => r.path), ['work-log']);
      await page.reload();
      await page.getByTestId('daily-tag-from').waitFor();
      await page.waitForFunction(() => document.querySelector('[data-testid="daily-tag-choice"][data-tag="work-log"]')?.getAttribute('aria-checked') === 'true');
      assert.deepEqual(await page.getByTestId('daily-tag-choice').evaluateAll((els) => els.map((e) => e.dataset.tag)), ['school/fall26', 'topic-only', 'work-log'], 'after a reload only the current and starred tags are offered');
      assert.deepEqual(page.errors, []);
    }));

  test('with nothing starred only the current tag shows, with no extra words; Settings still has every tag', () =>
    withPhone(browser, async ({ page, app }) => {
      await page.goto(`${app.url}/#/`);
      await page.getByTestId('daily-tag-from').waitFor();
      assert.equal(await page.getByTestId('daily-tag-choice').count(), 1, 'only the current tag');
      assert.equal((await page.getByTestId('daily-tag-from').innerText()).trim(), 'daily-jots', 'just the tag, no label or hint');
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
      assert.deepEqual(await regionOf(page), { left: ['widget-pinned'], center: ['widget-note'], right: ['nav', 'widget-mood', 'widget-tasks'] });

      await page.goto(`${app.url}/#/settings`);
      await page.getByTestId('widget-prefs').waitFor();
      await page.getByTestId('widget-down-nav').tap(); // New note button below mood
      await page.getByTestId('widget-toggle-mood').tap(); // hide mood
      await page.goto(`${app.url}/#/`);
      await page.getByTestId('widget-note').waitFor();
      assert.deepEqual(await regionOf(page), { left: ['widget-pinned'], center: ['widget-note'], right: ['nav', 'widget-tasks'] });

      await page.reload();
      await page.getByTestId('widget-note').waitFor();
      assert.deepEqual(await regionOf(page), { left: ['widget-pinned'], center: ['widget-note'], right: ['nav', 'widget-tasks'] }, 'kept after a reload');

      // hide everything: the dashboard says so and points to Settings
      await page.goto(`${app.url}/#/settings`);
      for (const id of ['nav', 'pinned', 'tasks', 'note']) await page.getByTestId(`widget-toggle-${id}`).tap();
      await page.goto(`${app.url}/#/`);
      await page.getByTestId('dashboard-empty').waitFor();
      assert.deepEqual(page.errors, []);
    }));

  test('on a wide screen the note sits left of a right column of New note, mood and tasks; on a phone they stack', () =>
    withPhone(browser, async ({ page, app }) => {
      await page.goto(`${app.url}/#/`);
      await page.getByTestId('widget-note').waitFor();
      const box = async (id) => (await page.getByTestId(id).boundingBox());
      // phone width: one column, in the order centre, then the right column (New note, mood, tasks)
      const [nav, note, mood, tasks] = [await box('today-new-note'), await box('widget-note'), await box('widget-mood'), await box('widget-tasks')];
      assert.ok(note.y < nav.y && nav.y < mood.y && mood.y < tasks.y, 'stacked in order on a phone');

      await page.setViewportSize({ width: 1200, height: 800 });
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.dashboard-grid')).gridTemplateColumns.split(' ').length === 2); // the left column is empty (nothing starred), so it takes no room
      const [n, c, m, t] = [await box('today-new-note'), await box('widget-note'), await box('widget-mood'), await box('widget-tasks')];
      assert.ok(c.x + c.width <= n.x + 1 && c.x + c.width <= m.x + 1 && c.x + c.width <= t.x + 1, 'New note, mood and tasks are right of the note');
      assert.ok(n.y + n.height <= m.y + 1 && m.y + m.height <= t.y + 1, 'New note, then mood, then tasks, top to bottom');
      assert.ok(n.width < 160 && n.height < 44, 'the New note button is small, not the full column');
      assert.ok(c.width > t.width, 'the note column is the widest');
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
      assert.deepEqual(await regionOf(page), { left: ['widget-mood'], center: ['widget-note'], right: ['nav', 'widget-tasks'] }, 'the mood moved to the left column (starred tags, with nothing starred, show nothing)');

      // put the mood across the top: the left column is empty, so only two columns remain
      await page.goto(`${app.url}/#/settings`);
      await page.getByTestId('widget-region-mood').selectOption('top');
      await page.goto(`${app.url}/#/`);
      await page.getByTestId('widget-note').waitFor();
      assert.deepEqual(await regionOf(page), { top: ['widget-mood'], center: ['widget-note'], right: ['nav', 'widget-tasks'] });
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.dashboard-grid')).gridTemplateColumns.split(' ').length), 2, 'no space is kept for the empty column');
      const [mood, note] = [await page.getByTestId('widget-mood').boundingBox(), await page.getByTestId('widget-note').boundingBox()];
      assert.ok(mood.y + mood.height <= note.y + 1, 'the top band is above the columns');

      await page.reload();
      await page.getByTestId('widget-note').waitFor();
      assert.deepEqual(await regionOf(page), { top: ['widget-mood'], center: ['widget-note'], right: ['nav', 'widget-tasks'] }, 'kept after a reload');

      await page.goto(`${app.url}/#/settings`);
      await page.getByTestId('widget-reset').tap();
      await page.goto(`${app.url}/#/`);
      await page.getByTestId('widget-note').waitFor();
      assert.deepEqual(await regionOf(page), { center: ['widget-note'], right: ['nav', 'widget-mood', 'widget-tasks'] }, 'back to the starting layout');
      assert.deepEqual(page.errors, []);
    }));
});

describe('the bottom tab bar', () => {
  const current = (page) => page.locator('[data-testid="tabbar"] a[aria-current="page"]').allInnerTexts();

  test('Today, Tasks, People and Notes are one tap away; tags belong to Notes; the bar steps aside while writing', () =>
    withPhone(browser, async ({ page, app }) => {
      await page.goto(`${app.url}/#/`);
      await page.getByTestId('tabbar').waitFor();
      assert.deepEqual(await current(page), ['Dashboard']);

      for (const [tab, hash, label] of [['tasks', '#/tasks', 'Tasks'], ['people', '#/people', 'People'], ['notes', '#/notes', 'Notes'], ['today', '#/', 'Dashboard']]) {
        await page.getByTestId(`tab-${tab}`).tap();
        await page.waitForFunction((h) => location.hash === h || (h === '#/' && (location.hash === '' || location.hash === '#/')), hash);
        await page.waitForFunction((l) => document.querySelector('[data-testid="tabbar"] a[aria-current="page"]')?.innerText === l, label);
      }
      await page.getByTestId('tab-notes').tap();
      await page.getByTestId('notes-tags-link').tap();
      await page.getByLabel('Tag to create').waitFor();
      assert.deepEqual(await current(page), ['Notes']);
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
