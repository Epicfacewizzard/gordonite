import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { uuid } from '../../shared/ids.js';
import { dateInTz } from '../../shared/dates.js';
import { launch, TZ, withPhone } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
const item = (text, attrs) => ({ type: 'taskItem', attrs: { id: uuid(), checked: false, ...attrs }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

async function seed(app) {
  const id = uuid();
  const r = await app.api('PUT', `/api/notes/${id}`, {
    baseRevision: 0, kind: 'note', title: 'History', date: dateInTz(new Date(), TZ), tags: ['school'], docFormat: 1,
    doc: { type: 'doc', content: [{ type: 'taskList', content: [
      item('done today', { checked: true, completedAt: daysAgo(0) }),
      item('done last month', { checked: true, completedAt: daysAgo(30) }),
      item('dismissed yesterday', { dismissedAt: daysAgo(1) }),
      item('dismissed last month', { dismissedAt: daysAgo(30) }),
    ] }] },
  });
  assert.equal(r.status, 200);
}
const texts = (page, section) => page.getByTestId(`section-${section}`).locator('.task-text').allInnerTexts().then((t) => t.map((x) => x.trim()));

test('Done and Dismissed on the Tasks page start with the last 7 days; older ones are counted and one tap shows them', () =>
  withPhone(browser, async ({ page, app }) => {
    await seed(app);
    await page.goto(`${app.url}/#/tasks`);
    await page.getByTestId('toggle-done').tap();
    assert.deepEqual(await texts(page, 'done'), ['done today']);
    assert.match(await page.getByTestId('outside-done').innerText(), /1 outside this range/);
    await page.getByTestId('toggle-dismissed').tap();
    assert.deepEqual(await texts(page, 'dismissed'), ['dismissed yesterday']);

    await page.getByTestId('show-all-done').tap();
    assert.deepEqual((await texts(page, 'done')).sort(), ['done last month', 'done today']);
    assert.deepEqual((await texts(page, 'dismissed')).sort(), ['dismissed last month', 'dismissed yesterday'], 'one range for both lists');
    assert.equal(await page.getByTestId('outside-done').count(), 0);
    assert.deepEqual(page.errors, []);
  }));

test('Settings sets how far back they start; Everything starts with no limit', () =>
  withPhone(browser, async ({ page, app }) => {
    await seed(app);
    await page.goto(`${app.url}/#/settings`);
    assert.equal(await page.getByTestId('done-days').inputValue(), '7', 'a week by default');
    await page.getByTestId('done-days').selectOption('0');
    await page.goto(`${app.url}/#/tasks`);
    await page.getByTestId('toggle-done').tap();
    assert.equal((await texts(page, 'done')).length, 2);
    assert.equal(await page.getByTestId('outside-done').count(), 0);

    await page.goto(`${app.url}/#/settings`);
    await page.getByTestId('done-days').selectOption('90');
    await page.goto(`${app.url}/#/tasks`);
    await page.getByTestId('toggle-done').tap();
    assert.equal((await texts(page, 'done')).length, 2, '90 days still reaches last month');
    await page.goto(`${app.url}/#/settings`);
    await page.getByTestId('done-days').selectOption('14');
    await page.goto(`${app.url}/#/tasks`);
    await page.getByTestId('toggle-done').tap();
    assert.deepEqual(await texts(page, 'done'), ['done today'], '14 days does not');
  }));

test('a note\'s own task history starts with the same length', () =>
  withPhone(browser, async ({ page, app }) => {
    await seed(app);
    await page.goto(`${app.url}/#/t/school`);
    const archive = page.getByTestId('task-archive').first();
    await archive.waitFor();
    await archive.locator('summary').tap();
    const body = await archive.innerText();
    assert.match(body, /done today/);
    assert.doesNotMatch(body, /done last month/, 'older than the default week');
    await page.goto(`${app.url}/#/settings`);
    await page.getByTestId('done-days').selectOption('0');
    await page.goto(`${app.url}/#/t/school`);
    const again = page.getByTestId('task-archive').first();
    await again.waitFor();
    await again.locator('summary').tap();
    assert.match(await again.innerText(), /done last month/, 'Everything shows it');
  }));
