// 0.22.0: a project adopts an existing tag and its sub-tags without moving or retagging a note, and a meeting keeps a pasted
// transcript with its source alongside the minutes (docs/MEETINGS.md). Fictional data throughout.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, para, docOf, task } from './helpers.js';
import { MIGRATIONS, SCHEMA_VERSION, applyPragmas, migrate } from '../../server/db.js';
import { parseCommitments, minutesDoc, transcriptDoc, cleanMeeting } from '../../shared/meetings.js';
import { validateDoc } from '../../shared/doc.js';
import { uuid } from '../../shared/ids.js';

let app;
before(async () => (app = await startServer({ HOME_TZ: 'America/Edmonton' })));
after(async () => app?.close());

const put = async (body) => {
  const id = uuid();
  const r = await app.api('PUT', `/api/notes/${id}`, { baseRevision: 0, docFormat: 1, date: '2026-11-05', opId: uuid(), ...body });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return id;
};
const tagsOf = (id) => app.db.prepare('SELECT t.path FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ? ORDER BY t.path').all(id).map((r) => r.path);
const snapshot = (ids) => JSON.stringify(ids.map((id) => [id, tagsOf(id), app.db.prepare('SELECT revision FROM notes WHERE id = ?').get(id).revision]));

test('the v13 migration adds the meetings table and keeps every existing row', () => {
  assert.ok(SCHEMA_VERSION >= 13);
  const db = new DatabaseSync(':memory:');
  applyPragmas(db);
  for (let v = 0; v < 12; v++) {
    db.exec(MIGRATIONS[v]);
    db.exec(`PRAGMA user_version = ${v + 1}`);
  }
  db.prepare('INSERT INTO notes (id, note_date, doc, doc_format, revision, created_at, updated_at, kind) VALUES (?,?,?,?,?,?,?,?)').run('note-old-2', '2026-11-01', '{"type":"doc","content":[{"type":"paragraph"}]}', 2, 5, 'a', 'b', 'daily');
  db.prepare('INSERT INTO suggestions (id, day, kind, data, source, created_at) VALUES (?,?,?,?,?,?)').run('sug-old-0001', '2026-11-01', 'task', '{}', 'assistant', 'a');
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(db.prepare('SELECT revision FROM notes').get().revision, 5);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM suggestions').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM meetings').get().c, 0);
  db.close();
});

test('commitments: a leading attendee name makes it theirs; the date written is carried; others are mine', () => {
  const people = [{ id: 'sam-0000001', title: 'Sam Lee', aliases: [] }, { id: 'rob-0000001', title: 'Robin Ortiz', aliases: ['Rob'] }];
  const c = parseCommitments('Sam: send the budget by Friday\n- [ ] Rob - bring cups\nbook the hall\nNobody: odd one', people, '2026-11-09');
  assert.deepEqual(c.map((x) => [x.text, x.ownerId, x.due]), [
    ['send the budget by Friday', 'sam-0000001', '2026-11-13'],
    ['bring cups', 'rob-0000001', null],
    ['book the hall', null, null],
    ['Nobody: odd one', null, null],
  ]);
  const doc = minutesDoc({ title: 'Kickoff', date: '2026-11-09', source: 'Otter', attendees: people, minutes: 'We met.\nAgreed on dates.', commitments: c, transcriptTitle: 'Transcript: Kickoff' });
  assert.equal(validateDoc(doc), null);
  assert.equal(validateDoc(transcriptDoc({ source: 'Otter', date: '2026-11-09', text: 'a\n\nb' })), null);
  assert.throws(() => cleanMeeting({ title: 'x', date: '2026-11-09', transcript: 'words' }), /where the transcript came from/);
});

