import { useState } from 'preact/hooks';
import { Sheet } from './parts.jsx';
import { addDays, formatDateShort } from '../../../shared/dates.js';
import { findDatePhrases } from '../../../shared/taskdates.js';
import { PriorityStar } from './TaskMenus.jsx';
import { RepeatEditor, CompletionList } from './TaskRepeat.jsx';
import { repeatZone, findRepeatPhrase } from '../../../shared/repeat.js';
import { useProjects } from '../projects-data.js';
import { usePeople } from './PersonProfile.jsx';
import { AREAS, AREA_LABEL, projectOfNote, waitingLabel } from '../../../shared/projects.js';

/**
 * Which project the task is in, who it is with, and whether it is waiting for their reply (docs/PROJECTS.md). Every
 * change goes straight to onChange, like the rest of the details. `tags` are the note's tags, to name the project the
 * task is in through its note.
 */
function TaskLinks({ values, change, today, tags, uid }) {
  const { projects } = useProjects();
  const { people } = usePeople();
  const fromNote = tags ? projectOfNote(tags, projects) : null;
  const choosable = projects.filter((p) => p.status === 'active' || p.id === values.project);
  const person = people.find((x) => x.noteId === values.person);
  return (
    <>
      <div class="field" data-testid="field-project">
        <label for={`task-project-${uid}`}>Project</label>
        <select id={`task-project-${uid}`} value={values.project ?? ''} onChange={(e) => change({ project: e.currentTarget.value || null })} data-testid="input-project">
          <option value="">{fromNote ? `From its note: ${fromNote.name}` : tags ? 'None (its note is in no project)' : 'From its note'}</option>
          {AREAS.map((area) => {
            const list = choosable.filter((p) => p.area === area);
            return list.length > 0 && (
              <optgroup key={area} label={AREA_LABEL[area]}>
                {list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </optgroup>
            );
          })}
          {values.project && !projects.some((p) => p.id === values.project) && <option value={values.project}>A removed project</option>}
        </select>
      </div>
      <div class="field" data-testid="field-person">
        <label for={`task-person-${uid}`}>With</label>
        <select id={`task-person-${uid}`} value={values.person ?? ''} onChange={(e) => change(e.currentTarget.value ? { person: e.currentTarget.value } : { person: null, waitingSince: null })} data-testid="input-person">
          <option value="">No one</option>
          {people.map((x) => <option key={x.noteId} value={x.noteId}>{x.title}</option>)}
          {values.person && !person && <option value={values.person}>Someone not in People now</option>}
        </select>
        {values.person && (
          <>
            <label class="check-row">
              <input type="checkbox" checked={!!values.waitingSince} onChange={(e) => change({ waitingSince: e.currentTarget.checked ? today : null })} data-testid="input-waiting" />
              <span>Waiting for {person ? person.title : 'their'}{person ? '’s' : ''} reply</span>
            </label>
            {values.waitingSince && (
              <div class="row small">
                <label for={`task-waiting-${uid}`}>Since</label>
                <input id={`task-waiting-${uid}`} type="date" max={today} value={values.waitingSince} onChange={(e) => e.currentTarget.value && change({ waitingSince: e.currentTarget.value })} data-testid="input-waiting-since" />
                <span class="muted">{waitingLabel(values.waitingSince, today)}</span>
                <button type="button" class="btn" onClick={() => change({ waitingSince: null })} data-testid="task-got-reply">Got a reply</button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

/**
 * Everything about one task in one place: when it is due, when it starts, hide until, priority, and hiding it
 * for good. `picked` holds what was chosen by hand; a date typed in the text ("due fri", or a date word at the
 * end) fills in until one is picked. Every change goes straight to onChange (no Save button), so closing never
 * loses anything. Shown inline when a task is expanded in the list, and in a sheet from the editor.
 * `uid` keeps the field ids unique when several are open at once.
 */
export function TaskDetails({ text, noteDate, today, picked, noteId, where, tags = null, uid = 'sheet', onChange, onDone, onDelete, onMove }) {
  const [moveMessage, setMoveMessage] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [values, setValues] = useState({ dueTime: picked.dueTime ?? null, startTime: picked.startTime ?? null, due: picked.due ?? null, start: picked.start ?? null, hidden: !!picked.hidden, hideUntil: picked.hideUntil ?? null, priority: picked.priority ?? null, project: picked.project ?? null, person: picked.person ?? null, waitingSince: picked.waitingSince ?? null });
  const phrases = findDatePhrases(text, noteDate);
  const typed = { due: null, start: null, dueWords: '', startWords: '' };
  for (const p of phrases) {
    if (typed[p.kind]) continue;
    typed[p.kind] = p.date;
    typed[`${p.kind}Time`] = p.time;
    typed[`${p.kind}Words`] = text.slice(p.index, p.index + p.length);
  }

  const change = (patch) => {
    setValues((v) => ({ ...v, ...patch }));
    onChange(patch);
  };

  const field = (key, label) => {
    const effective = values[key] ?? typed[key] ?? '';
    const fromText = !values[key] && typed[key];
    return (
      <div class="field" data-testid={`field-${key}`}>
        <label for={`task-${key}-${uid}`}>{label}</label>
        <div class="row">
          <input id={`task-${key}-${uid}`} type="date" value={effective} onChange={(e) => change({ [key]: e.currentTarget.value || null })} data-testid={`input-${key}`} />
          <button type="button" class="btn" onClick={() => change({ [key]: today })}>
            Today
          </button>
          <button type="button" class="btn" onClick={() => change({ [key]: addDays(today, 1) })}>
            Tomorrow
          </button>
        </div>
        {key !== 'hideUntil' && <div class="row">
          <label for={`task-${key}-time-${uid}`}>Time</label>
          <input id={`task-${key}-time-${uid}`} type="time" value={values[`${key}Time`] ?? typed[`${key}Time`] ?? ''} data-testid={`input-${key}-time`} onChange={(e) => change({ [`${key}Time`]: e.currentTarget.value || null, ...(e.currentTarget.value && !effective ? { [key]: noteDate } : {}) })} />
          {values[`${key}Time`] && <button class="link" onClick={() => change({ [`${key}Time`]: null })}>Clear picked time</button>}
        </div>}
        <div class="row small">
          {fromText && (
            <span class="muted">
              {formatDateShort(typed[key])} · from “{typed[`${key}Words`]}” in the text
            </span>
          )}
          {values[key] && (
            <button type="button" class="link" onClick={() => change({ [key]: null })} data-testid={`clear-${key}`}>
              Clear picked date
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div class="task-details">
      <p class="task-sheet-text">{text}</p>
      {(where || noteId) && (
        <p class="small muted">
          {where}
          {where && noteId && ' · '}
          {noteId && (
            <a href={`#/n/${noteId}`} data-testid="open-task-note">
              Open this task’s note
            </a>
          )}
        </p>
      )}
      <TaskLinks values={values} change={change} today={today} tags={tags} uid={uid} />
      {onMove && <div class="row"><button type="button" class="btn" data-testid="task-move-up" onClick={() => setMoveMessage(onMove(-1) ? null : 'Already first at this level.')}>Move up</button><button type="button" class="btn" data-testid="task-move-down" onClick={() => setMoveMessage(onMove(1) ? null : 'Already last at this level.')}>Move down</button></div>}
      {moveMessage && <p class="small muted" role="status">{moveMessage}</p>}
      {field('due', 'Due')}
      {field('start', 'Starts')}
      {field('hideUntil', 'Hide until')}
      <div class="field" data-testid="field-priority">
        <label>Priority</label>
        <div class="row">
          {[['both', 'Urgent & Important'], ['urgent', 'Urgent'], ['important', 'Important'], [null, 'None']].map(([id, label]) => (
            <button key={label} type="button" class={`btn prio-btn${(values.priority ?? null) === id ? ' on' : ''}`} aria-pressed={(values.priority ?? null) === id} onClick={() => change({ priority: id })} data-testid={`sheet-priority-${id ?? 'none'}`}>
              <span class={`prio prio-${id ?? 'none'}`}>
                <PriorityStar value={id} size={16} />
              </span>
              {label}
            </button>
          ))}
        </div>
      </div>
      <RepeatEditor uid={uid} text={text} picked={picked.repeat ?? null} due={values.due ?? typed.due} today={today} onChange={change} />
      <CompletionList completions={picked.completions ?? []} tz={repeatZone()} repeating={!!(picked.repeat || findRepeatPhrase(text))} onChange={(patch) => { onChange(patch); onDone?.(); }} />
      <label class="check-row">
        <input type="checkbox" checked={values.hidden} onChange={(e) => change({ hidden: e.currentTarget.checked })} data-testid="input-hidden" />
        <span>Hide from the Tasks list (it stays in its note)</span>
      </label>
      <p class="muted small">
        A task is not shown as “to do” before its start date/time. Times use the home timezone in Settings. Typing “due fri” or “starts oct 12” in the task works too, and so does a date word at the end (“… tomorrow”); a date/time picked here wins. Clearing a picked value falls back to the words.
      </p>
      <div class="row">
        <button type="button" class="btn" data-testid="task-dismiss" onClick={() => { change({ dismissedAt: picked.dismissedAt ? null : new Date().toISOString() }); onDone?.(); }}>
          {picked.dismissedAt ? 'Bring back task' : 'Dismiss task'}
        </button>
        {onDelete && <button type="button" class="btn" data-testid="task-delete" onClick={() => setConfirmDelete(true)}>Delete task…</button>}
      </div>
      <p class="small muted">Dismiss keeps the task in its note without marking it completed. Find it under Dismissed in Tasks.</p>
      {confirmDelete && <div class="banner" role="alert">
        <p>Delete this task’s text and any nested items from the note? The previous note version is kept in History.</p>
        <div class="row"><button type="button" class="btn" data-testid="task-delete-cancel" onClick={() => setConfirmDelete(false)}>Cancel</button>
          <button type="button" class="btn danger" data-testid="task-delete-confirm" onClick={() => { onDelete(); onDone?.(); }}>Delete task</button></div>
      </div>}
      <button type="button" class="btn primary block" onClick={onDone} data-testid="task-sheet-done">
        Done
      </button>
    </div>
  );
}

/** The same details in a bottom sheet (used from the editor's toolbar). */
export function TaskSheet({ onClose, ...props }) {
  return (
    <Sheet title="Task details" onClose={onClose}>
      <TaskDetails {...props} onDone={onClose} />
    </Sheet>
  );
}
