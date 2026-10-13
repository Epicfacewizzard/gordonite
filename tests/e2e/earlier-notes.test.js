import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { uuid } from '../../shared/ids.js';
import { dateInTz, addDays } from '../../shared/dates.js';
import { launch, TZ, withPhone, waitSaved } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

const today = () => dateInTz(new Date(), TZ);
const paragraph = (text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : undefined });

// A note of the given kind on a given date. `blocks` default to one paragraph of `text`.
async function seed(app, { text, blocks, date, tags = ['daily-jots'], kind = 'daily', title }) {
  const id = uuid();
  const r = await app.api('PUT', `/api/notes/${id}`, {
    baseRevision: 0,
    doc: { type: 'doc', content: blocks ?? [paragraph(text)] },
    docFormat: 1,
    tags,
    date,
    kind,
    ...(title ? { title } : {}),
    opId: uuid(),
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return id;
}

const daysAgo = (n) => addDays(today(), -n);
const dates = (page) => page.getByTestId('prev-note').evaluateAll((els) => els.map((e) => e.dataset.date));
const card = (page, date) => page.locator(`[data-testid="prev-note"][data-date="${date}"]`);
const todayEditor = (page) => page.locator('[data-testid="widget-note"] > article .note-text[contenteditable="true"]');
const open = async (page, app) => {
  await page.goto(`${app.url}/#/`);
  await page.locator('[data-testid="widget-note"] .note-text[contenteditable="true"]').waitFor();
};

describe("Dashboard: the last few days under today's note", () => {
  test('shows the last two written days, newest first, greyed; each card is headed by its date, with no "Earlier" label', () =>
    withPhone(browser, async ({ page, app }) => {
      await seed(app, { text: 'two days ago', date: daysAgo(2) });
      await seed(app, { text: 'yesterday', date: daysAgo(1) });
      await seed(app, { blocks: [paragraph('')], date: daysAgo(3) }); // nothing written: skipped
      await seed(app, { text: 'four days ago', date: daysAgo(4) });
      await open(page, app);
      await page.getByTestId('earlier-notes').waitFor();

      assert.deepEqual(await dates(page), [daysAgo(1), daysAgo(2)], 'only the last two written days, newest first');
      assert.match(await card(page, daysAgo(1)).locator('.note-date').innerText(), /Yesterday/);
      assert.match(await card(page, daysAgo(2)).locator('.note-date').innerText(), /\w{3}, \w{3} \d+/, 'older days show their date');
      const widget = await page.getByTestId('widget-note').innerText();
      assert.doesNotMatch(widget, /^\s*earlier\s*$/im, 'no "Earlier" heading');
      assert.equal(await page.locator('.earlier-title').count(), 0);

      const opacity = await page.getByTestId('prev-note').first().evaluate((e) => Number(getComputedStyle(e).opacity));
      assert.ok(opacity < 1, `greyed out until tapped (opacity ${opacity})`);
      assert.equal(await page.locator('[data-testid="widget-note"] [contenteditable="true"]').count(), 1, "only today's note is open for editing");
    }));

  test('tapping an earlier day edits it right there; what is typed is saved to that day, not into a new note', () =>
    withPhone(browser, async ({ page, app }) => {
      const id = await seed(app, { text: 'Went to the market.', date: daysAgo(1) });
      await seed(app, { text: 'two days ago', date: daysAgo(2) });
      await open(page, app);
      await page.getByTestId('prev-note').first().waitFor();

      await card(page, daysAgo(1)).locator('[data-testid="note-static"] p').first().tap();
      const editor = card(page, daysAgo(1)).locator('.note-text[contenteditable="true"]');
      await editor.waitFor();
      assert.equal(page.url().endsWith('#/'), true, 'stays on the dashboard');
      assert.equal(await page.locator('[data-testid="widget-note"] [contenteditable="true"]').count(), 1, 'one editor at a time');
      assert.equal(await todayEditor(page).count(), 0, "today's note is read-only while an earlier day is being edited");
      // (it fades from grey over a moment, so wait for the fade to finish)
      await page.waitForFunction(
        (d) => Number(getComputedStyle(document.querySelector(`[data-testid="prev-note"][data-date="${d}"]`)).opacity) === 1,
        daysAgo(1),
        { timeout: 3000 },
      );

      await page.waitForTimeout(400);
      await page.keyboard.press('Control+End');
      await page.keyboard.type(' Bought plums.');
      await waitSaved(page);
      assert.equal(app.docText(id), 'Went to the market. Bought plums.');
      assert.equal(app.notes().length, 2, 'no note was created for today');
    }));

  test("going back to today's note: it opens again, the earlier day is left as it was", () =>
    withPhone(browser, async ({ page, app }) => {
      const id = await seed(app, { text: 'yesterday as written', date: daysAgo(1) });
      await open(page, app);
      await card(page, daysAgo(1)).locator('[data-testid="note-static"] p').first().tap();
      await card(page, daysAgo(1)).locator('.note-text[contenteditable="true"]').waitFor();

      await page.locator('[data-testid="widget-note"] > article [data-testid="note-static"]').tap();
      await todayEditor(page).waitFor();
      assert.equal(await card(page, daysAgo(1)).locator('[contenteditable="true"]').count(), 0);
      await page.waitForTimeout(400);
      await page.keyboard.type('written today');
      await waitSaved(page);
      const today_ = app.notes().find((n) => n.note_date === today());
      assert.equal(app.docText(today_.id), 'written today');
      assert.equal(app.docText(id), 'yesterday as written');
    }));

  test('a checkbox in an earlier day can be ticked in place, and is saved', () =>
    withPhone(browser, async ({ page, app }) => {
      const blocks = [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false, id: uuid() }, content: [paragraph('buy stamps')] }] }];
      const id = await seed(app, { blocks, date: daysAgo(1) });
      await open(page, app);
      await card(page, daysAgo(1)).locator('input[type="checkbox"]').first().tap();
      await card(page, daysAgo(1)).locator('.note-text[contenteditable="true"]').waitFor();
      await waitSaved(page);
      const doc = JSON.parse(app.db.prepare('SELECT doc FROM notes WHERE id = ?').get(id).doc);
      assert.equal(doc.content[0].content[0].attrs.checked, true);
      assert.equal(page.url().endsWith('#/'), true, 'stays on the dashboard');
    }));

  test('"Show older notes" adds three at a time and fetches older pages when the loaded ones run out', () =>
    withPhone(browser, async ({ page, app }) => {
      // 20 written days spread over more than one stream page (a page is 14 dates)
      for (let i = 1; i <= 20; i++) await seed(app, { text: `entry ${i}`, date: daysAgo(i) });
      await open(page, app);
      await page.getByTestId('earlier-notes').waitFor();
      assert.equal((await dates(page)).length, 2);

      await page.getByTestId('earlier-more').click();
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="prev-note"]').length === 5);
      assert.deepEqual((await dates(page)).slice(0, 5), [1, 2, 3, 4, 5].map(daysAgo));

      for (const want of [8, 11, 14, 17, 20]) {
        await page.getByTestId('earlier-more').click();
        await page.waitForFunction((n) => document.querySelectorAll('[data-testid="prev-note"]').length === n, want);
      }
      assert.deepEqual(await dates(page), Array.from({ length: 20 }, (_, i) => daysAgo(i + 1)), 'every day, in order, none repeated');
      assert.equal(await page.getByTestId('earlier-more').count(), 0, 'no button once everything is shown');
      assert.equal(await page.locator('[data-testid="widget-note"] [contenteditable="true"]').count(), 1, 'still a single editor');
    }));

  test('the tag choices sit beside the "Today’s note" heading, not under the note', () =>
    withPhone(browser, async ({ page, app }) => {
      await app.api('POST', '/api/tags', { path: 'school' });
      const id = (await app.api('GET', '/api/tags')).json.tags.find((t) => t.path === 'school').id;
      await app.api('PUT', `/api/tags/${id}/favorite`, { favorite: true });
      await seed(app, { text: 'yesterday', date: daysAgo(1) });
      await open(page, app);
      await page.getByTestId('daily-tag-from').waitFor();
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="daily-tag-choice"]').length === 2);

      const [heading, choices, note] = await Promise.all([
        page.locator('[data-testid="widget-note"] h2.section').boundingBox(),
        page.getByTestId('daily-tag-from').boundingBox(),
        page.locator('[data-testid="widget-note"] article').first().boundingBox(),
      ]);
      assert.ok(choices.x >= heading.x + heading.width - 1, 'to the right of the heading');
      assert.ok(Math.abs(choices.y + choices.height / 2 - (heading.y + heading.height / 2)) < 30, 'on the same line as the heading');
      assert.ok(choices.y + choices.height <= note.y, 'above the note');
    }));

  test('the list follows the chosen tag, and shows daily entries only', () =>
    withPhone(browser, async ({ page, app }) => {
      await seed(app, { text: 'jots yesterday', date: daysAgo(1) });
      await seed(app, { text: 'work yesterday', date: daysAgo(1), tags: ['work-log'] });
      await seed(app, { text: 'a standalone note, same day, same tag', date: daysAgo(1), kind: 'note', title: 'Meeting notes' });
      await open(page, app);
      await page.getByTestId('earlier-notes').waitFor();
      const text = await page.getByTestId('earlier-notes').innerText();
      assert.match(text, /jots yesterday/);
      assert.doesNotMatch(text, /work yesterday/, 'another tag');
      assert.doesNotMatch(text, /standalone note/, 'not a daily entry');

      const id = (await app.api('GET', '/api/tags')).json.tags.find((t) => t.path === 'work-log').id;
      await app.api('PUT', `/api/tags/${id}/favorite`, { favorite: true });
      await page.reload();
      await page.getByTestId('daily-tag-choice').first().waitFor();
      await page.locator('[data-testid="daily-tag-choice"][data-tag="work-log"]').click();
      await page.waitForFunction(() => /work yesterday/.test(document.querySelector('[data-testid="earlier-notes"]')?.innerText ?? ''));
      assert.doesNotMatch(await page.getByTestId('earlier-notes').innerText(), /jots yesterday/);
    }));

  test('a long entry is cut off with a fade until it is opened; a phone-width screen does not scroll sideways', () =>
    withPhone(browser, async ({ page, app }) => {
      const blocks = Array.from({ length: 20 }, (_, i) => paragraph(`Line ${i + 1} of a long entry that goes on and on.`));
      await seed(app, { blocks, date: daysAgo(1) });
      await seed(app, { text: 'short', date: daysAgo(2) });
      await open(page, app);
      await page.getByTestId('prev-note').nth(1).waitFor();
      await page.waitForFunction(() => document.querySelector('[data-testid="prev-note"]')?.classList.contains('clamped'));
      assert.equal(await page.getByTestId('prev-note').nth(1).evaluate((e) => e.classList.contains('clamped')), false, 'a short entry is not faded');
      const closed = await card(page, daysAgo(1)).evaluate((e) => e.getBoundingClientRect().height);
      assert.ok(closed < 320, `capped while closed (${Math.round(closed)}px)`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 0, `no sideways scroll (${overflow}px)`);

      await card(page, daysAgo(1)).locator('[data-testid="note-static"] p').first().tap();
      await card(page, daysAgo(1)).locator('.note-text[contenteditable="true"]').waitFor();
      const open_ = await card(page, daysAgo(1)).evaluate((e) => e.getBoundingClientRect().height);
      assert.ok(open_ > closed, `opens in full for editing (${Math.round(open_)}px)`);
    }));

  test("today's own note is not repeated under itself, and nothing shows when there is no earlier day", () =>
    withPhone(browser, async ({ page, app }) => {
      await seed(app, { text: 'written today', date: today() });
      await open(page, app);
      assert.equal(await page.getByTestId('earlier-notes').count(), 0);
      assert.equal(await page.getByTestId('prev-note').count(), 0);
      assert.match(await todayEditor(page).innerText(), /written today/);
    }));
});
