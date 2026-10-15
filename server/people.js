// People (see docs/PEOPLE.md): every live note tagged 05-people (or a group under it), with the record of details kept
// beside it. The note stays the person's page; this only adds the details. Saving is by note id and replaces the
// record (the phone queues saves and sends them in order).
import { HttpError } from './errors.js';
import { checkId } from './ids.js';
import { plainText } from '../shared/doc.js';
import { PEOPLE_TAG, cleanProfile, emptyProfile, logEntries } from '../shared/people.js';

const MAX_TEXT = 4000; // of a person's note text, sent along so the phone can search it offline

/** The details, checked; a bad record is a 400 saying what is wrong. Shared with import. */
export function cleanPersonProfile(raw) {
  try {
    return cleanProfile(raw);
  } catch (err) {
    throw new HttpError(400, 'bad_profile', err.message);
  }
}

const readProfile = (data) => {
  try {
    return cleanProfile(JSON.parse(data));
  } catch {
    return emptyProfile(); // a record this version cannot read is shown empty, never refused
  }
};

/** Everyone: { people: [{ noteId, title, tags, preview, text, lastChat, lastTalked, updatedAt, profile, profileUpdatedAt }] }, by name. */
export function listPeople(db) {
  const rows = db
    .prepare(
      `SELECT n.*, p.data AS profile_data, p.updated_at AS profile_updated_at FROM notes n LEFT JOIN people p ON p.note_id = n.id
       WHERE n.deleted_at IS NULL AND EXISTS (
         SELECT 1 FROM note_tags x JOIN tags t ON t.id = x.tag_id WHERE x.note_id = n.id AND (t.path = ? OR t.path LIKE ?))
       ORDER BY n.title COLLATE NOCASE, n.id`,
    )
    .all(PEOPLE_TAG, `${PEOPLE_TAG}/%`);
  const tags = new Map(rows.map((r) => [r.id, []]));
  if (rows.length) {
    const links = db
      .prepare(`SELECT x.note_id, t.path FROM note_tags x JOIN tags t ON t.id = x.tag_id WHERE x.note_id IN (${rows.map(() => '?').join(',')}) ORDER BY t.path`)
      .all(...rows.map((r) => r.id));
    for (const l of links) tags.get(l.note_id).push(l.path);
  }
  const people = rows.map((r) => {
    const doc = JSON.parse(r.doc);
    const lines = plainText(doc)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const body = r.title ? lines : lines.slice(1);
    // The card's line is the first writing, not a heading ("## Notes" opens most people notes from the vault).
    const writing = (doc.content ?? [])
      .filter((n) => n.type !== 'heading')
      .map((n) => plainText({ type: 'doc', content: [n] }).replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const profile = r.profile_data ? readProfile(r.profile_data) : emptyProfile();
    const lastChat = logEntries(doc)[0] ?? null;
    return {
      noteId: r.id,
      // What was last talked about, read from the Log in the note; last talked is the later of it and the detail.
      lastChat,
      lastTalked: [profile.lastTalked, lastChat?.date ?? ''].sort().at(-1),
      title: r.title || (lines[0] ?? '').slice(0, 120),
      tags: tags.get(r.id),
      preview: (r.title ? writing : writing.slice(1)).join(' · ').slice(0, 200),
      text: body.join('\n').slice(0, MAX_TEXT),
      updatedAt: r.updated_at,
      profile,
      profileUpdatedAt: r.profile_updated_at ?? null,
    };
  });
  return { people };
}

/** One person's details (empty when none were saved yet). */
export function getPerson(db, noteId) {
  const row = db.prepare('SELECT * FROM people WHERE note_id = ?').get(checkId(noteId, 'note id'));
  return { noteId, profile: row ? readProfile(row.data) : emptyProfile(), updatedAt: row?.updated_at ?? null };
}

/** Save (create or replace) a person's details. The note does not have to be on the server yet. */
export function savePerson(db, noteId, body) {
  const id = checkId(noteId, 'note id');
  if (!body || typeof body !== 'object') throw new HttpError(400, 'bad_body', 'Missing body');
  const profile = cleanPersonProfile(body.profile);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO people (note_id, data, created_at, updated_at) VALUES (?,?,?,?)
     ON CONFLICT(note_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  ).run(id, JSON.stringify(profile), now, now);
  return getPerson(db, id);
}
