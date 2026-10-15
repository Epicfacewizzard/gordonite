import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { uuid } from '../../shared/ids.js';

let app;
before(async () => (app = await startServer({ HOME_TZ: 'America/Edmonton' })));
after(async () => app.close());

const entry = (over = {}) => ({ date: '2026-10-14', time: '2143', data: { symptoms: ['Itch'], products: ['Betaderm'] }, text: '2143: Itch on legs. Betaderm applied on legs.', noteId: uuid(), ...over });

test('an entry is saved by id, read back newest first, replaced when saved again, and deleted softly', async () => {
  const a = uuid();
  const b = uuid();
  assert.equal((await app.api('PUT', `/api/skin/${a}`, entry())).status, 200);
  assert.equal((await app.api('PUT', `/api/skin/${b}`, entry({ time: '2330', text: '2330: Reassessment of 2143 (Betaderm). Response: relief.', followsId: a, data: { response: ['Relief'] } }))).status, 200);
  let list = (await app.api('GET', '/api/skin?from=2026-10-01&to=2026-10-31')).json.entries;
  assert.deepEqual(list.map((e) => e.time), ['2330', '2143']);
  assert.equal(list[0].followsId, a);
  assert.deepEqual(list[1].data, { symptoms: ['Itch'], products: ['Betaderm'] });

  const edited = await app.api('PUT', `/api/skin/${a}`, entry({ text: '2143: Itch on arms. Betaderm applied on arms.', data: { symptoms: ['Itch'], areas: ['Arms'] } }));
  assert.equal(edited.json.entry.text, '2143: Itch on arms. Betaderm applied on arms.');
  list = (await app.api('GET', '/api/skin?from=2026-10-01&to=2026-10-31')).json.entries;
  assert.equal(list.length, 2, 'saving again replaces, it does not add');

  assert.equal((await app.api('DELETE', `/api/skin/${b}`)).status, 200);
  assert.equal((await app.api('DELETE', `/api/skin/${b}`)).status, 200, 'deleting twice is fine');
  list = (await app.api('GET', '/api/skin?from=2026-10-01&to=2026-10-31')).json.entries;
  assert.deepEqual(list.map((e) => e.id), [a]);
});

test('bad entries are refused with a plain reason', async () => {
  const bad = async (over) => (await app.api('PUT', `/api/skin/${uuid()}`, entry(over))).json.error.code;
  assert.equal(await bad({ date: '14/10/2026' }), 'bad_date');
  assert.equal(await bad({ time: '9pm' }), 'bad_time');
  assert.equal(await bad({ text: ' ' }), 'bad_text');
  assert.equal(await bad({ data: [] }), 'bad_data');
});

test('entries travel in the JSON export and come back on import', async () => {
  const id = uuid();
  await app.api('PUT', `/api/skin/${id}`, entry({ date: '2026-09-19', time: '2300', text: '2300: kept' }));
  const exported = JSON.parse((await app.api('GET', '/api/export/json')).text);
  assert.ok(exported.skinEntries.some((e) => e.id === id && e.text === '2300: kept'));
  const other = await startServer();
  try {
    const r = await other.api('POST', '/api/import?mode=merge', exported);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(r.json.skinEntriesAdded >= 1);
    const list = (await other.api('GET', '/api/skin?from=2026-09-01&to=2026-09-30')).json.entries;
    assert.deepEqual(list.map((e) => e.text), ['2300: kept']);
  } finally {
    await other.close();
  }
});
