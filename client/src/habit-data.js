// Habits on this device (see docs/HABITS.md): the server's habits and check-ins, corrected by the changes this device
// has not sent yet (record-queue.js), so a tick or an edit shows at once and works offline. What is due when, streaks
// and courses are in shared/habits.js.
import { api, NetworkError } from './api.js';
import { createRecordQueue } from './record-queue.js';
import { addDays } from '../../shared/dates.js';
import { uuid } from '../../shared/ids.js';

const HISTORY_DAYS = 120;

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
    else if (c.done) await api.checkHabit(c.habitId, c.date);
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

/** { habits, done(habitId, date), error, waiting } with this device's unsent changes applied. */
export function habitState() {
  const habits = new Map(server.habits.map((h) => [h.id, h]));
  const done = new Set(server.checks.map((c) => `${c.habitId}|${c.date}`));
  const waiting = habitQueue.get();
  for (const c of [...landed, ...waiting]) {
    if (c.kind === 'habit') habits.set(c.id, { ...(habits.get(c.id) ?? { courses: [] }), ...c.body, id: c.id });
    else if (c.kind === 'delete') habits.delete(c.id);
    else if (c.done) done.add(`${c.habitId}|${c.date}`);
    else done.delete(`${c.habitId}|${c.date}`);
  }
  const list = [...habits.values()].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.created).localeCompare(String(b.created)));
  return { habits: list, done: (id, date) => done.has(`${id}|${date}`), error, waiting: waiting.length, refused: waiting.filter((c) => c.error) };
}

export function subscribeHabits(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Tick or untick a habit on a day. */
export function toggleHabit(habitId, date) {
  const now = habitState().done(habitId, date);
  habitQueue.add({ key: `check:${habitId}:${date}`, kind: 'check', habitId, date, done: !now });
}

/** Save a habit (new when it has no id). Its courses are the server's to extend, so they are not sent. */
export function saveHabit({ id = null, name, detail = '', days, created, trigger = null, sort = 0 }) {
  const habitId = id ?? uuid();
  habitQueue.add({ key: `habit:${habitId}`, kind: 'habit', id: habitId, body: { name, detail, days, created, trigger, sort } });
  return habitId;
}

export function deleteHabit(id) {
  habitQueue.add({ key: `habit:${id}`, kind: 'delete', id });
}
