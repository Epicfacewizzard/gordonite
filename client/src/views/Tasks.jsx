import { useState } from 'preact/hooks';
import { taskCommands } from '../task-commands.js';
import { useToday, useNowTime, useTaskData } from '../hooks.js';
import { bucketOf, groupTasks, streamsOf, visibleSections, withinRange, isHiddenNow } from '../task-groups.js';
import { addDays, formatDateShort, formatDateLabel, isOverdue } from '../../../shared/dates.js';
import { findDatePhrases } from '../../../shared/taskdates.js';
import { PRIORITY_LABEL, dueBar, taskKey as keyOf } from '../../../shared/tasks.js';
import { TaskDetails } from './TaskSheet.jsx';
import { getShiftDismiss, getDoneDays } from '../prefs.js';
import { DateRangePicker } from './DateRangePicker.jsx';
import { TaskTextEditor } from './TaskTextEditor.jsx';
import { DateMenu, Glyph, HideMenu, PriorityMenu, PriorityStar } from './TaskMenus.jsx';

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

// Which section a task is in, how each is ordered and how much the dashboard's box shows are rules of their own
// (../task-groups.js); this screen only draws them.
// `overdueOnly` (with `compact`) is the dashboard's right-hand column: just what is overdue.
// `compact` is the version on the Today screen: only what needs attention now (overdue, today, the next week,
// a few undated ones), no folded sections, and a link on to the full list.

