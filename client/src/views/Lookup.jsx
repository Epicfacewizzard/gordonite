import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.js';
import { useTaskData, useToday } from '../hooks.js';
import { usePeople, PersonAvatar } from './PersonProfile.jsx';
import { useProjects } from '../projects-data.js';
import { PEOPLE_TAG, matchesSearch, sortPeople } from '../../../shared/people.js';
import { AREA_LABEL } from '../../../shared/projects.js';
import { addDays, dateInTz, formatDateLabel } from '../../../shared/dates.js';

// Look up keeps cross-category search and offers direct paths into the main collections.

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
    const active = projects.filter((p) => p.status === 'active' || !p.status);
    body = (
      <>
        {met.length > 0 && (
          <Group label="Met recently" id="met">
            {met.slice(0, 4).map((p) => <PersonRow key={p.noteId} p={p} today={today} extra={`met ${formatDateLabel(recent.get(p.noteId), today)}`} />)}
            {met.length > 4 && <a class="lookup-view-all" href="#/people" data-testid="lookup-met-view-all">View all {met.length} people</a>}
          </Group>
        )}
        {active.length > 0 && (
          <Group label="Projects" id="projects">
            {active.slice(0, 4).map((p) => (
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
            {active.length > 4 && <a class="lookup-view-all" href="#/projects" data-testid="lookup-projects-view-all">View all {active.length} projects</a>}
          </Group>
        )}
      </>
    );
  }

  const destinations = (
    <nav class="lookup-destinations" aria-label="Browse categories" data-testid="lookup-destinations">
      {[
        { label: 'Notes', detail: 'Read and find your writing', href: '#/notes', testid: 'lookup-notes', icon: <><path d="M5 3.5h9l5 5v12H5z" /><path d="M14 3.5v5h5M8 13h8M8 17h6" /></> },
        { label: 'People', detail: 'Keep up with people you know', href: '#/people', testid: 'lookup-all-people', icon: <><circle cx="9" cy="8" r="3" /><path d="M3.5 20v-1.5a5.5 5.5 0 0 1 11 0V20zM16 5.5a3 3 0 0 1 0 5.8M17 14a5 5 0 0 1 3.5 4.8V20h-3" /></> },
        { label: 'Projects', detail: 'See what you are working on', href: '#/projects', testid: 'lookup-all-projects', icon: <><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M8 5V3h8v2M3 11h18M10 11v2h4v-2" /></> },
        { label: 'Tags', detail: 'Browse notes by topic', href: '#/tags', testid: 'lookup-tags', icon: <><path d="M20 13 12 21l-9-9V3h9z" /><circle cx="7.5" cy="7.5" r="1" /></> },
        { label: 'Files', detail: 'Find attached files', href: '#/files', testid: 'lookup-files', icon: <><path d="M5 3h9l5 5v13H5z" /><path d="M14 3v5h5M8 14h8M8 17h5" /></> },
      ].map((item) => (
        <a class="lookup-destination" href={item.href} data-testid={item.testid} key={item.label}>
          <svg class="lookup-destination-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{item.icon}</svg>
          <span class="lookup-destination-copy"><b>{item.label}</b><span class="muted small">{item.detail}</span></span>
        </a>
      ))}
    </nav>
  );

  return (
    <div class="lookup" data-testid="lookup">
      <label class="lookup-search">
        <span aria-hidden="true">⌕</span>
        <input type="search" value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder="Search notes, people and tasks" aria-label="Search" autocomplete="off" data-testid="lookup-input" />
      </label>
      {!term && destinations}
      <div class="lookup-results">{body}</div>
      {!term && <nav class="lookup-more" aria-label="More places" data-testid="lookup-more">
        <a href="#/trash" data-testid="lookup-trash">Trash</a>
      </nav>}
    </div>
  );
}
