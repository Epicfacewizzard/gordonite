// Meetings (docs/MEETINGS.md): a record per meeting (table `meetings`) beside two ordinary notes, the minutes and the
// transcript pasted from outside. Both notes are made through Store.saveNote like any note, so they get history, revisions
// and backups; the record only says which note is the minutes, which is its transcript, who was there and where the
// transcript came from. Nothing here changes an existing note or tag.
import { tx } from './db.js';
import { HttpError } from './errors.js';
import { checkId } from './ids.js';
import { uuid } from '../shared/ids.js';
import { DOC_FORMAT } from '../shared/doc.js';
import { isPersonTags } from '../shared/people.js';
import { tagInProject } from '../shared/projects.js';
import { cleanMeeting, minutesDoc, parseCommitments, transcriptDoc, transcriptTitleOf } from '../shared/meetings.js';
import { getProjectRecord } from './projects.js';

const nowIso = () => new Date().toISOString();

/**
 * Make a meeting: { title, date, source, transcript?, minutes?, commitments?, attendees?: [People note id], projectId? }.
 * With a project the two notes carry the project's tag (and nothing existing is retagged). Returns { meeting }.
 */
export function createMeeting(db, store, body) {
  let m;
  try {
    m = cleanMeeting(body);
  } catch (err) {
    throw new HttpError(400, 'bad_meeting', err.message);
  }
  const tags = [];
  if (body.projectId) {
    const project = getProjectRecord(db, checkId(body.projectId, 'project id'));
    if (project.deletedAt) throw new HttpError(409, 'removed', 'This project was removed; bring it back first');
    if (!project.tag) throw new HttpError(409, 'no_tag', 'This project has no tag yet');
    tags.push(project.tag);
  }
  const attendees = m.attendees.map((id) => {
    const note = store.getNote(checkId(id, 'attendee id'));
    if (!note || note.deletedAt || !isPersonTags(note.tags.map((t) => t.path))) throw new HttpError(404, 'person_not_found', `No such person: ${id}`);
    return { id: note.id, title: note.title, aliases: [] };
  });
  const commitments = parseCommitments(m.commitments, attendees, m.date);
  const hasTranscript = !!m.transcript.trim();
  const transcriptTitle = hasTranscript ? transcriptTitleOf(m.title) : null;

  const save = (title, doc) => {
    const id = uuid();
    store.saveNote(id, { baseRevision: 0, doc, docFormat: DOC_FORMAT, tags, date: m.date, opId: uuid(), kind: 'note', title });
    return id;
  };
  // All or nothing: the transcript note, the minutes note and the record are written in one transaction (saveNote's own
  // transaction nests as a savepoint in tx()), so a failure part way leaves no orphan note and no record.
  const noteId = tx(db, () => {
    const transcriptNoteId = hasTranscript ? save(transcriptTitle, transcriptDoc({ source: m.source, date: m.date, text: m.transcript })) : null;
    const id = save(m.title, minutesDoc({ title: m.title, date: m.date, source: m.source, attendees, minutes: m.minutes, commitments, transcriptTitle }));
    db.prepare('INSERT INTO meetings (note_id, transcript_note_id, date, source, attendees, created_at) VALUES (?,?,?,?,?,?)').run(id, transcriptNoteId, m.date, m.source, JSON.stringify(attendees.map((a) => a.id)), nowIso());
    return id;
  });
  return { meeting: describe(db, store, noteId) };
}

function describe(db, store, noteId) {
  const row = db.prepare('SELECT * FROM meetings WHERE note_id = ?').get(noteId);
  if (!row) throw new HttpError(404, 'meeting_not_found', 'No such meeting');
  return toMeeting(store, row, store.listTasks());
}

function toMeeting(store, row, tasks) {
  const note = store.getNote(row.note_id);
  const mine = tasks.filter((t) => t.noteId === row.note_id);
  return {
    noteId: row.note_id,
    title: note?.title ?? 'Untitled',
    date: row.date,
    source: row.source,
    transcriptNoteId: row.transcript_note_id ?? null,
    attendees: JSON.parse(row.attendees),
    commitments: mine.map((t) => ({ taskId: t.taskId, text: t.text, owner: t.owner ?? null, due: t.due ?? null, checked: t.checked })),
    tags: note?.tags.map((t) => t.path) ?? [],
    trashed: !note || !!note.deletedAt,
  };
}

/** The meetings whose minutes are live notes, newest first; with `tag` only those in that tag or under it. */
export function listMeetings(db, store, { tag = null } = {}) {
  const rows = db.prepare('SELECT * FROM meetings ORDER BY date DESC, created_at DESC').all();
  const tasks = store.listTasks();
  return rows.map((r) => toMeeting(store, r, tasks)).filter((m) => !m.trashed && (!tag || m.tags.some((t) => tagInProject(t, tag))));
}
