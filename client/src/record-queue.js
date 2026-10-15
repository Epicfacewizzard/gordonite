// A queue of changes to small records (skin entries, habits, check-ins) kept in local storage until the server has
// them, so a change made offline is sent later and never lost by closing the app.
//
// Each change has a `key` (what it changes, e.g. "habit:<id>"): a newer change to the same thing replaces an older one
// still waiting, since the server keeps only the last anyway. Changes are sent in the order they were made. A run stops
// at the first "no connection" (everything stays for the next run); a change the server refuses is kept with its
// reason and skipped until retried or discarded.
import { NetworkError } from './api.js';

const browserStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

/** send(change) performs one change against the server; storage defaults to the browser's (tests pass a fake). */
export function createRecordQueue({ storageKey, send, storage = browserStorage() }) {
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn());
  const read = () => {
    try {
      const q = JSON.parse(storage?.getItem(storageKey) ?? '[]');
      return Array.isArray(q) ? q : [];
    } catch {
      return [];
    }
  };
  const write = (q) => {
    try {
      storage.setItem(storageKey, JSON.stringify(q));
      return true;
    } catch {
      return false;
    }
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  let running = null;
  let again = false;
  function flush() {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      await null; // the run always finishes after `running` is set
      try {
        for (const change of read()) {
          if (change.error) continue;
          try {
            await send(change);
            write(read().filter((c) => !same(c, change)));
          } catch (err) {
            if (err instanceof NetworkError) break;
            write(read().map((c) => (same(c, change) ? { ...c, error: err.message } : c)));
          }
        }
      } finally {
        running = null;
        emit();
        if (again) {
          again = false;
          flush();
        }
      }
    })();
    return running;
  }

  return {
    get: read,
    /** Add a change ({ key, ... }) and start sending. Throws if this device cannot store it. */
    add(change) {
      if (!write([...read().filter((c) => c.key !== change.key), change])) throw new Error('This device could not store the change. Keep the page open until it is sent.');
      emit();
      flush();
    },
    flush,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    retry(key) {
      write(read().map((c) => (c.key === key ? { ...c, error: undefined } : c)));
      return flush();
    },
    discard(key) {
      write(read().filter((c) => c.key !== key));
      emit();
    },
  };
}
