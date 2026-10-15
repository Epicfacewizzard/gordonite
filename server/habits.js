// Habits and their check-ins (see docs/HABITS.md). Saving a habit is by id and replaces it (the phone queues saves
// and sends them in order); a check-in is set or cleared by habit and day. Deleting a habit is soft.
// A habit with a trigger is a course started by the skin log: see startCourses, called when a skin entry is saved.
import { HttpError } from './errors.js';
import { checkId } from './ids.js';
import { dateInTz, addDays, isValidDateString } from '../shared/dates.js';
import { extendCourse, triggeredBy } from '../shared/habits.js';

const MAX_HABITS = 200;
const MAX_RANGE_DAYS = 400;

const toHabit = (r) => ({
  id: r.id,
  name: r.name,
  detail: r.detail,
  days: JSON.parse(r.days),
  created: r.created,
  trigger: r.trigger ? JSON.parse(r.trigger) : null,
  courses: JSON.parse(r.courses),
  sort: r.sort,
});

/** Check a habit's fields; returns the row values. Shared with import. */
export function cleanHabit(body) {
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
  return { name, detail, days: JSON.stringify(days.sort()), created: body.created, trigger: trigger ? JSON.stringify(trigger) : null, courses: JSON.stringify(courses.map((c) => ({ from: c.from, to: c.to }))), sort };
}

export function saveHabit(db, id, body) {
  const habitId = checkId(id, 'habit id');
  const h = cleanHabit(body);
  const exists = db.prepare('SELECT courses FROM habits WHERE id = ?').get(habitId);
  // The phone sends no courses when it edits a habit: the ones here (perhaps just extended by a skin entry) stay.
  if (body.courses === undefined && exists) h.courses = exists.courses;
  if (!exists && db.prepare('SELECT COUNT(*) AS n FROM habits WHERE deleted_at IS NULL').get().n >= MAX_HABITS) throw new HttpError(400, 'too_many', `At most ${MAX_HABITS} habits`);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO habits (id, name, detail, days, created, trigger, courses, sort, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, detail = excluded.detail, days = excluded.days, created = excluded.created,
       trigger = excluded.trigger, courses = excluded.courses, sort = excluded.sort, updated_at = excluded.updated_at, deleted_at = NULL`,
  ).run(habitId, h.name, h.detail, h.days, h.created, h.trigger, h.courses, h.sort, now, now);
  return { habit: toHabit(db.prepare('SELECT * FROM habits WHERE id = ?').get(habitId)) };
}

export function deleteHabit(db, id) {
  db.prepare('UPDATE habits SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ?').run(new Date().toISOString(), checkId(id, 'habit id'));
  return { ok: true };
}

/** Tick (done = true) or untick a habit on a day. Not for a future day. */
export function setCheck(db, cfg, habitId, date, done, source = 'tap') {
  checkId(habitId, 'habit id');
  if (!isValidDateString(date)) throw new HttpError(400, 'bad_date', 'The day must be a date like 2026-10-07');
  if (date > dateInTz(new Date(), cfg.tz)) throw new HttpError(400, 'future_date', 'A day that has not come yet cannot be ticked');
  if (done) db.prepare('INSERT OR IGNORE INTO habit_checks (habit_id, check_date, source, checked_at) VALUES (?,?,?,?)').run(habitId, date, source, new Date().toISOString());
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
    .prepare('SELECT c.habit_id AS habitId, c.check_date AS date, c.source FROM habit_checks c JOIN habits h ON h.id = c.habit_id WHERE h.deleted_at IS NULL AND c.check_date BETWEEN ? AND ? ORDER BY c.check_date')
    .all(from, to);
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
