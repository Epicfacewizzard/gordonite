// Habits and their check-ins (see docs/HABITS.md). Saving a habit is by id and replaces it (the phone queues saves
// and sends them in order); a check-in is set or cleared by habit and day. Deleting a habit is soft.
// A habit with a trigger is a course started by the skin log: see startCourses, called when a skin entry is saved.
import { HttpError } from './errors.js';
import { checkId } from './ids.js';
import { dateInTz, addDays, isValidDateString } from '../shared/dates.js';
import { extendCourse, triggeredBy, COLORS, FREQ_TYPES } from '../shared/habits.js';

const MAX_HABITS = 200;
const MAX_RANGE_DAYS = 400;

// Kept in the `options` column; a habit saved without one of them (by an older app on a phone) keeps what it had.
export const OPTION_DEFAULTS = { freq: { type: 'days' }, kind: 'yesno', unit: '', target: null, targetType: 'atLeast', color: null, question: '', reminder: null, archived: false };
const OPTION_KEYS = Object.keys(OPTION_DEFAULTS);

const toHabit = (r) => ({
  ...OPTION_DEFAULTS,
  ...JSON.parse(r.options ?? '{}'),
  id: r.id,
  name: r.name,
  detail: r.detail,
  days: JSON.parse(r.days),
  created: r.created,
  trigger: r.trigger ? JSON.parse(r.trigger) : null,
  courses: JSON.parse(r.courses),
  sort: r.sort,
});

function cleanOptions(o) {
  const bad = (message) => new HttpError(400, 'bad_options', message);
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  const f = o.freq ?? OPTION_DEFAULTS.freq;
  if (!f || !FREQ_TYPES.includes(f.type)) throw bad('Unknown frequency');
  let freq = { type: 'days' };
  if (f.type === 'week' || f.type === 'month') {
    if (!int(f.times, 1, f.type === 'week' ? 7 : 31)) throw bad(`Choose how many times a ${f.type}`);
    freq = { type: f.type, times: f.times };
  } else if (f.type === 'every') {
    if (!int(f.n, 1, 365)) throw bad('Every 1 to 365 days');
    freq = { type: 'every', n: f.n };
  }
  const kind = o.kind ?? 'yesno';
  if (kind !== 'yesno' && kind !== 'number') throw bad('A habit is yes-or-no or a number');
  let unit = '';
  let target = null;
  let targetType = 'atLeast';
  if (kind === 'number') {
    if (typeof o.target !== 'number' || !Number.isFinite(o.target) || o.target < 0 || o.target > 1e9) throw bad('A number habit needs a target of 0 or more');
    target = o.target;
    unit = typeof o.unit === 'string' ? o.unit.trim().slice(0, 20) : '';
    targetType = o.targetType === 'atMost' ? 'atMost' : 'atLeast';
  }
  const color = o.color == null || o.color === '' ? null : o.color;
  if (color !== null && !Object.hasOwn(COLORS, color)) throw bad('Unknown colour');
  const question = typeof o.question === 'string' ? o.question.trim().slice(0, 120) : '';
  const reminder = o.reminder == null || o.reminder === '' ? null : o.reminder;
  if (reminder !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(reminder)) throw bad('A reminder time is like 21:00');
  return { freq, kind, unit, target, targetType, color, question, reminder, archived: o.archived === true };
}

/** Check a habit's fields; returns the row values. Shared with import. `previous`: the options it has now. */
export function cleanHabit(body, previous = null) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'bad_body', 'Missing body');
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 80) throw new HttpError(400, 'bad_name', 'A habit needs a name of up to 80 characters');
  const detail = typeof body.detail === 'string' ? body.detail.trim().slice(0, 100) : '';
  const days = Array.isArray(body.days) ? [...new Set(body.days)] : [];
  if (!days.length || !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) throw new HttpError(400, 'bad_days', 'Choose at least one day of the week');
  if (!isValidDateString(body.created)) throw new HttpError(400, 'bad_date', '"created" must be a date like 2026-10-07');
  let trigger = null;
  if (body.trigger) {
    const product = typeof body.trigger.product === 'string' ? body.trigger.product.trim() : '';
    const n = body.trigger.days;
    if (!product || product.length > 80 || !Number.isInteger(n) || n < 1 || n > 365) throw new HttpError(400, 'bad_trigger', 'A course needs a product name and 1 to 365 days');
    trigger = { product, days: n };
  }
  const courses = Array.isArray(body.courses) ? body.courses : [];
  if (courses.length > 1000 || !courses.every((c) => isValidDateString(c?.from) && isValidDateString(c?.to) && c.from <= c.to)) throw new HttpError(400, 'bad_courses', 'Courses must be { from, to } dates');
  const sort = Number.isInteger(body.sort) ? body.sort : 0;
  const given = {};
  for (const k of OPTION_KEYS) given[k] = body[k] !== undefined ? body[k] : previous?.[k];
  const options = cleanOptions(given);
  if (trigger && options.freq.type !== 'days') throw new HttpError(400, 'bad_trigger', 'A course from the skin log runs on chosen weekdays');
  return { name, detail, days: JSON.stringify(days.sort()), created: body.created, trigger: trigger ? JSON.stringify(trigger) : null, courses: JSON.stringify(courses.map((c) => ({ from: c.from, to: c.to }))), sort, options: JSON.stringify(options) };
}

