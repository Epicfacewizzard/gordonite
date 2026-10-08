import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.js';
import { sync } from '../sync.js';
import { useToday, useNowTime } from '../hooks.js';
import { addDays, formatDateShort, formatDateLabel, hasStarted, isOverdue } from '../../../shared/dates.js';
import { findDatePhrases, parseTaskSchedule } from '../../../shared/taskdates.js';
import { PRIORITY_LABEL, dueBar, priorityRank, extractTasks } from '../../../shared/tasks.js';
import { TaskDetails } from './TaskSheet.jsx';
import { TaskTextEditor } from './TaskTextEditor.jsx';
import { DateMenu, Glyph, HideMenu, PriorityMenu, PriorityStar } from './TaskMenus.jsx';

const keyOf = (t) => `${t.noteId}:${t.taskId}`;
const byDate = (field) => (a, b) => `${a[field] || ''} ${a[`${field}Time`] || '23:59'}`.localeCompare(`${b[field] || ''} ${b[`${field}Time`] || '23:59'}`) || b.date.localeCompare(a.date);
// Most pressing first (urgent & important, urgent, important, none); the other order breaks ties.
const byPriorityThen = (tiebreak) => (a, b) => priorityRank(a.priority) - priorityRank(b.priority) || tiebreak(a, b);
const isHiddenNow = (t, today) => t.hidden || (t.hideUntil && t.hideUntil > today);

// A date typed in the text ("due fri") shown dimmer than the rest, so you can see it was understood.
function TaskText({ text, date }) {
  const parts = [];
  let at = 0;
  for (const p of findDatePhrases(text, date)) {
    if (p.index < at) continue;
    parts.push(text.slice(at, p.index), <span key={p.index} class="typed-date">{text.slice(p.index, p.index + p.length)}</span>);
    at = p.index + p.length;
  }
  parts.push(text.slice(at));
  return parts;
}

// Which part of the list a task belongs in. A task ticked on this page stays where it was.
function bucketOf(t, today, touched, now) {
  if (t.dismissedAt) return 'dismissed';
  if (t.checked && !touched.has(keyOf(t))) return 'done';
  if (isHiddenNow(t, today)) return 'hidden';
  if (!hasStarted(t.start, t.startTime, today, now)) return 'later';
  if (isOverdue(t.due, t.dueTime, today, now)) return 'overdue';
  if (t.due === today) return 'today';
  if (t.due) return 'upcoming';
  return 'anytime';
}

// `overdueOnly` (with `compact`) is the dashboard's right-hand column: just what is overdue.
// `compact` is the version on the Today screen: only what needs attention now (overdue, today, the next week,
// a few undated ones), no folded sections, and a link on to the full list.
const COMPACT_UNDATED = 5;
const COMPACT_DAYS = 7;

