// The editing tools of the MCP bridge (0.11.0), each called the way an agent calls it, through the stdio bridge and
// the assistant door, and checked in the database: History versions, Trash and undo still work.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startServer } from './helpers.js';
import { splitSchedule } from '../../server/assistant-notes.js';

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
  return r.content[0].text;
}
const versions = (noteId) => app.db.prepare('SELECT COUNT(*) n FROM note_versions WHERE note_id = ?').get(noteId).n;
const note = (noteId) => call('get_note', { noteId });

test('ping says the server version and the daily tag', async () => {
  const ping = await call('ping');
  assert.match(ping.version, /^\d+\.\d+\.\d+$/);
  assert.equal(typeof ping.dailyTag, 'string');
});

test('error messages reach the agent: a wrong task id says so, not "check the note id"', async () => {
  const { id } = await call('create_note', { title: 'Errors', markdown: '- [ ] one' });
  const text = await refused('update_task', { noteId: id, taskId: 'not-a-real-task', checked: true }, /No task with that id/);
  assert.match(text, /task_not_found/);
  await refused('get_note', { noteId: 'missing-note-123' }, /Note not found/);
});

test('set_note_title renames a free note and refuses a daily entry', async () => {
  const { id } = await call('create_note', { title: 'Old name', markdown: 'body' });
  await call('set_note_title', { noteId: id, title: 'New name' });
  assert.equal((await note(id)).title, 'New name');
  const daily = await call('append_daily', { markdown: 'today', tag: 'journal' });
  await refused('set_note_title', { noteId: daily.id, title: 'x' }, /Only free notes have a title/);
});

test('add_note_tag and remove_note_tag change only the tags', async () => {
  const { id } = await call('create_note', { title: 'Tagged', markdown: 'body', tags: ['a'] });
  assert.deepEqual((await call('add_note_tag', { noteId: id, tag: 'projects/garden' })).tags, ['a', 'projects/garden']);
  assert.deepEqual((await call('remove_note_tag', { noteId: id, tag: 'a' })).tags, ['projects/garden']);
  await refused('remove_note_tag', { noteId: id, tag: 'zzz' }, /not tagged zzz/);
  assert.deepEqual((await note(id)).tags, ['projects/garden']);
});

test('rewrite_note: the same Markdown keeps every task; edits keep matching tasks and read the shown dates back', async () => {
  const md = '# Plan\n\nSome **bold** and *italic* text with a_b and \\[brackets\\].\n\n- [ ] Call Sam\n- [x] Done thing\n- [ ] Keep me\n  - [ ] Nested child\n\n- plain bullet';
  const { id } = await call('create_note', { title: 'Rewrite', markdown: md });
  let read = await note(id);
  const sam = read.tasks.find((t) => t.text === 'Call Sam');
  await call('update_task', { noteId: id, taskId: sam.id, due: '2026-12-01', dueTime: '09:30', priority: 'urgent' });
  read = await note(id);
  assert.match(read.markdown, /- \[ \] Call Sam \(due 2026-12-01 at 09:30\)/);

  // The Markdown exactly as read: nothing changes (same tasks, same dates, same text).
  const same = await call('rewrite_note', { noteId: id, expectedRevision: read.revision, markdown: read.markdown });
  assert.deepEqual(same.tasks, { kept: 4, added: 0, removed: 0 });
  const after = await note(id);
  assert.equal(after.markdown, read.markdown);
  assert.deepEqual(after.tasks, read.tasks);

  // Tick a task, move a date, drop one, add one, change text.
  const edited = after.markdown
    .replace('- [ ] Call Sam (due 2026-12-01 at 09:30)', '- [x] Call Sam (due 2026-12-05)')
    .replace('- [x] Done thing\n', '')
    .replace('Some **bold**', 'Changed **bold**')
    .replace('- plain bullet', '- plain bullet\n\n- [ ] Brand new (start 2026-11-01)');
  const before = versions(id);
  const res = await call('rewrite_note', { noteId: id, expectedRevision: after.revision, markdown: edited });
  assert.deepEqual(res.tasks, { kept: 3, added: 1, removed: 1 });
  assert.ok(versions(id) > before, 'the previous text is in History');
  const final = await note(id);
  const sam2 = final.tasks.find((t) => t.text === 'Call Sam');
  assert.equal(sam2.id, sam.id, 'same task');
  assert.equal(sam2.checked, true);
  assert.equal(sam2.due, '2026-12-05');
  assert.equal(sam2.dueTime, null, 'the time was removed from the line');
  assert.equal(sam2.priority, 'urgent', 'priority is kept');
  assert.ok(sam2.completedAt, 'ticking stamps the completion time');
  assert.equal(final.tasks.find((t) => t.text === 'Brand new').start, '2026-11-01');
  assert.equal(final.tasks.find((t) => t.text === 'Nested child').id, after.tasks.find((t) => t.text === 'Nested child').id);
  assert.match(final.markdown, /Changed \*\*bold\*\*/);
  assert.ok(!final.tasks.some((t) => t.text === 'Done thing'));

  await refused('rewrite_note', { noteId: id, expectedRevision: after.revision, markdown: 'x' }, /changed since you read it/);
});

