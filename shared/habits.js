// Habits (see docs/HABITS.md): what is due on a day, streaks, the week's progress, and courses started by the skin log.
// Used by the server (a skin entry starting a course) and the app (what to show). Dates are YYYY-MM-DD in the home
// time zone.
//
// habit: { id, name, detail, days: [0..6] (0 = Sunday), created: date,
//          trigger: null | { product: 'Betaderm', days: 7 },   a course: due only while one is running
//          courses: [{ from: date, to: date }] }               the courses so far, oldest first
import { addDays } from './dates.js';

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const weekday = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
/** The Monday of the week a date is in. */
export const weekStart = (date) => addDays(date, -((weekday(date) + 6) % 7));

/** Is a course of this habit running on that day? (Always true for a habit without a trigger.) */
export function inCourse(habit, date) {
  if (!habit.trigger) return true;
  return (habit.courses ?? []).some((c) => c.from <= date && date <= c.to);
}

/** Is the habit due on that day? */
export const scheduled = (habit, date) => date >= habit.created && habit.days.includes(weekday(date)) && inCourse(habit, date);

/** Days in a row it was done, counting only days it was due. An unfinished today does not break it. */
export function currentStreak(habit, today, isDone) {
  let date = today;
  let count = 0;
  if (!scheduled(habit, date) || !isDone(habit.id, date)) date = addDays(date, -1);
  for (; date >= habit.created; date = addDays(date, -1)) {
    if (!scheduled(habit, date)) {
      if (habit.trigger && !(habit.courses ?? []).some((c) => c.from <= date)) break; // before the first course
      continue;
    }
    if (!isDone(habit.id, date)) break;
    count++;
  }
  return count;
}

/** This week so far (Monday to today): how many due check-ins were done. */
export function weekProgress(habits, today, isDone) {
  let done = 0;
  let total = 0;
  for (let date = weekStart(today); date <= today; date = addDays(date, 1)) {
    for (const habit of habits) {
      if (!scheduled(habit, date)) continue;
      total++;
      if (isDone(habit.id, date)) done++;
    }
  }
  return { done, total };
}

/**
 * The habit's courses after its product was used on `date`: a running (or just ended) course is extended to
 * `date + days - 1`; otherwise a new one starts that day. Never shortens a course.
 */
export function extendCourse(habit, date) {
  const days = habit.trigger?.days;
  if (!days) return habit.courses ?? [];
  const until = addDays(date, days - 1);
  const courses = [...(habit.courses ?? [])].sort((a, b) => a.from.localeCompare(b.from));
  const touching = courses.findIndex((c) => c.from <= addDays(date, 1) && date <= addDays(c.to, 1));
  if (touching === -1) {
    courses.push({ from: date, to: until });
    return courses.sort((a, b) => a.from.localeCompare(b.from));
  }
  const c = courses[touching];
  courses[touching] = { from: c.from < date ? c.from : date, to: c.to > until ? c.to : until };
  return courses;
}

/** Does this product name start this habit's course? (Ignores case and spaces at the ends.) */
export const triggeredBy = (habit, product) => !!habit.trigger?.product && habit.trigger.product.trim().toLowerCase() === String(product).trim().toLowerCase();
