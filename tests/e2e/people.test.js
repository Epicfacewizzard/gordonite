import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { launch, withPhone, newId, paragraphDoc } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

const until = async (check, what, timeout = 10_000) => {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};
const seedPerson = async (app, title, tag, text, profile) => {
  const id = newId();
  await app.api('PUT', `/api/notes/${id}`, { baseRevision: 0, kind: 'note', title, doc: paragraphDoc(text), docFormat: 1, tags: [tag], date: '2026-10-05' });
  if (profile) await app.api('PUT', `/api/people/${id}`, { profile });
  return id;
};
const profileOf = async (app, id) => (await app.api('GET', `/api/people/${id}`)).json.profile;

describe('people', () => {
  test('the list shows details as cards or a table, filters by closeness and sorts by last talked', () =>
    withPhone(browser, async ({ page, app }) => {
      await seedPerson(app, 'Ava', '05-people/css', 'Treasurer notes', { role: 'Treasurer', closeness: 'close', lastTalked: '2026-01-01' });
      await seedPerson(app, 'Ben', '05-people/nursing', 'Lab partner', { closeness: 'friendly', lastTalked: '2026-09-01' });
      await seedPerson(app, 'Cy', '05-people/css', 'No details yet', null);
      await page.goto(`${app.url}/#/people`);
      await page.getByTestId('person-note').first().waitFor();
      assert.deepEqual(await page.locator('.person-card .note-title').allInnerTexts(), ['Ava', 'Ben', 'Cy']);
      assert.match(await page.getByTestId('person-note').first().innerText(), /Treasurer/);

      await page.getByRole('group', { name: 'Closeness' }).getByRole('button', { name: 'Close', exact: true }).tap();
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="person-note"]').length === 1);
      await page.getByRole('group', { name: 'Closeness' }).getByRole('button', { name: 'Close', exact: true }).tap();

      await page.getByLabel('Sort people').selectOption('talked');
      await page.waitForFunction(() => document.querySelector('.person-card .note-title')?.textContent === 'Cy');
      assert.deepEqual(await page.locator('.person-card .note-title').allInnerTexts(), ['Cy', 'Ava', 'Ben'], 'never talked, then longest ago');

      await page.getByTestId('people-table-view').tap();
      await page.getByTestId('people-table').waitFor();
      assert.deepEqual(await page.getByTestId('person-row').evaluateAll((rows) => rows.map((r) => r.lastChild.textContent)), ['Cy', 'Ava', 'Ben'], 'same order in the table');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the table scrolls in its box, not the page');
      await page.reload();
      await page.getByTestId('people-table').waitFor(); // the choice is kept on the device
    }));

  test('on a wide screen the list and the open person sit side by side; on a phone a person opens on their own page', () =>
    withPhone(browser, async ({ page, app }) => {
      const ava = await seedPerson(app, 'Ava', '05-people/css', 'Treasurer notes', { role: 'Treasurer' });
      const ben = await seedPerson(app, 'Ben', '05-people/nursing', 'Lab partner', null);
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`${app.url}/#/people`);
      await page.getByTestId('people-open').getByTestId('person-profile').waitFor();
      assert.equal(await page.getByTestId('people-open').getByTestId('note-page').getAttribute('data-note-id'), ava, 'the first person is open');
      await page.getByTestId('person-note').nth(1).click();
      await page.waitForFunction((id) => document.querySelector('[data-testid="people-open"] [data-testid="note-page"]')?.dataset.noteId === id, ben);
      assert.equal(await page.evaluate(() => location.hash), `#/people/${ben}`);
      assert.equal(await page.getByTestId('person-note').nth(1).getAttribute('aria-current'), 'true');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction((id) => location.hash === `#/n/${id}`, ben);
      await page.getByTestId('person-profile').waitFor();
    }));

  test('a person’s page shows their details; adding and changing one is saved, offline too', () =>
    withPhone(browser, async ({ page, app, context }) => {
      const id = await seedPerson(app, 'Dana Ruiz', '05-people/friends', 'Met at the fair', { role: 'Neighbour' });
      await page.goto(`${app.url}/#/n/${id}`);
      await page.getByTestId('person-profile').waitFor();
      assert.match(await page.getByTestId('person-header').innerText(), /DR/);
      assert.match(await page.getByTestId('person-profile').innerText(), /Role\s+Neighbour/);

      // add a birthday (always shown, says "Add" when empty)
      assert.match(await page.locator('[data-prop="birthday"]').innerText(), /Add/);
      await page.getByRole('button', { name: 'Change birthday' }).tap();
      await page.getByLabel('Month').selectOption('3');
      await page.getByLabel('Day').fill('14');
      await page.getByTestId('person-save').tap();
      await until(async () => (await profileOf(app, id)).birthday === '03-14', 'the birthday on the server');
      assert.equal((await profileOf(app, id)).role, 'Neighbour', 'the rest is kept');

      // offline: the change waits on the phone and is sent on reconnect
      await context.setOffline(true);
      await page.getByTestId('person-talked-today').tap();
      await page.getByText('Details waiting to be sent.').waitFor();
      assert.equal((await profileOf(app, id)).lastTalked, '');
      await context.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event('hq-reconnected')));
      await until(async () => (await profileOf(app, id)).lastTalked !== '', 'last talked on the server', 15_000);
      await page.getByText('Details waiting to be sent.').waitFor({ state: 'detached' });

      // log a conversation: it goes into the note's Log and shows as what was last talked about
      await page.getByTestId('person-log-open').tap();
      await page.getByTestId('person-log-dialog').getByLabel('How').selectOption('Call');
      await page.getByTestId('person-log-text').fill('Planned the street party');
      await page.getByTestId('person-log-save').tap();
      await page.getByTestId('person-log-dialog').waitFor({ state: 'detached' });
      await until(() => /· Call: Planned the street party/.test(app.docText(id)), 'the line in the note', 15_000);
      assert.match(await page.locator('[data-prop="lastTalked"]').innerText(), /Today[\s\S]*Call: Planned the street party/);
      await page.goto(`${app.url}/#/people`);
      await page.getByTestId('person-last').first().waitFor();
      assert.match(await page.getByTestId('person-last').first().innerText(), /Spoke today · Call: Planned the street party/);

      // an ordinary note has no details block
      const plain = newId();
      await app.api('PUT', `/api/notes/${plain}`, { baseRevision: 0, kind: 'note', title: 'Groceries', doc: paragraphDoc('milk'), docFormat: 1, tags: ['home'], date: '2026-10-05' });
      await page.goto(`${app.url}/#/n/${plain}`);
      await page.locator('.note-text[contenteditable="true"]').waitFor();
      assert.equal(await page.getByTestId('person-profile').count(), 0);
    }));
});