test('splitSchedule reads the shown dates and leaves other brackets alone', () => {
  assert.deepEqual(splitSchedule('Call (mum) (due 2026-10-20 at 07:05) (start note date at 06:00) (dismissed 2026-10-01T00:00:00Z)'), {
    text: 'Call (mum)',
    schedule: { due: '2026-10-20', dueTime: '07:05', start: null, startTime: '06:00' },
  });
  assert.deepEqual(splitSchedule('Read (due soon)'), { text: 'Read (due soon)', schedule: null });
});

test('replace_text finds text copied with Markdown symbols; replace_section picks one of several headings', async () => {
  const { id } = await call('create_note', { title: 'Lenient', markdown: 'A **bold** word and a\\_b\n\n- [ ] Task line\n\n## Notes\n\nfirst\n\n## Notes\n\nsecond' });
  let read = await note(id);
  const r1 = await call('replace_text', { noteId: id, expectedRevision: read.revision, find: 'A **bold** word and a\\_b', replace: 'Plain words' });
  assert.equal(r1.matchedAs, 'A bold word and a_b');
  read = await note(id);
  const t = read.tasks[0];
  await call('update_task', { noteId: id, taskId: t.id, due: '2026-11-11' });
  read = await note(id);
  await call('replace_text', { noteId: id, expectedRevision: read.revision, find: '- [ ] Task line (due 2026-11-11)', replace: 'Task words' });
  read = await note(id);
  assert.equal(read.tasks[0].text, 'Task words');
  assert.equal(read.tasks[0].due, '2026-11-11', 'the date stays on the task');
  await refused('replace_section', { noteId: id, expectedRevision: read.revision, heading: 'Notes', markdown: 'x' }, /occurrence/);
  await call('replace_section', { noteId: id, expectedRevision: read.revision, heading: 'Notes', occurrence: 2, markdown: 'replaced second' });
  read = await note(id);
  assert.match(read.markdown, /first[\s\S]*replaced second/);
});

