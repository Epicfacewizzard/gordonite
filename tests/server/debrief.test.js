// 0.20.0: the day's debrief and the suggestions an assistant files for the owner to accept (docs/DEBRIEF.md): the v12
// migration, the app's and the assistant's routes, and the bridge tools, called the way an agent calls them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startServer, para, docOf, task } from './helpers.js';
import { MIGRATIONS, SCHEMA_VERSION, applyPragmas, migrate } from '../../server/db.js';
import { uuid } from '../../shared/ids.js';

const token = 'test-only-assistant-key-123456789';
let app, c, today;

before(async () => {
  app = await startServer({ ASSISTANT_TOKEN: token, HOME_TZ: 'America/Edmonton' });
  c = new Client({ name: 'test', version: '1' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('mcp/server.js')], env: { ...process.env, GORDONITE_URL: app.url, GORDONITE_TOKEN: token }, stderr: 'pipe' }));
  today = (await call('ping')).today;
});
after(async () => {
  await c?.close();
  await app?.close();
});

async function call(name, args = {}) {
  const r = await c.callTool({ name, arguments: args });
  assert.ok(!r.isError, `${name}: ${JSON.stringify(r.content)}`);
  return JSON.parse(r.content[0].text);
}
async function refused(name, args, pattern) {
  const r = await c.callTool({ name, arguments: args });
  assert.equal(r.isError, true, `${name} should be refused`);
  if (pattern) assert.match(r.content[0].text, pattern);
}
const put = async (body, id = uuid()) => {
  const r = await app.api('PUT', `/api/notes/${id}`, { baseRevision: 0, docFormat: 1, date: today, opId: uuid(), ...body });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return id;
};

test('the v12 migration adds the suggestions table and keeps every existing row', () => {
  assert.equal(SCHEMA_VERSION, MIGRATIONS.length);
  assert.ok(SCHEMA_VERSION >= 12);
  const db = new DatabaseSync(':memory:');
  applyPragmas(db);
  for (let v = 0; v < 11; v++) {
    db.exec(MIGRATIONS[v]);
    db.exec(`PRAGMA user_version = ${v + 1}`);
  }
  // a database as 0.19.0 left it: a note, a person's details and a project
  db.prepare('INSERT INTO notes (id, note_date, doc, doc_format, revision, created_at, updated_at, kind) VALUES (?,?,?,?,?,?,?,?)').run('note-old-1', '2026-11-01', '{"type":"doc","content":[{"type":"paragraph"}]}', 2, 3, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 'daily');
  db.prepare('INSERT INTO people (note_id, data, created_at, updated_at) VALUES (?,?,?,?)').run('note-old-1', '{"role":"x"}', 'a', 'b');
  db.prepare('INSERT INTO projects (id, name, area, created_at, updated_at) VALUES (?,?,?,?,?)').run('proj-old-1', 'Fair', 'club', 'a', 'b');
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 11);
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(db.prepare('SELECT revision FROM notes WHERE id = ?').get('note-old-1').revision, 3);
  assert.equal(db.prepare('SELECT data FROM people').get().data, '{"role":"x"}');
  assert.equal(db.prepare('SELECT name FROM projects').get().name, 'Fair');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM suggestions').get().c, 0);
  db.close();
});

