import { useState } from 'preact/hooks';
import { Sheet } from './parts.jsx';
import { addDays, formatDateShort } from '../../../shared/dates.js';
import { parseTaskDates } from '../../../shared/taskdates.js';

/**
 * Pick when a task is due, when it starts, and whether it is hidden from the Tasks list.
 * `picked` holds what was chosen by hand; a date typed in the text ("due fri") fills in until one is picked.
 * Every change is passed straight to onChange (no Save button), so closing the sheet never loses anything.
 */
export function TaskSheet({ text, noteDate, today, picked, onChange, onClose }) {
  const [values, setValues] = useState({ due: picked.due ?? null, start: picked.start ?? null, hidden: !!picked.hidden });
  const typed = parseTaskDates(text, noteDate);

  const change = (patch) => {
    setValues((v) => ({ ...v, ...patch }));
    onChange(patch);
  };

  const field = (key, label, hintWord) => {
    const effective = values[key] ?? typed[key] ?? '';
    const fromText = !values[key] && typed[key];
    return (
      <div class="field" data-testid={`field-${key}`}>
        <label for={`task-${key}`}>{label}</label>
        <div class="row">
          <input
            id={`task-${key}`}
            type="date"
            value={effective}
            onChange={(e) => change({ [key]: e.currentTarget.value || null })}
            data-testid={`input-${key}`}
          />
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
              {formatDateShort(typed[key])} · from “{hintWord}” in the text
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
    <Sheet title="Task dates" onClose={onClose}>
      <p class="task-sheet-text">{text}</p>
      {field('due', 'Due', 'due')}
      {field('start', 'Starts', 'start')}
      <label class="check-row">
        <input type="checkbox" checked={values.hidden} onChange={(e) => change({ hidden: e.currentTarget.checked })} data-testid="input-hidden" />
        <span>Hide from the Tasks list (it stays in its note)</span>
      </label>
      <p class="muted small">
        A task is not shown as “to do” before its start date. Typing “due fri” or “starts oct 12” in the task works too; a date picked here wins.
      </p>
      <button type="button" class="btn primary block" onClick={onClose} data-testid="task-sheet-done">
        Done
      </button>
    </Sheet>
  );
}