test('update_task changes text, priority and hideUntil; delete_task and move_task keep History', async () => {
  const a = await call('create_note', { title: 'From', markdown: '- [ ] Move me\n  - [ ] child\n- [ ] Delete me\n- [ ] Stay' });
  const b = await call('create_note', { title: 'To', markdown: 'Intro\n\n- [ ] Existing' });
  let read = await note(a.id);
  const [move, , del, stay] = read.tasks;
  await call('update_task', { noteId: a.id, taskId: stay.id, text: 'Stay **here**', priority: 'important', hideUntil: '2026-12-24' });
  read = await note(a.id);
  const s = read.tasks.find((t) => t.id === stay.id);
  assert.equal(s.text, 'Stay here');
  assert.equal(s.priority, 'important');
  assert.equal(s.hideUntil, '2026-12-24');
  assert.match(read.markdown, /Stay \*\*here\*\*/);

  const v = versions(a.id);
  await call('delete_task', { noteId: a.id, taskId: del.id });
  assert.ok(!(await note(a.id)).tasks.some((t) => t.id === del.id));
  assert.ok(versions(a.id) > v, 'the note before the delete is in History');
  await refused('delete_task', { noteId: a.id, taskId: del.id }, /No task with that id/);

  await call('update_task', { noteId: a.id, taskId: move.id, due: '2026-11-30' });
  const moved = await call('move_task', { noteId: a.id, taskId: move.id, toNoteId: b.id });
  assert.equal(moved.to.id, b.id);
  const from = await note(a.id);
  const to = await note(b.id);
  assert.ok(!from.tasks.some((t) => t.id === move.id));
  const there = to.tasks.find((t) => t.id === move.id);
  assert.equal(there.due, '2026-11-30', 'same task, same date');
  assert.ok(to.tasks.some((t) => t.text === 'child'), 'nested tasks travel along');
  assert.deepEqual(to.tasks.map((t) => t.text).slice(0, 2), ['Existing', 'Move me'], 'added to the end of the last task list');
  await refused('move_task', { noteId: b.id, taskId: move.id, toNoteId: b.id }, /already in that note/);
});

test('list_versions, get_version and restore_version undo an edit', async () => {
  const { id } = await call('create_note', { title: 'History', markdown: 'original words' });
  let read = await note(id);
  await call('replace_text', { noteId: id, expectedRevision: read.revision, find: 'original', replace: 'changed' });
  const { versions: list } = await call('list_versions', { noteId: id });
  assert.ok(list.length >= 1);
  const old = await call('get_version', { noteId: id, versionId: list[0].id });
  assert.match(old.markdown, /original words/);
  await call('restore_version', { noteId: id, versionId: list[0].id });
  read = await note(id);
  assert.match(read.markdown, /original words/);
  assert.ok((await call('list_versions', { noteId: id })).versions.some((v) => v.preview.includes('changed words')), 'the undone text is kept too');
});

test('list_trash and restore_note bring a trashed note back', async () => {
  const { id } = await call('create_note', { title: 'Trashed', markdown: 'bye' });
  const read = await note(id);
  await call('trash_note', { noteId: id, expectedRevision: read.revision, confirmed: true });
  assert.ok((await call('list_trash')).notes.some((n) => n.id === id && n.title === 'Trashed'));
  await refused('get_note', { noteId: id }, /not found/);
  await call('restore_note', { noteId: id });
  assert.equal((await note(id)).title, 'Trashed');
  assert.ok(!(await call('list_trash')).notes.some((n) => n.id === id));
});

test('list_tags, move_tag (rename keeps its place), set_tag and set_daily_tag', async () => {
  await call('create_note', { title: 'T', markdown: 'x', tags: ['work/alpha', 'work/beta', 'work/gamma', 'work/alpha/sub'] });
  app.store.moveTag({ from: 'work/beta', into: 'work', order: ['alpha', 'beta', 'gamma'] }); // an order, as the app saves one
  await call('set_daily_tag', { tag: 'work/beta' });
  const renamed = await call('move_tag', { tag: 'work/beta', name: 'bravo' });
  assert.equal(renamed.path, 'work/bravo');
  assert.deepEqual(app.store.getTagOrder().work, ['alpha', 'bravo', 'gamma'], 'renamed in place');
  assert.equal((await call('ping')).dailyTag, 'work/bravo', 'the daily tag follows a rename');
  const moved = await call('move_tag', { tag: 'work/alpha', into: '' });
  assert.equal(moved.path, 'alpha');
  let tags = (await call('list_tags')).tags;
  assert.ok(tags.some((t) => t.path === 'alpha/sub'), 'children move along');
  await refused('move_tag', { tag: 'work/gamma', into: '', name: 'alpha' }, /already exists/);
  await call('set_tag', { tag: 'alpha', favorite: true, daily: false });
  tags = (await call('list_tags')).tags;
  const alpha = tags.find((t) => t.path === 'alpha');
  assert.equal(alpha.favorite, true);
  assert.equal(alpha.daily, false);
  await refused('set_tag', { tag: 'nope', favorite: true }, /No such tag/);
});