test('a project adopts a tag with sub-tags: nothing is moved or retagged, and the page has notes, tasks (mine and others), files, meetings and people', async () => {
  const sam = await put({ kind: 'note', title: 'Sam Lee', tags: ['05-people'], doc: docOf(para('A person.')) });
  const flyer = await put({ kind: 'note', title: 'Flyer plan', tags: ['21-club/events/fair'], doc: docOf(para('Plan'), { type: 'taskList', content: [task('print flyers'), { ...task('Sam to send logo'), attrs: { checked: false, id: uuid(), owner: sam } }] }) });
  const budget = await put({ kind: 'note', title: 'Budget', tags: ['21-club/finance'], doc: docOf(para('Numbers')) });
  const outside = await put({ kind: 'note', title: 'Elsewhere', tags: ['21-clubhouse'], doc: docOf(para('Not in the club')) });
  const before = snapshot([flyer, budget, outside]);

  const made = await app.api('POST', '/api/projects', { name: 'The Club', area: 'club', tag: '21-club' });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const pid = made.json.project.id;
  assert.equal(snapshot([flyer, budget, outside]), before, 'adopting changed no note');
  assert.equal((await app.api('GET', '/api/projects')).json.projects.find((p) => p.id === pid).noteCount, 2, 'the tag and its sub-tags, not 21-clubhouse');

  await app.files.add(Buffer.from('%PDF-1.4 fictional'), { name: 'menu.pdf', noteId: budget });

  const m = await app.api('POST', '/api/meetings', {
    title: 'Spring kickoff', date: '2026-11-09', projectId: pid, source: 'Fictional Notetaker app', attendees: [sam],
    transcript: 'Priya: hello everyone\nSam: I will send the logo',
    minutes: 'Agreed on the fair date.', commitments: 'Sam: send the logo by Friday\nbook the hall',
  });
  assert.equal(m.status, 201, JSON.stringify(m.json));
  const meeting = m.json.meeting;
  assert.equal(meeting.attendees[0], sam);
  assert.deepEqual(meeting.commitments.map((c) => [c.text, c.owner]), [['send the logo by Friday', sam], ['book the hall', null]]);
  const transcript = app.store.getNote(meeting.transcriptNoteId);
  assert.equal(transcript.title, 'Transcript: Spring kickoff');
  assert.match(JSON.stringify(transcript.doc), /Source: Fictional Notetaker app/);
  assert.match(JSON.stringify(transcript.doc), /Priya: hello everyone/);
  assert.deepEqual(tagsOf(meeting.noteId), ['21-club'], 'new notes carry the project tag');
  assert.match(JSON.stringify(app.store.getNote(meeting.noteId).doc), /\[\[Sam Lee\]\]/);
  assert.match(JSON.stringify(app.store.getNote(meeting.noteId).doc), /\[\[Transcript: Spring kickoff\]\]/);

  const d = (await app.api('GET', `/api/projects/${pid}`)).json;
  assert.equal(d.notes.length, 4, 'two club notes, the minutes and the transcript');
  assert.deepEqual(d.tasks.others.map((t) => t.text).sort(), ['Sam to send logo', 'send the logo by Friday']);
  assert.deepEqual(d.tasks.open.map((t) => t.text).sort(), ['book the hall', 'print flyers']);
  assert.deepEqual(d.files.map((f) => f.name), ['menu.pdf']);
  assert.deepEqual(d.meetings.map((x) => x.title), ['Spring kickoff']);
  assert.ok(d.people.includes(sam));
  assert.equal((await app.api('GET', '/api/meetings')).json.meetings.length, 1);
  assert.equal((await app.api('GET', '/api/meetings?tag=nothing-here')).json.meetings.length, 0);
});

test('a meeting with no transcript, and bad requests refused', async () => {
  const ok = await app.api('POST', '/api/meetings', { title: 'Quick chat', date: '2026-11-10', attendees: [] });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.meeting.transcriptNoteId, null);
  assert.equal((await app.api('POST', '/api/meetings', { title: '', date: '2026-11-10' })).status, 400);
  assert.equal((await app.api('POST', '/api/meetings', { title: 'x', date: '2026-11-10', transcript: 'text' })).status, 400, 'a transcript needs its source');
  assert.equal((await app.api('POST', '/api/meetings', { title: 'x', date: '2026-11-10', attendees: [uuid()] })).status, 404);
});

