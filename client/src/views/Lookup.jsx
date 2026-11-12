import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.js';
import { useTaskData, useToday } from '../hooks.js';
import { usePeople, PersonAvatar } from './PersonProfile.jsx';
import { useProjects } from '../projects-data.js';
import { PEOPLE_TAG, matchesSearch, sortPeople } from '../../../shared/people.js';
import { AREA_LABEL } from '../../../shared/projects.js';
import { addDays, dateInTz, formatDateLabel } from '../../../shared/dates.js';

// Look up: one search box over notes, people and tasks; with the box empty, the people met in the last 30 days, the
// projects, and everyone else by who was talked to most recently. Nothing here is stored: it is all read from the
// people list, the projects list, the task list and the notes search that already exist. Notes, Tags, Files and Trash
// are linked at the bottom.

const MET_DAYS = 30;

const personLine = (p) => p.profile.role || p.preview || '';

function PersonRow({ p, today, extra = null }) {
  return (
    <a class="lookup-row" href={`#/n/${p.noteId}`} data-testid="lookup-person">
      <PersonAvatar name={p.title} photo={p.profile.photo} size={36} />
      <span class="lookup-grow">
        <b>{p.title}</b>
        <span class="muted small lookup-line">{[personLine(p), extra ?? (p.lastTalked ? `talked ${formatDateLabel(p.lastTalked, today)}` : '')].filter(Boolean).join(' · ')}</span>
      </span>
      <span class="lookup-chev" aria-hidden="true">›</span>
    </a>
  );
}

const Group = ({ label, count, id, children }) => (
  <section class="lookup-group" data-testid={`lookup-${id}`}>
    <h2 class="section">
      {label}
      {count != null && <span class="count"> {count}</span>}
    </h2>
    <div class="lookup-list">{children}</div>
  </section>
);

