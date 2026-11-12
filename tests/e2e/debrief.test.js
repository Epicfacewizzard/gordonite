// 0.20.0: the Debrief screen, reached from Today: what was written, who was named, tasks made, tasks open and overdue and
// every suggestion waiting (the built-in ones and the ones an assistant filed), each in one tap.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { uuid } from '../../shared/ids.js';
import { dateInTz, addDays } from '../../shared/dates.js';
import { launch, TZ, withPhone, waitSaved, paragraphDoc } from './harness.js';

let browser;
before(async () => (browser = await launch()));
after(async () => browser.close());

const TOKEN = 'e2e-assistant-key-0123456789abcdef';
const today = () => dateInTz(new Date(), TZ);
const taskItem = (text, attrs = {}) => ({ type: 'taskItem', attrs: { checked: false, id: uuid(), ...attrs }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const seed = async (app, { doc, tags = ['school'], date = today(), kind = 'daily', title = null }) => {
  const id = uuid();
  const r = await app.api('PUT', `/api/notes/${id}`, { baseRevision: 0, kind, title, doc, docFormat: 1, tags, date, opId: uuid() });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return id;
};
const journalNote = (app) => app.notes().find((n) => n.kind === 'daily' && n.note_date === today() && n.id);
const journalDoc = (app) => JSON.parse(journalNote(app).doc);
const assistant = (app, method, p, body) =>
  fetch(app.url + p, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json() }));

