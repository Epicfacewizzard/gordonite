// Mood taps are queued on this device until the server confirms them, so a dropped connection never loses one.
// Each entry has its own id, so sending it twice is harmless (the server keeps the first).
//
// An entry leaves the queue in exactly two ways: the server acknowledged it, or the person discarded it. A failed
// request never removes anything. What happens next depends on the failure (see failure.js):
//   - no connection, a server problem, or a login that ran out: the entry stays and the whole run stops, so a later
//     run sends everything in order;
//   - the server says this entry's data is wrong (a bad score, a time in the future): the entry is marked
//     "rejected" and kept where the person can see it, and the entries after it are still sent.
// A rejected entry is not sent again until the person chooses Try again.
import { api as realApi } from './api.js';
import { classifyFailure } from './failure.js';
import { uuid } from '../../shared/ids.js';

const KEY = 'hq-mood-pending';

const browserStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // some browsers throw on access when site data is blocked
  }
};
const isEntry = (e) => !!e && typeof e === 'object' && typeof e.id === 'string' && Number.isInteger(e.score);

/**
 * A queue over one storage area. The page uses the default instance below; tests build their own with a fake
 * api and storage (two queues over the same storage behave like two browser tabs).
 */
export function createMoodQueue({ api = realApi, storage = browserStorage(), newId = uuid, now = () => new Date() } = {}) {
  let memory = []; // this visit's copy, used when storage cannot be read or the last write to it failed
  let degraded = false; // the last write failed, so some entries may exist only in `memory`
  let problem = null; // why the last write failed (null = entries are on this device's disk)
  const listeners = new Set();

  const readStored = () => {
    if (!storage) return null;
    try {
      const raw = storage.getItem(KEY);
      if (raw === null || raw === undefined) return [];
      const value = JSON.parse(raw);
      return Array.isArray(value) ? value.filter(isEntry) : [];
    } catch {
      return null; // unreadable or damaged: fall back to this visit's copy
    }
  };

  // Another tab writes to the same storage, so the stored list is the truth whenever it can be read; the in-memory
  // copy only fills in after a failed write (those entries exist nowhere else).
  const view = () => {
    const stored = readStored();
    if (stored === null) return memory;
    if (!degraded) return stored;
    const have = new Set(stored.map((e) => e.id));
    return [...stored, ...memory.filter((e) => !have.has(e.id))];
  };

  const write = (entries) => {
    if (!storage) {
      problem = 'Local storage is not available in this browser';
      return false;
    }
    try {
      storage.setItem(KEY, JSON.stringify(entries));
      problem = null;
      return true;
    } catch (err) {
      problem = err?.message || 'Could not write to local storage';
      return false;
    }
  };

  const notify = () => {
    for (const fn of [...listeners]) fn();
  };

  const mutate = (fn) => {
    const next = fn(view());
    memory = next;
    degraded = !write(next);
    notify();
    return next;
  };

  /** Entries not yet confirmed by the server: [{ id, score, note, at, rejected? }] (rejected: { code, status, message, at }) */
  const pending = () => view().map((e) => ({ ...e }));

  /** Remember a tap right away; call flush() to send it. */
  function log(score, note) {
    const entry = { id: newId(), score, note: note?.trim() || null, at: now().toISOString() };
    mutate((q) => [...q, entry]);
    return entry;
  }

  /** Forget an entry that was never confirmed (the person chose to discard it). */
  function drop(id) {
    mutate((q) => q.filter((m) => m.id !== id));
  }

  /** Let the next flush send a rejected entry again. */
  function retry(id) {
    mutate((q) =>
      q.map((m) => {
        if (m.id !== id || !m.rejected) return m;
        const { rejected, ...rest } = m;
        return rest;
      }),
    );
  }

  async function run() {
    let sent = 0;
    let failure = null;
    const tried = new Set();
    for (;;) {
      // entries logged while the run was in progress are picked up by the next pass
      const batch = view().filter((m) => !m.rejected && !tried.has(m.id));
      if (batch.length === 0 || failure) break;
      for (const m of batch) {
        tried.add(m.id);
        try {
          await api.saveMood(m.id, { score: m.score, note: m.note, at: m.at });
        } catch (err) {
          const f = classifyFailure(err);
          if (f.kind === 'rejected') {
            // never going to be accepted as it is: keep it visible and do not let it block the others
            mutate((q) => q.map((x) => (x.id === m.id ? { ...x, rejected: { code: f.code, status: f.status, message: f.message, at: now().toISOString() } } : x)));
            continue;
          }
          failure = f; // offline, server trouble or login needed: keep this and everything after it
          break;
        }
        mutate((q) => q.filter((x) => x.id !== m.id)); // acknowledged: only now is it forgotten
        sent++;
      }
    }
    const rest = view();
    return {
      sent, // entries the server acknowledged in this run
      pending: rest.filter((m) => !m.rejected).length, // still waiting to be sent
      rejected: rest.filter((m) => m.rejected).length, // refused by the server, kept for the person to decide
      paused: failure?.kind === 'login', // waiting for a login
      failure: failure ? { kind: failure.kind, message: failure.message } : null, // why the run stopped early
    };
  }

  let flushing = null;
  /** Send what is queued, oldest first. Resolves to { sent, pending, rejected, paused, failure }. */
  function flush() {
    if (flushing) return flushing;
    flushing = run().finally(() => {
      flushing = null;
    });
    return flushing;
  }

  return {
    log,
    drop,
    retry,
    flush,
    pending,
    /** Why entries are not being kept on this device's disk, or null. While set, closing the page loses them. */
    storageProblem: () => problem,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

const queue = createMoodQueue();

export const pendingMoods = () => queue.pending();
export const logMood = (score, note) => queue.log(score, note);
export const dropPendingMood = (id) => queue.drop(id);
export const retryMood = (id) => queue.retry(id);
export const flushMoods = () => queue.flush();
export const moodStorageProblem = () => queue.storageProblem();
export const subscribeMoods = (fn) => queue.subscribe(fn);