export function LookupView({ config }) {
  const today = useToday(config.tz);
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null); // the notes matching the search: { q, notes } | { q, notes, error }
  const [recent, setRecent] = useState(null); // the people notes and the day each was created: Map of note id -> day
  const people = usePeople();
  const { projects } = useProjects();
  const taskData = useTaskData();
  const term = q.trim();

  useEffect(() => {
    let alive = true;
    api
      .notes({ tag: PEOPLE_TAG, sub: true, limit: 100 })
      .then((r) => alive && setRecent(new Map(r.notes.map((n) => [n.id, dateInTz(new Date(n.createdAt), config.tz)]))))
      .catch(() => alive && setRecent(new Map()));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!term) {
      setFound(null);
      return undefined;
    }
    let alive = true;
    const id = setTimeout(() => {
      api
        .notes({ q: term, limit: 20 })
        .then((r) => alive && setFound({ q: term, notes: r.notes }))
        .catch((e) => alive && setFound({ q: term, notes: [], error: e.message }));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [term]);

  const all = people.people;
  let body;
  if (term) {
    const lower = term.toLowerCase();
    const matchedPeople = sortPeople(all.filter((p) => matchesSearch(p, term)), 'name', today);
    const matchedTasks = (taskData.tasks() ?? []).filter((t) => !t.dismissedAt && t.text.toLowerCase().includes(lower)).slice(0, 20);
    const notes = found?.q === term ? found.notes : null;
    body = (
      <>
        {matchedPeople.length > 0 && (
          <Group label="People" count={matchedPeople.length} id="people-found">
            {matchedPeople.map((p) => <PersonRow key={p.noteId} p={p} today={today} />)}
          </Group>
        )}
        {matchedTasks.length > 0 && (
          <Group label="Tasks" count={matchedTasks.length} id="tasks-found">
            {matchedTasks.map((t) => (
              <a key={`${t.noteId}:${t.taskId}`} class="lookup-row" href={`#/n/${t.noteId}`} data-testid="lookup-task">
                <span class="lookup-grow">
                  <span class={t.checked ? 'lookup-done' : ''}>{t.text}</span>
                  <span class="muted small lookup-line">{[t.checked ? 'done' : t.due ? `due ${formatDateLabel(t.due, today)}` : '', t.tags[0]].filter(Boolean).join(' · ')}</span>
                </span>
                <span class="lookup-chev" aria-hidden="true">›</span>
              </a>
            ))}
          </Group>
        )}
        {notes && notes.length > 0 && (
          <Group label="Written" count={notes.length} id="notes-found">
            {notes.map((n) => (
              <a key={n.id} class="lookup-row" href={`#/n/${n.id}`} data-testid="lookup-note">
                <span class="lookup-grow">
                  <b>{n.title || 'Untitled note'}</b>
                  <span class="muted small lookup-line">{[formatDateLabel(n.date, today), n.preview].filter(Boolean).join(' · ')}</span>
                </span>
                <span class="lookup-chev" aria-hidden="true">›</span>
              </a>
            ))}
          </Group>
        )}
        {found?.q === term && found.error && <p class="muted small">Can’t search the notes now: {found.error}</p>}
        {!notes && <p class="muted small">Searching…</p>}
        {notes && notes.length === 0 && matchedPeople.length === 0 && matchedTasks.length === 0 && (
          <p class="muted center" data-testid="lookup-nothing">
            Nothing matches “{term}”.
          </p>
        )}
      </>
    );
  } else {
    const since = addDays(today, -(MET_DAYS - 1));
    const met = all
      .filter((p) => (recent?.get(p.noteId) ?? '') >= since)
      .sort((a, b) => recent.get(b.noteId).localeCompare(recent.get(a.noteId)) || (a.title || '').localeCompare(b.title || ''));
    const metIds = new Set(met.map((p) => p.noteId));
    const rest = all
      .filter((p) => !metIds.has(p.noteId))
      .sort((a, b) => (b.lastTalked || '').localeCompare(a.lastTalked || '') || (b.updatedAt || '').localeCompare(a.updatedAt || '') || (a.title || '').localeCompare(b.title || ''));
    const active = projects.filter((p) => p.status === 'active' || !p.status);
    body = (
      <>
        {met.length > 0 && (
          <Group label="Met recently" count={met.length} id="met">
            {met.map((p) => <PersonRow key={p.noteId} p={p} today={today} extra={`met ${formatDateLabel(recent.get(p.noteId), today)}`} />)}
          </Group>
        )}
        {active.length > 0 && (
          <Group label="Projects" count={active.length} id="projects">
            {active.map((p) => (
              <a key={p.id} class="lookup-row" href={`#/projects/${p.id}`} data-testid="lookup-project">
                <span class="lookup-initials" aria-hidden="true">
                  {p.name.slice(0, 2)}
                </span>
                <span class="lookup-grow">
                  <b>{p.name}</b>
                  <span class="muted small lookup-line">{AREA_LABEL[p.area] ?? ''}</span>
                </span>
                <span class="lookup-chev" aria-hidden="true">›</span>
              </a>
            ))}
          </Group>
        )}
        <Group label="People" count={rest.length} id="people">
          {rest.map((p) => <PersonRow key={p.noteId} p={p} today={today} />)}
          {rest.length === 0 && people.loaded && (
            <p class="muted small lookup-empty">
              No one else yet. <a href={`#/new?tag=${encodeURIComponent(PEOPLE_TAG)}`}>Add a person</a>
            </p>
          )}
        </Group>
      </>
    );
  }

  return (
    <div class="lookup" data-testid="lookup">
      <label class="lookup-search">
        <span aria-hidden="true">⌕</span>
        <input type="search" value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder="Search notes, people and tasks" aria-label="Search" autocomplete="off" data-testid="lookup-input" />
      </label>
      {body}
      <nav class="lookup-more" aria-label="More places" data-testid="lookup-more">
        <a href="#/people" data-testid="lookup-all-people">All people</a>
        <a href="#/projects" data-testid="lookup-all-projects">All projects</a>
        <a href="#/notes" data-testid="lookup-notes">Notes</a>
        <a href="#/tags" data-testid="lookup-tags">Tags</a>
        <a href="#/files" data-testid="lookup-files">Files</a>
        <a href="#/trash" data-testid="lookup-trash">Trash</a>
      </nav>
    </div>
  );
}