describe('the Debrief', () => {
  test('from Today: what was written, who was named, tasks made, overdue and open tasks; tick and set When in one tap', () =>
    withPhone(browser, async ({ page, app }) => {
      const t = today();
      await seed(app, { kind: 'note', title: 'Sam Lee', tags: ['05-people'], doc: paragraphDoc('A person.') });
      await seed(app, { tags: ['daily-jots'], doc: { type: 'doc', content: [para('Lunch with Sam Lee about the fair.'), { type: 'taskList', content: [taskItem('made today')] }] } });
      const old = await seed(app, { date: addDays(t, -5), doc: { type: 'doc', content: [{ type: 'taskList', content: [taskItem('late one', { due: addDays(t, -2) }), taskItem('someday one')] }] } });

      await page.goto(`${app.url}/#/`);
      await page.getByTestId('today').waitFor();
      await page.getByTestId('today-more-toggle').waitFor();
      await page.getByTestId('today-debrief').tap();
      await page.getByTestId('debrief').waitFor();
      assert.match(await page.getByTestId('debrief-date').innerText(), /^Debrief · Today/);
      assert.deepEqual(await page.locator('[data-testid="tab-today"][aria-current="page"]').count(), 1, 'Today stays lit');

      await page.getByTestId('debrief-journal').waitFor();
      assert.match(await page.getByTestId('debrief-written').innerText(), /Lunch with Sam Lee/);
      await page.getByTestId('debrief-people').waitFor();
      assert.match(await page.getByTestId('debrief-people').innerText(), /Sam Lee/);
      assert.match(await page.getByTestId('debrief-made').innerText(), /made today/);
      assert.match(await page.getByTestId('debrief-overdue').innerText(), /late one/);
      assert.match(await page.getByTestId('debrief-open').innerText(), /someday one/);

      // tick the overdue task: saved into its own note
      await page.getByTestId('debrief-overdue').getByRole('checkbox').tap();
      await waitSaved(page);
      const items = JSON.parse(app.notes().find((n) => n.id === old).doc).content[0].content;
      assert.equal(items.find((i) => i.content[0].content[0].text === 'late one').attrs.checked, true);

      // set When on the undated one: Tomorrow, in one tap
      await page.getByTestId('debrief-open').getByTestId('debrief-when-tomorrow').tap();
      await waitSaved(page);
      const after = JSON.parse(app.notes().find((n) => n.id === old).doc).content[0].content;
      assert.equal(after.find((i) => i.content[0].content[0].text === 'someday one').attrs.due, addDays(t, 1));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scrolling');
    }));

  test('built-in suggestions: accept makes the task, dismiss hides it; nothing changes until tapped', () =>
    withPhone(browser, async ({ page, app }) => {
      await seed(app, { tags: ['daily-jots'], doc: { type: 'doc', content: [para('Need to book the hall by Friday'), para('Have to call the printer')] } });
      await page.goto(`${app.url}/#/debrief`);
      await page.getByTestId('suggestion').first().waitFor();
      assert.equal(await page.getByTestId('suggestion').count(), 2);
      assert.deepEqual(journalDoc(app).content.map((n) => n.type), ['paragraph', 'paragraph']);

      await page.locator('[data-testid="suggestion"]', { hasText: 'book the hall' }).getByTestId('suggestion-task').tap();
      await waitSaved(page);
      assert.deepEqual(journalDoc(app).content.map((n) => n.type), ['taskList', 'paragraph']);
      assert.match(journalDoc(app).content[0].content[0].attrs.due, /^\d{4}-\d{2}-\d{2}$/);
      await page.locator('[data-testid="suggestion"]', { hasText: 'call the printer' }).getByTestId('suggestion-dismiss').tap();
      await page.getByTestId('debrief-no-suggestions').waitFor();
      assert.deepEqual(journalDoc(app).content.map((n) => n.type), ['taskList', 'paragraph'], 'dismissing changed nothing');
    }));

  test('suggestions an assistant filed: accept carries each out through the usual save, and the server is told; dismiss changes nothing', () =>
    withPhone(browser, async ({ page, app }) => {
      const t = today();
      const samId = await seed(app, { kind: 'note', title: 'Sam Lee', tags: ['05-people'], doc: paragraphDoc('A person.') });
      const journal = await seed(app, { tags: ['daily-jots'], doc: { type: 'doc', content: [para('Sent the draft to Sam Lee and need to confirm the budget')] } });
      const filed = await assistant(app, 'POST', '/api/assistant/suggestions', {
        items: [
          { kind: 'task', text: 'Confirm the budget', line: 'Sent the draft to Sam Lee and need to confirm the budget', due: addDays(t, 3), reason: 'You wrote you need to' },
          { kind: 'person', name: 'Dana Reyes' },
          { kind: 'remember', personId: samId, text: 'Prefers morning meetings' },
          { kind: 'task', text: 'Water the plants' },
        ],
      });
      assert.equal(filed.status, 200, JSON.stringify(filed.json));
      const [taskP, personP, , plantsP] = filed.json.filed;

      await page.goto(`${app.url}/#/debrief`);
      await page.locator('[data-testid="proposal"]').first().waitFor();
      assert.equal(await page.getByTestId('proposal').count(), 4);
      assert.match(await page.getByTestId('proposal').first().innerText(), /from your assistant: You wrote you need to/);
      const notesBefore = app.notes().map((n) => `${n.id}:${n.revision}`).join();

      const row = (text) => page.locator('[data-testid="proposal"]', { hasText: text });
      await row('Confirm the budget').getByTestId('proposal-accept').tap();
      await row('Confirm the budget').waitFor({ state: 'detached' });
      await waitSaved(page);
      const doc = JSON.parse(app.notes().find((n) => n.id === journal).doc);
      assert.equal(doc.content[0].type, 'taskList');
      assert.equal(doc.content[0].content[0].attrs.due, addDays(t, 3));
      assert.notEqual(app.notes().map((n) => `${n.id}:${n.revision}`).join(), notesBefore, 'accepting made the change');

      await row('Dana Reyes').getByTestId('proposal-accept').tap();
      await row('Dana Reyes').waitFor({ state: 'detached' });
      await waitSaved(page);
      assert.ok(app.notes().some((n) => n.title === 'Dana Reyes'), 'the person was made');

      await row('Prefers morning meetings').getByTestId('proposal-accept').tap();
      await row('Prefers morning meetings').waitFor({ state: 'detached' });
      await page.waitForFunction(async (id) => (await (await fetch(`/api/people/${id}`)).json()).profile?.remember?.includes('Prefers morning meetings') ?? false, samId, { timeout: 10_000 });

      await row('Water the plants').getByTestId('proposal-dismiss').tap();
      await row('Water the plants').waitFor({ state: 'detached' });
      assert.equal(JSON.stringify(journalDoc(app)).includes('Water the plants'), false, 'dismissing added nothing');

      const open = await assistant(app, 'GET', `/api/assistant/suggestions?day=${t}&status=all`);
      const by = Object.fromEntries(open.json.suggestions.map((s) => [s.id, s.status]));
      assert.equal(by[taskP.id], 'accepted');
      assert.equal(by[personP.id], 'accepted');
      assert.equal(by[plantsP.id], 'dismissed');
    }, { env: { ASSISTANT_TOKEN: TOKEN } }));
});
