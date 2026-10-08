import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, withPhone } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

const entries = (app) => app.db.prepare('SELECT score, note, deleted_at FROM mood_entries ORDER BY logged_at, id').all();

test('only the faces show at first; picking one reveals Note and Log, and nothing is saved until Log', () =>
  withPhone(browser, async ({ page, app }) => {
    await page.goto(`${app.url}/#/`);
    await page.getByTestId('widget-mood').waitFor();
    for (const hidden of ['mood-note', 'mood-log', 'mood-table', 'mood-summary', 'mood-entries']) {
      assert.equal(await page.getByTestId(hidden).count(), 0, `${hidden} is not shown at first`);
    }
    assert.equal(await page.getByRole('group', { name: 'How are you feeling?' }).getByRole('button').count(), 5);

    await page.getByTestId('mood-2').tap();
    await page.getByTestId('mood-note').waitFor();
    assert.equal(await page.getByTestId('mood-note').getAttribute('placeholder'), 'Note');
    assert.equal((await page.getByTestId('mood-log').innerText()).trim(), 'Log');
    assert.equal(await page.getByTestId('mood-2').getAttribute('aria-pressed'), 'true');
    assert.equal(entries(app).length, 0, 'picking a face alone saves nothing');

    await page.getByTestId('mood-2').tap(); // the same face again puts it away
    await page.getByTestId('mood-note').waitFor({ state: 'detached' });

    await page.getByTestId('mood-2').tap();
    await page.getByTestId('mood-note').fill('slept badly');
    await page.getByTestId('mood-log').tap();
    await page.getByTestId('mood-done').waitFor();
    await page.getByTestId('mood-note').waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelector('[data-testid="mood-2"]')?.getAttribute('aria-pressed') === 'false');
    await page.getByTestId('mood-5').tap();
    await page.getByTestId('mood-log').tap(); // a note is optional
    await page.waitForFunction(() => document.querySelector('[data-testid="mood-note"]') === null);
    await page.waitForTimeout(300);
    assert.deepEqual(entries(app).map((e) => [e.score, e.note]), [[2, 'slept badly'], [5, null]]);
    for (const hidden of ['mood-table', 'mood-summary', 'mood-entries']) {
      assert.equal(await page.getByTestId(hidden).count(), 0, `${hidden} stays hidden after logging`);
    }
    assert.deepEqual(page.errors, []);
  }));

test('the hidden history still works when switched on: today, the 7-day table, the streak, and delete', () =>
  withPhone(browser, async ({ page, app }) => {
    await page.goto(`${app.url}/#/settings`);
    await page.getByTestId('mood-pref-history').check(); // the switch in Settings → Dashboard
    await page.goto(`${app.url}/#/`);
    await page.getByTestId('widget-mood').waitFor();
    assert.match(await page.getByTestId('mood-summary').innerText(), /0 of the last 7 days/);
    assert.equal(await page.getByTestId('mood-entries').count(), 0, 'nothing today yet');

    await page.getByTestId('mood-2').tap();
    await page.getByTestId('mood-note').fill('slept badly');
    await page.getByTestId('mood-log').tap();
    await page.getByTestId('mood-entry').first().waitFor();
    await page.getByTestId('mood-5').tap();
    await page.getByTestId('mood-log').tap();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="mood-entry"]').length === 2);
    const texts = await page.getByTestId('mood-entry').allInnerTexts();
    assert.match(texts[0], /slept badly/);
    assert.deepEqual(entries(app).map((e) => [e.score, e.note]), [[2, 'slept badly'], [5, null]]);

    // chart and streak
    assert.match(await page.getByTestId('mood-summary').innerText(), /1-day streak · 1 of the last 7 days/);
    assert.equal(await page.getByTestId('mood-cell').count(), 7, 'a small table: one cell per day of the last week');
    assert.match(await page.getByTestId('mood-cell').last().getAttribute('title'), /average 3\.5 \(2 entries\)/, 'today averages the two entries');
    assert.equal(await page.getByTestId('mood-cell').first().getAttribute('title').then((t) => /nothing logged/.test(t)), true);

    // it is all still there after a reload
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="mood-entry"]').length === 2);

    // delete one: gone from the list, kept (soft-deleted) on the server
    await page.getByTestId('mood-delete').first().tap();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="mood-entry"]').length === 1);
    await page.waitForFunction(() => document.querySelector('[data-testid="mood-summary"]').innerText.includes('1 of the last'));
    assert.equal(entries(app).filter((e) => e.deleted_at).length, 1);
    assert.deepEqual(page.errors, []);
  }));

test('a log while the connection is down is kept on the phone and sent when it is back', () =>
  withPhone(browser, async ({ page, app }) => {
    await page.goto(`${app.url}/#/`);
    await page.getByTestId('widget-mood').waitFor();
    await page.context().setOffline(true);
    await page.getByTestId('mood-4').tap();
    await page.getByTestId('mood-log').tap();
    await page.getByTestId('mood-status').waitFor();
    assert.match(await page.getByTestId('mood-status').innerText(), /Not sent yet/);
    assert.equal(entries(app).length, 0, 'the server has not seen it');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('hq-mood-pending')).length), 1, 'it is saved on the phone');

    await page.context().setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => !document.querySelector('[data-testid="mood-status"]'));
    assert.deepEqual(entries(app).map((e) => e.score), [4]);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('hq-mood-pending')).length), 0, 'the queue is empty again');
    assert.deepEqual(page.errors.filter((e) => !/Failed to fetch|NetworkError|net::ERR/i.test(String(e))), []);
  }));

test('Settings can turn the note step off, so one tap on a face logs it, and back on', () =>
  withPhone(browser, async ({ page, app }) => {
    await page.goto(`${app.url}/#/settings`);
    assert.equal(await page.getByTestId('mood-pref-askNote').isChecked(), true, 'asking for a note is the default');
    assert.equal(await page.getByTestId('mood-pref-history').isChecked(), false, 'history is off by default');
    await page.getByTestId('mood-pref-askNote').uncheck();
    await page.goto(`${app.url}/#/`);
    await page.getByTestId('widget-mood').waitFor();
    await page.getByTestId('mood-3').tap();
    await page.getByTestId('mood-done').waitFor();
    assert.equal(await page.getByTestId('mood-note').count(), 0, 'no Note box when the step is off');
    await page.waitForTimeout(300);
    assert.deepEqual(entries(app).map((e) => [e.score, e.note]), [[3, null]]);

    await page.goto(`${app.url}/#/settings`);
    await page.getByTestId('mood-pref-askNote').check();
    await page.goto(`${app.url}/#/`);
    await page.getByTestId('mood-3').tap();
    await page.getByTestId('mood-note').waitFor();
    assert.equal(entries(app).length, 1, 'with the step back on, a face alone saves nothing');
    assert.deepEqual(page.errors, []);
  }));
