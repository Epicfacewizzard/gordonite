// Mood taps are queued on this device until the server confirms them, so a dropped connection never loses one.
// Each entry has its own id, so sending it twice is harmless (the server keeps the first).
import { api, ApiError } from './api.js';
import { uuid } from '../../shared/ids.js';

const KEY = 'hq-mood-pending';

function read() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(value) ? value : [];
  } catch {
    return []; // storage unavailable or damaged: the queue then only lives for this visit
  }
}
let queue = read();
const persist = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(queue));
  } catch {
    /* kept in memory */
  }
};

/** Entries not yet confirmed by the server: [{ id, score, note, at }] */
export const pendingMoods = () => [...queue];

/** Remember a tap right away; call flushMoods() to send it. */
export function logMood(score, note) {
  const entry = { id: uuid(), score, note: note?.trim() || null, at: new Date().toISOString() };
  queue.push(entry);
  persist();
  return entry;
}

/** Forget an entry that was never sent. */
export function dropPendingMood(id) {
  queue = queue.filter((m) => m.id !== id);
  persist();
}

let flushing = null;
/** Send what is queued, oldest first. Stops at the first connection problem and keeps the rest. Resolves to the number sent. */
export function flushMoods() {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    for (const m of [...queue]) {
      try {
        await api.saveMood(m.id, { score: m.score, note: m.note, at: m.at });
      } catch (err) {
        if (!(err instanceof ApiError)) break; // network trouble: try again later
        // the server refused this entry (it will never be accepted): drop it so it cannot block the others
      }
      dropPendingMood(m.id);
      sent++;
    }
    return sent;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}
