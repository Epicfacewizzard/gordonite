// The tasks the app shows, as one list that every screen reads.
//
// The server knows every task in every note (GET /api/tasks) but is only as new as the last time it was asked, and
// the notes this device has changed are ahead of it. So the list is the server's rows with one correction: for every
// note this device holds changes to (unsent edits, an open editor, or saved since the list was fetched) that note's
// rows are taken from this device's own copy of it. It replaces the note's whole set of rows, so a task removed or
// retyped here is gone or changed in the list straight away, and a task typed into a note that has not reached the
// server appears too. Nothing here is a second copy anyone edits: changes still go through the note (task-commands.js).
//
// When the server is asked again: when a screen showing tasks appears, when the page regains focus or comes back
// online, and after something that changes which notes or tags exist (a note deleted or restored, an import, a tag
// moved: the api announces these). Never for a keystroke or a save: the notes' own copies already cover those.
// One request runs at a time; if more are asked for meanwhile they become one more request afterwards.
import { api as realApi } from './api.js';
import { sync as realSync } from './sync.js';
import { taskKey, taskRecords, patchedTaskAttrs } from '../../shared/tasks.js';
import { parseTaskSchedule } from '../../shared/taskdates.js';
import { findRepeatPhrase } from '../../shared/repeat.js';

const STALE_MS = 2000; // a list this fresh is not fetched again only because another screen appeared
const COALESCE_MS = 250; // a burst of announcements is one request

// A row with a patch applied: a cleared date falls back to a date typed in the text, exactly as the server says.
export function applyPatchToRow(row, patch) {
  const next = { ...row, ...patch };
  const typed = parseTaskSchedule(row.text, row.date);
  for (const k of ['due', 'start', 'dueTime', 'startTime']) {
    if (k in patch) {
      next[k] = patch[k] ?? typed[k];
      next[`${k}From`] = patch[k] ? 'set' : typed[k] ? 'text' : null;
    }
  }
  return next;
}

/**
 * What a row looks like after a patch, as a patch to the row. Most patches are shown as they are; a patch that a
 * repeating task turns into something else (a tick moves its due date on and records it; skip; taking a completion
 * back; a new rule) is worked out with the same rules the note will apply (patchedTaskAttrs), so the row moves to its
 * next date at once instead of flashing as done.
 */
export function shownPatch(row, patch) {
  const ticksRepeat = patch.checked === true && !row.checked && row.repeat && !row.dismissedAt;
  if (!ticksRepeat && !('repeat' in patch) && !patch.skip && !patch.undoCompletion) return patch;
  const picked = (k) => (row[`${k}From`] === 'set' ? row[k] : null);
  const attrs = { checked: row.checked, dismissedAt: row.dismissedAt, due: picked('due'), start: picked('start'), dueTime: picked('dueTime'), startTime: picked('startTime'), hideUntil: row.hideUntil, repeat: row.repeatFrom === 'set' ? row.repeat : null, completions: row.completions ?? [] };
  const next = patchedTaskAttrs(attrs, patch, undefined, { text: row.text, noteDate: row.date });
  if (!next) return {};
  const typed = findRepeatPhrase(row.text)?.rule ?? null;
  return { checked: !!next.checked, due: next.due ?? null, start: next.start ?? null, hideUntil: next.hideUntil ?? null, completions: next.completions ?? [], repeat: next.repeat ?? typed, repeatFrom: next.repeat ? 'set' : typed ? 'text' : null };
}

// The page's own events. Tests hand in a fake with the same shape.
const browserEvents = {
  on(name, fn) {
    if (typeof window === 'undefined') return () => {};
    const target = name === 'visibilitychange' ? document : window;
    const handler = () => {
      if (name !== 'visibilitychange' || document.visibilityState === 'visible') fn();
    };
    target.addEventListener(name, handler);
    return () => target.removeEventListener(name, handler);
  },
};
const realTimers = { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t) };