test('making a meeting is all or nothing: a failure part way leaves no note and no record', async () => {
  const notesBefore = app.db.prepare('SELECT COUNT(*) AS c FROM notes').get().c;
  const meetingsBefore = app.db.prepare('SELECT COUNT(*) AS c FROM meetings').get().c;
  const real = app.store.saveNote.bind(app.store);
  let calls = 0;
  app.store.saveNote = (...args) => {
    if (++calls === 2) throw new Error('disk trouble');
    return real(...args);
  };
  try {
    await assert.rejects(async () => {
      const r = await app.api('POST', '/api/meetings', { title: 'Doomed', date: '2026-11-11', source: 'x', transcript: 'a line' });
      if (r.status >= 400) throw new Error(`refused ${r.status}`);
    });
  } finally {
    app.store.saveNote = real;
  }
  assert.equal(calls, 2, 'the transcript was saved before the minutes failed');
  assert.equal(app.db.prepare('SELECT COUNT(*) AS c FROM notes').get().c, notesBefore, 'the transcript note was rolled back');
  assert.equal(app.db.prepare('SELECT COUNT(*) AS c FROM meetings').get().c, meetingsBefore);
  assert.equal(app.db.isTransaction, false, 'no transaction left open');
  const ok = await app.api('POST', '/api/meetings', { title: 'Fine now', date: '2026-11-11', source: 'x', transcript: 'a line' });
  assert.equal(ok.status, 201);
});

test('meetings and filed suggestions survive JSON export then import (replace and merge); older exports without them still import', async () => {
  const sam = await put({ kind: 'note', title: 'Sam Export', tags: ['05-people'], doc: docOf(para('A person.')) });
  const made = await app.api('POST', '/api/meetings', { title: 'Export meeting', date: '2026-11-08', source: 'Fictional app', attendees: [sam], transcript: 'Priya: hi', commitments: 'Sam Export: send it' });
  assert.equal(made.status, 201);
  const { fileProposals } = await import('../../server/suggestions.js');
  const filed = fileProposals(app.db, { day: '2026-11-08', items: [{ kind: 'task', text: 'Water plants', ownerId: sam, due: '2026-11-09' }, { kind: 'person', name: 'Dana Reyes' }] }).filed;
  app.db.prepare("UPDATE suggestions SET status = 'dismissed', resolved_at = ? WHERE id = ?").run('2026-11-08T10:00:00.000Z', filed[1].id);

  const exported = JSON.parse((await app.api('GET', '/api/export/json')).text);
  assert.ok(exported.meetings.some((m) => m.noteId === made.json.meeting.noteId && m.attendees[0] === sam && m.source === 'Fictional app'));
  assert.equal(exported.suggestions.length >= 2, true);

  const other = await startServer({ HOME_TZ: 'America/Edmonton' });
  try {
    const r = await other.api('POST', '/api/import?mode=replace', exported);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.meetingsAdded, exported.meetings.length);
    assert.equal(r.json.suggestionsAdded, exported.suggestions.length);
    const row = other.db.prepare('SELECT * FROM meetings WHERE note_id = ?').get(made.json.meeting.noteId);
    assert.deepEqual([row.transcript_note_id, row.date, row.source, JSON.parse(row.attendees)], [made.json.meeting.transcriptNoteId, '2026-11-08', 'Fictional app', [sam]]);
    const back = other.db.prepare('SELECT * FROM suggestions WHERE id = ?').get(filed[1].id);
    assert.deepEqual([back.status, back.resolved_at, back.kind, JSON.parse(back.data).name], ['dismissed', '2026-11-08T10:00:00.000Z', 'person', 'Dana Reyes']);
    assert.equal(JSON.parse(other.db.prepare('SELECT data FROM suggestions WHERE id = ?').get(filed[0].id).data).ownerId, sam);
    // merge again: nothing added twice
    const again = await other.api('POST', '/api/import?mode=merge', exported);
    assert.deepEqual([again.json.meetingsAdded, again.json.suggestionsAdded], [0, 0]);
    // an older export without the two lists still imports, and replace empties them
    const { meetings, suggestions, ...older } = exported;
    const old = await other.api('POST', '/api/import?mode=replace', older);
    assert.equal(old.status, 200, JSON.stringify(old.json));
    assert.equal(other.db.prepare('SELECT COUNT(*) AS c FROM meetings').get().c, 0);
    // bad entries are refused with the reason
    const bad = await other.api('POST', '/api/import?mode=merge', { ...exported, suggestions: [{ ...exported.suggestions[0], status: 'maybe' }] });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error.message, /suggestion .*bad status/);
    const bad2 = await other.api('POST', '/api/import?mode=merge', { ...exported, meetings: [{ ...exported.meetings[0], date: 'soon' }] });
    assert.equal(bad2.status, 400);
  } finally {
    await other.close();
  }
});
