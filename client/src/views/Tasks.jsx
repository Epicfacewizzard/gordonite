import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.js';
import { sync } from '../sync.js';
import { useToday } from '../hooks.js';
import { addDays, formatDateShort } from '../../../shared/dates.js';
import { parseTaskDates } from '../../../shared/taskdates.js';
import { TaskSheet } from './TaskSheet.jsx';

const keyOf = (t) => `${t.noteId}:${t.taskId}`;
const byDate = (field) => (a, b) => (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : a.date < b.date ? 1 : -1);

// Which part of the list a task belongs in. A task ticked on this page stays where it was.
function bucketOf(t, today, touched) {
  if (t.checked && !touched.has(keyOf(t))) return 'done';
  if (t.hidden) return 'hidden';
  if (t.start && t.start > today) return 'later';
  if (t.due && t.due < today) return 'overdue';
  if (t.due === today) return 'today';
  if (t.due) return 'upcoming';
  return 'anytime';
}

// `compact` is the version on the Today screen: only what needs attention now (overdue, today, the next week,
// a few undated ones), no folded sections, and a link on to the full list.
const COMPACT_UNDATED = 5;
const COMPACT_DAYS = 7;

export function TasksView({ config, compact = false }) {
  const today = useToday(config.tz);
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState({ done: false, hidden: false, later: false });
  const [sheet, setSheet] = useState(null); // the task being edited in the dates sheet
  // Tasks ticked on this page stay listed (struck through) so a slip can be undone.
  const [touched, setTouched] = useState(() => new Set());

  const load = () =>
    api
      .tasks()
      .then((r) => {
        setTasks(r.tasks);
        setError(null);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const patchLocal = (task, patch) =>
    setTasks((list) =>
      list.map((t) => {
        if (keyOf(t) !== keyOf(task)) return t;
        const next = { ...t, ...patch };
        // A cleared date falls back to a date typed in the text, exactly as the server will say.
        const typed = parseTaskDates(t.text, t.date);
        for (const k of ['due', 'start']) {
          if (k in patch) {
            next[k] = patch[k] ?? typed[k];
            next[`${k}From`] = patch[k] ? 'set' : typed[k] ? 'text' : null;
          }
        }
        return next;
      }),
    );

  // Optimistic: show the change at once, then write it through the note's save session (phone
  // copy first, then the server, with the usual conflict protection). Put it back if that fails.
  const apply = async (task, patch) => {
    const before = tasks.find((t) => keyOf(t) === keyOf(task));
    patchLocal(task, patch);
    try {
      await sync.track(
        (async () => {
          await sync.ready;
          const { note } = await api.getNote(task.noteId);
          const session = sync.adopt(note);
          if (!session.editTask(task.taskId, patch)) throw new Error('That task is no longer in its note.');
        })(),
      );
      setError(null);
    } catch (e) {
      setTasks((list) => list.map((t) => (keyOf(t) === keyOf(task) ? before : t)));
      await load(); // show what the server really has, then say why the change did not stick
      setError(e.message);
    }
  };

  const toggle = (task) => {
    setTouched((s) => new Set(s).add(keyOf(task)));
    apply(task, { checked: !task.checked });
  };

  const buckets = { overdue: [], today: [], upcoming: [], anytime: [], later: [], hidden: [], done: [] };
  for (const t of tasks ?? []) buckets[bucketOf(t, today, touched)].push(t);
  buckets.overdue.sort(byDate('due'));
  buckets.today.sort(byDate('due'));
  buckets.upcoming.sort(byDate('due'));
  buckets.later.sort(byDate('start'));
  const streams = new Map();
  for (const t of buckets.anytime) {
    const stream = t.tags[0] ?? '(untagged)';
    if (!streams.has(stream)) streams.set(stream, []);
    streams.get(stream).push(t);
  }

  const upcomingShown = compact ? buckets.upcoming.filter((t) => t.due <= addDays(today, COMPACT_DAYS)) : buckets.upcoming;
  const undatedShown = compact ? buckets.anytime.slice(0, COMPACT_UNDATED) : buckets.anytime;
  const undatedMore = compact ? buckets.anytime.length - undatedShown.length : 0;

  // Tasks ticked on this page stay listed but no longer count as open.
  const openCount = [...buckets.overdue, ...buckets.today, ...buckets.upcoming, ...buckets.anytime].filter((t) => !t.checked).length;
  const row = (t) => {
    const overdue = t.due && !t.checked && t.due < today;
    return (
      <li key={keyOf(t)} class={`task-row${t.checked ? ' done' : ''}`} data-testid="task-row">
        <label class="task-check">
          <input type="checkbox" checked={t.checked} onChange={() => toggle(t)} aria-label={t.checked ? 'Completed task' : 'Task'} />
        </label>
        <button type="button" class="task-body" onClick={() => setSheet(t)} aria-label={`Dates and options for: ${t.text}`} data-testid="task-open">
          <span class="task-text">{t.text}</span>
          <span class="task-meta">
            {t.due && <span class={`task-chip${overdue ? ' overdue' : ''}`} data-testid="chip-due">due {formatDateShort(t.due)}</span>}
            {t.start && t.start > today && <span class="task-chip" data-testid="chip-start">starts {formatDateShort(t.start)}</span>}
            {t.hidden && <span class="task-chip" data-testid="chip-hidden">hidden</span>}
            <span>
              {t.tags[0] ?? ''} · {formatDateShort(t.date)}
            </span>
          </span>
        </button>
      </li>
    );
  };

  const section = (id, title, list) =>
    list.length > 0 && (
      <section class="task-group" data-testid={`section-${id}`}>
        <h2 class={`section${id === 'overdue' ? ' overdue' : ''}`}>
          {title} <span class="count">{list.length}</span>
        </h2>
        <ul class="task-list">{list.map(row)}</ul>
      </section>
    );

  const folded = (id, title, list) =>
    list.length > 0 && (
      <section class="task-group" data-testid={`section-${id}`}>
        <h2 class="section">
          <button type="button" class="link-plain" onClick={() => setOpen((o) => ({ ...o, [id]: !o[id] }))} aria-expanded={open[id]} data-testid={`toggle-${id}`}>
            {open[id] ? '▾' : '▸'} {title} <span class="count">{list.length}</span>
          </button>
        </h2>
        {open[id] && <ul class="task-list">{list.map(row)}</ul>}
      </section>
    );

  return (
    <div class="tasks">
      {error && (
        <div class="banner error" role="alert">
          <span>{error}</span>
          <button type="button" class="btn" onClick={load}>
            Retry
          </button>
        </div>
      )}
      {tasks && (
        <p class="muted" data-testid="task-count">
          {openCount} open {openCount === 1 ? 'task' : 'tasks'}
          {compact && (
            <>
              {' · '}
              <a href="#/tasks" data-testid="all-tasks">
                All tasks
              </a>
            </>
          )}
        </p>
      )}
      {tasks && openCount === 0 && !error && (
        <p class="muted center">
          {compact ? 'Nothing is due. Open All tasks to see everything.' : 'Nothing to do. Turn a line into a task with the toolbar’s task button while writing a note.'}
        </p>
      )}
      {section('overdue', 'Overdue', buckets.overdue)}
      {section('today', 'Due today', buckets.today)}
      {section('upcoming', compact ? 'Coming up' : 'Upcoming', upcomingShown)}
      {compact && section('anytime', 'No date', undatedShown)}
      {compact && undatedMore > 0 && (
        <p class="muted small">
          <a href="#/tasks">{undatedMore} more with no date</a>
        </p>
      )}
      {!compact && streams.size > 0 && (
        <section class="task-group" data-testid="section-anytime">
          {[...streams.keys()].sort().map((stream) => (
            <div key={stream} data-testid="task-group" data-stream={stream}>
              <h2 class="section">
                <a href={`#/t/${encodeURIComponent(stream).replaceAll('%2F', '/')}`}>{stream}</a>
              </h2>
              <ul class="task-list">{streams.get(stream).map(row)}</ul>
            </div>
          ))}
        </section>
      )}
      {!compact && folded('later', 'Starts later', buckets.later)}
      {!compact && folded('hidden', 'Hidden', buckets.hidden)}
      {!compact && folded('done', 'Done', buckets.done)}
      {sheet && (
        <TaskSheet
          text={sheet.text}
          noteDate={sheet.date}
          noteId={sheet.noteId}
          today={today}
          picked={{ due: sheet.dueFrom === 'set' ? sheet.due : null, start: sheet.startFrom === 'set' ? sheet.start : null, hidden: sheet.hidden }}
          onChange={(patch) => apply(sheet, patch)}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}