// `scope` (with `compact`) is how much the dashboard's list shows: 'overdue', 'today' (overdue and due today), 'week'
// (adds the next seven days) or 'all' (adds a few with no date). The full Tasks page always shows everything.
export function TasksView({ config, compact = false, overdueOnly = false, scope = null }) {
  const level = !compact ? 'all' : overdueOnly ? 'overdue' : scope ?? 'all';
  const today = useToday(config.tz);
  const now = useNowTime(config.tz);
  // What is listed comes from the app's one task list (task-data.js): the server's rows, corrected by this device's own
  // copy of every note it holds changes to. This screen keeps only how it is shown (what is open, the range, the menus).
  const data = useTaskData();
  const tasks = data.tasks();
  const [actionError, setActionError] = useState(null); // a change that did not stick
  const error = actionError ?? data.error();
  const [open, setOpen] = useState({ done: false, hidden: false, later: false, dismissed: false });
  // The date range for the Done and Dismissed lists (the same control the note history uses). Starts at the length chosen
  // in Settings; 'Everything' starts with no limit.
  const [range, setRangeState] = useState(() => {
    const days = getDoneDays();
    return days > 0 ? { from: addDays(today, -(days - 1)), to: today } : { from: '', to: '' };
  });
  const setRange = (from, to) => setRangeState({ from, to });
  const [expanded, setExpanded] = useState(() => new Set()); // tasks opened out to show their details
  const toggleExpanded = (t) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (!next.delete(keyOf(t))) next.add(keyOf(t));
      return next;
    });
  const [menu, setMenu] = useState(null); // { key, kind: 'date' | 'hide' | 'priority' }: a round button's menu
  const [editing, setEditing] = useState(null);
  // Where the task being edited sat when editing began. A date typed into its words (`due fri`) is understood as it is
  // typed, which would move the row to another section and take the editor from under the cursor; it moves when done.
  const [editingBucket, setEditingBucket] = useState(null);
  const startEditing = (t) => {
    setEditingBucket(bucketOf(t, { today, now, touched }));
    setEditing(keyOf(t));
  };
  const finishEditing = () => {
    setEditing(null);
    setEditingBucket(null);
  };
  // Tasks ticked on this page stay listed (struck through) so a slip can be undone.
  const [touched, setTouched] = useState(() => new Set());

  // Show the change at once, then make it through the note (kept on the phone first, then sent, with the usual
  // conflict protection). Once it has been made the note's own copy shows it, so what was shown at once is let go; if it
  // could not be made, that is let go too and what is really there comes back, with the reason.
  const apply = async (task, patch) => {
    const release = data.optimistic(task.noteId, task.taskId, patch);
    try {
      const changed = patch === null ? await taskCommands.remove(task.noteId, task.taskId) : await taskCommands.update(task.noteId, task.taskId, patch);
      if (!changed) throw new Error('That task is no longer in its note.');
      setActionError(null);
      release();
    } catch (e) {
      release();
      await data.refresh();
      setActionError(e.message);
    }
  };

  const toggle = (task) => {
    if (task.dismissedAt) return;
    setTouched((s) => new Set(s).add(keyOf(task)));
    apply(task, { checked: !task.checked });
  };

  const buckets = groupTasks(tasks, { today, now, touched, pinned: editing && editingBucket ? new Map([[editing, editingBucket]]) : null });
  const streams = streamsOf(buckets.anytime);
  const { showToday, showUpcoming, showUndated, upcomingShown, undatedShown, undatedMore, openCount, listed } = visibleSections(buckets, { level, compact, today });
  const EMPTY = { overdue: 'Nothing overdue.', today: 'Nothing overdue or due today.', week: 'Nothing overdue or coming up this week.' };
  const row = (t) => {
    const overdue = !t.checked && isOverdue(t.due, t.dueTime, today, now);
    const hiddenNow = isHiddenNow(t, today);
    const open = (kind) => setMenu({ key: keyOf(t), kind });
    const isOpen = expanded.has(keyOf(t));
    return (
      <li key={keyOf(t)} class={`task-row${t.checked ? ' done' : ''}${isOpen ? ' expanded' : ''}`} data-testid="task-row" data-priority={t.priority ?? ''} data-bar={dueBar(t.due, t.checked, today)}>
        <label class="task-check">
          {t.dismissedAt ? <span class="dismissed-icon" role="img" aria-label="Dismissed task">⊠</span> : <input type="checkbox" checked={t.checked} onChange={() => toggle(t)} onClick={(e) => { if (e.shiftKey && !t.checked && getShiftDismiss()) { e.preventDefault(); apply(t, { dismissedAt: new Date().toISOString() }); } }} title={t.checked ? undefined : 'Shift-click to dismiss'} aria-label={t.checked ? 'Completed task' : 'Task'} />}
        </label>
        <div class="task-body">
          {editing === keyOf(t) ? <TaskTextEditor task={t} onDone={finishEditing} /> :
            <button type="button" class="task-text task-text-button" onClick={() => { finishEditing(); startEditing(t); }} aria-label={`Edit task: ${t.text}`} data-testid="task-edit-text">
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

  // Done and Dismissed: only the tasks finished or dismissed inside the date range are listed; the rest are counted and
  // one tap brings them back. (A task with no recorded date, from before dates were kept, is always listed.)
  const archived = (id, title, all) => {
    if (all.length === 0) return false;
    const { list, outside } = withinRange(all, range, config.tz);
    return (
      <section class="task-group" data-testid={`section-${id}`}>
        <h2 class="section">
          <button type="button" class="link-plain" onClick={() => setOpen((o) => ({ ...o, [id]: !o[id] }))} aria-expanded={open[id]} data-testid={`toggle-${id}`}>
            {open[id] ? '▾' : '▸'} {title} <span class="count">{list.length}</span>
          </button>
        </h2>
        {open[id] && (
          <>
            <div class="archive-bar" data-testid={`range-${id}`}>
              <DateRangePicker from={range.from} to={range.to} today={today} onChange={setRange} />
              {outside > 0 && (
                <span class="muted small" data-testid={`outside-${id}`}>
                  {outside} outside this range ·{' '}
                  <button type="button" class="link" onClick={() => setRange('', '')} data-testid={`show-all-${id}`}>
                    Show all
                  </button>
                </span>
              )}
            </div>
            {list.length > 0 ? <ul class="task-list">{list.map(row)}</ul> : <p class="muted">Nothing in this date range.</p>}
          </>
        )}
      </section>
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
          <button type="button" class="btn" onClick={() => { setActionError(null); data.refresh(); }}>
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
      {!compact && archived('done', 'Done', buckets.done)}
      {!compact && archived('dismissed', 'Dismissed', buckets.dismissed)}
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
