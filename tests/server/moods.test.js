import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { dateInTz, addDays } from '../../shared/dates.js';
import { moodStreak, dayAverages } from '../../shared/moods.js';
import { uuid } from '../../shared/ids.js';

const TOKEN = 'test-only-assistant-key-123456789';
const auth = { authorization: `Bearer ${TOKEN}` };
let app, today;
// Earlier days at midday; "today" entries are a minute or two ago (the server refuses times in the future).
const at = (daysAgo, minutesAgo = 1) => (daysAgo === 0 ? new Date(Date.now() - minutesAgo * 60_000).toISOString() : `${addDays(today, -daysAgo)}T12:00:00.000Z`);

before(async () => {
  app = await startServer({ ASSISTANT_TOKEN: TOKEN, HOME_TZ: 'UTC' });
  today = dateInTz(new Date(), 'UTC');
});
after(async () => app.close());

describe('shared mood helpers', () => {
  test('the streak counts back from today, or from yesterday while today is still empty', () => {
    assert.equal(moodStreak(['2026-10-07', '2026-10-06', '2026-10-05'], '2026-10-07'), 3);
    assert.equal(moodStreak(['2026-10-06', '2026-10-05'], '2026-10-07'), 2, 'today not logged yet does not break it');
    assert.equal(moodStreak(['2026-10-05'], '2026-10-07'), 0, 'a missed day does');
    assert.equal(moodStreak([], '2026-10-07'), 0);
  });
  test('day averages fill every day, empty ones are null', () => {
    const rows = dayAverages([{ day: '2026-10-05', score: 2 }, { day: '2026-10-05', score: 4 }, { day: '2026-10-07', score: 5 }], '2026-10-05', '2026-10-07');
    assert.deepEqual(rows, [{ day: '2026-10-05', count: 2, avg: 3 }, { day: '2026-10-06', count: 0, avg: null }, { day: '2026-10-07', count: 1, avg: 5 }]);
  });
});

describe('mood entries over the API', () => {
  test('several entries a day, kept with their note and time; saving the same id again changes nothing', async () => {
    const id = uuid();
    const first = await app.api('PUT', `/api/moods/${id}`, { score: 3, note: '  rough   morning ', at: at(0, 3) });
    assert.equal(first.status, 200);
    assert.equal(first.json.created, true);
    assert.equal(first.json.mood.note, 'rough morning', 'whitespace tidied');
    assert.equal(first.json.mood.day, today);
    const again = await app.api('PUT', `/api/moods/${id}`, { score: 5, note: 'different', at: at(0, 2) });
    assert.equal(again.json.created, false);
    assert.equal(again.json.mood.score, 3, 'a retry of the same entry never edits it');
    await app.api('PUT', `/api/moods/${uuid()}`, { score: 5, at: at(0, 1) });
    const list = await app.api('GET', '/api/moods');
    assert.deepEqual(list.json.moods.map((m) => m.score), [3, 5], 'oldest first');
    assert.equal(list.json.daysLogged, 1);
    assert.equal(list.json.streak, 1);
  });

  test('bad input is refused with a clear reason', async () => {
    for (const [body, code] of [
      [{ score: 0 }, 'bad_score'], [{ score: 6 }, 'bad_score'], [{ score: 2.5 }, 'bad_score'], [{ score: '3' }, 'bad_score'],
      [{ score: 3, note: 7 }, 'bad_note'], [{ score: 3, at: 'tomorrow' }, 'bad_time'],
      [{ score: 3, at: new Date(Date.now() + 3_600_000).toISOString() }, 'bad_time'],
    ]) {
      const r = await app.api('PUT', `/api/moods/${uuid()}`, body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.json.error?.code ?? r.json.code, code, JSON.stringify(body));
    }
    assert.equal((await app.api('PUT', '/api/moods/x', { score: 3 })).status, 400, 'bad id');
    assert.equal((await app.api('GET', '/api/moods?from=2026-13-01')).status, 400);
    assert.equal((await app.api('GET', `/api/moods?from=${addDays(today, -800)}&to=${today}`)).status, 400, 'too many days at once');
  });

  test('the day follows the home timezone and the streak counts consecutive days', async () => {
    for (const d of [1, 2]) await app.api('PUT', `/api/moods/${uuid()}`, { score: 4, at: at(d) });
    const r = (await app.api('GET', '/api/moods')).json;
    assert.equal(r.streak, 3, 'today, yesterday and the day before');
    assert.equal(r.daysLogged, 3);
    const only = (await app.api('GET', `/api/moods?from=${addDays(today, -1)}&to=${addDays(today, -1)}`)).json;
    assert.equal(only.moods.length, 1);
  });

  test('deleting is soft and repeatable; the entry leaves the list but stays in the database', async () => {
    const id = uuid();
    await app.api('PUT', `/api/moods/${id}`, { score: 1, at: at(0, 1) });
    assert.equal((await app.api('DELETE', `/api/moods/${id}`)).status, 200);
    assert.equal((await app.api('DELETE', `/api/moods/${id}`)).status, 200, 'deleting twice is fine');
    assert.ok(!(await app.api('GET', '/api/moods')).json.moods.some((m) => m.id === id));
    assert.ok(app.db.prepare('SELECT deleted_at FROM mood_entries WHERE id = ?').get(id).deleted_at);
    assert.equal((await app.api('PUT', `/api/moods/${id}`, { score: 1 })).json.created, false, 'a late retry does not bring it back');
    assert.equal((await app.api('DELETE', `/api/moods/${uuid()}`)).status, 404);
  });
});

