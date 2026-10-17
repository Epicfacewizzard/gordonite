import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.js';
import { go, useTaskData, useToday } from '../hooks.js';
import { loadProjects, projectActions, useProjects } from '../projects-data.js';
import { usePeople } from './PersonProfile.jsx';
import { TaskLinkChips } from './TaskChips.jsx';
import { AREAS, AREA_LABEL, STATUSES, STATUS_LABEL, byWaitingLongest, isWaiting, projectOfTask } from '../../../shared/projects.js';
import { formatDateShort } from '../../../shared/dates.js';

// Projects (see docs/PROJECTS.md): Personal, School and Club areas with their projects, and a page per project with its
// notes, its open tasks and the ones waiting for someone's reply. A project's notes are the notes with its tag; its
// tasks are read from those notes, so nothing is copied and finishing a task here is the same as anywhere else.

function useProjectTasks(projectId) {
  const data = useTaskData();
  const { projects } = useProjects();
  const mine = (data.tasks() ?? []).filter((t) => projectOfTask(t, projects)?.id === projectId);
  const live = mine.filter((t) => !t.checked && !t.dismissedAt);
  return { open: live.filter((t) => !isWaiting(t)), waiting: live.filter(isWaiting).sort(byWaitingLongest), done: mine.filter((t) => t.checked) };
}

function NewProject({ areaFolders, onDone }) {
  const [name, setName] = useState('');
  const [area, setArea] = useState('club');
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await projectActions.create({ name, area, ...(tag.trim() ? { tag: tag.trim() } : {}) });
      onDone(r.project);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <form class="project-new" onSubmit={submit} data-testid="project-new">
      <div class="field">
        <label for="project-name">Name</label>
        <input id="project-name" type="text" value={name} maxLength={120} onInput={(e) => setName(e.currentTarget.value)} data-testid="project-name" required />
      </div>
      <div class="field">
        <label>Area</label>
        <div class="row">
          {AREAS.map((a) => (
            <button key={a} type="button" class="btn" aria-pressed={area === a} onClick={() => setArea(a)} data-testid={`project-area-${a}`}>
              {AREA_LABEL[a]}
            </button>
          ))}
        </div>
      </div>
      <div class="field">
        <label for="project-tag">Existing tag (optional)</label>
        <input id="project-tag" type="text" value={tag} placeholder={`left empty: a new tag under ${areaFolders[area]}/`} onInput={(e) => setTag(e.currentTarget.value)} data-testid="project-tag" />
        <p class="muted small">The notes with this tag, and the tags under it, join the project at once.</p>
      </div>
      {error && <p class="error inline" role="alert">{error}</p>}
      <div class="row">
        <button type="submit" class="btn primary" disabled={busy || !name.trim()} data-testid="project-create">Create project</button>
        <button type="button" class="btn" onClick={() => onDone(null)}>Cancel</button>
      </div>
    </form>
  );
}

