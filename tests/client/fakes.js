// Test doubles for the client's saving code. Nothing here touches a browser, a network or a real clock, so every
// timing situation (a reply that arrives late, a retry after back-off, a page reload) happens exactly when the
// test says it does.
import { ApiError, NetworkError } from '../../client/src/api.js';

/** Let queued promise callbacks run (the save queue is a chain of them). */
export const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve));
};

export const doc = (...texts) => ({
  type: 'doc',
  content: texts.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
});

export const apiError = (status, code, message = `Server said ${code}`, body = null) => new ApiError(status, code, message, body);
export const networkError = () => new NetworkError('Cannot reach the server');

/** A clock and timer set that only moves when advance() is called. */
export function fakeClock(start = 1_700_000_000_000) {
  let now = start;
  let nextHandle = 0;
  const timers = new Map();
  return {
    now: () => now,
    timers: {
      set(fn, ms) {
        const handle = ++nextHandle;
        timers.set(handle, { at: now + ms, fn });
        return handle;
      },
      clear(handle) {
        timers.delete(handle);
      },
    },
    /** How many timers are waiting. */
    waiting: () => timers.size,
    /** Run every timer that falls due within the next `ms`, in order, letting promises settle after each. */
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        const [handle, timer] = due;
        timers.delete(handle);
        now = Math.max(now, timer.at);
        timer.fn();
        await settle();
      }
      now = end;
      await settle();
    },
  };
}

/** An api whose saves stay open until the test answers them. */
export function deferredApi() {
  const calls = [];
  return {
    calls,
    saveNote(id, body) {
      return new Promise((resolve, reject) => calls.push({ id, body, resolve, reject }));
    },
    restoreNote: async () => ({ note: { revision: 40 } }),
    /** The most recent request that has not been answered. */
    last: () => calls.at(-1),
  };
}

/** The durable local copy (IndexedDB in the page): a Map by note id, with a switch to make writes fail. */
export function fakeStore() {
  const records = new Map();
  const store = {
    records,
    failWrites: false,
    puts: 0,
    async put(record) {
      if (store.failWrites) throw new Error('QuotaExceededError');
      store.puts++;
      records.set(record.noteId, structuredClone(record));
    },
    async deleteIfSeq(noteId, seq) {
      const held = records.get(noteId);
      if (held && held.seq <= seq) records.delete(noteId);
    },
    async getAll() {
      return [...records.values()].map((r) => structuredClone(r));
    },
  };
  return store;
}

/** The page lifecycle: tests call the handlers the way the browser would. */
export function fakeLifecycle() {
  const handlers = {};
  return {
    handlers,
    install(h) {
      Object.assign(handlers, h);
    },
  };
}

/** localStorage: a Map with switches for the ways it fails in real browsers. */
export function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  const storage = {
    data,
    failWrites: false,
    failReads: false,
    getItem(key) {
      if (storage.failReads) throw new Error('SecurityError');
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      if (storage.failWrites) throw new Error('QuotaExceededError');
      data.set(key, String(value));
    },
  };
  return storage;
}

let counter = 0;
/** Ids that are readable in a failing assertion. */
export const sequentialIds = (prefix = 'id') => {
  let n = 0;
  return () => `${prefix}-${++n}-${++counter}`;
};
