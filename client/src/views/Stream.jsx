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
import { TagEditor } from './TagEditor.jsx';
import { DateMenu, HideMenu, PriorityMenu } from './TaskMenus.jsx';
import { extractTasks } from '../../../shared/tasks.js';
import { TaskArchive } from './TaskArchive.jsx';

const isEditingNow = () => !!document.activeElement?.closest?.('.note-text');

// The name of a free note, editable on its own page. Typing goes through the note's save session, like the text.
function NoteTitle({ session }) {
  const ref = useRef(null);
  // A brand-new note asks for its name first (Enter moves on to the text).
  const fresh = useRef(session.revision === 0 && !session.title && !session.pending);
  useEffect(() => {
    if (fresh.current) ref.current?.focus();
  }, []);
  return (
    <input
      ref={ref}
      class="note-title-input"
      type="text"
      defaultValue={session.title ?? ''}
      placeholder="Untitled"
      aria-label="Note title"
      maxLength={120}
      autocomplete="off"
      enterkeyhint="next"
      data-testid="note-title"
      onInput={(e) => session.editTitle(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        document.querySelector('.note-page .note-text[contenteditable="true"]')?.focus();
      }}
    />
  );
}

// One note: its date, tags, status panels and either the live editor or a read-only view. `tag` is the
// stream it is shown in (null on its own page); `standalone` marks the own-page case.
export function NoteCard({ session, tag, today, tz = 'America/Edmonton', active, onActivate, onChanged, onEditor, focusRequest, standalone }) {
  useSession(session);
  const [menu, setMenu] = useState(false);
  const [problem, setProblem] = useState(null);
  const [taskMenu, setTaskMenu] = useState(null); // { kind: 'hide' | 'date' | 'priority', taskId }: a task button's menu
  const openTaskMenu = useCallback((kind, taskId) => setTaskMenu({ kind, taskId }), []);
  const label = formatDateLabel(session.date, today);
  const weekday = label === 'Today' || label === 'Yesterday' ? formatDateShort(session.date) : null;
  const html = useMemo(
    () => (active ? '' : renderDoc(session.currentDoc(), { today, noteDate: session.date })),
    [session.pending, session.serverDoc, session.generation, active, today],
  );
  const otherTags = session.tags.filter((t) => t !== tag);
  // The heading is a link to the note's own page, except there or while it is not on the server yet.
  const link = (text) =>
    standalone || session.revision === 0 ? (
      text
    ) : (
      <a class="note-date-link" href={`#/n/${session.id}`} data-testid="open-note" aria-label={`Open ${text} on its own page`}>
        {text}
      </a>
    );
  const empty = !session.currentDoc().content?.some((n) => n.content?.length);

  const activate = (e) => {
    if (e.target.closest?.('a.wiki-link')) return;
    // One of a task's round buttons (hide / due / priority): open its menu, without waking the editor.
    const taskButton = e.target.closest?.('[data-task-action]');
    if (taskButton) {
      e.preventDefault();
      openTaskMenu(taskButton.dataset.taskAction, taskButton.dataset.taskId);
      return;
    }
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
          {/* a free note in a stream is known by its name; everything else by its date */}
          {link(session.kind === 'note' && !standalone ? session.title || 'Untitled' : label)}
          {session.kind === 'note' && !standalone ? (
            <span class="note-date-sub">{label}</span>
          ) : (
            weekday && <span class="note-date-sub">{weekday}</span>
          )}
          {session.kind === 'note' && <span class="note-kind">note</span>}
        </h2>
        <button type="button" class="icon-btn" aria-label="Note options" data-testid="note-menu" onClick={() => setMenu(true)}>
          ⋯
        </button>
      </header>
      {standalone && session.kind === 'note' && <NoteTitle key={`title:${session.id}:${session.generation}`} session={session} />}
      {standalone && <TagEditor session={session} />}
      {!standalone && otherTags.length > 0 && (
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
        <NoteEditor key={`${session.id}:${session.generation}`} session={session} focusRequest={focusRequest} onEditor={onEditor} onProblem={setProblem} today={today} onTaskAction={openTaskMenu} />
      ) : (
        <div
          class={`static note-text${empty ? ' is-empty' : ''}`}
          data-testid="note-static"
          onClick={activate}
          dangerouslySetInnerHTML={{ __html: empty ? '<p class="placeholder">Empty note. Tap to write.</p>' : html }}
        />
      )}
      <TaskArchive doc={session.currentDoc()} noteDate={session.date} today={today} tz={tz} onPatch={(taskId, patch) => session.applyTaskPatch(taskId, patch)} onReactivate={(taskId) => session.applyTaskPatch(taskId, { checked: false, dismissedAt: null, completedAt: null })} />
      {taskMenu && (() => {
        const t = extractTasks(session.currentDoc(), session.date).find((x) => x.id === taskMenu.taskId);
        if (!t) return null;
        const close = () => setTaskMenu(null);
        const pick = (patch) => session.applyTaskPatch(t.id, patch);
        if (taskMenu.kind === 'date') return <DateMenu today={today} due={t.dueFrom === 'set' ? t.due : null} start={t.startFrom === 'set' ? t.start : null} onPick={pick} onClose={close} />;
        if (taskMenu.kind === 'hide') return <HideMenu today={today} hidden={t.hidden} hideUntil={t.hideUntil} onPick={pick} onClose={close} />;
        return <PriorityMenu value={t.priority} onPick={pick} onClose={close} />;
      })()}
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
  const [load, setLoad] = useState({ status: 'loading', notes: [], hasMore: false, error: null, daily: true, tagId: null });
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
      setLoad({ status: 'ready', notes: res.notes.map((n) => n.id), hasMore: res.hasMore, error: null, daily: res.tag.daily, tagId: res.tag.id });
    } catch (err) {
      if (mine === generation.current) setLoad((l) => ({ ...l, status: 'error', error: err.message }));
    }
  }, [tag]);

  useEffect(() => {
    setLoad({ status: 'loading', notes: [], hasMore: false, error: null, daily: true, tagId: null });
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
    // A tag with its daily entry switched off shows only the notes written in it (and any daily entries it already has).
    const existingToday = [...byId.values()].find((s) => s.date === shownToday && s.kind === 'daily');
    const todaySession = existingToday ?? (load.daily ? sync.draft(tag, shownToday) : null);
    if (todaySession) byId.set(todaySession.id, todaySession);
    // Newest day first; within a day the daily entry, then free notes newest first.
    const rank = (x) => (x.kind === 'daily' ? 0 : 1);
    return [...byId.values()].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
    });
  })();
  // Remember which sessions were created for this stream so they stay listed after saving.
  entries.forEach((s) => (s.drafted = true));

  const todayEntry = entries.find((s) => s.date === shownToday && s.kind === 'daily');
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

  // Switch the daily entry for this tag on or off (a tag that has no notes yet is created first).
  const toggleDaily = async () => {
    const next = !load.daily;
    setLoad((l) => ({ ...l, daily: next }));
    try {
      let id = load.tagId;
      if (!id) id = (await api.createTag(tag)).tag.id;
      await api.setDaily(id, next);
      setLoad((l) => ({ ...l, tagId: id }));
    } catch (err) {
      setLoad((l) => ({ ...l, daily: !next, error: err.message }));
    }
  };

  const newNoteButton = (
    <a class="btn block" href={`#/new?tag=${encodeURIComponent(tag).replaceAll('%2F', '/')}`} data-testid="new-note-here">
      New note in “{tag}”
    </a>
  );

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
      {!load.daily && newNoteButton}
      {entries.map((s) => (
        <NoteCard
          key={s.id}
          session={s}
          tag={tag}
          today={today}
          tz={config.tz}
          active={s.id === effectiveActive}
          focusRequest={s.id === effectiveActive ? focusRequest : null}
          onActivate={activate}
          onChanged={changed}
          onEditor={s.id === effectiveActive ? setEditor : undefined}
        />
      ))}
      {load.daily && newNoteButton}
      {load.hasMore && (
        <button type="button" class="btn block" data-testid="load-older" onClick={loadMore}>
          Load older notes
        </button>
      )}
      {load.status === 'ready' && !load.hasMore && load.daily && entries.length <= 1 && (
        <p class="muted center">Notes you write here are saved by day under “{tag}”.</p>
      )}
      {load.status === 'ready' && !load.daily && entries.length === 0 && (
        <p class="muted center" data-testid="no-notes">
          No notes in “{tag}” yet.
        </p>
      )}
      {load.status === 'ready' && (
        <label class="check-row small daily-toggle">
          <input type="checkbox" checked={load.daily} onChange={toggleDaily} data-testid="daily-toggle" />
          <span>Show an entry for today in “{tag}” (turn off for a topic you only write notes in)</span>
        </label>
      )}
      <div class="toolbar-spacer" />
      <EditorBar editor={editor} noteDate={sync.get(effectiveActive)?.date} today={today} />
    </div>
  );
}
