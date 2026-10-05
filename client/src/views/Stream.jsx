import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { api } from '../api.js';
import { sync } from '../sync.js';
import { useSession, useToday } from '../hooks.js';
import { formatDateLabel, formatDateShort } from '../../../shared/dates.js';
import { NoteEditor } from '../editor/NoteEditor.jsx';
import { renderDoc } from '../editor/render.js';
import { ConflictPanel } from './parts.jsx';
import { NoteMenu } from './NoteMenu.jsx';
import { EditorBar } from './EditorBar.jsx';

const isEditingNow = () => !!document.activeElement?.closest?.('.note-text');

// One note: its date, tags, status panels and either the live editor or a read-only view. `tag` is the
// stream it is shown in (null on its own page); `standalone` marks the own-page case.
export function NoteCard({ session, tag, today, active, onActivate, onChanged, onEditor, focusRequest, standalone }) {
  useSession(session);
  const [menu, setMenu] = useState(false);
  const [problem, setProblem] = useState(null);
  const label = formatDateLabel(session.date, today);
  const weekday = label === 'Today' || label === 'Yesterday' ? formatDateShort(session.date) : null;
  const html = useMemo(() => (active ? '' : renderDoc(session.currentDoc())), [session.pending, session.serverDoc, session.generation, active]);
  const otherTags = session.tags.filter((t) => t !== tag);
  const empty = !session.currentDoc().content?.some((n) => n.content?.length);

  const activate = (e) => {
    const checkbox = e.target.closest?.('input[type="checkbox"]');
    if (checkbox) {
      e.preventDefault(); // the editor performs the (undoable) toggle once mounted
      onActivate(session.id, { taskId: e.target.closest('li')?.dataset.taskId });
    } else {
      // Remember where in the text the tap landed (not the screen position: the layout can shift
      // when the previously active editor closes).
      let textOffset = null;
      const hit = !empty && document.caretRangeFromPoint?.(e.clientX, e.clientY);
      if (hit && e.currentTarget.contains(hit.startContainer)) {
        const r = document.createRange();
        r.selectNodeContents(e.currentTarget);
        r.setEnd(hit.startContainer, hit.startOffset);
        textOffset = r.toString().length;
      }
      onActivate(session.id, { textOffset });
    }
  };

  return (
    <article class="note" data-testid="note" data-note-id={session.id} data-date={session.date} data-active={active}>
      <header class="note-head">
        <h2 class="note-date">
          {standalone || session.revision === 0 ? (
            label
          ) : (
            <a class="note-date-link" href={`#/n/${session.id}`} data-testid="open-note" aria-label={`Open ${label} on its own page`}>
              {label}
            </a>
          )}
          {weekday && <span class="note-date-sub">{weekday}</span>}
        </h2>
        <button type="button" class="icon-btn" aria-label="Note options" data-testid="note-menu" onClick={() => setMenu(true)}>
          ⋯
        </button>
      </header>
      {otherTags.length > 0 && (
        <ul class="chips small" aria-label="Also tagged">
          {otherTags.map((t) => (
            <li key={t} class="chip">
              <a href={`#/t/${encodeURIComponent(t).replaceAll('%2F', '/')}`}>{t}</a>
            </li>
          ))}
        </ul>
      )}
      {session.conflict && <ConflictPanel session={session} onResolved={onChanged} />}
      {session.error?.kind === 'server' && !session.conflict && (
        <p class="error inline" role="alert">
          The server rejected the save ({session.error.message}). Your text is kept on this phone and will be retried.{' '}
          <button type="button" class="link" onClick={() => session.retryNow()}>
            Retry now
          </button>
        </p>
      )}
      {problem && <p class="error inline" role="alert">{problem}</p>}
      {active ? (
        <NoteEditor key={`${session.id}:${session.generation}`} session={session} focusRequest={focusRequest} onEditor={onEditor} onProblem={setProblem} />
      ) : (
        <div
          class={`static note-text${empty ? ' is-empty' : ''}`}
          data-testid="note-static"
          onClick={activate}
          dangerouslySetInnerHTML={{ __html: empty ? '<p class="placeholder">Empty note. Tap to write.</p>' : html }}
        />
      )}
      {menu && (
        <NoteMenu
          session={session}
          tag={tag}
          standalone={standalone}
          onClose={() => setMenu(false)}
          onTagsChanged={(tags) => {
            if (!tag || !tags.some((t) => t.path === tag)) onChanged();
          }}
          onDeleted={onChanged}
          onRestored={onChanged}
        />
      )}
    </article>
  );
}

