import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../api.js';

// People are ordinary shared note pages, not a second contacts database.
export function PeopleView() {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('05-people');
  const [groups, setGroups] = useState([]);
  const [notes, setNotes] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const run = useRef(0);
  const load = async (offset, mine) => {
    try {
      const result = await api.notes({ tag: group, sub: true, q: q.trim(), sort: 'title', limit: 100, offset });
      if (mine !== run.current) return;
      setNotes((old) => offset ? [...old, ...result.notes] : result.notes);
      setHasMore(result.hasMore); setError(null);
    } catch (e) { if (mine === run.current) setError(e.message); }
    finally { if (mine === run.current) setLoading(false); }
  };
  useEffect(() => { api.tags().then((r) => setGroups([...new Set(r.tags.filter((t) => t.path.startsWith('05-people/')).map((t) => t.path.split('/').slice(0, 2).join('/')))].sort())).catch(() => {}); }, []);
  useEffect(() => {
    const mine = ++run.current;
    setNotes([]); setLoading(true); setHasMore(false);
    const timer = setTimeout(() => load(0, mine), q ? 250 : 0);
    return () => { clearTimeout(timer); ++run.current; };
  }, [q, group]);
  const groupName = (path) => path.slice('05-people/'.length).split('-').map((word) => word === 'css' ? 'CSS' : word[0].toUpperCase() + word.slice(1)).join(' ');
  const initials = (title) => title.trim().split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0]).join('').toUpperCase();
  const cue = (note) => {
    const preview = note.preview?.startsWith(`${note.title} · `) ? note.preview.slice(note.title.length + 3) : note.preview;
    return (preview || '').replace(/\[![^\]]+\]\s*/g, '').split(' · ')[0];
  };
  return <section data-testid="people-page">
    <p class="muted small">{loading ? 'Loading people…' : `${notes.length}${hasMore ? '+' : ''} people notes`} · Open a card to read or edit.</p>
    <a class="btn primary block" href="#/new?tag=05-people">New person note</a>
    <div class="notes-filters"><input type="search" aria-label="Search people" placeholder="Search people" value={q} onInput={(e) => setQ(e.currentTarget.value)} /></div>
    <nav class="people-filters" aria-label="People groups"><button class="btn" aria-pressed={group === '05-people'} onClick={() => setGroup('05-people')}>Everyone</button>{groups.map((path) => <button key={path} class="btn" aria-pressed={group === path} onClick={() => setGroup(path)}>{groupName(path)}</button>)}</nav>
    {error && <div class="banner error" role="alert">{error}<button class="btn" onClick={() => { setLoading(true); load(0, ++run.current); }}>Retry</button></div>}
    {loading && <p class="muted">Loading…</p>}
    {!loading && !error && !notes.length && <p class="muted">{q ? 'No people match.' : 'No people notes yet.'}</p>}
    <ul class="people-cards">{notes.map((note) => <li key={note.id}><a class="person-card" href={`#/n/${note.id}`} data-testid="person-note">
      <span class="person-initials" aria-hidden="true">{initials(note.title || '?')}</span><span class="person-summary"><span class="note-title">{note.title || 'Untitled person note'}</span>{cue(note) && <span class="note-preview">{cue(note)}</span>}<span class="person-groups">{[...new Set(note.tags.filter((tag) => tag.path.startsWith('05-people/')).map((tag) => tag.path.split('/').slice(0, 2).join('/')))].map((path) => <span key={path} class="task-chip">{groupName(path)}</span>)}</span></span>
    </a></li>)}</ul>
    {hasMore && <button class="btn block" disabled={loading} onClick={() => { setLoading(true); load(notes.length, run.current); }} data-testid="people-more">Load more</button>}
  </section>;
}
