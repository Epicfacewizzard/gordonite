import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { uuid } from '../../shared/ids.js';
import { dateInTz, addDays } from '../../shared/dates.js';

let app;
before(async () => (app = await startServer({ HOME_TZ: 'America/Edmonton' })));
after(async () => app.close());

const today = () => dateInTz(new Date(), 'America/Edmonton');
const habit = (over = {}) => ({ name: 'Read', detail: 'Ten minutes', days: [0, 1, 2, 3, 4, 5, 6], created: addDays(today(), -10), ...over });
const list = async () => (await app.api('GET', '/api/habits')).json;

test('a habit is saved, ticked and unticked, edited, and deleted softly', async () => {
  const id = uuid();
  assert.equal((await app.api('PUT', `/api/habits/${id}`, habit())).status, 200);
  assert.equal((await app.api('PUT', `/api/habits/${id}/checks/${today()}`)).status, 200);
  assert.equal((await app.api('PUT', `/api/habits/${id}/checks/${today()}`)).status, 200, 'ticking twice is fine');
  let l = await list();
  assert.deepEqual(l.checks.filter((c) => c.habitId === id).map((c) => c.date), [today()]);
  await app.api('DELETE', `/api/habits/${id}/checks/${today()}`);
  l = await list();
  assert.equal(l.checks.filter((c) => c.habitId === id).length, 0);
  await app.api('PUT', `/api/habits/${id}`, habit({ name: 'Read more', days: [1, 3, 5] }));
  l = await list();
  assert.deepEqual(l.habits.find((h) => h.id === id).days, [1, 3, 5]);
  await app.api('DELETE', `/api/habits/${id}`);
  assert.equal((await list()).habits.some((h) => h.id === id), false);
});

test('bad habits and future check-ins are refused', async () => {
  const code = async (body) => (await app.api('PUT', `/api/habits/${uuid()}`, body)).json.error.code;
  assert.equal(await code(habit({ name: ' ' })), 'bad_name');
  assert.equal(await code(habit({ days: [] })), 'bad_days');
  assert.equal(await code(habit({ trigger: { product: 'Betaderm', days: 0 } })), 'bad_trigger');
  const id = uuid();
  await app.api('PUT', `/api/habits/${id}`, habit());
  assert.equal((await app.api('PUT', `/api/habits/${id}/checks/${addDays(today(), 1)}`)).json.error.code, 'future_date');
});

test('logging a product in the skin log starts the linked habit course and ticks that day; logging again extends it', async () => {
  const id = uuid();
  await app.api('PUT', `/api/habits/${id}`, habit({ name: 'Betaderm course', trigger: { product: 'Betaderm', days: 7 } }));
  const day = addDays(today(), -3);
  const entry = (date, products) => ({ date, time: '2100', text: '2100: x', data: { products }, noteId: uuid() });
  const r = await app.api('PUT', `/api/skin/${uuid()}`, entry(day, ['betaderm', 'Eucerin']));
  assert.deepEqual(r.json.habits, [id], 'the product name matches whatever the case');
  let h = (await list()).habits.find((x) => x.id === id);
  assert.deepEqual(h.courses, [{ from: day, to: addDays(day, 6) }]);
  assert.ok((await list()).checks.some((c) => c.habitId === id && c.date === day && c.source === 'skin'));

  await app.api('PUT', `/api/skin/${uuid()}`, entry(today(), ['Betaderm']));
  h = (await list()).habits.find((x) => x.id === id);
  assert.deepEqual(h.courses, [{ from: day, to: addDays(today(), 6) }], 'used again during the course: it runs 7 days from then');

  await app.api('PUT', `/api/skin/${uuid()}`, entry(today(), ['CeraVe']));
  assert.deepEqual((await list()).habits.find((x) => x.id === id).courses, h.courses, 'another product changes nothing');
});

test('habits and check-ins travel in the JSON export and come back on import', async () => {
  const id = uuid();
  await app.api('PUT', `/api/habits/${id}`, habit({ name: 'Exported habit' }));
  await app.api('PUT', `/api/habits/${id}/checks/${today()}`);
  const exported = JSON.parse((await app.api('GET', '/api/export/json')).text);
  const other = await startServer({ HOME_TZ: 'America/Edmonton' });
  try {
    const r = await other.api('POST', '/api/import?mode=merge', exported);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const l = (await other.api('GET', '/api/habits')).json;
    assert.ok(l.habits.some((h) => h.id === id && h.name === 'Exported habit'));
    assert.ok(l.checks.some((c) => c.habitId === id && c.date === today()));
  } finally {
    await other.close();
  }
});
