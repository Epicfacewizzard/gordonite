// Mood entries: a 1 to 5 score with an optional short note and the moment it was logged. Several a day.
// These helpers are used by the server (the streak in the API) and by the dashboard widget (the chart).
import { addDays } from './dates.js';

export const MOOD_LABELS = ['Very low', 'Low', 'Okay', 'Good', 'Great'];
export const MAX_MOOD_NOTE = 280;

/** Days in a row with at least one entry, counting back from today (or from yesterday while today has none yet). */
export function moodStreak(days, today) {
  const logged = days instanceof Set ? days : new Set(days);
  let day = logged.has(today) ? today : addDays(today, -1);
  let count = 0;
  while (logged.has(day)) {
    count++;
    day = addDays(day, -1);
  }
  return count;
}

/** One row per day from `from` to `to`: { day, count, avg } (avg is null when nothing was logged that day). */
export function dayAverages(moods, from, to) {
  const byDay = new Map();
  for (const m of moods) {
    const row = byDay.get(m.day) ?? { sum: 0, count: 0 };
    row.sum += m.score;
    row.count++;
    byDay.set(m.day, row);
  }
  const out = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const row = byDay.get(day);
    out.push({ day, count: row?.count ?? 0, avg: row ? row.sum / row.count : null });
  }
  return out;
}