// `scope` (with `compact`) is how much the dashboard's list shows: 'overdue', 'today' (overdue and due today), 'week'
// (adds the next seven days) or 'all' (adds a few with no date). The full Tasks page always shows everything.
export function TasksView({ config, compact = false, overdueOnly = false, scope = null }) {
  const level = !compact ? 'all' : overdueOnly ? 'overdue' : scope ?? 'all';
  const showToday = level !== 'overdue';
  const showUpcoming = level === 'week' || level === 'all';
  const showUndated = level === 'all';
  const today = useToday(config.tz);
  const now = useNowTime(config.tz);
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState({ done: false, hidden: false, later: false, dismissed: false });
  const [expanded, setExpanded] = useState(() => new Set()); // tasks opened out to show their details
  const toggleExpanded = (t) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (!next.delete(keyOf(t))) next.add(keyOf(t));
      return next;
    });
  const [menu, setMenu] = useState(null); // { key, kind: 'date' | 'hide' | 'priority' }: a round button's menu
  const [editing, setEditing] = useState(null);
  const finishEditing = () => {
    const task = tasks?.find((t) => keyOf(t) === editing);
    const session = task && sync.get(task.noteId);
    const latest = session && extractTasks(session.provider ? session.provider() : session.currentDoc(), task.date).find((t) => t.id === task.taskId);
    if (latest) setTasks((list) => list.map((item) => keyOf(item) === editing ? { ...item, ...latest } : item));
    setEditing(null);
  };
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
        const typed = parseTaskSchedule(t.text, t.date);
        for (const k of ['due', 'start', 'dueTime', 'startTime']) {
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
    if (patch === null) setTasks((list) => list.filter((t) => keyOf(t) !== keyOf(task)));
    else patchLocal(task, patch);
    try {
      await sync.track(
        (async () => {
          await sync.ready;
          const { note } = await api.getNote(task.noteId);
          const session = sync.adopt(note);
          const changed = patch === null ? session.removeTask(task.taskId) : session.applyTaskPatch(task.taskId, patch);
          if (!changed) throw new Error('That task is no longer in its note.');
        })(),
      );
      setError(null);
    } catch (e) {
      setTasks((list) => patch === null ? [...list, before] : list.map((t) => (keyOf(t) === keyOf(task) ? before : t)));
      await load(); // show what the server really has, then say why the change did not stick
      setError(e.message);
    }
  };

  const toggle = (task) => {
    if (task.dismissedAt) return;
    setTouched((s) => new Set(s).add(keyOf(task)));
    apply(task, { checked: !task.checked });
  };

  const buckets = { overdue: [], today: [], upcoming: [], anytime: [], later: [], hidden: [], done: [], dismissed: [] };
  for (const t of tasks ?? []) buckets[bucketOf(t, today, touched, now)].push(t);
  buckets.overdue.sort(byPriorityThen(byDate('due')));
  buckets.today.sort(byPriorityThen(byDate('due')));
  buckets.upcoming.sort(byPriorityThen(byDate('due')));
  buckets.later.sort(byDate('start'));
  buckets.anytime.sort(byPriorityThen(() => 0)); // sort is stable: the rest keep their order
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
  const listed = buckets.overdue.length + (showToday ? buckets.today.length : 0) + (showUpcoming ? upcomingShown.length : 0) + (showUndated ? undatedShown.length : 0);
  const EMPTY = { overdue: 'Nothing overdue.', today: 'Nothing overdue or due today.', week: 'Nothing overdue or coming up this week.' };
  const row = (t) => {
    const overdue = !t.checked && isOverdue(t.due, t.dueTime, today, now);
    const hiddenNow = isHiddenNow(t, today);
    const open = (kind) => setMenu({ key: keyOf(t), kind });
    const isOpen = expanded.has(keyOf(t));
    return (
      <li key={keyOf(t)} class={`task-row${t.checked ? ' done' : ''}${isOpen ? ' expanded' : ''}`} data-testid="task-row" data-priority={t.priority ?? ''} data-bar={dueBar(t.due, t.checked, today)}>
        <label class="task-check">
          {t.dismissedAt ? <span class="dismissed-icon" role="img" aria-label="Dismissed task">⊠</span> : <input type="checkbox" checked={t.checked} onChange={() => toggle(t)} aria-label={t.checked ? 'Completed task' : 'Task'} />}
        </label>
        <div class="task-body">
          {editing === keyOf(t) ? <TaskTextEditor task={t}
            onText={(text) => setTasks((list) => list.map((item) => keyOf(item) === keyOf(t) ? { ...item, text } : item))}
            onDone={finishEditing} /> :
            <button type="button" class="task-text task-text-button" onClick={() => { finishEditing(); setEditing(keyOf(t)); }} aria-label={`Edit task: ${t.text}`} data-testid="task-edit-text">
              <TaskText text={t.text} date={t.date} />
            </button>}
          <span class="task-meta">
            {t.dismissedAt && <span class="task-chip" data-testid="chip-dismissed">dismissed · {new Date(t.dismissedAt).toLocaleDateString('en-CA', { timeZone: config.tz })}</span>}
            {t.due && <span class={`task-chip${overdue ? ' overdue' : ''}`} data-testid="chip-due">due {formatDateLabel(t.due, today)}{t.dueTime && ` at ${t.dueTime}`}</span>}
            {t.start && <span class="task-chip" data-testid="chip-start">starts {formatDateLabel(t.start, today)}{t.startTime && ` at ${t.startTime}`}</span>}
            {t.hidden && <span class="task-chip" data-testid="chip-hidden">hidden</span>}
            {!t.hidden && t.hideUntil && t.hideUntil > today && <span class="task-chip" data-testid="chip-hidden">hidden until {formatDateShort(t.hideUntil)}</span>}
            <span>
              {t.tags[0] ?? ''} · {formatDateShort(t.date)}
            </span>
          </span>
        </div>
        <div class="task-actions">
          <button type="button" class={`round-btn${hiddenNow ? ' on' : ' unset'}`} onClick={() => open('hide')} aria-label={hiddenNow ? 'Hidden: change or show again' : 'Hide for a while'} title="Hide" data-testid="task-hide">
            <Glyph name="eyeOff" />
          </button>
          <button type="button" class={`round-btn${!t.due && !(t.start && t.start > today) ? ' unset' : t.due && t.due <= today && !t.checked ? ' due-soon' : ' due-set'}`} onClick={() => open('date')} aria-label="Due date" title="Due date" data-testid="task-date">
            <Glyph name="calendar" />
          </button>
          <button
            type="button"
            class={`round-btn prio-${t.priority ?? 'none'}${t.priority ? '' : ' unset'}`}
            onClick={() => open('priority')}
            aria-label={`Priority: ${PRIORITY_LABEL[t.priority] ?? 'none'}`}
            title="Priority"
            data-testid="task-priority"
          >
            <PriorityStar value={t.priority} />
          </button>
          <button type="button" class={`round-btn chevron${isOpen ? ' open' : ''}`} onClick={() => toggleExpanded(t)} aria-expanded={isOpen} aria-label={isOpen ? 'Close details' : 'Open details'} title="Details" data-testid="task-expand">
            <Glyph name="chevron" />
          </button>
        </div>
        {isOpen && (
          <div class="task-expanded" data-testid="task-details">
            <TaskDetails
              uid={keyOf(t)}
              text={t.text}
              noteDate={t.date}
              noteId={t.noteId}
              where={`${t.tags[0] ?? 'No tag'} · ${formatDateShort(t.date)}`}
              today={today}
              picked={{ dueTime: t.dueTimeFrom === 'set' ? t.dueTime : null, startTime: t.startTimeFrom === 'set' ? t.startTime : null, due: t.dueFrom === 'set' ? t.due : null, start: t.startFrom === 'set' ? t.start : null, hidden: t.hidden, hideUntil: t.hideUntil, priority: t.priority, dismissedAt: t.dismissedAt }}
              onChange={(patch) => apply(t, patch)}
              onDelete={() => apply(t, null)}
              onDone={() => toggleExpanded(t)}
            />
          </div>
        )}
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
          {level === 'overdue' ? `${buckets.overdue.length} overdue · ${openCount} open` : level === 'today' || level === 'week' ? `${buckets.overdue.length} overdue · ${buckets.today.length} today · ${openCount} open` : `${openCount} open ${openCount === 1 ? 'task' : 'tasks'}`}
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
      {tasks && level !== 'all' && listed === 0 && !error && (
        <p class="muted center" data-testid={level === 'overdue' ? 'nothing-overdue' : 'nothing-due'}>
          {EMPTY[level]}
        </p>
      )}
      {tasks && level === 'all' && openCount === 0 && !error && (
        <p class="muted center">
          {compact ? 'Nothing is due. Open All tasks to see everything.' : 'Nothing to do. Turn a line into a task with the toolbar’s task button while writing a note.'}
        </p>
      )}
      {section('overdue', 'Overdue', buckets.overdue)}
      {showToday && section('today', 'Due today', buckets.today)}
      {showUpcoming && section('upcoming', compact ? 'Coming up' : 'Upcoming', upcomingShown)}
      {compact && showUndated && section('anytime', 'No date', undatedShown)}
      {compact && showUndated && undatedMore > 0 && (
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
      {!compact && folded('dismissed', 'Dismissed', buckets.dismissed)}
      {menu && (() => {
        const t = tasks?.find((x) => keyOf(x) === menu.key);
        if (!t) return null;
        const close = () => setMenu(null);
        const onPick = (patch) => apply(t, patch);
        if (menu.kind === 'date') return <DateMenu today={today} due={t.dueFrom === 'set' ? t.due : null} start={t.startFrom === 'set' ? t.start : null} onPick={onPick} onClose={close} />;
        if (menu.kind === 'hide') return <HideMenu today={today} hidden={t.hidden} hideUntil={t.hideUntil} onPick={onPick} onClose={close} />;
        return <PriorityMenu value={t.priority} onPick={onPick} onClose={close} />;
      })()}
    </div>
  );
}
