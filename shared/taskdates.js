// Dates typed into a task's text: "call dentist due fri", "essay starts oct 12", "pay rent due in 3 days".
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
  `in\\s+(?<n>\\d{1,3})\\s+(?<unit>days?|weeks?)`,
  `(?:next\\s+)?(?<wd>${WD})`,
  `(?<mo1>${MO})\\.?\\s+(?<d1>\\d{1,2})(?:st|nd|rd|th)?`,
  `(?<d2>\\d{1,2})(?:st|nd|rd|th)?\\s+(?<mo2>${MO})`,
].join('|');

const PHRASE = new RegExp(`(?<![\\w-])(?<kw>due|starts?|starting)\\s+(?:on\\s+)?(?:${EXPR})(?![\\w-])`, 'gi');

const dow = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

function monthDay(noteDate, month, day) {
  const year = Number(noteDate.slice(0, 4));
  for (const y of [year, year + 1]) {
    const candidate = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (!isValidDateString(candidate)) return null; // e.g. Feb 30
    if (candidate >= noteDate) return candidate;
  }
  return null;
}

function resolve(g, noteDate) {
  if (g.iso) return isValidDateString(g.iso) ? g.iso : null;
  if (g.rel) return /^today$/i.test(g.rel) ? noteDate : addDays(noteDate, 1);
  if (g.n) return addDays(noteDate, Number(g.n) * (/^w/i.test(g.unit) ? 7 : 1));
  if (g.wd) {
    const diff = (WEEKDAYS[g.wd.toLowerCase()] - dow(noteDate) + 7) % 7 || 7;
    return addDays(noteDate, diff);
  }
  if (g.mo1) return monthDay(noteDate, MONTHS[g.mo1.toLowerCase()], Number(g.d1));
  if (g.mo2) return monthDay(noteDate, MONTHS[g.mo2.toLowerCase()], Number(g.d2));
  return null;
}

/** Every date phrase in the text, in order: [{ kind: 'due' | 'start', date, index, length }] (index/length locate it in the text). */
export function findDatePhrases(text, noteDate) {
  const out = [];
  if (typeof text !== 'string' || !isValidDateString(noteDate)) return out;
  for (const m of text.matchAll(PHRASE)) {
    const date = resolve(m.groups, noteDate);
    if (date) out.push({ kind: m.groups.kw.toLowerCase() === 'due' ? 'due' : 'start', date, index: m.index, length: m[0].length });
  }
  return out;
}

/** { due, start } found in the text (YYYY-MM-DD or null). The first phrase of each kind wins. */
export function parseTaskDates(text, noteDate) {
  const out = { due: null, start: null };
  for (const p of findDatePhrases(text, noteDate)) if (!out[p.kind]) out[p.kind] = p.date;
  return out;
}
