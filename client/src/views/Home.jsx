import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.js';
import { go } from '../hooks.js';
import { normalizeTag } from '../../../shared/tags.js';
import { formatDateShort } from '../../../shared/dates.js';

export function HomeView() {
  const [tags, setTags] = useState(null);
  const [error, setError] = useState(null);
  const [text, setText] = useState('');
  const [formError, setFormError] = useState(null);

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
    <li key={t.id} class="tag-item">
      <a class="tag-row" href={`#/t/${encodeURIComponent(t.path).replaceAll('%2F', '/')}`} data-testid="tag-link">
        <span class="tag-name">{t.path}</span>
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

  const favorites = tags?.filter((t) => t.favorite) ?? [];

  const open = async (e) => {
    e.preventDefault();
    const path = normalizeTag(text);
    if (!path) return setFormError('Tag names use letters, numbers, - _ . and / for sub-tags, e.g. school/fall26.');
    setFormError(null);
    go(`/t/${path}`); // opening a stream creates no note; the tag is stored with its first note
  };

  return (
    <div class="home">
      {favorites.length > 0 && (
        <>
          <h2 class="section">Favorites</h2>
          <ul class="tag-list" data-testid="favorite-list">
            {favorites.map(row)}
          </ul>
        </>
      )}
      <h2 class="section">Daily-note streams</h2>
      {error && (
        <div class="banner error" role="alert">
          <span>Can’t reach the server: {error}</span>
          <button type="button" class="btn" onClick={load}>
            Retry
          </button>
        </div>
      )}
      {tags && tags.length === 0 && <p class="muted">No tags yet. Open one below, e.g. “daily-jots”.</p>}
      <ul class="tag-list" data-testid="tag-list">
        {tags?.map(row)}
      </ul>

      <form class="row open-tag" onSubmit={open}>
        <input
          type="text"
          value={text}
          onInput={(e) => setText(e.currentTarget.value)}
          placeholder="Open or start a tag, e.g. daily-jots"
          aria-label="Tag to open"
          autocapitalize="none"
          autocomplete="off"
          enterkeyhint="go"
          data-testid="open-tag-input"
        />
        <button type="submit" class="btn primary" data-testid="open-tag-button">
          Open
        </button>
      </form>
      {formError && <p class="error" role="alert">{formError}</p>}

      <nav class="footer-links">
        <a href="#/trash">Trash</a>
        <a href="#/data">Data &amp; backups</a>
      </nav>
    </div>
  );
}
