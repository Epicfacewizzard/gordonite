// Recurring tasks (docs/RECURRING-TASKS.md).
//
// A task may carry a repeat rule, picked in the task menu or typed in its words ("every 2 weeks"):
//   { every: 1-365, unit: 'day' | 'week' | 'month' | 'year', days?: [0-6] (week only, 0 = Sunday), day?: 1-31, from: 'due' | 'done' }
// `from` says where the next due date counts from: the due date it had ('due', the default; bills, rent) or the day it
// was ticked in the home timezone ('done'; watering plants). `day` is the day of the month a monthly or yearly task
// belongs on, so a task due on the 31st falls on Feb 28 (or 29) and goes back to Mar 31.
//
// Ticking a repeating task does not complete it: it stays unticked, its due date moves on, and one entry is added to
// its `completions` (see shared/tasks.js patchedTaskAttrs). Everything here is plain calendar arithmetic on
// YYYY-MM-DD strings, so it never depends on the device's own timezone.
import { addDays, dateInTz, isValidDateString } from './dates.js';

export const UNITS = ['day', 'week', 'month', 'year'];
export const MAX_COMPLETIONS = 500;

// The zone a completion day is counted in when the caller does not say (the server and the client both set it from
// Settings; America/Edmonton until they do).
let homeZone = 'America/Edmonton';
export const setRepeatZone = (tz) => { if (tz) homeZone = tz; };
export const repeatZone = () => homeZone;

/** True when `r` is a well-formed repeat rule. */
export function isValidRepeat(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
  if (!Number.isInteger(r.every) || r.every < 1 || r.every > 365) return false;
  if (!UNITS.includes(r.unit)) return false;
  if (r.from !== undefined && r.from !== 'due' && r.from !== 'done') return false;
  if (r.days !== undefined) {
    if (r.unit !== 'week' || !Array.isArray(r.days) || !r.days.length || r.days.length > 7) return false;
    if (!r.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) || new Set(r.days).size !== r.days.length) return false;
  }
  if (r.day !== undefined && (!Number.isInteger(r.day) || r.day < 1 || r.day > 31)) return false;
  const known = new Set(['every', 'unit', 'days', 'day', 'from']);
  return Object.keys(r).every((k) => known.has(k));
}

/** A rule tidied to its stored form: days sorted, `from` always present, `day` only where it matters. */
export function normalRepeat(r) {
  const out = { every: r.every, unit: r.unit, from: r.from === 'done' ? 'done' : 'due' };
  if (r.unit === 'week' && r.days?.length) out.days = [...new Set(r.days)].sort((a, b) => a - b);
  if ((r.unit === 'month' || r.unit === 'year') && r.day) out.day = r.day;
  return out;
}

const dow = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
const lastDayOf = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12
const pad = (n) => String(n).padStart(2, '0');

/** `date` moved by `months` calendar months, on day `day` (or the date's own day), clamped to the month's last day. */
export function addMonths(date, months, day = Number(date.slice(8, 10))) {
  const total = Number(date.slice(0, 4)) * 12 + (Number(date.slice(5, 7)) - 1) + months;
  const y = Math.floor(total / 12), m = (total % 12) + 1;
  return `${y}-${pad(m)}-${pad(Math.min(day, lastDayOf(y, m)))}`;
}

/**
 * The next date after `base` under the rule. `day` overrides the day of the month for monthly and yearly rules (the
 * anchor), so clamping at a short month does not stick.
 */
export function nextDate(rule, base, day = rule.day) {
  const n = rule.every;
  switch (rule.unit) {
    case 'day':
      return addDays(base, n);
    case 'week': {
      if (!rule.days?.length) return addDays(base, 7 * n);
      // The first chosen weekday after `base`, in a week that is a whole number of `n` weeks from base's week
      // (weeks start on Sunday, as the weekday numbers do).
      const weekOf = (d) => addDays(d, -dow(d));
      const baseWeek = weekOf(base);
      for (let i = 1; i <= 7 * n + 7; i++) {
        const d = addDays(base, i);
        const weeks = Math.round((Date.parse(weekOf(d)) - Date.parse(baseWeek)) / (7 * 86400000));
        if (weeks % n === 0 && rule.days.includes(dow(d))) return d;
      }
      return addDays(base, 7 * n); // not reached for a valid rule
    }
    case 'month':
      return addMonths(base, n, day);
    case 'year':
      return addMonths(base, 12 * n, day);
    default:
      throw new Error(`Unknown repeat unit ${rule.unit}`);
  }
}

/**
 * Where a repeating task goes when it is ticked (or skipped) on instant `now`:
 * { due, start } for the next occurrence. `due` and `start` are the task's effective dates now (picked or typed; null
 * when it has none). Counting from the due date moves on one step only, even if that step is still in the past (the
 * October bill is still owed after September's is paid late). A task with no due date counts from the day it was done.
 * `anchor` is the day of the month a monthly/yearly rule belongs on when the rule does not say.
 */