describe('assistant door', () => {
  test('needs the key; can read recent moods and log one, and the logged one shows in the app', async () => {
    assert.equal((await app.api('GET', '/api/assistant/moods')).status, 401);
    assert.equal((await app.api('POST', '/api/assistant/moods', { score: 3 })).status, 401);
    const logged = await app.api('POST', '/api/assistant/moods', { score: 2, note: 'from Claude' }, auth);
    assert.equal(logged.status, 200);
    const seen = await app.api('GET', '/api/assistant/moods?days=2', undefined, auth);
    assert.ok(seen.json.moods.some((m) => m.note === 'from Claude' && m.score === 2));
    assert.ok((await app.api('GET', '/api/moods')).json.moods.some((m) => m.note === 'from Claude'));
    assert.equal((await app.api('POST', '/api/assistant/moods', { score: 99 }, auth)).status, 400);
  });
});

describe('export, import and backup', () => {
  test('moods travel in the JSON export; merge adds what is missing, replace takes the export as is', async () => {
    const out = (await app.api('GET', '/api/export/json')).json;
    assert.ok(out.moods.length >= 4);
    assert.ok(out.moods.some((m) => m.deletedAt), 'deleted entries are exported too');
    const other = await startServer({ HOME_TZ: 'UTC' });
    try {
      const merged = await other.api('POST', '/api/import?mode=merge', out);
      assert.equal(merged.status, 200, JSON.stringify(merged.json));
      assert.equal(merged.json.moodsAdded, out.moods.length);
      const again = await other.api('POST', '/api/import?mode=merge', out);
      assert.equal(again.json.moodsAdded, 0, 'importing twice adds nothing');
      assert.equal(other.db.prepare('SELECT COUNT(*) n FROM mood_entries').get().n, out.moods.length);
      other.db.prepare("INSERT INTO mood_entries (id, score, day, logged_at, created_at) VALUES ('onlyhere1', 3, ?, ?, ?)").run(today, new Date().toISOString(), new Date().toISOString());
      await other.api('POST', '/api/import?mode=replace', out);
      assert.equal(other.db.prepare("SELECT COUNT(*) n FROM mood_entries WHERE id = 'onlyhere1'").get().n, 0, 'replace drops what was not in the export');
      assert.equal(other.db.prepare('SELECT COUNT(*) n FROM mood_entries').get().n, out.moods.length);
      const bad = structuredClone(out);
      bad.moods[0].score = 9;
      assert.equal((await other.api('POST', '/api/import?mode=merge', bad)).status, 400);
    } finally {
      await other.close();
    }
  });

  test('an export from before moods existed still imports', async () => {
    const out = (await app.api('GET', '/api/export/json')).json;
    delete out.moods;
    const other = await startServer({ HOME_TZ: 'UTC' });
    try {
      assert.equal((await other.api('POST', '/api/import?mode=merge', out)).status, 200);
    } finally {
      await other.close();
    }
  });
});
