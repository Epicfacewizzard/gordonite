// Mood entries: a 1 to 5 score, an optional short note, the moment it was logged. Several a day.
// Saving is idempotent by id (the phone keeps trying until the server confirms), and deleting is soft.
import { HttpError, checkId } from './store.js';
import { dateInTz, addDays, isValidDateString } from '../shared/dates.js';
import { uuid } from '../shared/ids.js';
import { MAX_MOOD_NOTE, moodStreak } from '../shared/moods.js';

const MAX_RANGE_DAYS = 400;
const toMood = (r) => ({ id: r.id, score: r.score, note: r.note ?? null, day: r.day, at: r.logged_at });

function cleanNote(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new HttpError(400, 'bad_note', 'note must be text');
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_MOOD_NOTE) || null;
}

// When it was logged: now unless a time is given (a phone that was offline sends the time of the tap).
function loggedAt(value) {
  if (value === undefined || value === null) return new Date().toISOString();
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  if (Number.isNaN(ms)) throw new HttpError(400, 'bad_time', '"at" must be a date and time such as 2026-10-07T08:30:00Z');
  if (ms > Date.now() + 5 * 60_000) throw new HttpError(400, 'bad_time', '"at" cannot be in the future');
  if (ms < Date.now() - MAX_RANGE_DAYS * 86_400_000) throw new HttpError(400, 'bad_time', '"at" is too long ago');
  return new Date(ms).toISOString();
}

/** Save one mood. Sending the same id again changes nothing and returns the saved entry. */
export function addMood(db, cfg, body, id = null) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'bad_body', 'Missing body');
  if (!Number.isInteger(body.score) || body.score < 1 || body.score > 5) throw new HttpError(400, 'bad_score', 'score must be a whole number from 1 to 5');
  const note = cleanNote(body.note);
  const at = loggedAt(body.at);
  const moodId = id ? checkId(id, 'mood id') : uuid();
  const existing = db.prepare('SELECT * FROM mood_entries WHERE id = ?').get(moodId);
  if (existing) return { mood: toMood(existing), created: false };
  db.prepare('INSERT INTO mood_entries (id, score, note, day, logged_at, created_at) VALUES (?,?,?,?,?,?)').run(
    moodId, body.score, note, dateInTz(new Date(at), cfg.tz), at, new Date().toISOString(),
  );
  return { mood: toMood(db.prepare('SELECT * FROM mood_entries WHERE id = ?').get(moodId)), created: true };
}

/** Entries from one day to another (default: the last 30 days), oldest first, with the logging streak. */
export function listMoods(db, cfg, { from = null, to = null } = {}) {
  const today = dateInTz(new Date(), cfg.tz);
  to = to || today;
  from = from || addDays(to, -29);
  if (!isValidDateString(from) || !isValidDateString(to)) throw new HttpError(400, 'bad_date', '"from" and "to" must be dates like 2026-10-07');
  if (from > to) throw new HttpError(400, 'bad_date', '"from" must not be after "to"');
  if (addDays(from, MAX_RANGE_DAYS) < to) throw new HttpError(400, 'bad_date', `Ask for at most ${MAX_RANGE_DAYS} days at a time`);
  const moods = db
    .prepare('SELECT * FROM mood_entries WHERE deleted_at IS NULL AND day BETWEEN ? AND ? ORDER BY logged_at, id')
    .all(from, to)
    .map(toMood);
  const loggedDays = db.prepare('SELECT DISTINCT day FROM mood_entries WHERE deleted_at IS NULL AND day >= ?').all(addDays(today, -MAX_RANGE_DAYS));
  return {
    today, from, to, moods,
    daysLogged: new Set(moods.map((m) => m.day)).size,
    streak: moodStreak(loggedDays.map((r) => r.day), today),
  };
}

export function deleteMood(db, id) {
  const res = db.prepare('UPDATE mood_entries SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ?').run(new Date().toISOString(), checkId(id, 'mood id'));
  if (res.changes === 0) throw new HttpError(404, 'not_found', 'Mood entry not found');
  return { ok: true };
}
