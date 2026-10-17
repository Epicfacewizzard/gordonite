// Habits on this device (see docs/HABITS.md): the server's habits and check-ins, corrected by the changes this device
// has not sent yet (record-queue.js), so a tick or an edit shows at once and works offline. What is due when, streaks
// and courses are in shared/habits.js.
import { api, NetworkError } from './api.js';
import { createRecordQueue } from './record-queue.js';
import { addDays } from '../../shared/dates.js';
import { uuid } from '../../shared/ids.js';

const HISTORY_DAYS = 399; // the server lists at most 400 days at a time; enough for a habit's year of history

/** The oldest day the app has loaded, so the oldest day it lets you log or change. */
export const earliestDay = (today) => addDays(today, -HISTORY_DAYS);

let sent = false; // something reached the server since it was last asked
// Changes the server has taken but has not listed back yet. They stay on screen until a list asked for after they were
// sent comes from the server itself: a slow list is answered from the phone copy, which was kept before them.
let landed = [];
let sentCount = 0;
export const habitQueue = createRecordQueue({
  storageKey: 'hq-habit-pending',
  async send(c) {
    if (c.kind === 'habit') await api.saveHabit(c.id, c.body);
    else if (c.kind === 'delete') await api.deleteHabit(c.id);
    else if (c.done) await api.checkHabit(c.habitId, c.date, c.value === undefined ? {} : { value: c.value, skip: !!c.skip });
    else await api.uncheckHabit(c.habitId, c.date);
    landed = [...landed.filter((l) => l.key !== c.key), { ...c, sentAs: ++sentCount }];
    sent = true;
  },
});

let server = { habits: [], checks: [] }; // what the server (or the phone copy) last said
let loadedFor = null;
let error = null;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());
// A sent change leaves the queue: ask the server again so the screen keeps showing it (now as the server's).
habitQueue.subscribe(() => {
  emit();
  if (sent && loadedFor) {
    sent = false;
    loadHabits(loadedFor);
  }
});

/** Ask the server again (the phone copy when out of reach). */
export async function loadHabits(today) {
  loadedFor = today;
  const asked = sentCount;
  try {
    server = await api.habits(addDays(today, -HISTORY_DAYS), today);
    if (!server.fromPhoneCopy) landed = landed.filter((l) => l.sentAs > asked);
    error = null;
  } catch (err) {
    error = err instanceof NetworkError ? null : err.message; // offline with no copy: show what waits on the phone
  }
  emit();
}

if (typeof window !== 'undefined') {
  const again = () => loadedFor && loadHabits(loadedFor);
  window.addEventListener('hq-habits-changed', again);
  window.addEventListener('hq-reconnected', () => {
    habitQueue.flush().then(again);
  });
}

/**
 * { habits, entry(habitId, date), done(habitId, date), error, waiting } with this device's unsent changes applied.
 * entry() is { value, skip } or null; done() is whether the day has a check-in that is not a skip.
 */
export function habitState() {
  const habits = new Map(server.habits.map((h) => [h.id, h]));
  const entries = new Map(server.checks.map((c) => [`${c.habitId}|${c.date}`, { value: c.value ?? null, skip: !!c.skip }]));
  const waiting = habitQueue.get();
  for (const c of [...landed, ...waiting]) {
    if (c.kind === 'habit') habits.set(c.id, { ...(habits.get(c.id) ?? { courses: [] }), ...c.body, id: c.id });
    else if (c.kind === 'delete') habits.delete(c.id);
    else if (!c.done) entries.delete(`${c.habitId}|${c.date}`);
    else if (c.value !== undefined) entries.set(`${c.habitId}|${c.date}`, { value: c.value, skip: !!c.skip });
    else if (!entries.has(`${c.habitId}|${c.date}`)) entries.set(`${c.habitId}|${c.date}`, { value: null, skip: false });
  }
  const list = [...habits.values()].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.created).localeCompare(String(b.created)));
  const entry = (id, date) => entries.get(`${id}|${date}`) ?? null;
  return {
    habits: list.filter((h) => !h.archived),
    archived: list.filter((h) => h.archived),
    entry,
    done: (id, date) => !!entry(id, date) && !entry(id, date).skip,
    error,
    waiting: waiting.length,
    refused: waiting.filter((c) => c.error),
  };
}

export function subscribeHabits(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// A day logged before the habit's start was done after all: the habit started then, so its start moves back to it.
function startBy(habitId, date) {
  const { habits, archived } = habitState();
  const habit = [...habits, ...archived].find((h) => h.id === habitId);
  if (habit && date < habit.created) saveHabit({ ...habit, created: date });
}

/** Tick a day, or clear it if it has any check-in (a tick, a number, a skip). */
export function toggleHabit(habitId, date) {
  const had = !!habitState().entry(habitId, date);
  if (!had) startBy(habitId, date);
  habitQueue.add({ key: `check:${habitId}:${date}`, kind: 'check', habitId, date, done: !had, ...(had ? {} : { value: null, skip: false }) });
}

/** Set a day's check-in: a number (`value`), a plain tick (value null), or a skipped day (skip true). */
export function setHabitEntry(habitId, date, { value = null, skip = false }) {
  startBy(habitId, date);
  habitQueue.add({ key: `check:${habitId}:${date}`, kind: 'check', habitId, date, done: true, value, skip });
}

export function clearHabitEntry(habitId, date) {
  habitQueue.add({ key: `check:${habitId}:${date}`, kind: 'check', habitId, date, done: false });
}

const OPTIONS = ['freq', 'kind', 'unit', 'target', 'targetType', 'color', 'question', 'reminder', 'archived'];

/** Save a habit (new when it has no id). Its courses are the server's to extend, so they are not sent. */
export function saveHabit(habit) {
  const habitId = habit.id ?? uuid();
  const body = { name: habit.name, detail: habit.detail ?? '', days: habit.days, created: habit.created, trigger: habit.trigger ?? null, sort: habit.sort ?? 0 };
  for (const k of OPTIONS) if (habit[k] !== undefined) body[k] = habit[k];
  habitQueue.add({ key: `habit:${habitId}`, kind: 'habit', id: habitId, body });
  return habitId;
}

/** Move a habit one place up (-1) or down (+1) among `list`; the order is saved as each habit's `sort`. */
export function moveHabit(list, id, by) {
  const order = list.map((h) => h.id);
  const at = order.indexOf(id);
  const to = at + by;
  if (at < 0 || to < 0 || to >= order.length) return;
  [order[at], order[to]] = [order[to], order[at]];
  order.forEach((hid, i) => {
    const h = list.find((x) => x.id === hid);
    if (h.sort !== (i + 1) * 10) saveHabit({ ...h, sort: (i + 1) * 10 });
  });
}

export function deleteHabit(id) {
  habitQueue.add({ key: `habit:${id}`, kind: 'delete', id });
}