test('edit_mood, delete_mood and restore_mood', async () => {
  await call('log_mood', { score: 2, note: 'meh' });
  const [mood] = (await call('get_moods', { days: 2 })).moods.slice(-1);
  const edited = await call('edit_mood', { moodId: mood.id, score: 4, note: null });
  assert.equal(edited.mood.score, 4);
  assert.equal(edited.mood.note, null);
  assert.equal(edited.previous.score, 2);
  await call('delete_mood', { moodId: mood.id });
  assert.ok(!(await call('get_moods', { days: 2 })).moods.some((m) => m.id === mood.id));
  await refused('edit_mood', { moodId: mood.id, score: 3 }, /deleted/);
  await call('restore_mood', { moodId: mood.id });
  assert.equal((await call('get_moods', { days: 2 })).moods.find((m) => m.id === mood.id).score, 4);
});

test('habits: get, add, edit, tick, delete and bring back', async () => {
  const { habit } = await call('add_habit', { name: 'Stretch', days: [1, 3, 5] });
  assert.deepEqual(habit.days, [1, 3, 5]);
  const edited = await call('edit_habit', { habitId: habit.id, name: 'Stretch 10 min' });
  assert.equal(edited.habit.name, 'Stretch 10 min');
  assert.deepEqual(edited.habit.days, [1, 3, 5], 'fields left out stay');
  assert.equal(edited.previous.name, 'Stretch');
  await call('tick_habit', { habitId: habit.id, done: true });
  let list = await call('get_habits');
  assert.ok(list.checks.some((x) => x.habitId === habit.id && x.date === today));
  await call('tick_habit', { habitId: habit.id, done: false, date: today });
  list = await call('get_habits');
  assert.ok(!list.checks.some((x) => x.habitId === habit.id));
  await refused('tick_habit', { habitId: habit.id, done: true, date: '2999-01-01' }, /not come yet/);
  await call('tick_habit', { habitId: habit.id, done: true });
  await call('delete_habit', { habitId: habit.id });
  assert.ok(!(await call('get_habits')).habits.some((h) => h.id === habit.id));
  const back = await call('edit_habit', { habitId: habit.id, sort: 1 });
  assert.equal(back.restored, true);
  list = await call('get_habits');
  assert.ok(list.habits.some((h) => h.id === habit.id));
  assert.ok(list.checks.some((x) => x.habitId === habit.id), 'its ticks come back with it');
});

test('habit options (0.11.0) can be set and changed by an agent; an edit keeps the courses the skin log started', async () => {
  const { habit } = await call('add_habit', { name: 'Water', kind: 'number', target: 8, unit: 'glasses', freq: { type: 'week', times: 5 }, color: 'blue', question: 'How many glasses?', reminder: '21:00' });
  assert.equal(habit.kind, 'number');
  assert.equal(habit.target, 8);
  assert.equal(habit.unit, 'glasses');
  assert.deepEqual(habit.freq, { type: 'week', times: 5 });
  assert.equal(habit.color, 'blue');
  assert.equal(habit.reminder, '21:00');
  await refused('add_habit', { name: 'No target', kind: 'number' }, /target/);

  const ticked = await call('tick_habit', { habitId: habit.id, done: true, value: 6 });
  assert.equal(ticked.value, 6);
  let check = (await call('get_habits')).checks.find((x) => x.habitId === habit.id);
  assert.equal(check.value, 6);
  await call('tick_habit', { habitId: habit.id, done: true, skip: true });
  check = (await call('get_habits')).checks.find((x) => x.habitId === habit.id);
  assert.equal(check.skip, true);

  // courses as the skin log leaves them on a habit
  const courses = [{ from: '2026-10-01', to: '2026-10-07' }];
  app.db.prepare('UPDATE habits SET courses = ? WHERE id = ?').run(JSON.stringify(courses), habit.id);
  const edited = await call('edit_habit', { habitId: habit.id, archived: true, color: null });
  assert.equal(edited.habit.archived, true);
  assert.equal(edited.habit.color, null);
  assert.equal(edited.habit.target, 8, 'options left out stay');
  assert.equal(edited.previous.color, 'blue', 'the answer says what it was');
  assert.deepEqual(edited.habit.courses, courses, 'courses are not cleared by an edit');
});

