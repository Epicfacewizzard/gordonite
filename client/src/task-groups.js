// How the combined task list is divided up: which section a task belongs in, how each section is ordered, how much of
// it the dashboard's box shows, and which finished tasks fall inside a date range. Pure functions of the rows (see
// task-data.js) and "now", so the rules are tested without drawing anything (tests/client/task-groups.test.js).
import { addDays, dateInTz, hasStarted, isOverdue } from '../../shared/dates.js';
import { priorityRank, taskKey } from '../../shared/tasks.js';
import { byWaitingLongest, isWaiting } from '../../shared/projects.js';

export const COMPACT_UNDATED = 5; // the dashboard's box shows this many with no date...
export const COMPACT_DAYS = 7; // ...and what is due within this many days

export const isHiddenNow = (t, today) => !!t.hidden || !!(t.hideUntil && t.hideUntil > today);

const byDate = (field) => (a, b) =>
  `${a[field] || ''} ${a[`${field}Time`] || '23:59'}`.localeCompare(`${b[field] || ''} ${b[`${field}Time`] || '23:59'}`) || b.date.localeCompare(a.date);
// Most pressing first (urgent & important, urgent, important, none); the other order breaks ties.
const byPriorityThen = (tiebreak) => (a, b) => priorityRank(a.priority) - priorityRank(b.priority) || tiebreak(a, b);

/**
 * Which part of the list a task belongs in. `touched` is the set of task keys ticked on this screen: such a task stays
 * where it was, struck through, so a slip can be undone. `pinned` maps a task key to the section it must stay in: the
 * task whose words are being edited, which a date typed into them would otherwise move away under the cursor.
 */
export function bucketOf(t, { today, now, touched = new Set(), pinned = null }) {
  const stay = pinned?.get(taskKey(t));
  if (stay) return stay;
  if (t.dismissedAt) return 'dismissed';
  if (t.checked && !touched.has(taskKey(t))) return 'done';
  if (isHiddenNow(t, today)) return 'hidden';
  if (!hasStarted(t.start, t.startTime, today, now)) return 'later';
  if (isOverdue(t.due, t.dueTime, today, now)) return 'overdue';
  if (t.due === today) return 'today';
  // Waiting on someone's reply (docs/PROJECTS.md): its own section, unless it is overdue or due today.
  if (isWaiting(t)) return 'waiting';
  if (t.due) return 'upcoming';
  return 'anytime';
}

/** The rows divided into sections, each in its order: { overdue, today, waiting, upcoming, anytime, later, hidden, done, dismissed }. */
export function groupTasks(tasks, ctx) {
  const buckets = { overdue: [], today: [], waiting: [], upcoming: [], anytime: [], later: [], hidden: [], done: [], dismissed: [] };
  for (const t of tasks ?? []) buckets[bucketOf(t, ctx)].push(t);
  buckets.overdue.sort(byPriorityThen(byDate('due')));
  buckets.today.sort(byPriorityThen(byDate('due')));
  buckets.upcoming.sort(byPriorityThen(byDate('due')));
  buckets.later.sort(byDate('start'));
  buckets.waiting.sort(byWaitingLongest);
  buckets.anytime.sort(byPriorityThen(() => 0)); // sort is stable: the rest keep their order
  return buckets;
}

/** The tasks with no date, by the first tag of their note (insertion order is the list's order). */
export function streamsOf(anytime) {
  const streams = new Map();
  for (const t of anytime) {
    const stream = t.tags[0] ?? '(untagged)';
    if (!streams.has(stream)) streams.set(stream, []);
    streams.get(stream).push(t);
  }
  return streams;
}

/**
 * What a screen shows of the open sections. `level` is how much: 'all' (the Tasks page, and the dashboard's widest
 * setting), 'week' (overdue, today and the next week), 'today' (overdue and today) or 'overdue'. `compact` is the
 * dashboard's box: it shows only the next week of upcoming tasks and a few with no date.
 */
export function visibleSections(buckets, { level, compact, today }) {
  const showToday = level !== 'overdue';
  const showUpcoming = level === 'week' || level === 'all';
  const showUndated = level === 'all';
  const upcomingShown = compact ? buckets.upcoming.filter((t) => t.due <= addDays(today, COMPACT_DAYS)) : buckets.upcoming;
  const undatedShown = compact ? buckets.anytime.slice(0, COMPACT_UNDATED) : buckets.anytime;
  const undatedMore = compact ? buckets.anytime.length - undatedShown.length : 0;
  // Tasks ticked on this screen stay listed but no longer count as open.
  const openCount = [...buckets.overdue, ...buckets.today, ...buckets.waiting, ...buckets.upcoming, ...buckets.anytime].filter((t) => !t.checked).length;
  const listed = buckets.overdue.length + (showToday ? buckets.today.length : 0) + (showUpcoming ? upcomingShown.length : 0) + (showUndated ? undatedShown.length : 0);
  return { showToday, showUpcoming, showUndated, upcomingShown, undatedShown, undatedMore, openCount, listed };
}

/**
 * Done and Dismissed: the tasks finished or dismissed inside the date range, and how many fall outside it. A task with
 * no recorded day (from before dates were kept) is always listed. `range` is { from, to } as YYYY-MM-DD, '' = no limit.
 */
export function withinRange(all, range, tz) {
  const dayOf = (t) => {
    const stamp = t.dismissedAt || t.completedAt;
    return stamp ? dateInTz(new Date(stamp), tz) : null;
  };
  const list = all.filter((t) => {
    const day = dayOf(t);
    return !day || ((!range.from || day >= range.from) && (!range.to || day <= range.to));
  });
  return { list, outside: all.length - list.length };
}
