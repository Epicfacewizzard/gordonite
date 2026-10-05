import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.js';
import { sync } from '../sync.js';
import { formatDateShort } from '../../../shared/dates.js';

const keyOf = (t) => `${t.noteId}:${t.taskId}`;
const streamHref = (tag) => `#/t/${encodeURIComponent(tag).replaceAll('%2F', '/')}`;

export function TasksView() {
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState(null);
  const [showDone, setShowDone] = useState(false);
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

  const setChecked = (task, checked) =>
    setTasks((list) => list.map((t) => (keyOf(t) === keyOf(task) ? { ...t, checked } : t)));

  // Optimistic: tick at once, then write through the note's save session (phone copy first,
  // then the server, with the usual conflict protection). Put the box back if that fails.
  const toggle = async (task) => {
    const next = !task.checked;
    setChecked(task, next);
    setTouched((s) => new Set(s).add(keyOf(task)));
    try {
      await sync.track(
        (async () => {
          await sync.ready;
          const { note } = await api.getNote(task.noteId);
          const session = sync.adopt(note);
          if (!session.setTaskChecked(task.taskId, next)) throw new Error('That task is no longer in its note.');
        })(),
      );
      setError(null);
    } catch (e) {
      setChecked(task, !next);
      await load(); // show what the server really has, then say why the tick did not stick
      setError(e.message);
    }
  };

  const visible = tasks?.filter((t) => !t.checked || showDone || touched.has(keyOf(t))) ?? [];
  const groups = new Map();
  for (const t of visible) {
    const stream = t.tags[0] ?? '(untagged)';
    if (!groups.has(stream)) groups.set(stream, []);
    groups.get(stream).push(t);
  }
  const streams = [...groups.keys()].sort();
  const openCount = tasks?.filter((t) => !t.checked).length ?? 0;
  const doneCount = (tasks?.length ?? 0) - openCount;

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
          {doneCount > 0 && (
            <>
              {' · '}
              <button type="button" class="link" onClick={() => setShowDone((v) => !v)} data-testid="toggle-done">
                {showDone ? 'hide' : 'show'} {doneCount} done
              </button>
            </>
          )}
        </p>
      )}
      {tasks && visible.length === 0 && !error && (
        <p class="muted center">Nothing to do. Turn a line into a task with the toolbar’s task button while writing a note.</p>
      )}
      {streams.map((stream) => (
        <section key={stream} class="task-group" data-testid="task-group" data-stream={stream}>
          <h2 class="section">
            <a href={streamHref(stream)}>{stream}</a>
          </h2>
          <ul class="task-list">
            {groups.get(stream).map((t) => (
              <li key={keyOf(t)} class={`task-row${t.checked ? ' done' : ''}`} data-testid="task-row">
                <label class="task-check">
                  <input type="checkbox" checked={t.checked} onChange={() => toggle(t)} aria-label={t.checked ? 'Completed task' : 'Task'} />
                </label>
                <span class="task-body">
                  <span class="task-text">{t.text}</span>
                  <span class="task-meta">
                    {formatDateShort(t.date)}
                    {t.tags.slice(1).map((o) => (
                      <> · <a href={streamHref(o)}>{o}</a></>
                    ))}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
