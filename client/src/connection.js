// Can the server be reached right now? (see docs/OFFLINE.md)
//
// api.js reports every request: an answer of any kind means reachable, no answer means not. While it is not
// reachable the server's health check is asked every 15 seconds (only while the page is visible), because turning a
// VPN on fires no browser event. When it comes back, `hq-reconnected` is fired: the save queue retries at once and
// screens fetch their data again.

const POLL_MS = 15_000;

let reachable = null; // null until the first request finishes
let since = null; // when it stopped being reachable
let poll = null;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

async function probe() {
  try {
    const res = await fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (res.ok) connection.answered();
  } catch {
    /* still out of reach */
  }
}

function startPolling() {
  if (poll || typeof window === 'undefined') return;
  poll = setInterval(() => {
    if (document.visibilityState === 'visible') probe();
  }, POLL_MS);
}

export const connection = {
  /** true, false, or null when nothing has been asked yet. */
  get reachable() {
    return reachable;
  },
  get since() {
    return since;
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  answered() {
    if (reachable === true) return;
    const wasDown = reachable === false;
    reachable = true;
    since = null;
    clearInterval(poll);
    poll = null;
    emit();
    if (wasDown && typeof window !== 'undefined') window.dispatchEvent(new Event('hq-reconnected'));
  },
  unanswered() {
    if (reachable === false) return;
    reachable = false;
    since = new Date().toISOString();
    startPolling();
    emit();
  },
  /** Resolves when the server is known to be out of reach (at once if it already is). */
  whenUnreachable() {
    if (reachable === false) return Promise.resolve();
    return new Promise((resolve) => {
      const off = connection.subscribe(() => {
        if (reachable === false) {
          off();
          resolve();
        }
      });
    });
  },
  /** Ask now (the grey dot's tap). */
  check: probe,
};
