import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../api.js';
import { formatDateShort } from '../../../shared/dates.js';
import { tagFolders, folderLabel, folderPathLabel } from '../tag-folders.js';

const PAGE = 30;
const FILTER_KEY = 'gordonite-notes-browser';
function savedFilter() {
  try { return JSON.parse(sessionStorage.getItem(FILTER_KEY)) || {}; } catch { return {}; }
}

function FolderBranch({ folder, selected, choose }) {
  const button = <button type="button" class="folder-select" aria-current={selected === folder.path ? 'true' : undefined} onClick={() => choose(folder.path)} data-folder={folder.path}>
    <span aria-hidden="true">▱</span><span>{folder.children.length ? `All in ${folderLabel(folder.name)}` : folderLabel(folder.name)}</span>
  </button>;
  return <li>{folder.children.length ? <details open={selected === folder.path || selected.startsWith(`${folder.path}/`)}>
    <summary><span class="folder-name">{folderLabel(folder.name)}</span></summary>
    {button}
    <ul>{folder.children.map((child) => <FolderBranch key={child.path} folder={child} selected={selected} choose={choose} />)}</ul>
  </details> : button}</li>;
}

/**
 * Every note in one list, most recently changed first: search the words, filter by tag (with or without
 * its sub-tags) or show notes that have no tag yet. Tap one to open it on its own page.
 */
export function NotesView() {
  const [q, setQ] = useState(() => savedFilter().q || '');
  const [tag, setTag] = useState(() => savedFilter().tag || '');
  const [sub, setSub] = useState(() => savedFilter().sub ?? true);
  const [tags, setTags] = useState([]);
  const [tagOrder, setTagOrder] = useState({});
  const [list, setList] = useState({ status: 'loading', notes: [], hasMore: false, error: null });
  const run = useRef(0);
  useEffect(() => {
    try { sessionStorage.setItem(FILTER_KEY, JSON.stringify({ q, tag, sub })); } catch { /* browsing still works */ }
  }, [q, tag, sub]);
  const choose = (path) => { setTag(path); setSub(true); };

  useEffect(() => {
    api.tags().then((r) => { setTags(r.tags); setTagOrder(r.order ?? {}); }).catch(() => {});
  }, []);

  const params = (offset) => ({ q: q.trim(), tag: tag && tag !== '__untagged' ? tag : '', sub: tag && tag !== '__untagged' ? sub : false, untagged: tag === '__untagged', limit: PAGE, offset });

  // Reload from the top whenever the search or the filter changes (typing is debounced).
  useEffect(() => {
    const mine = ++run.current;
    setList({ status: 'loading', notes: [], hasMore: false, error: null });
    const timer = setTimeout(() => {
      api
        .notes(params(0))
        .then((r) => mine === run.current && setList({ status: 'ready', notes: r.notes, hasMore: r.hasMore, error: null }))
        .catch((e) => mine === run.current && setList({ status: 'error', notes: [], hasMore: false, error: e.message }));
    }, q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [q, tag, sub]);

  const more = async () => {
    const mine = run.current;
    try {
      const r = await api.notes(params(list.notes.length));
      if (mine === run.current) setList((l) => ({ ...l, notes: [...l.notes, ...r.notes], hasMore: r.hasMore }));
    } catch (e) {
      setList((l) => ({ ...l, error: e.message }));
    }
  };

  return (
    <div class="notes-page">
      <nav class="notes-sections" aria-label="Notes navigation">
        <span aria-current="page">Folders & notes</span>
        <a class="btn" href="#/tags" data-testid="notes-tags-link">Tags</a>
      </nav>
      <a class="btn primary block" href={tag && tag !== '__untagged' ? `#/new?tag=${encodeURIComponent(tag)}` : '#/new'} data-testid="new-note">
        New note
      </a>
      <div class="notes-browser">
      <nav class="notes-folders" aria-label="Note folders" data-testid="notes-folders">
        <h2>Folders</h2>
        <button type="button" class="folder-select" aria-current={tag === '' ? 'true' : undefined} onClick={() => choose('')}>All notes</button>
        <button type="button" class="folder-select" aria-current={tag === '__untagged' ? 'true' : undefined} onClick={() => choose('__untagged')}>No tag</button>
        <ul>{tagFolders(tags, tagOrder).map((folder) => <FolderBranch key={folder.path} folder={folder} selected={tag} choose={choose} />)}</ul>
        <p class="small muted">Folders follow your tags. A note can appear in more than one folder.</p>
      </nav>
      <section class="notes-results" aria-label="Notes in selected folder" aria-busy={list.status === 'loading'}>
      <h2>{tag === '__untagged' ? 'No tag' : tag ? folderPathLabel(tag) : 'All notes'}</h2>
      <div class="notes-filters">
        <input
          type="search"
          value={q}
          onInput={(e) => setQ(e.currentTarget.value)}
          placeholder="Search notes"
          aria-label="Search notes"
          autocapitalize="none"
          autocomplete="off"
          data-testid="notes-search"
        />
        <select value={tag} onChange={(e) => setTag(e.currentTarget.value)} aria-label="Filter by tag" data-testid="notes-tag-filter">
          <option value="">All notes</option>
          <option value="__untagged">No tag</option>
          {[...new Set(tags.flatMap((t) => t.path.split('/').map((_, i, parts) => parts.slice(0, i + 1).join('/'))))].sort().map((path) => (
            <option key={path} value={path}>
              {folderPathLabel(path)}
            </option>
          ))}
        </select>
      </div>
      {tag && tag !== '__untagged' && (
        <label class="check-row small">
          <input type="checkbox" checked={sub} onChange={(e) => setSub(e.currentTarget.checked)} data-testid="notes-include-sub" />
          <span>Include sub-tags</span>
        </label>
      )}
      {list.error && (
        <div class="banner error" role="alert">
          <span>Can’t reach the server: {list.error}</span>
        </div>
      )}
      {list.status === 'loading' && list.notes.length === 0 && <p class="muted center">Loading…</p>}
      {list.status === 'ready' && list.notes.length === 0 && (
        <p class="muted center" data-testid="notes-empty">
          {q || tag ? 'No notes match.' : 'No notes yet. Tap “New note” to write one.'}
        </p>
      )}
      <ul class="notes-list" data-testid="notes-list">
        {list.notes.map((n) => (
          <li key={n.id}>
            <a class="note-row" href={`#/n/${n.id}`} data-testid="note-row">
              <span class="note-title">{n.title || 'Empty note'}</span>
              {n.preview && <span class="note-preview">{n.preview}</span>}
              <span class="note-meta">
                {formatDateShort(n.date)}
                {n.kind === 'daily' ? ' · daily' : ''}
                {n.tags.length > 0 ? ` · ${n.tags.map((t) => t.path).join(', ')}` : ' · no tag'}
              </span>
            </a>
          </li>
        ))}
      </ul>
      {list.hasMore && (
        <button type="button" class="btn block" onClick={more} data-testid="notes-more">
          Load more
        </button>
      )}
      </section>
      </div>
    </div>
  );
}
