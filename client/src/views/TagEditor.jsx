import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../api.js';
import { useSession } from '../hooks.js';
import { normalizeTag } from '../../../shared/tags.js';

const streamHref = (tag) => `#/t/${encodeURIComponent(tag).replaceAll('%2F', '/')}`;

/**
 * Tags of one note, editable right on its page. A tag is a path: `school` is a tag and
 * `school/fall26/math` is a sub-tag of it. Tapping + on a tag starts a sub-tag under it.
 * A note that is not on the server yet keeps its tags on the phone and sends them with its first save;
 * a saved note changes them on the server straight away.
 */
export function TagEditor({ session, onChanged }) {
  useSession(session);
  const [tags, setTags] = useState(null); // [{ id, path }]; id is null until the note is on the server
  const [all, setAll] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [suggesting, setSuggesting] = useState(false);
  const input = useRef(null);
  const saved = session.revision > 0;
  const busy = session.inFlight !== null; // the first save is in flight: wait until it has landed

  const loadTags = () => {
    if (!saved) return setTags(session.tags.map((path) => ({ id: null, path })));
    api
      .getNote(session.id)
      .then((r) => setTags(r.note.tags))
      .catch((e) => setError(e.message));
  };
  useEffect(() => {
    api.tags().then((r) => setAll(r.tags)).catch(() => {});
  }, []);
  useEffect(loadTags, [saved, session.id]);

  const apply = async (fn) => {
    setError(null);
    try {
      const next = await fn();
      setTags(next);
      onChanged?.(next);
    } catch (e) {
      setError(e.message);
    }
  };

  const add = (e) => {
    e.preventDefault();
    const path = normalizeTag(text);
    if (!path) return setError('Tag names use letters, numbers, - _ . and / for sub-tags, e.g. school/fall26/math.');
    if (tags.some((t) => t.path === path)) {
      setText('');
      return;
    }
    apply(async () => {
      if (saved) {
        const res = await api.addTag(session.id, path);
        session.tags = res.tags.map((t) => t.path);
        return res.tags;
      }
      const next = [...tags, { id: null, path }];
      session.setLocalTags(next.map((t) => t.path));
      return next;
    }).then(() => {
      setText('');
      api.tags().then((r) => setAll(r.tags)).catch(() => {});
    });
  };

  const remove = (tag) =>
    apply(async () => {
      if (saved) {
        const res = await api.removeTag(session.id, tag.id);
        session.tags = res.tags.map((t) => t.path);
        return res.tags;
      }
      const next = tags.filter((t) => t.path !== tag.path);
      session.setLocalTags(next.map((t) => t.path));
      return next;
    });

  const startSub = (tag) => {
    setText(`${tag.path}/`);
    input.current?.focus();
  };

  if (tags === null) return error ? <p class="error" role="alert">{error}</p> : null;
  const suggestions = all.filter((t) => !tags.some((x) => x.path === t.path) && t.path.includes(text.trim().toLowerCase())).slice(0, 6);

  return (
    <div class="tag-editor" data-testid="tag-editor">
      <ul class="chips" data-testid="note-tags">
        {tags.map((t) => (
          <li key={t.path} class="chip" data-testid="note-tag">
            <a href={streamHref(t.path)}>{t.path}</a>
            <button type="button" aria-label={`Add a sub-tag under ${t.path}`} title="Add a sub-tag" disabled={busy} onClick={() => startSub(t)} data-testid="sub-tag">
              +
            </button>
            <button type="button" aria-label={`Remove tag ${t.path}`} disabled={busy} onClick={() => remove(t)} data-testid="remove-tag">
              ×
            </button>
          </li>
        ))}
        {tags.length === 0 && <li class="muted small">No tags yet</li>}
      </ul>
      <form onSubmit={add} class="row tag-add" onFocusCapture={() => setSuggesting(true)} onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setSuggesting(false); }}>
        <input
          ref={input}
          type="text"
          value={text}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') setSuggesting(false); }}
          placeholder="Add a tag…"
          aria-label="Add a tag"
          autocapitalize="none"
          autocomplete="off"
          enterkeyhint="done"
          disabled={busy}
          data-testid="add-tag-input"
        />
        {suggesting && !busy && suggestions.length > 0 && <ul class="tag-suggestions" aria-label="Suggested tags" data-testid="tag-suggestions">{suggestions.map((t) => <li key={t.id}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setText(t.path); setSuggesting(false); input.current?.focus(); }} data-testid="tag-suggestion">{t.path}</button></li>)}</ul>}
        <button type="submit" class="btn" disabled={busy} data-testid="add-tag-button">
          Add
        </button>
      </form>
      {error && <p class="error small" role="alert">{error}</p>}
    </div>
  );
}