export function saveHabit(db, id, body) {
  const habitId = checkId(id, 'habit id');
  const exists = db.prepare('SELECT courses, options FROM habits WHERE id = ?').get(habitId);
  const h = cleanHabit(body, exists ? JSON.parse(exists.options) : null);
  // The phone sends no courses when it edits a habit: the ones here (perhaps just extended by a skin entry) stay.
  if (body.courses === undefined && exists) h.courses = exists.courses;
  if (!exists && db.prepare('SELECT COUNT(*) AS n FROM habits WHERE deleted_at IS NULL').get().n >= MAX_HABITS) throw new HttpError(400, 'too_many', `At most ${MAX_HABITS} habits`);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO habits (id, name, detail, days, created, trigger, courses, sort, options, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, detail = excluded.detail, days = excluded.days, created = excluded.created,
       trigger = excluded.trigger, courses = excluded.courses, sort = excluded.sort, options = excluded.options, updated_at = excluded.updated_at, deleted_at = NULL`,
  ).run(habitId, h.name, h.detail, h.days, h.created, h.trigger, h.courses, h.sort, h.options, now, now);
  return { habit: toHabit(db.prepare('SELECT * FROM habits WHERE id = ?').get(habitId)) };
}

export function deleteHabit(db, id) {
  db.prepare('UPDATE habits SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ?').run(new Date().toISOString(), checkId(id, 'habit id'));
  return { ok: true };
}

/**
 * Tick (done = true) or untick a habit on a day. Not for a future day. `entry` ({ value, skip }) sets the number
 * entered or marks the day skipped, replacing what the day had; without it a tick keeps an existing check-in as it is
 * (a tick from the skin log, or from an app older than numbers and skips).
 */
export function setCheck(db, cfg, habitId, date, done, source = 'tap', entry = null) {
  checkId(habitId, 'habit id');
  if (!isValidDateString(date)) throw new HttpError(400, 'bad_date', 'The day must be a date like 2026-10-07');
  if (date > dateInTz(new Date(), cfg.tz)) throw new HttpError(400, 'future_date', 'A day that has not come yet cannot be ticked');
  if (done && entry && (entry.value !== undefined || entry.skip !== undefined)) {
    const value = entry.value ?? null;
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e9)) throw new HttpError(400, 'bad_value', 'The number must be a plain number');
    db.prepare(
      `INSERT INTO habit_checks (habit_id, check_date, source, checked_at, value, skip) VALUES (?,?,?,?,?,?)
       ON CONFLICT(habit_id, check_date) DO UPDATE SET value = excluded.value, skip = excluded.skip, source = excluded.source, checked_at = excluded.checked_at`,
    ).run(habitId, date, source, new Date().toISOString(), value, entry.skip === true ? 1 : 0);
  } else if (done) db.prepare('INSERT OR IGNORE INTO habit_checks (habit_id, check_date, source, checked_at) VALUES (?,?,?,?)').run(habitId, date, source, new Date().toISOString());
  else db.prepare('DELETE FROM habit_checks WHERE habit_id = ? AND check_date = ?').run(habitId, date);
  return { ok: true };
}

/** Every habit, and the check-ins between two days (default: the last 120 days). */
export function listHabits(db, cfg, { from = null, to = null } = {}) {
  to = to || dateInTz(new Date(), cfg.tz);
  from = from || addDays(to, -119);
  if (!isValidDateString(from) || !isValidDateString(to) || from > to) throw new HttpError(400, 'bad_date', '"from" and "to" must be dates like 2026-10-07, in order');
  if (addDays(from, MAX_RANGE_DAYS) < to) throw new HttpError(400, 'bad_date', `Ask for at most ${MAX_RANGE_DAYS} days at a time`);
  const habits = db.prepare('SELECT * FROM habits WHERE deleted_at IS NULL ORDER BY sort, created_at, id').all().map(toHabit);
  const checks = db
    .prepare('SELECT c.habit_id AS habitId, c.check_date AS date, c.source, c.value, c.skip FROM habit_checks c JOIN habits h ON h.id = c.habit_id WHERE h.deleted_at IS NULL AND c.check_date BETWEEN ? AND ? ORDER BY c.check_date')
    .all(from, to)
    .map((c) => ({ ...c, skip: c.skip === 1 }));
  return { from, to, habits, checks };
}

/**
 * A skin entry was saved: each habit whose trigger names one of its products starts (or extends) a course from the
 * entry's day, and that day is ticked. Returns the ids of the habits it touched.
 */
export function startCourses(db, cfg, date, products = []) {
  if (!products.length || !isValidDateString(date)) return [];
  const touched = [];
  for (const row of db.prepare('SELECT * FROM habits WHERE deleted_at IS NULL AND trigger IS NOT NULL').all()) {
    const habit = toHabit(row);
    if (!products.some((p) => triggeredBy(habit, p))) continue;
    db.prepare('UPDATE habits SET courses = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(extendCourse(habit, date)), new Date().toISOString(), habit.id);
    if (date <= dateInTz(new Date(), cfg.tz)) setCheck(db, cfg, habit.id, date, true, 'skin');
    touched.push(habit.id);
  }
  return touched;
}
