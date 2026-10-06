// Dates typed into a task's text: "call dentist due fri", "essay starts oct 12", "pay rent due in 3 days",
// or just a date word at the end: "review this example tomorrow".
//
// Nothing rewrites the text. The phrase stays exactly as typed and is read when tasks are listed.
// Relative words ("fri", "tomorrow") are resolved against the date of the NOTE the task is in, not
// against today, so the answer never drifts: "due fri" written on Mon Oct 5 is Fri Oct 9 forever.
// A weekday means its next occurrence after the note date ("due fri" written on a Friday is the
// following Friday; write "due today" for the same day).
import { addDays, isValidDateString } from './dates.js';

const WEEKDAYS = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tues: 2, tue: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thurs: 4, thur: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};
const MONTHS = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
};

// Longest names first so "friday" is not read as "fri" + "day".
const alt = (names) => Object.keys(names).sort((a, b) => b.length - a.length).join('|');
const WD = alt(WEEKDAYS);
const MO = alt(MONTHS);

const EXPR = [
  `(?<iso>\\d{4}-\\d{2}-\\d{2})`,
  `(?<rel>today|tomorrow|tmrw|tmr)`,
  `next\\s+(?<nextUnit>week|month|year)`,
  `in\\s+(?<n>\\d{1,3})\\s+(?<unit>days?|weeks?)`,
  `(?:next\\s+)?(?<wd>${WD})`,
  `(?<mo1>${MO})\\.?\\s+(?<d1>\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(?<year1>\\d{4}))?`,
  `(?<d2>\\d{1,2})(?:st|nd|rd|th)?\\s+(?<mo2>${MO})(?:,?\\s+(?<year2>\\d{4}))?`,
].join('|');

const PHRASE = new RegExp(`(?<![\\w-])(?<kw>due|starts?|starting)\\s+(?:on\\s+)?(?:${EXPR})(?![\\w-])`, 'gi');

// A date word at the very end of a task counts as its due date, with or without "due" in front:
// "review this example tomorrow", "call mom on sun". (Only the due date; a start date needs its keyword.)
const TRAILING = new RegExp(`(?<![\\w-])(?:(?:by|on)\\s+)?(?:${EXPR})(?:\\s*[.!?])?\\s*$`, 'i');

const dow = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

function monthDay(noteDate, month, day, explicitYear) {
  const year = Number(noteDate.slice(0, 4));
  for (const y of explicitYear ? [Number(explicitYear)] : [year, year + 1]) {
    const candidate = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (!isValidDateString(candidate)) return null; // e.g. Feb 30
    if (explicitYear || candidate >= noteDate) return candidate;
  }
  return null;
}

function resolve(g, noteDate) {
  if (g.iso) return isValidDateString(g.iso) ? g.iso : null;
  if (g.rel) return /^today$/i.test(g.rel) ? noteDate : addDays(noteDate, 1);
  if (g.nextUnit) {
    const unit = g.nextUnit.toLowerCase();
    if (unit === 'week') return addDays(noteDate, 7);
    const date = new Date(`${noteDate}T00:00:00Z`), day = date.getUTCDate();
    date.setUTCDate(1);
    if (unit === 'month') date.setUTCMonth(date.getUTCMonth() + 1);
    else date.setUTCFullYear(date.getUTCFullYear() + 1);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, last));
    return date.toISOString().slice(0, 10);
  }
  if (g.n) return addDays(noteDate, Number(g.n) * (/^w/i.test(g.unit) ? 7 : 1));
  if (g.wd) {
    const diff = (WEEKDAYS[g.wd.toLowerCase()] - dow(noteDate) + 7) % 7 || 7;
    return addDays(noteDate, diff);
  }
  if (g.mo1) return monthDay(noteDate, MONTHS[g.mo1.toLowerCase()], Number(g.d1), g.year1);
  if (g.mo2) return monthDay(noteDate, MONTHS[g.mo2.toLowerCase()], Number(g.d2), g.year2);
  return null;
}

