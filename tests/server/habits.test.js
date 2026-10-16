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

test('frequency, numbers with a target, colour, question, reminder and archive are kept; bad ones are refused', async () => {
  const id = uuid();
  const custom = { freq: { type: 'week', times: 3 }, kind: 'number', unit: 'glasses', target: 8, targetType: 'atLeast', color: 'blue', question: 'Did you drink water?', reminder: '21:00', archived: false };
  assert.equal((await app.api('PUT', `/api/habits/${id}`, habit({ name: 'Water', ...custom }))).status, 200);
  let h = (await list()).habits.find((x) => x.id === id);
  for (const [k, v] of Object.entries(custom)) assert.deepEqual(h[k], v, k);

  // an app from before these options saves the habit without them: they stay
  await app.api('PUT', `/api/habits/${id}`, habit({ name: 'Water!' }));
  h = (await list()).habits.find((x) => x.id === id);
  assert.equal(h.name, 'Water!');
  assert.deepEqual(h.freq, custom.freq);
  assert.equal(h.target, 8);

  await app.api('PUT', `/api/habits/${id}`, habit({ name: 'Water', ...custom, archived: true }));
  assert.equal((await list()).habits.find((x) => x.id === id).archived, true, 'archived habits are still listed, marked');

  const code = async (over) => (await app.api('PUT', `/api/habits/${uuid()}`, habit(over))).json.error?.code;
  assert.equal(await code({ freq: { type: 'week', times: 9 } }), 'bad_options');
  assert.equal(await code({ freq: { type: 'every', n: 0 } }), 'bad_options');
  assert.equal(await code({ kind: 'number' }), 'bad_options', 'a number habit needs a target');
  assert.equal(await code({ color: 'chartreuse' }), 'bad_options');
  assert.equal(await code({ reminder: '25:00' }), 'bad_options');
  assert.equal(await code({ freq: { type: 'week', times: 2 }, trigger: { product: 'Betaderm', days: 7 } }), 'bad_trigger');
  const old = (await list()).habits.find((x) => x.name === 'Read');
  assert.equal(old?.kind ?? 'yesno', 'yesno', 'a habit from before reads as yes-or-no');
});

test('a check-in can carry a number or be a skipped day; a plain tick keeps what the day has', async () => {
  const id = uuid();
  await app.api('PUT', `/api/habits/${id}`, habit({ kind: 'number', target: 8 }));
  const day = addDays(today(), -1);
  await app.api('PUT', `/api/habits/${id}/checks/${day}`, { value: 6.5, skip: false });
  await app.api('PUT', `/api/habits/${id}/checks/${today()}`, { value: null, skip: true });
  let c = (await list()).checks.filter((x) => x.habitId === id);
  assert.deepEqual(c.map(({ date, value, skip }) => ({ date, value, skip })), [{ date: day, value: 6.5, skip: false }, { date: today(), value: null, skip: true }]);
  await app.api('PUT', `/api/habits/${id}/checks/${day}`); // an older app's tick
  assert.equal((await list()).checks.find((x) => x.habitId === id && x.date === day).value, 6.5);
  await app.api('PUT', `/api/habits/${id}/checks/${day}`, { value: 9, skip: false });
  c = (await list()).checks.find((x) => x.habitId === id && x.date === day);
  assert.equal(c.value, 9, 'replaced');
  assert.equal((await app.api('PUT', `/api/habits/${id}/checks/${day}`, { value: 'lots' })).json.error.code, 'bad_value');

  const exported = JSON.parse((await app.api('GET', '/api/export/json')).text);
  assert.equal(exported.habits.find((h) => h.id === id).target, 8);
  const other = await startServer({ HOME_TZ: 'America/Edmonton' });
  try {
    await other.api('POST', '/api/import?mode=merge', exported);
    const l = (await other.api('GET', '/api/habits')).json;
    assert.equal(l.habits.find((h) => h.id === id).kind, 'number');
    assert.ok(l.checks.some((x) => x.habitId === id && x.date === today() && x.skip));
    assert.ok(l.checks.some((x) => x.habitId === id && x.date === day && x.value === 9));
  } finally {
    await other.close();
  }
});
