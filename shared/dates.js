// Note dates are plain calendar dates (YYYY-MM-DD) in the configured home
// timezone. They are stored separately from timestamps, which are UTC instants.

export function dateInTz(instant, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant instanceof Date ? instant : new Date(instant));
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function isValidDateString(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// "Today", "Yesterday", or "Mon, Oct 5" (with the year when it isn't this year).
export function formatDateLabel(dateStr, todayStr, locale = 'en-CA') {
  if (dateStr === todayStr) return 'Today';
  if (dateStr === addDays(todayStr, -1)) return 'Yesterday';
  const d = new Date(`${dateStr}T00:00:00Z`);
  const sameYear = dateStr.slice(0, 4) === todayStr.slice(0, 4);
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(d);
}

// "Mon, Oct 5" (no year); used as a secondary label next to "Today"/"Yesterday".
export function formatDateShort(dateStr, locale = 'en-CA') {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(
    new Date(`${dateStr}T00:00:00Z`),
  );
}

/** Wall clock in the configured home zone. Task times are local HH:mm, not UTC timestamps. */
export function timeInTz(instant, tz) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant);
}
export const isValidTime = (s) => typeof s === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s);
export const hasStarted = (date, time, today, now) => !date || date < today || (date === today && (!time || time <= now));
export const isOverdue = (date, time, today, now) => !!date && (date < today || (date === today && !!time && time < now));

/** Correct a history day in the home zone while retaining its recorded wall-clock time. */
export function changeTimestampDay(timestamp, day, tz) {
  if (!isValidDateString(day)) throw new Error('Choose a valid date.');
  const original = timestamp ? new Date(timestamp) : null;
  const clock = original ? timeInTz(original, tz) : '12:00';
  const target = Date.parse(`${day}T${clock}:00Z`);
  let candidate = target;
  for (let i = 0; i < 4; i++) {
    const current = new Date(candidate);
    const local = Date.parse(`${dateInTz(current, tz)}T${timeInTz(current, tz)}:00Z`);
    if (local === target) {
      current.setUTCSeconds(original?.getUTCSeconds() ?? 0, original?.getUTCMilliseconds() ?? 0);
      return current.toISOString();
    }
    candidate += target - local;
  }
  throw new Error('The recorded clock time does not exist on that day in your home timezone. Choose another date.');
}
