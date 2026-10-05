import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { api, ApiError } from '../api.js';
import { sync } from '../sync.js';
import { go, useSession, useToday } from '../hooks.js';
import { NoteCard } from './Stream.jsx';
import { EditorBar } from './EditorBar.jsx';

/**
 * One note on its own page (#/n/<id>): the same editor, status and menu as in a stream, nothing else.
 * It uses the same save session as the stream, so the two never disagree about what is saved.
 */
export function NoteView({ id, config }) {
  useSession();
  const today = useToday(config.tz);
  const [state, setState] = useState({ status: 'loading', error: null });
  const [editor, setEditor] = useState(null);
  const [, refresh] = useState(0);
  const lastTag = useRef(null);

  const load = useCallback(async () => {
    try {
      await sync.ready;
      try {
        const { note } = await api.getNote(id);
        if (note.deletedAt && !sync.get(id)?.hasUnsaved) return setState({ status: 'trashed', error: null });
        sync.adopt(note);
      } catch (err) {
        // A note that exists only on this phone so far (not saved on the server yet) has no server copy.
        if (!(err instanceof ApiError && err.status === 404 && sync.get(id))) throw err;
      }
      setState({ status: 'ready', error: null });
    } catch (err) {
      setState({ status: err instanceof ApiError && err.status === 404 ? 'missing' : 'error', error: err.message });
    }
  }, [id]);

  useEffect(() => {
    setState({ status: 'loading', error: null });
    load();
  }, [id]);

  const session = sync.get(id);
  if (session?.tags[0]) lastTag.current = session.tags[0];

  // Deleted or discarded from the menu: go back to where it lived. Anything else: refresh.
  const changed = () => {
    const s = sync.get(id);
    if (!s || s.discarded) return go(lastTag.current ? `/t/${lastTag.current}` : '/');
    refresh((n) => n + 1);
    load();
  };

  return (
    <div class="stream note-page" data-testid="note-page" data-note-id={id}>
      {state.status === 'loading' && <p class="muted center">Loading…</p>}
      {state.status === 'error' && (
        <div class="banner error" role="alert" data-testid="load-error">
          <span>Can’t reach the server: {state.error}. Text already typed on this phone is safe.</span>
          <button type="button" class="btn" onClick={load}>
            Retry
          </button>
        </div>
      )}
      {state.status === 'missing' && (
        <p class="muted center" data-testid="note-missing">
          This note does not exist (the link may be old). <a href="#/">Back to all streams</a>
        </p>
      )}
      {state.status === 'trashed' && (
        <p class="muted center" data-testid="note-trashed">
          This note is in the trash. <a href="#/trash">Open the trash</a> to restore it.
        </p>
      )}
      {state.status === 'ready' && session && !session.discarded && (
        <>
          <NoteCard session={session} tag={null} today={today} active standalone onChanged={changed} onEditor={setEditor} />
          <div class="toolbar-spacer" />
          <EditorBar editor={editor} noteDate={session.date} today={today} />
        </>
      )}
    </div>
  );
}
