import { useEffect, useState } from 'preact/hooks';
import { api, ApiError } from '../api.js';
import { normalizeTag } from '../../../shared/tags.js';
import { renderDoc } from '../editor/render.js';
import { Sheet } from './parts.jsx';
import { sync } from '../sync.js';

const KIND_LABEL = {
  auto: 'Earlier version',
  guard: 'Before a large deletion',
  conflict: 'Conflicting version kept',
  import: 'From an import',
  restore: 'Before a restore',
};

const when = (iso) => new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });

async function settle(session) {
  // Make sure everything typed so far has reached the server before a server-side action.
  session.captureNow({ schedule: false });
  if (session.revision === 0 && !session.pending) return;
  await session.flush();
  if (session.hasUnsaved) throw new Error('Some changes are not saved on the server yet (see the status). Try again once they are.');
}

export function NoteMenu({ session, tag, standalone, onClose, onTagsChanged, onDeleted, onRestored }) {
  const [view, setView] = useState('main');
  return (
    <Sheet title={{ main: 'Note options', tags: 'Tags', history: 'History', delete: 'Delete note' }[view]} onClose={onClose}>
      {view === 'main' && (
        <div class="menu-list">
          {!standalone && session.revision > 0 && (
            <a class="menu-item" href={`#/n/${session.id}`} data-testid="menu-open">
              Open on its own page
            </a>
          )}
          <button type="button" class="menu-item" data-testid="menu-tags" onClick={() => setView('tags')}>
            Tags…
          </button>
          <button type="button" class="menu-item" data-testid="menu-history" onClick={() => setView('history')} disabled={session.revision === 0}>
            History…
          </button>
          <button type="button" class="menu-item danger" data-testid="menu-delete" onClick={() => setView('delete')}>
            Move to trash…
          </button>
        </div>
      )}
      {view === 'tags' && <TagsPane session={session} tag={tag} onTagsChanged={onTagsChanged} />}
      {view === 'history' && <HistoryPane session={session} onRestored={onRestored} onClose={onClose} />}
      {view === 'delete' && <DeletePane session={session} onDeleted={onDeleted} onClose={onClose} />}
    </Sheet>
  );
}

function TagsPane({ session, tag, onTagsChanged }) {
  const [tags, setTags] = useState(null);
  const [all, setAll] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const saved = session.revision > 0;

  useEffect(() => {
    api.tags().then((r) => setAll(r.tags)).catch(() => {});
    if (saved) api.getNote(session.id).then((r) => setTags(r.note.tags)).catch((e) => setError(e.message));
    else setTags(session.tags.map((p) => ({ id: null, path: p })));
  }, []);

  const change = async (fn) => {
    setError(null);
    try {
      const res = await fn();
      setTags(res.tags);
      session.tags = res.tags.map((t) => t.path);
      onTagsChanged(res.tags);
    } catch (err) {
      setError(err instanceof ApiError || err.message ? err.message : String(err));
    }
  };

  if (!saved) {
    return <p class="muted">Tags can be changed once the note has been saved on the server.</p>;
  }

  const add = (e) => {
    e.preventDefault();
    const path = normalizeTag(text);
    if (!path) return setError('Tag names use letters, numbers, - _ . and / for sub-tags.');
    change(() => api.addTag(session.id, path)).then(() => setText(''));
  };

  return (
    <div>
      <p class="muted">This is one page: editing it through any of its tags edits the same note.</p>
      <ul class="chips" data-testid="note-tags">
        {(tags ?? []).map((t) => (
          <li key={t.path} class="chip">
            <span>{t.path}</span>
            {tags.length > 1 && (
              <button type="button" aria-label={`Remove tag ${t.path}`} onClick={() => change(() => api.removeTag(session.id, t.id))}>
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={add} class="row">
        <input
          type="text"
          list="all-tags"
          value={text}
          onInput={(e) => setText(e.currentTarget.value)}
          placeholder="Add a tag, e.g. school/fall26"
          aria-label="Add a tag"
          autocapitalize="none"
          autocomplete="off"
          data-testid="add-tag-input"
        />
        <datalist id="all-tags">
          {all.filter((t) => !(tags ?? []).some((x) => x.path === t.path)).map((t) => <option key={t.id} value={t.path} />)}
        </datalist>
        <button type="submit" class="btn" data-testid="add-tag-button">
          Add
        </button>
      </form>
      {error && <p class="error" role="alert">{error}</p>}
    </div>
  );
}

function HistoryPane({ session, onRestored, onClose }) {
  const [versions, setVersions] = useState(null);
  const [open, setOpen] = useState(null); // { version, html }
  const [error, setError] = useState(null);

  useEffect(() => {
    api.versions(session.id).then((r) => setVersions(r.versions)).catch((e) => setError(e.message));
  }, []);

  const show = async (v) => {
    try {
      const { version } = await api.version(session.id, v.id);
      setOpen({ meta: v, version, html: renderDoc(version.doc) });
    } catch (e) {
      setError(e.message);
    }
  };

  const restore = async () => {
    setError(null);
    try {
      await settle(session);
      const { note } = await api.restoreVersion(session.id, open.meta.id);
      session.applyServerNote(note);
      onRestored();
      onClose();
    } catch (e) {
      setError(e.message);
    }
  };

  if (open) {
    return (
      <div>
        <p class="muted">
          {KIND_LABEL[open.meta.kind] ?? open.meta.kind} · {when(open.meta.createdAt)}
        </p>
        <div class="static version-preview" dangerouslySetInnerHTML={{ __html: open.html }} />
        <div class="row">
          <button type="button" class="btn primary" data-testid="restore-version" onClick={restore}>
            Restore this version
          </button>
          <button type="button" class="btn" onClick={() => setOpen(null)}>
            Back
          </button>
        </div>
        <p class="muted">The current text is kept in History, so restoring can be undone.</p>
        {error && <p class="error" role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      {error && <p class="error" role="alert">{error}</p>}
      {versions === null && !error && <p class="muted">Loading…</p>}
      {versions?.length === 0 && <p class="muted">No earlier versions yet. They are kept automatically as you write.</p>}
      <ul class="version-list" data-testid="version-list">
        {versions?.map((v) => (
          <li key={v.id}>
            <button type="button" class="menu-item" data-kind={v.kind} onClick={() => show(v)}>
              <span class="v-meta">
                {when(v.createdAt)} · {KIND_LABEL[v.kind] ?? v.kind}
              </span>
              <span class="v-preview">{v.preview || '(empty)'}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DeletePane({ session, onDeleted, onClose }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const unsent = session.revision === 0;

  const del = async () => {
    setBusy(true);
    setError(null);
    try {
      if (unsent) {
        session.discardUnsaved();
      } else {
        await settle(session);
        await api.deleteNote(session.id);
        sync.forget(session);
      }
      onDeleted();
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div>
      <p>
        {unsent
          ? 'This note has not been saved on the server yet. Deleting it discards the text on this phone.'
          : 'The note moves to the trash, where it can be restored for a limited time. It disappears from all of its tags.'}
      </p>
      <div class="row">
        <button type="button" class="btn danger" disabled={busy} data-testid="confirm-delete" onClick={del}>
          {unsent ? 'Discard note' : 'Move to trash'}
        </button>
        <button type="button" class="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
      {error && <p class="error" role="alert">{error}</p>}
    </div>
  );
}
