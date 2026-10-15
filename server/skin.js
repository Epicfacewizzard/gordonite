// Skin log entries as data (see docs/SKIN-LOG.md). The phone writes each entry's line into a month note itself; this
// keeps what was picked, so an entry can be edited or reassessed later and other features can read it.
// Saving is by id and replaces the entry (the phone queues saves and sends them in order); deleting is soft.
import { HttpError } from './errors.js';
import { checkId } from './ids.js';
import { dateInTz, addDays, isValidDateString } from '../shared/dates.js';
import { startCourses } from './habits.js';

const MAX_TEXT = 2000;
const MAX_DATA = 10_000;
const MAX_RANGE_DAYS = 400;

const toEntry = (r) => ({
  id: r.id,
  date: r.entry_date,
  time: r.entry_time,
  data: JSON.parse(r.data),
  text: r.text,
  noteId: r.note_id ?? null,
  followsId: r.follows_id ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Check a saved entry's fields; returns the row values. Shared with import. */
export function cleanSkinEntry(body) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'bad_body', 'Missing body');
  if (!isValidDateString(body.date)) throw new HttpError(400, 'bad_date', '"date" must be a date like 2026-10-07');
  const time = body.time ?? '';
  if (typeof time !== 'string' || !/^(\d{4})?$/.test(time)) throw new HttpError(400, 'bad_time', '"time" must be four digits like 2300, or empty');
  if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > MAX_TEXT) throw new HttpError(400, 'bad_text', `"text" must be 1 to ${MAX_TEXT} characters`);
  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) throw new HttpError(400, 'bad_data', '"data" must be an object');
  const data = JSON.stringify(body.data);
  if (data.length > MAX_DATA) throw new HttpError(400, 'bad_data', '"data" is too large');
  const noteId = body.noteId ? checkId(body.noteId, 'note id') : null;
  const followsId = body.followsId ? checkId(body.followsId, 'entry id') : null;
  return { date: body.date, time, data, text: body.text, noteId, followsId };
}

/** Save (create or replace) one entry. A product it names may start or extend a habit's course (habits.js). */
export function saveSkinEntry(db, cfg, id, body) {
  const entryId = checkId(id, 'entry id');
  const e = cleanSkinEntry(body);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO skin_entries (id, entry_date, entry_time, data, text, note_id, follows_id, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET entry_date = excluded.entry_date, entry_time = excluded.entry_time, data = excluded.data,
       text = excluded.text, note_id = excluded.note_id, follows_id = excluded.follows_id, updated_at = excluded.updated_at, deleted_at = NULL`,
  ).run(entryId, e.date, e.time, e.data, e.text, e.noteId, e.followsId, now, now);
  const products = Array.isArray(body.data.products) ? body.data.products.filter((p) => typeof p === 'string') : [];
  const habits = startCourses(db, cfg, e.date, products);
  return { entry: toEntry(db.prepare('SELECT * FROM skin_entries WHERE id = ?').get(entryId)), habits };
}

/** Entries from one day to another (default: the last 30 days), newest first. */
export function listSkinEntries(db, cfg, { from = null, to = null } = {}) {
  to = to || dateInTz(new Date(), cfg.tz);
  from = from || addDays(to, -29);
  if (!isValidDateString(from) || !isValidDateString(to)) throw new HttpError(400, 'bad_date', '"from" and "to" must be dates like 2026-10-07');
  if (from > to) throw new HttpError(400, 'bad_date', '"from" must not be after "to"');
  if (addDays(from, MAX_RANGE_DAYS) < to) throw new HttpError(400, 'bad_date', `Ask for at most ${MAX_RANGE_DAYS} days at a time`);
  const entries = db
    .prepare('SELECT * FROM skin_entries WHERE deleted_at IS NULL AND entry_date BETWEEN ? AND ? ORDER BY entry_date DESC, entry_time DESC, created_at DESC')
    .all(from, to)
    .map(toEntry);
  return { from, to, entries };
}

/** Delete (soft). Deleting one already deleted, or never saved, is fine: the phone may send it again. */
export function deleteSkinEntry(db, id) {
  db.prepare('UPDATE skin_entries SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ?').run(new Date().toISOString(), checkId(id, 'entry id'));
  return { ok: true };
}