export function ProjectsView() {
  const state = useProjects();
  const data = useTaskData();
  const [adding, setAdding] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const counts = new Map();
  for (const t of data.tasks() ?? []) {
    const p = projectOfTask(t, state.projects);
    if (!p || t.checked || t.dismissedAt) continue;
    const c = counts.get(p.id) ?? { open: 0, waiting: 0 };
    c.open++;
    if (isWaiting(t)) c.waiting++;
    counts.set(p.id, c);
  }
  const shown = state.projects.filter((p) => showArchived || p.status !== 'archived');
  return (
    <div class="projects" data-testid="projects">
      <div class="row">
        <button type="button" class="btn primary" onClick={() => setAdding(true)} data-testid="project-add">New project</button>
        <label class="check-row">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.currentTarget.checked)} />
          <span>Show archived</span>
        </label>
      </div>
      {adding && <NewProject areaFolders={state.areaFolders} onDone={(p) => { setAdding(false); if (p) go(`/projects/${p.id}`); }} />}
      {state.error && <p class="banner error" role="alert">{state.error}</p>}
      {state.loaded && !state.error && shown.length === 0 && !adding && (
        <p class="muted center">No projects yet. Make one from a tag you already use, such as a club event, or start a new one.</p>
      )}
      {AREAS.map((area) => {
        const list = shown.filter((p) => p.area === area);
        return list.length > 0 && (
          <section key={area} class="project-area" data-testid={`area-${area}`}>
            <h2 class="section">{AREA_LABEL[area]} <span class="count">{list.length}</span></h2>
            <ul class="project-list">
              {list.map((p) => {
                const c = counts.get(p.id) ?? { open: 0, waiting: 0 };
                return (
                  <li key={p.id} class="project-card" data-testid="project-card">
                    <a href={`#/projects/${p.id}`} class="project-card-name">{p.name}</a>
                    <span class="muted small">
                      {p.status !== 'active' && `${STATUS_LABEL[p.status]} · `}
                      {c.open} open {c.open === 1 ? 'task' : 'tasks'}
                      {c.waiting > 0 && ` · ${c.waiting} waiting`} · {p.noteCount} {p.noteCount === 1 ? 'note' : 'notes'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function AddNotes({ project, existing, onClose }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null);
  const [message, setMessage] = useState(null);
  useEffect(() => {
    if (!q.trim()) return setFound(null);
    const id = setTimeout(() => api.notes({ q, limit: 15 }).then((r) => setFound(r.notes)).catch(() => setFound([])), 250);
    return () => clearTimeout(id);
  }, [q]);
  const add = async (n) => {
    try {
      const r = await projectActions.addNotes(project.id, [n.id]);
      setMessage(r.failed.length ? r.failed[0].message : `Added “${n.title}”.`);
    } catch (err) {
      setMessage(err.message);
    }
  };
  return (
    <div class="project-add-notes" data-testid="project-add-notes">
      <label for="project-note-search">Find a note to add</label>
      <input id="project-note-search" type="search" value={q} onInput={(e) => setQ(e.currentTarget.value)} data-testid="project-note-search" />
      {message && <p class="muted small" role="status">{message}</p>}
      <ul class="project-list">
        {(found ?? []).filter((n) => !existing.has(n.id)).map((n) => (
          <li key={n.id} class="project-card">
            <span>{n.title || 'Untitled'} <span class="muted small">{n.tags.map((t) => t.path ?? t).join(', ')}</span></span>
            <button type="button" class="btn small" onClick={() => add(n)} data-testid="project-note-add">Add</button>
          </li>
        ))}
      </ul>
      <button type="button" class="btn" onClick={onClose}>Done</button>
    </div>
  );
}

export function ProjectPage({ id, config }) {
  const state = useProjects();
  const today = useToday(config.tz);
  const { people } = usePeople();
  const project = state.byId(id);
  const tasks = useProjectTasks(id);
  const [notes, setNotes] = useState(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(null);
  const [showDone, setShowDone] = useState(false);
  useEffect(() => {
    if (!project?.tag) return setNotes([]);
    api.notes({ tag: project.tag, sub: true, limit: 100 }).then((r) => setNotes(r.notes)).catch(() => setNotes([]));
  }, [project?.tag, project?.noteCount]);
  if (!project) {
    return state.loaded ? <p class="muted center">This project is not here. <a href="#/projects">Back to Projects</a></p> : <p class="muted center">Loading…</p>;
  }
  const act = (fn) => fn().then(() => setError(null)).catch((e) => setError(e.message));
  const row = (t) => (
    <li key={`${t.noteId}:${t.taskId}`} class="person-task" data-testid="project-task">
      <a href={`#/n/${t.noteId}`} class="person-task-text">{t.text}</a>
      <span class="task-meta">
        {t.due && <span class="task-chip">due {formatDateShort(t.due)}</span>}
        <TaskLinkChips task={t} today={today} projects={state.projects} people={people} hideProject />
      </span>
    </li>
  );
  return (
    <div class="project-page" data-testid="project-page">
      <h2 class="project-title" data-testid="project-title">{project.name}</h2>
      <p class="muted small">
        {AREA_LABEL[project.area]} · {STATUS_LABEL[project.status]}
        {project.tag && <> · tag <a href={`#/t/${project.tag}`}>{project.tag}</a></>}
      </p>
      <div class="row">
        {project.overviewNoteId && <a class="btn" href={`#/n/${project.overviewNoteId}`} data-testid="project-overview">Overview note</a>}
        <label class="project-status">
          <span class="muted small">Status</span>
          <select value={project.status} onChange={(e) => act(() => projectActions.save(id, { status: e.currentTarget.value }))} data-testid="project-status">
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <label class="project-status">
          <span class="muted small">Area</span>
          <select value={project.area} onChange={(e) => act(() => projectActions.save(id, { area: e.currentTarget.value }))} data-testid="project-area">
            {AREAS.map((a) => <option key={a} value={a}>{AREA_LABEL[a]}</option>)}
          </select>
        </label>
      </div>
      {error && <p class="error inline" role="alert">{error}</p>}

      <section class="project-section" data-testid="project-waiting">
        <h3 class="section">Waiting on <span class="count">{tasks.waiting.length}</span></h3>
        {tasks.waiting.length === 0 ? <p class="muted small">Nothing is waiting for a reply.</p> : <ul class="person-task-list">{tasks.waiting.map(row)}</ul>}
      </section>
      <section class="project-section" data-testid="project-open">
        <h3 class="section">Open tasks <span class="count">{tasks.open.length}</span></h3>
        {tasks.open.length === 0 ? <p class="muted small">No open tasks.</p> : <ul class="person-task-list">{tasks.open.map(row)}</ul>}
        {tasks.done.length > 0 && (
          <p class="small">
            <button type="button" class="link" onClick={() => setShowDone((v) => !v)}>{showDone ? 'Hide' : 'Show'} {tasks.done.length} done</button>
          </p>
        )}
        {showDone && <ul class="person-task-list">{tasks.done.map(row)}</ul>}
      </section>
      <section class="project-section" data-testid="project-notes">
        <h3 class="section">Notes <span class="count">{notes?.length ?? 0}</span></h3>
        <ul class="person-task-list">
          {(notes ?? []).map((n) => (
            <li key={n.id} class="person-task"><a href={`#/n/${n.id}`} class="person-task-text">{n.title || 'Untitled'}</a><span class="muted small">{n.tags.map((t) => t.path ?? t).join(', ')} · {formatDateShort(n.date)}</span></li>
          ))}
        </ul>
        {adding ? (
          <AddNotes project={project} existing={new Set((notes ?? []).map((n) => n.id))} onClose={() => { setAdding(false); loadProjects(); }} />
        ) : (
          <button type="button" class="btn" onClick={() => setAdding(true)} disabled={!project.tag} data-testid="project-add-notes-btn">Add notes</button>
        )}
      </section>
      <p>
        <button type="button" class="btn danger" onClick={() => act(() => projectActions.remove(id).then(() => go('/projects')))} data-testid="project-remove">Remove project</button>
        <span class="muted small"> Its tag and notes stay.</span>
      </p>
    </div>
  );
}
