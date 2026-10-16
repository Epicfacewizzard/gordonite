// Habits (see docs/HABITS.md): what is due on a day, streaks, scores, the week's progress, and courses started by the
// skin log. Used by the server (validating a habit, a skin entry starting a course) and the app (what to show). Dates
// are YYYY-MM-DD in the home time zone.
//
// habit: { id, name, detail, days: [0..6] (0 = Sunday), created: date,
//          freq: { type: 'days' }                     on the chosen weekdays (`days`), the default
//              | { type: 'week' | 'month', times: n }  n times a calendar week (Monday to Sunday) or month
//              | { type: 'every', n }                   once every n days, counted from `created`
//          kind: 'yesno' | 'number', unit, target, targetType: 'atLeast' | 'atMost'   a number habit is met on a day
//                                                       when the number entered reaches (or stays under) the target
//          color, question, reminder: 'HH:MM' | null, archived: boolean,
//          trigger: null | { product: 'Betaderm', days: 7 },   a course: due only while one is running (weekdays only)
//          courses: [{ from: date, to: date }] }               the courses so far, oldest first
//
// An entry (a check-in) is { value: number | null, skip: boolean }. A skipped day (ill, away) is neither done nor
// missed: it never breaks a streak, and in a habit counted per week, month or n days it stands in for one time.
// Functions that read check-ins take `entryOf(habitId, date)`, returning an entry, null, or simply true/false.
import { addDays } from './dates.js';

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const weekday = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
/** The Monday of the week a date is in. */
export const weekStart = (date) => addDays(date, -((weekday(date) + 6) % 7));
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
const monthEnd = (date) => {
  const d = new Date(`${date.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
};

// Colours a habit can have (its squares, its mark on the card). null = the app's accent colour.
export const COLORS = { teal: '#2fae9f', blue: '#4a86e8', purple: '#9466e0', pink: '#e0569a', red: '#e0524a', orange: '#ec8a34', yellow: '#cfa72b', green: '#52a556' };
export const FREQ_TYPES = ['days', 'week', 'month', 'every'];

export const freqOf = (habit) => habit.freq ?? { type: 'days' };
const perPeriod = (habit) => {
  const f = freqOf(habit);
  return f.type === 'week' || f.type === 'month' ? f.times : 1;
};
export const byPeriod = (habit) => freqOf(habit).type !== 'days';

/** "Every day", "Mon, Wed, Fri", "3 times a week", "Every 2 days". */
export function frequencyLabel(habit) {
  const f = freqOf(habit);
  if (f.type === 'week') return f.times === 1 ? 'Once a week' : `${f.times} times a week`;
  if (f.type === 'month') return f.times === 1 ? 'Once a month' : `${f.times} times a month`;
  if (f.type === 'every') return f.n === 1 ? 'Every day' : `Every ${f.n} days`;
  if (habit.days.length === 7) return 'Every day';
  if (habit.days.length === 5 && [1, 2, 3, 4, 5].every((d) => habit.days.includes(d))) return 'Weekdays';
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => habit.days.includes(d)).map((d) => DAYS[d]).join(', ');
}

/** "at least 8 glasses", or '' for a yes-or-no habit. */
export function targetLabel(habit) {
  if (habit.kind !== 'number') return '';
  return `${habit.targetType === 'atMost' ? 'at most' : 'at least'} ${habit.target}${habit.unit ? ` ${habit.unit}` : ''}`;
}

const asEntry = (e) => (e === true ? { value: null, skip: false } : e || null);
const lookup = (entryOf) => (id, date) => asEntry(entryOf(id, date));

/** Does this entry count as done? (A number habit: does the number reach the target?) */
export function met(habit, entry) {
  const e = asEntry(entry);
  if (!e || e.skip) return false;
  if (habit.kind !== 'number') return true;
  if (typeof e.value !== 'number') return false;
  return habit.targetType === 'atMost' ? e.value <= habit.target : e.value >= habit.target;
}

/** Is a course of this habit running on that day? (Always true for a habit without a trigger.) */
export function inCourse(habit, date) {
  if (!habit.trigger) return true;
  return (habit.courses ?? []).some((c) => c.from <= date && date <= c.to);
}

/** Can the habit be done on that day? Weekday habits: on their days. Habits counted per period: any day. */
export const scheduled = (habit, date) => date >= habit.created && (byPeriod(habit) || habit.days.includes(weekday(date))) && inCourse(habit, date);

/** The period a day falls in: the week, the month, the n days, or the day itself for a weekday habit. */
export function periodOf(habit, date) {
  const f = freqOf(habit);
  if (f.type === 'week') return { from: weekStart(date), to: addDays(weekStart(date), 6) };
  if (f.type === 'month') return { from: `${date.slice(0, 7)}-01`, to: monthEnd(date) };
  if (f.type === 'every') {
    const from = addDays(habit.created, Math.floor(daysBetween(habit.created, date) / f.n) * f.n);
    return { from, to: addDays(from, f.n - 1) };
  }
  return { from: date, to: date };
}

/** How a period stands: { done, skipped, needed, complete }. */
export function periodProgress(habit, date, entryOf) {
  const entry = lookup(entryOf);
  const { from, to } = periodOf(habit, date);
  let done = 0;
  let skipped = 0;
  for (let d = from < habit.created ? habit.created : from; d <= to; d = addDays(d, 1)) {
    const e = entry(habit.id, d);
    if (e?.skip) skipped++;
    else if (met(habit, e)) done++;
  }
  const needed = perPeriod(habit);
  return { done, skipped, needed, complete: done + skipped >= needed };
}

/**
 * Should the habit be on today's list? A weekday habit on its days; a habit counted per period until the period's
 * target is reached, and on a day it was done (so a tick stays where it was made).
 */
export function dueToday(habit, today, entryOf) {
  if (habit.archived || !scheduled(habit, today)) return false;
  if (!byPeriod(habit)) return true;
  return !periodProgress(habit, today, entryOf).complete || !!asEntry(entryOf(habit.id, today));
}

/** The unit a streak counts: days for weekday habits, otherwise weeks, months or periods. */
export function streakUnit(habit, n) {
  const t = freqOf(habit).type;
  const word = t === 'week' ? 'week' : t === 'month' ? 'month' : t === 'every' ? (freqOf(habit).n === 1 ? 'day' : 'period') : 'due day';
  return `${word}${n === 1 ? '' : 's'}`;
}

/**
 * Due days (or periods) in a row that were done. Days it was not due and skipped days are passed over; an
 * unfinished today (or this week, month, …) does not break it.
 */
export function currentStreak(habit, today, entryOf) {
  const entry = lookup(entryOf);
  let count = 0;
  if (byPeriod(habit)) {
    let p = periodOf(habit, today);
    if (!periodProgress(habit, today, entry).complete) p = periodOf(habit, addDays(p.from, -1));
    for (; p.to >= habit.created; p = periodOf(habit, addDays(p.from, -1))) {
      if (!periodProgress(habit, p.from < habit.created ? habit.created : p.from, entry).complete) break;
      count++;
    }
    return count;
  }
  let date = today;
  if (!scheduled(habit, date) || !met(habit, entry(habit.id, date))) date = addDays(date, -1);
  for (; date >= habit.created; date = addDays(date, -1)) {
    if (!scheduled(habit, date)) {
      if (habit.trigger && !(habit.courses ?? []).some((c) => c.from <= date)) break; // before the first course
      continue;
    }
    const e = entry(habit.id, date);
    if (e?.skip) continue;
    if (!met(habit, e)) break;
    count++;
  }
  return count;
}

/** Each finished due day or period from `from` (default: created) to today, oldest first: { from, to, value 0..1 }. */
function opportunities(habit, today, entry, from = habit.created) {
  const out = [];
  if (byPeriod(habit)) {
    for (let p = periodOf(habit, from < habit.created ? habit.created : from); p.from <= today; p = periodOf(habit, addDays(p.to, 1))) {
      const pr = periodProgress(habit, p.from < habit.created ? habit.created : p.from, entry);
      if (p.to >= today && !pr.complete) break; // the current period, not finished yet
      out.push({ ...p, value: Math.min(1, pr.done / Math.max(1, pr.needed - pr.skipped)), skipped: pr.skipped >= pr.needed && !pr.done });
    }
    return out;
  }
  for (let d = from < habit.created ? habit.created : from; d <= today; d = addDays(d, 1)) {
    if (!scheduled(habit, d)) continue;
    const e = entry(habit.id, d);
    if (d === today && !met(habit, e)) break; // today is not missed yet
    out.push({ from: d, to: d, value: met(habit, e) ? 1 : 0, skipped: !!e?.skip });
  }
  return out;
}

/** The longest run of done days (or periods) since the habit began. */
export function bestStreak(habit, today, entryOf) {
  const entry = lookup(entryOf);
  let best = 0;
  let run = 0;
  for (const o of opportunities(habit, today, entry)) {
    if (o.skipped) continue;
    run = o.value >= 1 ? run + 1 : 0;
    if (run > best) best = run;
  }
  return Math.max(best, currentStreak(habit, today, entryOf));
}

/**
 * How strong the habit is, 0 to 1: a running average of the due days (or periods) so far in which recent ones weigh
 * most; a done day pulls it up and a missed one down, by about half over four weeks of chances. So a long run is not
 * lost to one bad day, and a few good days do not make a strong habit. Skipped days leave it as it was.
 */
export function habitScore(habit, today, entryOf) {
  const entry = lookup(entryOf);
  const f = freqOf(habit);
  const chancesIn4Weeks = f.type === 'week' ? 4 : f.type === 'month' ? 1 : f.type === 'every' ? 28 / f.n : (4 * habit.days.length);
  const keep = 0.5 ** (1 / Math.max(1, chancesIn4Weeks));
  let score = 0;
  for (const o of opportunities(habit, today, entry)) {
    if (o.skipped) continue;
    score = score * keep + o.value * (1 - keep);
  }
  return score;
}

/** This week so far (Monday to today): how many due check-ins were done. Habits counted per week count `times`. */
export function weekProgress(habits, today, entryOf) {
  const entry = lookup(entryOf);
  let done = 0;
  let total = 0;
  for (const habit of habits) {
    if (habit.archived) continue;
    const t = freqOf(habit).type;
    if (t === 'week') {
      if (!scheduled(habit, today)) continue;
      const pr = periodProgress(habit, today, entry);
      total += pr.needed;
      done += Math.min(pr.needed, pr.done + pr.skipped);
      continue;
    }
    if (t === 'month') continue; // a month's target says nothing about this week
    if (t === 'every') {
      // the n-day periods this week has touched: counted once finished, or once done if still running
      const start = weekStart(today) < habit.created ? habit.created : weekStart(today);
      for (let p = periodOf(habit, start); p.from <= today && start <= today; p = periodOf(habit, addDays(p.to, 1))) {
        const pr = periodProgress(habit, p.from < start ? start : p.from, entry);
        if ((!pr.complete && p.to >= today) || (pr.skipped && !pr.done)) continue;
        total++;
        if (pr.complete) done++;
      }
      continue;
    }
    for (let date = weekStart(today); date <= today; date = addDays(date, 1)) {
      if (!scheduled(habit, date)) continue;
      const e = entry(habit.id, date);
      if (e?.skip) continue;
      total++;
      if (met(habit, e)) done++;
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