export function nextOccurrence(rule, { due, start, now, tz = homeZone, anchor }) {
  const doneDay = dateInTz(now instanceof Date ? now : new Date(now), tz);
  const fromDue = rule.from !== 'done' && due;
  const base = fromDue ? due : doneDay;
  const day = rule.day ?? (fromDue ? anchor ?? Number(due.slice(8, 10)) : undefined);
  const nextDue = nextDate(rule, base, day);
  // A start date keeps its distance before the due date (a reminder a few days ahead stays a few days ahead).
  let nextStart = null;
  if (start) {
    const lead = due ? Math.round((Date.parse(due) - Date.parse(start)) / 86400000) : null;
    nextStart = lead !== null ? addDays(nextDue, -lead) : null;
  }
  return { due: nextDue, start: nextStart };
}

const UNIT_WORD = { day: 'day', week: 'week', month: 'month', year: 'year' };
const DAY_NAME = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const isWeekdays = (days) => days?.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d));

/** Short words for a rule: "daily", "every 2 weeks", "weekly on Mon, Thu", "monthly", "every weekday · from done". */
export function repeatLabel(r, { withFrom = true } = {}) {
  if (!r) return '';
  let words;
  if (r.unit === 'week' && r.days?.length) {
    const on = isWeekdays(r.days) ? 'weekday' : r.days.map((d) => DAY_NAME[d]).join(', ');
    words = r.every === 1 ? (isWeekdays(r.days) ? 'every weekday' : `weekly on ${on}`) : `every ${r.every} weeks on ${on}`;
  } else if (r.every === 1) words = { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' }[r.unit];
  else words = `every ${r.every} ${UNIT_WORD[r.unit]}s`;
  return withFrom && r.from === 'done' ? `${words} · from done` : words;
}

// ---- typed in the task's words ----

const WEEKDAYS = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tues: 2, tue: 2, wednesday: 3, wed: 3,
  thursday: 4, thurs: 4, thur: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
};
const WD = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join('|');
const WD_LIST = `(?:${WD})s?(?:\\s*(?:,\\s*(?:and\\s+)?|\\s+and\\s+|\\s*&\\s*)(?:${WD})s?)*`;
const FROM_DONE = `(?:\\s+(?<done>(?:from|after)\\s+(?:done|completion|completed|finishing|finished)))?`;
const REPEAT = new RegExp(
  `(?<![\\w-])(?:` +
    `every\\s+(?:(?<n>\\d{1,3})\\s+(?<unitN>days|weeks|months|years)|(?<other>other)\\s+(?<unitO>day|week|month|year)|(?<weekday>weekday)s?|(?<wds>${WD_LIST})|(?<unit1>day|week|month|year))` +
    `|(?<adverb>daily|weekly|fortnightly|monthly|yearly|annually)` +
  `)${FROM_DONE}(?![\\w-])`,
  'i',
);

/** The repeat phrase in a task's words: { rule, index, length } or null. The first one counts. */
export function findRepeatPhrase(text) {
  if (typeof text !== 'string') return null;
  const m = REPEAT.exec(text);
  if (!m) return null;
  const g = m.groups;
  let rule;
  if (g.n) {
    const n = Number(g.n);
    if (n < 1 || n > 365) return null;
    rule = { every: n, unit: g.unitN.toLowerCase().replace(/s$/, '') };
  } else if (g.other) rule = { every: 2, unit: g.unitO.toLowerCase() };
  else if (g.weekday) rule = { every: 1, unit: 'week', days: [1, 2, 3, 4, 5] };
  else if (g.wds) {
    const days = [...g.wds.toLowerCase().matchAll(new RegExp(WD, 'g'))].map((x) => WEEKDAYS[x[0]]);
    rule = { every: 1, unit: 'week', days };
  } else if (g.unit1) rule = { every: 1, unit: g.unit1.toLowerCase() };
  else {
    const a = g.adverb.toLowerCase();
    rule = a === 'fortnightly' ? { every: 2, unit: 'week' } : { every: 1, unit: { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year', annually: 'year' }[a] };
  }
  rule.from = g.done ? 'done' : 'due';
  return { rule: normalRepeat(rule), index: m.index, length: m[0].length };
}

/** A completion entry is { at: UTC timestamp, due: YYYY-MM-DD | null, skipped?: true, prev?: {...} }. */
export function isValidCompletion(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
  if (typeof c.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(c.at) || !Number.isFinite(Date.parse(c.at))) return false;
  if (c.due != null && !isValidDateString(c.due)) return false;
  if (c.skipped !== undefined && c.skipped !== true) return false;
  if (c.prev !== undefined) {
    if (!c.prev || typeof c.prev !== 'object' || Array.isArray(c.prev)) return false;
    for (const k of ['due', 'start', 'hideUntil']) if (c.prev[k] != null && !isValidDateString(c.prev[k])) return false;
  }
  return true;
}