test('get_debrief reads the day: writing, people named, tasks made, open and overdue tasks, rule suggestions', async () => {
  const sam = await put({ kind: 'note', title: 'Sam Lee', tags: ['05-people'], doc: docOf(para('A person.')) });
  const overdueDay = '2020-01-02';
  await put({ tags: ['school'], date: overdueDay, doc: docOf({ type: 'taskList', content: [{ ...task('old thing'), attrs: { checked: false, id: uuid(), due: overdueDay } }] }) });
  const journal = await put({ kind: 'daily', tags: ['daily-jots'], doc: docOf(para('Lunch with Sam Lee, then met Priya Rao.'), para('Need to send the budget by Friday'), { type: 'taskList', content: [task('already a task')] }) });
  const d = await call('get_debrief');
  assert.equal(d.day, today);
  assert.equal(d.written.length, 2, 'the person note and the journal');
  assert.match(d.written.find((w) => w.noteId === journal).text, /Need to send the budget/);
  assert.deepEqual(d.people, [{ id: sam, title: 'Sam Lee' }]);
  assert.deepEqual(d.tasksMade.map((t) => t.text), ['already a task']);
  assert.ok(d.open.some((t) => t.text === 'old thing') && d.open.some((t) => t.text === 'already a task'));
  assert.deepEqual(d.overdue.map((t) => t.text), ['old thing']);
  assert.deepEqual(d.ruleSuggestions.map((s) => `${s.kind}:${s.name ?? s.line}`).sort(), ['person:Priya Rao', 'task:Need to send the budget by Friday']);
  assert.deepEqual(d.filed, []);
  assert.equal((await call('get_debrief', { day: overdueDay })).tasksMade[0].text, 'old thing');
  await refused('get_debrief', { day: 'yesterday' });
});

test('file_suggestions files proposals only: no note changes; the app lists and resolves them; a withdrawn one is closed', async () => {
  const notesBefore = JSON.stringify(app.db.prepare('SELECT id, revision FROM notes ORDER BY id').all());
  const filed = await call('file_suggestions', { items: [
    { kind: 'task', text: 'Send the budget', line: 'Need to send the budget by Friday', due: '2026-11-13', reason: 'It says by Friday' },
    { kind: 'person', name: 'Priya Rao', line: 'Lunch with Sam Lee, then met Priya Rao.' },
    { kind: 'remember', personId: 'sam-person-id', text: 'Likes oat milk' },
  ] });
  assert.equal(filed.filed.length, 3);
  assert.ok(filed.filed.every((f) => f.status === 'open' && f.day === today && f.source === 'assistant'));
  assert.equal(JSON.stringify(app.db.prepare('SELECT id, revision FROM notes ORDER BY id').all()), notesBefore, 'filing changed no note');

  const mine = await app.api('GET', `/api/suggestions?day=${today}`);
  assert.equal(mine.json.suggestions.length, 3);
  assert.equal((await call('get_debrief')).filed.length, 3);
  const [t, p] = mine.json.suggestions;
  const accepted = await app.api('POST', `/api/suggestions/${t.id}/resolve`, { status: 'accepted' });
  assert.equal(accepted.json.suggestion.status, 'accepted');
  assert.equal((await app.api('POST', `/api/suggestions/${t.id}/resolve`, { status: 'dismissed' })).status, 409, 'a closed one does not change again');
  assert.equal((await call('withdraw_suggestion', { suggestionId: p.id })).suggestion.status, 'withdrawn');
  assert.equal((await app.api('GET', `/api/suggestions?day=${today}`)).json.suggestions.length, 1);
  assert.equal((await call('list_suggestions', { status: 'all', day: today })).suggestions.length, 3);
  assert.equal((await app.api('POST', `/api/suggestions/${t.id}/resolve`, { status: 'nonsense' })).status, 400);
});

test('bad suggestions are refused whole, with the reason, and nothing is filed', async () => {
  const count = async () => (await call('list_suggestions', { status: 'all' })).suggestions.length;
  const was = await count();
  await refused('file_suggestions', { items: [{ kind: 'task', text: 'fine' }, { kind: 'task' }] }, /Suggestion 2: "text" is required/);
  await refused('file_suggestions', { items: [{ kind: 'remember', text: 'short fact' }] }, /personId/);
  await refused('file_suggestions', { items: [{ kind: 'task', text: 'a', due: '2026-13-45' }] }, /due/);
  await refused('file_suggestions', { items: [] });
  assert.equal(await count(), was);
});

test('the assistant door needs its key', async () => {
  const r = await fetch(`${app.url}/api/assistant/debrief`);
  assert.equal(r.status, 401);
});
