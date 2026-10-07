import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, withPhone } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

const entries = (app) => app.db.prepare('SELECT score, note, deleted_at FROM mood_entries ORDER BY logged_at, id').all();

test('tap a face to log a mood, several a day, with an optional note; see today, the chart and the streak; delete one', () =>
  withPhone(browser, async ({ page, app }) => {
    await page.goto(`${app.url}/#/`);
    await page.getByTestId('widget-mood').waitFor();
    assert.match(await page.getByTestId('mood-summary').innerText(), /0 of the last 7 days/);
    assert.equal(await page.getByTestId('mood-entries').count(), 0, 'nothing today yet');

    await page.getByTestId('mood-note').fill('slept badly');
    await page.getByTestId('mood-2').tap();
    await page.getByTestId('mood-entry').first().waitFor();
    assert.equal(await page.getByTestId('mood-note').inputValue(), '', 'the note field is cleared after a tap');
    await page.getByTestId('mood-5').tap();
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

test('a tap while the connection is down is kept on the phone and sent when it is back', () =>
  withPhone(browser, async ({ page, app }) => {
    await page.goto(`${app.url}/#/`);
    await page.getByTestId('widget-mood').waitFor();
    await page.context().setOffline(true);
    await page.getByTestId('mood-4').tap();
    await page.getByTestId('mood-entry').waitFor();
    assert.match(await page.getByTestId('mood-entry').innerText(), /not sent yet/);
    assert.equal(entries(app).length, 0, 'the server has not seen it');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('hq-mood-pending')).length), 1, 'it is saved on the phone');

    await page.context().setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => !document.querySelector('[data-testid="mood-entry"]')?.innerText.includes('not sent yet'));
    assert.deepEqual(entries(app).map((e) => e.score), [4]);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('hq-mood-pending')).length), 0, 'the queue is empty again');
    assert.deepEqual(page.errors.filter((e) => !/Failed to fetch|NetworkError|net::ERR/i.test(String(e))), []);
  }));
