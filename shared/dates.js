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