export function createTaskData({ api = realApi, sync = realSync, events = browserEvents, timers = realTimers, now = () => Date.now() } = {}) {
  let rows = null; // the server's rows, null until the first answer
  let rowsAt = 0;
  let error = null;
  let running = null; // the request in progress
  let queued = false; // someone asked again while it ran
  let coalesce = null;
  const shown = new Map(); // key -> [patch | null, ...]: changes shown at once, until each command finishes
  const listeners = new Set();
  let cached = null; // { list, signature }

  // ---- what is listed ----

  // The device's own rows for every note it holds changes to, by note id.
  function localRows() {
    const revisionAt = new Map();
    for (const t of rows ?? []) if (!revisionAt.has(t.noteId)) revisionAt.set(t.noteId, t.revision ?? 0);
    const out = new Map();
    for (const s of sync.sessions.values()) {
      if (s.discarded) continue;
      // ahead of the server's list: unsent edits, an open editor, or saved since the list was fetched
      if (!(s.hasUnsaved || s.provider || s.revision > (revisionAt.get(s.id) ?? 0))) continue;
      const doc = s.provider ? s.provider() : s.currentDoc();
      out.set(s.id, taskRecords({ id: s.id, doc, date: s.date, tags: s.tags, revision: s.revision }));
    }
    return out;
  }

  function compute() {
    if (rows === null) return { list: null, signature: 'none' };
    // keep the server's order (newest note first, document order inside a note); a note the server does not know yet
    // goes in by date, ahead of the others of its day
    const groups = [];
    const at = new Map();
    for (const t of rows) {
      if (!at.has(t.noteId)) {
        at.set(t.noteId, groups.length);
        groups.push({ date: t.date, rows: [] });
      }
      groups[at.get(t.noteId)].rows.push(t);
    }
    for (const [noteId, mine] of localRows()) {
      if (at.has(noteId)) {
        groups[at.get(noteId)].rows = mine;
      } else if (mine.length) {
        const index = groups.findIndex((g) => g.date <= mine[0].date);
        groups.splice(index < 0 ? groups.length : index, 0, { date: mine[0].date, rows: mine });
      }
    }
    let list = groups.flatMap((g) => g.rows);
    if (shown.size) {
      list = list.flatMap((t) => {
        const patches = shown.get(taskKey(t));
        if (!patches) return [t];
        if (patches.includes(null)) return [];
        return [patches.reduce((row, patch) => applyPatchToRow(row, patch), t)];
      });
    }
    return { list, signature: JSON.stringify(list) };
  }

  // Recompute; true when what is listed is not what it was.
  function recompute() {
    const next = compute();
    if (cached && cached.signature === next.signature) return false;
    cached = next;
    return true;
  }
  const notify = () => {
    for (const fn of [...listeners]) fn();
  };
  const update = () => {
    if (recompute()) notify();
  };

  // ---- asking the server ----

  function refresh() {
    if (running) {
      queued = true;
      return running;
    }
    running = (async () => {
      try {
        const res = await api.tasks();
        rows = res.tasks;
        rowsAt = now();
        error = null;
      } catch (err) {
        error = err?.message ?? String(err); // the list on screen stays as it was
      }
      running = null;
      recompute();
      notify(); // the error state may have changed even when the list did not
      if (queued) {
        queued = false;
        await refresh();
      }
    })();
    return running;
  }

  const refreshSoon = () => {
    timers.clear(coalesce);
    coalesce = timers.set(() => refresh(), COALESCE_MS);
  };

  // ---- who is looking ----

  let watchers = 0;
  let stops = [];
  const stale = () => rows === null || now() - rowsAt > STALE_MS;

  return {
    /** The listed tasks, or null before the first answer. */
    tasks() {
      if (!cached) recompute();
      return cached.list;
    },
    /** Why the last request to the server failed, or null. */
    error: () => error,
    refresh,
    /** Show a change at once (patch = null: the task is gone) until the returned function is called. */
    optimistic(noteId, taskId, patch) {
      const key = `${noteId}:${taskId}`;
      shown.set(key, [...(shown.get(key) ?? []), patch]);
      update();
      return () => {
        const rest = (shown.get(key) ?? []).filter((p) => p !== patch);
        if (rest.length) shown.set(key, rest);
        else shown.delete(key);
        update();
      };
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Call while a screen shows the list; the returned function says it has gone. */
    watch() {
      if (watchers++ === 0) {
        stops = [
          sync.subscribe(update),
          events.on('focus', refresh),
          events.on('visibilitychange', refresh),
          events.on('online', refresh),
          events.on('hq-data-changed', refreshSoon),
        ];
      }
      if (stale()) refresh();
      else update();
      return () => {
        if (--watchers === 0) {
          stops.forEach((stop) => stop());
          stops = [];
          timers.clear(coalesce);
        }
      };
    },
  };
}

/** The page's task list. */
export const taskData = createTaskData();
