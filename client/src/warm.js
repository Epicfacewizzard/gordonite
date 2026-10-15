// Fill this phone's copy while the server is in reach (see docs/OFFLINE.md), so the app has something to show the
// next time it is opened without a connection: settings, tags, the task list, today's stream, the first page of the
// Notes list, and every note that holds an open task or is on that first page (so a task can be ticked offline).
//
// Runs when the app opens, when it comes back to the screen and when the server is back in reach, at most once every
// ten minutes, one request at a time. Every answer is kept by api.js itself; nothing here changes what is on screen.
import { api } from './api.js';
import { connection } from './connection.js';
import { offlineCopy } from './offline-copy.js';

const EVERY_MS = 10 * 60_000;
const MAX_NOTES = 80;
const KEEP_DAYS = 30;

let last = 0;
let running = false;

export async function warmCopy({ force = false } = {}) {
  if (running || connection.reachable === false) return;
  if (!force && Date.now() - last < EVERY_MS) return;
  running = true;
  last = Date.now();
  try {
    const config = await api.config();
    if (config.fromPhoneCopy) return; // the server did not answer in time: try again later
    await api.tags();
    const { tasks = [] } = await api.tasks();
    const ids = new Set(tasks.filter((t) => !t.checked && !t.dismissedAt).map((t) => t.noteId));
    if (config.dailyTag) {
      const stream = await api.stream(config.dailyTag);
      for (const n of stream.notes ?? []) ids.add(n.id);
    }
    const list = await api.notes({ limit: 30, offset: 0 }); // the Notes page's first page, as it asks for it
    for (const n of list.notes ?? []) ids.add(n.id);
    for (const id of [...ids].filter(Boolean).slice(0, MAX_NOTES)) {
      if (connection.reachable === false) break;
      await api.getNote(id).catch(() => {});
    }
    await offlineCopy.prune(KEEP_DAYS);
  } catch {
    last = 0; // try again next time
  } finally {
    running = false;
  }
}
