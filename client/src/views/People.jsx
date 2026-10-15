import { useEffect, useState } from 'preact/hooks';
import { go, useToday } from '../hooks.js';
import { PEOPLE_TAG, CLOSENESS, birthdayLabel, birthdaySoon, groupName, groupsOf, matchesSearch, nextBirthday, sinceLabel, sortPeople } from '../../../shared/people.js';
import { loadPeople } from '../people-data.js';
import { PersonAvatar, usePeople } from './PersonProfile.jsx';
import { NoteView } from './NotePage.jsx';

// People (see docs/PEOPLE.md): everyone tagged 05-people, as a small database: cards or a table, filtered by group and
// closeness, sorted by name, by who has not been talked to longest, or by whose birthday is next. Search covers names,
// details and note text. The list comes from the server with a copy on the phone, so it opens offline too.

const VIEW_KEY = 'hq-people-view';
const readView = () => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'cards';
  } catch {
    return 'cards';
  }
};

// Wide screens show the list and the open person side by side (as in the Personal CRM preview); phones one at a time.
const WIDE = '(min-width: 900px)';
function useWide() {
  const [wide, setWide] = useState(() => typeof matchMedia === 'function' && matchMedia(WIDE).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(WIDE);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

const SORTS = [
  { id: 'name', label: 'Name' },
  { id: 'talked', label: 'Last talked' },
  { id: 'birthday', label: 'Next birthday' },
];

/** `open`: the person shown beside the list on a wide screen (#/people/<id>). */
export function PeopleView({ config, open = null }) {
  const today = useToday(config.tz);
  const state = usePeople();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState(null);
  const [closeness, setCloseness] = useState(null);
  const [sort, setSort] = useState('name');
  const [view, setView] = useState(readView);
  const pickView = (v) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* a convenience only */
    }
  };

  const groups = [...new Set(state.people.flatMap((p) => groupsOf(p.tags)))].sort();
  const shown = sortPeople(
    state.people.filter((p) => (!group || groupsOf(p.tags).includes(group)) && (!closeness || p.profile.closeness === closeness) && matchesSearch(p, q)),
    sort,
    today,
  );
  const soon = sortPeople(
    state.people.filter((p) => (nextBirthday(p.profile.birthday, today)?.days ?? 99) <= 14),
    'birthday',
    today,
  );
  const newHref = `#/new?tag=${encodeURIComponent(group ?? PEOPLE_TAG)}`;
  const wide = useWide();
  const split = wide && view === 'cards';
  const selected = split ? (open ?? shown[0]?.noteId ?? null) : null;
  const href = (id) => (split ? `#/people/${id}` : `#/n/${id}`);
  // A person link from a wide screen opened on a narrow one: show that person on their own page.
  useEffect(() => {
    if (open && !split) go(`/n/${open}`, { replace: true });
  }, [open, split]);

  const list = (
    <>
      <p class="muted small">
        {!state.loaded ? 'Loading people…' : `${shown.length === state.people.length ? state.people.length : `${shown.length} of ${state.people.length}`} people`}
        {state.fromPhoneCopy && ' · from this phone’s copy'}
      </p>
      <a class="btn primary block" href={newHref}>
        New person
      </a>
      {soon.length > 0 && (
        <p class="people-soon" data-testid="people-birthdays">
          🎂{' '}
          {soon.map((p, i) => (
            <span key={p.noteId}>
              {i > 0 && ', '}
              <a href={href(p.noteId)}>{p.title}</a> {birthdaySoon(p.profile.birthday, today)}
            </span>
          ))}
        </p>
      )}
      <div class="notes-filters">
        <input type="search" aria-label="Search people" placeholder="Search names, details and notes" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
      </div>
      <nav class="people-filters" aria-label="People groups">
        <button class="btn small" aria-pressed={!group} onClick={() => setGroup(null)}>
          Everyone
        </button>
        {groups.map((path) => (
          <button key={path} class="btn small" aria-pressed={group === path} onClick={() => setGroup(group === path ? null : path)}>
            {groupName(path)}
          </button>
        ))}
      </nav>
      <div class="people-bar">
        <div class="people-filters" role="group" aria-label="Closeness">
          {CLOSENESS.map((c) => (
            <button key={c.id} class="btn small" aria-pressed={closeness === c.id} onClick={() => setCloseness(closeness === c.id ? null : c.id)}>
              {c.label}
            </button>
          ))}
        </div>
        <label class="people-sort">
          Sort
          <select value={sort} onChange={(e) => setSort(e.currentTarget.value)} aria-label="Sort people">
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div class="people-view-toggle" role="group" aria-label="Show as">
          <button class="btn small" aria-pressed={view === 'cards'} onClick={() => pickView('cards')} data-testid="people-cards-view">
            Cards
          </button>
          <button class="btn small" aria-pressed={view === 'table'} onClick={() => pickView('table')} data-testid="people-table-view">
            Table
          </button>
        </div>
      </div>
      {state.error && (
        <div class="banner error" role="alert">
          {state.error}
          <button class="btn" onClick={loadPeople}>
            Retry
          </button>
        </div>
      )}
      {state.loaded && !shown.length && <p class="muted">{state.people.length ? 'No people match.' : 'No people yet. Notes tagged 05-people show here.'}</p>}
      {view === 'cards' ? <Cards people={shown} today={today} href={href} selected={selected} /> : <Table people={shown} today={today} href={href} />}
    </>
  );
  if (!split) return <section data-testid="people-page">{list}</section>;
  return (
    <section data-testid="people-page" class="people-split">
      <div class="people-side">{list}</div>
      <div class="people-open" data-testid="people-open">
        {selected ? <NoteView key={selected} id={selected} config={config} /> : <p class="muted center">Pick someone on the left.</p>}
      </div>
    </section>
  );
}