export function StreamView({ tag, config }) {
  useSession(); // any session change (save status, new unsent notes)
  const today = useToday(config.tz);
  const [shownToday, setShownToday] = useState(today);
  const [newDay, setNewDay] = useState(false);
  const [load, setLoad] = useState({ status: 'loading', notes: [], hasMore: false, error: null });
  const [activeId, setActiveId] = useState(null);
  const [focusRequest, setFocusRequest] = useState(null);
  const [editor, setEditor] = useState(null);
  const [, refresh] = useState(0);
  const generation = useRef(0);

  // Crossing midnight never moves or interrupts writing: if the keyboard is up in a
  // note, only offer the new day; otherwise show it right away.
  useEffect(() => {
    if (today === shownToday) return;
    if (isEditingNow()) setNewDay(true);
    else setShownToday(today);
  }, [today]);

  const fetchFirst = useCallback(async () => {
    const mine = ++generation.current;
    setLoad((l) => ({ ...l, status: l.notes.length ? 'ready' : 'loading', error: null }));
    try {
      await sync.ready;
      const res = await api.stream(tag);
      if (mine !== generation.current) return;
      res.notes.forEach((n) => sync.adopt(n));
      setLoad({ status: 'ready', notes: res.notes.map((n) => n.id), hasMore: res.hasMore, error: null });
    } catch (err) {
      if (mine === generation.current) setLoad((l) => ({ ...l, status: 'error', error: err.message }));
    }
  }, [tag]);

  useEffect(() => {
    setLoad({ status: 'loading', notes: [], hasMore: false, error: null });
    setActiveId(null);
    fetchFirst();
  }, [tag]);

  const loadMore = async () => {
    const last = sync.get(load.notes[load.notes.length - 1]);
    try {
      const res = await api.stream(tag, last.date);
      res.notes.forEach((n) => sync.adopt(n));
      setLoad((l) => ({ ...l, notes: [...l.notes, ...res.notes.map((n) => n.id)], hasMore: res.hasMore }));
    } catch (err) {
      setLoad((l) => ({ ...l, error: err.message }));
    }
  };

  // Everything shown, newest first: notes from the server, plus notes of this tag created
  // or edited on this phone in the loaded date range, plus today's (possibly empty) entry.
  const entries = (() => {
    if (load.status === 'loading') return [];
    const byId = new Map();
    for (const id of load.notes) {
      const s = sync.get(id);
      if (s && s.tags.includes(tag) && !s.discarded) byId.set(id, s);
    }
    const oldest = load.notes.length ? sync.get(load.notes[load.notes.length - 1])?.date : null;
    for (const s of sync.sessions.values()) {
      if (byId.has(s.id) || s.discarded || !s.tags.includes(tag)) continue;
      const touched = s.revision === 0 ? !!s.pending : true;
      const inWindow = !load.hasMore || (oldest && s.date >= oldest);
      if (touched && inWindow && (s.pending || s.drafted)) byId.set(s.id, s);
    }
    const todaySession = [...byId.values()].find((s) => s.date === shownToday) ?? sync.draft(tag, shownToday);
    byId.set(todaySession.id, todaySession);
    return [...byId.values()].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
  })();
  // Remember which sessions were created for this stream so they stay listed after saving.
  entries.forEach((s) => (s.drafted = true));

  const todayEntry = entries.find((s) => s.date === shownToday);
  const effectiveActive = activeId ?? todayEntry?.id;

  const activate = (id, req) => {
    setActiveId(id);
    setFocusRequest(req ? { ...req, n: Date.now() } : null);
  };

  const startNewDay = () => {
    setShownToday(today);
    setNewDay(false);
    const s = sync.draft(tag, today);
    activate(s.id, {});
  };

  const changed = () => {
    refresh((n) => n + 1);
    fetchFirst();
  };

  return (
    <div class="stream" data-testid="stream" data-tag={tag}>
      {newDay && (
        <div class="banner" role="status">
          <span>It is now {formatDateShort(today)}.</span>
          <button type="button" class="btn" data-testid="new-day" onClick={startNewDay}>
            Start today’s note
          </button>
        </div>
      )}
      {load.status === 'error' && (
        <div class="banner error" role="alert" data-testid="load-error">
          <span>Can’t reach the server: {load.error}. Text already typed on this phone is safe.</span>
          <button type="button" class="btn" onClick={fetchFirst}>
            Retry
          </button>
        </div>
      )}
      {load.status === 'loading' && <p class="muted center">Loading…</p>}
      {entries.map((s) => (
        <NoteCard
          key={s.id}
          session={s}
          tag={tag}
          today={today}
          active={s.id === effectiveActive}
          focusRequest={s.id === effectiveActive ? focusRequest : null}
          onActivate={activate}
          onChanged={changed}
          onEditor={s.id === effectiveActive ? setEditor : undefined}
        />
      ))}
      {load.hasMore && (
        <button type="button" class="btn block" data-testid="load-older" onClick={loadMore}>
          Load older notes
        </button>
      )}
      {load.status === 'ready' && !load.hasMore && entries.length <= 1 && (
        <p class="muted center">Notes you write here are saved by day under “{tag}”.</p>
      )}
      <div class="toolbar-spacer" />
      <EditorBar editor={editor} noteDate={sync.get(effectiveActive)?.date} today={today} />
    </div>
  );
}
