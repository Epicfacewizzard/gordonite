import { useState } from 'preact/hooks';
import { Sheet } from './parts.jsx';
import { addDays, formatDateShort } from '../../../shared/dates.js';
import { findDatePhrases } from '../../../shared/taskdates.js';
import { PriorityStar } from './TaskMenus.jsx';

/**
 * Everything about one task in one place: when it is due, when it starts, hide until, priority, and hiding it
 * for good. `picked` holds what was chosen by hand; a date typed in the text ("due fri", or a date word at the
 * end) fills in until one is picked. Every change goes straight to onChange (no Save button), so closing never
 * loses anything. Shown inline when a task is expanded in the list, and in a sheet from the editor.
 * `uid` keeps the field ids unique when several are open at once.
 */
export function TaskDetails({ text, noteDate, today, picked, noteId, where, uid = 'sheet', onChange, onDone }) {
  const [values, setValues] = useState({ due: picked.due ?? null, start: picked.start ?? null, hidden: !!picked.hidden, hideUntil: picked.hideUntil ?? null, priority: picked.priority ?? null });
  const phrases = findDatePhrases(text, noteDate);
  const typed = { due: null, start: null, dueWords: '', startWords: '' };
  for (const p of phrases) {
    if (typed[p.kind]) continue;
    typed[p.kind] = p.date;
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
      <label class="check-row">
        <input type="checkbox" checked={values.hidden} onChange={(e) => change({ hidden: e.currentTarget.checked })} data-testid="input-hidden" />
        <span>Hide from the Tasks list (it stays in its note)</span>
      </label>
      <p class="muted small">
        A task is not shown as “to do” before its start date. Typing “due fri” or “starts oct 12” in the task works too, and so does a date word at the end (“… tomorrow”); a date picked here wins.
      </p>
      <button type="button" class="btn primary block" onClick={onDone} data-testid="task-sheet-done">
        Done
      </button>
    </div>
  );
}

/** The same details in a bottom sheet (used from the editor's toolbar). */
export function TaskSheet({ onClose, ...props }) {
  return (
    <Sheet title="Task dates" onClose={onClose}>
      <TaskDetails {...props} onDone={onClose} />
    </Sheet>
  );
}