// "Spoke today", "Spoke yesterday", "Spoke 3 days ago", … (as in the Personal CRM preview)
const spokeLabel = (date, today) => {
  const since = sinceLabel(date, today);
  return since === 'Planned' ? since : `Spoke ${since.toLowerCase()}`;
};

function Cards({ people, today, href, selected }) {
  return (
    <ul class="people-cards">
      {people.map((p) => (
        <li key={p.noteId}>
          <a class="person-card" href={href(p.noteId)} aria-current={selected === p.noteId ? 'true' : undefined} data-testid="person-note">
            <PersonAvatar name={p.title} photo={p.profile.photo} />
            <span class="person-summary">
              <span class="person-card-head">
                <span class="note-title">{p.title || 'Untitled person'}</span>
                <span class="person-card-group">{groupsOf(p.tags).map(groupName).join(', ')}</span>
              </span>
              {(p.profile.role || p.preview) && <span class="note-preview">{p.profile.role || p.preview.replace(/[![^]]+]s*/g, '').split(' · ')[0]}</span>}
              <span class="person-last" data-testid="person-last">
                {p.lastTalked ? (
                  <>
                    <span class="person-last-when">{spokeLabel(p.lastTalked, today)}</span>
                    {p.lastChat && p.lastChat.date === p.lastTalked && <span class="person-last-what"> · {p.lastChat.how ? `${p.lastChat.how}: ` : ''}{p.lastChat.text}</span>}
                  </>
                ) : (
                  <span class="muted">No conversation logged yet</span>
                )}
              </span>
              {(p.profile.closeness || p.profile.birthday) && (
                <span class="person-groups">
                  {p.profile.closeness && <span class="task-chip subtle">{CLOSENESS.find((c) => c.id === p.profile.closeness).label}</span>}
                  {p.profile.birthday && <span class="task-chip subtle">🎂 {birthdayLabel(p.profile.birthday.length === 10 ? p.profile.birthday.slice(5) : p.profile.birthday)}</span>}
                </span>
              )}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function Table({ people, today, href }) {
  return (
    <div class="people-table-wrap">
      <table class="people-table" data-testid="people-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Group</th>
            <th scope="col">Role</th>
            <th scope="col">Closeness</th>
            <th scope="col">Last talked</th>
            <th scope="col">Birthday</th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.noteId}>
              <th scope="row">
                <a href={href(p.noteId)} class="people-table-name" data-testid="person-row">
                  <PersonAvatar name={p.title} photo={p.profile.photo} size={28} />
                  {p.title || 'Untitled person'}
                </a>
              </th>
              <td>{groupsOf(p.tags).map(groupName).join(', ')}</td>
              <td>{p.profile.role}</td>
              <td>{CLOSENESS.find((c) => c.id === p.profile.closeness)?.label ?? ''}</td>
              <td>{sinceLabel(p.lastTalked ?? p.profile.lastTalked, today)}</td>
              <td>{birthdayLabel(p.profile.birthday)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
