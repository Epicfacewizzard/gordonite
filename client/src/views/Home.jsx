import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.js';
import { normalizeTag } from '../../../shared/tags.js';
import { formatDateShort } from '../../../shared/dates.js';
import { tagFolders, folderLabel } from '../tag-folders.js';

export function HomeView() {
  const [tags, setTags] = useState(null);
  const [error, setError] = useState(null);
  const [text, setText] = useState('');
  const [formError, setFormError] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = () =>
    api
      .tags()
      .then((r) => {
        setTags(r.tags);
        setError(null);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  // Optimistic: flip the star at once, put it back if the server says no.
  const toggleFavorite = async (tag) => {
    const next = !tag.favorite;
    const set = (favorite) => setTags((list) => list.map((t) => (t.id === tag.id ? { ...t, favorite } : t)));
    set(next);
    try {
      await api.setFavorite(tag.id, next);
    } catch (e) {
      set(!next);
      setError(e.message);
    }
  };

  const row = (t) => (
    <li key={t.id} class="tag-item" style={{ paddingLeft: `${Math.min(t.path.split('/').length - 1, 4) * 14}px` }}>
      <a class="tag-row" href={`#/t/${encodeURIComponent(t.path).replaceAll('%2F', '/')}`} data-testid="tag-link">
        <span class="tag-name">
          {t.path.includes('/') && <span class="tag-parent">{t.path.slice(0, t.path.lastIndexOf('/') + 1)}</span>}
          {t.path.slice(t.path.lastIndexOf('/') + 1)}
        </span>
        <span class="tag-meta">
          {t.noteCount} {t.noteCount === 1 ? 'note' : 'notes'}
          {t.lastDate ? ` · last ${formatDateShort(t.lastDate)}` : ''}
        </span>
      </a>
      <button
        type="button"
        class={`star${t.favorite ? ' on' : ''}`}
        onClick={() => toggleFavorite(t)}
        aria-pressed={t.favorite}
        aria-label={t.favorite ? `Remove ${t.path} from favorites` : `Add ${t.path} to favorites`}
        data-testid="tag-star"
      >
        {t.favorite ? '★' : '☆'}
      </button>
    </li>
  );

  const byPath = new Map((tags ?? []).map((t) => [t.path, t]));
  const branch = (folder) => folder.children.length ? <li key={folder.path} class="tag-branch"><details open>
    <summary>{folderLabel(folder.name)}</summary>
    <ul class="tag-list">{byPath.has(folder.path) && row(byPath.get(folder.path))}{folder.children.map(branch)}</ul>
  </details></li> : row(byPath.get(folder.path));

  const open = async (e) => {
    e.preventDefault();
    const path = normalizeTag(text);
    if (!path) return setFormError('Tag names use letters, numbers, - _ . and / for sub-tags, e.g. school/fall26.');
    setFormError(null);
    setCreating(true);
    try { await api.createTag(path); setText(''); load(); }
    catch (e) { setFormError(e.message); }
    finally { setCreating(false); }
  };

  return (
    <div class="home">
      <form class="row open-tag" onSubmit={open}>
        <input type="text" value={text} onInput={(e) => setText(e.currentTarget.value)} placeholder="New tag, e.g. school/fall26" aria-label="Tag to create" autocapitalize="none" autocomplete="off" enterkeyhint="done" data-testid="open-tag-input" />
        <button type="submit" class="btn primary" disabled={creating} data-testid="open-tag-button">{creating ? 'Creating…' : 'Create tag'}</button>
      </form>
      {formError && <p class="error" role="alert">{formError}</p>}
      <p class="small muted">Expand a parent to see its tags. Tap a tag to open it; the star adds it to Today.</p>
      <h2 class="section">Your tags</h2>
      {error && (
        <div class="banner error" role="alert">
          <span>Can’t reach the server: {error}</span>
          <button type="button" class="btn" onClick={load}>
            Retry
          </button>
        </div>
      )}
      {tags && tags.length === 0 && <p class="muted">No tags yet. Create one above, e.g. “daily-jots”.</p>}
      <ul class="tag-list" data-testid="tag-list">
        {tagFolders(tags ?? []).map(branch)}
      </ul>
    </div>
  );
}