/** Every date phrase in the text, in order: [{ kind: 'due' | 'start', date, index, length }] (index/length locate it in the text). */
function findCalendarPhrases(text, noteDate) {
  const out = [];
  if (typeof text !== 'string' || !isValidDateString(noteDate)) return out;
  for (const m of text.matchAll(PHRASE)) {
    const date = resolve(m.groups, noteDate);
    if (date) out.push({ kind: m.groups.kw.toLowerCase() === 'due' ? 'due' : 'start', date, index: m.index, length: m[0].length });
  }
  if (!out.some((p) => p.kind === 'due')) {
    const m = TRAILING.exec(text);
    const date = m && resolve(m.groups, noteDate);
    if (date) {
      const length = m[0].trimEnd().length;
      const overlaps = out.some((p) => m.index < p.index + p.length && p.index < m.index + length); // already part of "starts oct 12"
      if (!overlaps) out.push({ kind: 'due', date, index: m.index, length });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

// A small grammar, not a list of whole sentences. Explicit am/pm, 24-hour
// HH:mm, noon and midnight are unambiguous; a bare number is left alone.
const TIME = /(?<![\w:])(?:(?<kw>due|starts?|starting)\s+)?(?:at\s+)?(?:(?<h>\d{1,2})(?::(?<m>\d{2}))?\s*(?<mer>am|pm)|(?<h24>\d{1,2}):(?<m24>\d{2})|(?<named>noon|midnight))(?![\w:])/gi;
export function findDatePhrases(text, noteDate) {
  if (typeof text !== 'string' || !isValidDateString(noteDate)) return [];
  const times = [];
  let masked = text;
  for (const match of text.matchAll(TIME)) {
    const g = match.groups;
    let hour = g.named ? (/noon/i.test(g.named) ? 12 : 0) : Number(g.h ?? g.h24);
    const minute = Number(g.m ?? g.m24 ?? 0);
    if (minute > 59 || (g.mer ? hour < 1 || hour > 12 : hour > 23)) continue;
    if (g.mer) hour = hour % 12 + (/pm/i.test(g.mer) ? 12 : 0);
    times.push({ index: match.index, length: match[0].length, time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, kind: g.kw ? (/^due$/i.test(g.kw) ? 'due' : 'start') : null });
    masked = masked.slice(0, match.index) + ' '.repeat(match[0].length) + masked.slice(match.index + match[0].length);
  }
  const dates = findCalendarPhrases(masked, noteDate);
  for (const clock of times) {
    const adjacent = dates.filter((date) => {
      if (clock.kind && date.kind !== clock.kind) return false;
      const left = Math.min(date.index + date.length, clock.index + clock.length);
      const right = Math.max(date.index, clock.index);
      return /^[\s,]*(?:at|on)?[\s,]*$/i.test(text.slice(left, right));
    }).sort((a, b) => {
      const gap = (d) => Math.max(d.index - clock.index - clock.length, clock.index - d.index - d.length, 0);
      return gap(a) - gap(b) || a.index - b.index;
    })[0];
    if (adjacent && !adjacent.time) {
      const end = Math.max(adjacent.index + adjacent.length, clock.index + clock.length);
      adjacent.index = Math.min(adjacent.index, clock.index); adjacent.length = end - adjacent.index;
      adjacent.time = clock.time;
    } else dates.push({ ...clock, kind: clock.kind || 'due', date: noteDate });
  }
  return dates.sort((a, b) => a.index - b.index);
}

export function parseTaskSchedule(text, noteDate) {
  const out = { due: null, start: null, dueTime: null, startTime: null };
  for (const phrase of findDatePhrases(text, noteDate)) if (!out[phrase.kind]) {
    out[phrase.kind] = phrase.date;
    out[`${phrase.kind}Time`] = phrase.time ?? null;
  }
  return out;
}

/** { due, start } found in the text (YYYY-MM-DD or null). The first phrase of each kind wins. */
export function parseTaskDates(text, noteDate) {
  const out = { due: null, start: null };
  for (const p of findDatePhrases(text, noteDate)) if (!out[p.kind]) out[p.kind] = p.date;
  return out;
}
