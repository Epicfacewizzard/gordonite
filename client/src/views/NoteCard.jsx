// One note as a card: its date, tags, status panels and either the live editor or a read-only view. A stream, the
// dashboard, an earlier day and a note's own page all show notes with this, so ticking, saving and conflicts behave
// the same everywhere.
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useSession } from '../hooks.js';
import { formatDateLabel, formatDateShort } from '../../../shared/dates.js';
import { NoteEditor } from '../editor/NoteEditor.jsx';
import { renderDoc } from '../editor/render.js';
import { ConflictPanel } from './parts.jsx';
import { NoteMenu } from './NoteMenu.jsx';
import { TagEditor } from './TagEditor.jsx';
import { DateMenu, HideMenu, PriorityMenu } from './TaskMenus.jsx';
import { RepeatMenu } from './TaskRepeat.jsx';
import { extractTasks } from '../../../shared/tasks.js';
import { TaskArchive } from './TaskArchive.jsx';
import { getShiftDismiss } from '../prefs.js';

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
// stream it is shown in (null on its own page); `standalone` marks the own-page case. On its own page, `aboveTitle` and
// `belowTags` add to the top of the page (a person's photo and details, People.jsx).
export function NoteCard({ session, tag, today, tz = 'America/Edmonton', active, onActivate, onChanged, onEditor, focusRequest, standalone, aboveTitle = null, belowTags = null }) {
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
  // A file is a block without text of its own, but it is something written: the note is not empty.
  const empty = !session.currentDoc().content?.some((n) => n.content?.length || n.type === 'attachment');

  const activate = (e) => {
    if (e.target.closest?.('a.wiki-link, a.attachment-open')) return;
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
      const taskId = e.target.closest('li')?.dataset.taskId;
      if (e.shiftKey && taskId && getShiftDismiss()) {
        session.applyTaskPatch(taskId, { dismissedAt: new Date().toISOString() }); // Shift-click dismisses instead
        return;
      }
      onActivate(session.id, { taskId });
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
      {standalone && aboveTitle}
      {standalone && session.kind === 'note' && <NoteTitle key={`title:${session.id}:${session.generation}`} session={session} />}
      {standalone && <TagEditor session={session} />}
      {standalone && belowTags}
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
      {/* Task history belongs to the note itself: streams and the dashboard only show the writing. */}
      {standalone && <TaskArchive doc={session.currentDoc()} noteDate={session.date} today={today} tz={tz} onPatch={(taskId, patch) => session.applyTaskPatch(taskId, patch)} onReactivate={(taskId) => session.applyTaskPatch(taskId, { checked: false, dismissedAt: null, completedAt: null })} />}
      {taskMenu && (() => {
        const t = extractTasks(session.currentDoc(), session.date).find((x) => x.id === taskMenu.taskId);
        if (!t) return null;
        const close = () => setTaskMenu(null);
        const pick = (patch) => session.applyTaskPatch(t.id, patch);
        if (taskMenu.kind === 'date') return <DateMenu today={today} due={t.dueFrom === 'set' ? t.due : null} start={t.startFrom === 'set' ? t.start : null} repeat={t.repeat} onPick={pick} onClose={close} onRepeat={() => setTaskMenu({ ...taskMenu, kind: 'repeat' })} />;
        if (taskMenu.kind === 'repeat') return <RepeatMenu text={t.text} picked={t.repeatFrom === 'set' ? t.repeat : null} due={t.due} today={today} onChange={pick} onClose={close} />;
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