test('skin log: log, edit (line rewritten in the month note), delete (line removed)', async () => {
  const date = today;
  const logged = await call('log_skin', { date, time: '2100', data: { symptoms: ['Itch'], areas: ['Legs'], where: { Legs: { side: 'left', aspect: 'posterior' } }, products: ['Betaderm'] } });
  assert.equal(logged.entry.text, '2100: Itch on left posterior legs. Betaderm applied on left posterior legs.');
  assert.equal(logged.noteCreated, true);
  let month = await note(logged.noteId);
  assert.match(month.title, /^Skin log · /);
  assert.deepEqual(month.tags, ['skin']);
  assert.match(month.markdown, /- 2100: Itch on left posterior legs\./);

  const second = await call('log_skin', { date, time: '0800', data: { comment: 'calm morning' } });
  assert.equal(second.noteId, logged.noteId, 'same month, same note');

  const edited = await call('edit_skin_entry', { entryId: logged.entry.id, time: '2130', data: { response: ['Relief'] } });
  assert.equal(edited.lineWasFound, true);
  assert.equal(edited.entry.text, '2130: Itch on left posterior legs. Betaderm applied on left posterior legs. Response: relief.');
  assert.deepEqual(edited.entry.data.products, ['Betaderm'], 'picks left out stay');
  month = await note(logged.noteId);
  assert.ok(!/- 2100:/.test(month.markdown), 'the old line is gone');
  assert.match(month.markdown, /- 0800: Calm morning\.\n- 2130: .*Response: relief\./, 'the new line is in time order');
  assert.ok(versions(logged.noteId) > 0, 'the note keeps History');

  const del = await call('delete_skin_entry', { entryId: second.entry.id });
  assert.equal(del.lineWasFound, true);
  month = await note(logged.noteId);
  assert.ok(!/Calm morning/.test(month.markdown));
  assert.deepEqual((await call('get_skin_log')).entries.map((e) => e.id), [logged.entry.id]);
  await refused('edit_skin_entry', { entryId: second.entry.id, time: '0900' }, /No such skin log entry/);
  await refused('log_skin', { data: {} }, /Nothing to log/);
});

test('People: list, read, update details (patch) and log a conversation', async () => {
  const { id } = await call('create_note', { title: 'Sam Lee', markdown: '## Notes\n\nMet at the bake sale.', tags: ['05-people/friends'] });
  const plain = await call('create_note', { title: 'Not a person', markdown: 'x' });
  const list = await call('list_people');
  const sam = list.people.find((p) => p.noteId === id);
  assert.ok(sam);
  assert.equal(sam.text, undefined, 'the list leaves out the note text');
  await call('update_person', { noteId: id, profile: { role: 'Neighbour', birthday: '03-14', remember: ['Likes tea'] } });
  const upd = await call('update_person', { noteId: id, profile: { closeness: 'close' } });
  assert.equal(upd.profile.role, 'Neighbour', 'fields left out stay');
  assert.equal(upd.profile.closeness, 'close');
  assert.equal(upd.previous.closeness, '');
  assert.deepEqual((await call('get_person', { noteId: id })).profile.remember, ['Likes tea']);
  await refused('update_person', { noteId: id, profile: { birthday: 'soon' } }, /birthday/);
  await refused('update_person', { noteId: plain.id, profile: { role: 'x' } }, /not a person/);

  await call('log_conversation', { noteId: id, text: 'Talked about the garden', how: 'Coffee', date: '2026-10-15' });
  const read = await note(id);
  assert.match(read.markdown, /## Log\n\n- Oct 15, 2026 · Coffee: Talked about the garden/);
  assert.equal((await call('list_people')).people.find((p) => p.noteId === id).lastTalked, '2026-10-15');
});
