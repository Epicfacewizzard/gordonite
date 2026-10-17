// Recurring tasks on screen (docs/RECURRING-TASKS.md): choosing a repeat rule, and a repeating task's history.
// Every choice goes straight to onChange as a patch ({ repeat }, { skip: true }, { undoCompletion: true }), the same
// patches the Tasks list, the note editor and the assistant use (shared/tasks.js patchedTaskAttrs).
import { useState } from 'preact/hooks';
import { Sheet } from './parts.jsx';
import { dateInTz, formatDateShort } from '../../../shared/dates.js';
import { findRepeatPhrase, repeatLabel } from '../../../shared/repeat.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dow = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The quick choices: [label, rule without `from`]. Weekly is on the due date's weekday (or today's). */
export function repeatPresets(due, today) {
  const day = dow(due || today);
  return [
    ['Daily', { every: 1, unit: 'day' }],
    ['Weekdays', { every: 1, unit: 'week', days: [1, 2, 3, 4, 5] }],
    [`Weekly on ${DAYS[day]}`, { every: 1, unit: 'week', days: [day] }],
    ['Every 2 weeks', { every: 2, unit: 'week' }],
    ['Monthly', { every: 1, unit: 'month' }],
    ['Yearly', { every: 1, unit: 'year' }],
  ];
}

/**
 * Pick, change or stop a task's repeat. `picked` is the rule chosen by hand (or null); a rule typed in the words is
 * shown until one is picked. `due` is the task's effective due date (for the weekday and the month day).
 */
export function RepeatEditor({ text, picked, due, today, onChange, uid = 'repeat' }) {
  const typed = findRepeatPhrase(text);
  const [rule, setRule] = useState(picked ?? null);
  const [custom, setCustom] = useState(false);
  const effective = rule ?? typed?.rule ?? null;
  const from = effective?.from ?? 'due';
  const change = (next) => {
    const stored = next ? { ...next, from: next.from ?? from } : null;
    if (stored && !(stored.unit === 'week' && stored.days?.length)) delete stored.days;
    if (stored && stored.unit !== 'month' && stored.unit !== 'year') delete stored.day;
    setRule(stored);
    onChange({ repeat: stored });
  };
  const presets = repeatPresets(due, today);
  const presetOn = (r) => effective && same({ every: r.every, unit: r.unit, days: r.days }, { every: effective.every, unit: effective.unit, days: effective.days });
  const showCustom = custom || (effective && !presets.some(([, r]) => presetOn(r)));
  return (
    <div class="field repeat-editor" data-testid="field-repeat">
      <label>Repeat</label>
      <div class="row wrap">
        {presets.map(([label, r]) => (
          <button key={label} type="button" class={`btn${presetOn(r) ? ' on' : ''}`} aria-pressed={!!presetOn(r)} onClick={() => change(r)} data-testid={`repeat-preset-${label.toLowerCase().replace(/\W+/g, '-')}`}>
            {label}
          </button>
        ))}
        <button type="button" class={`btn${showCustom ? ' on' : ''}`} aria-pressed={!!showCustom} onClick={() => setCustom(true)} data-testid="repeat-custom">
          Custom…
        </button>
      </div>
      {showCustom && (
        <div class="row wrap" data-testid="repeat-custom-fields">
          <label for={`repeat-every-${uid}`}>Every</label>
          <input id={`repeat-every-${uid}`} type="number" min="1" max="365" inputMode="numeric" class="repeat-every" value={effective?.every ?? 1} data-testid="repeat-every"
            onChange={(e) => { const n = Number(e.currentTarget.value); if (Number.isInteger(n) && n >= 1 && n <= 365) change({ ...(effective ?? { unit: 'week' }), every: n }); }} />
          <select aria-label="Unit" value={effective?.unit ?? 'week'} data-testid="repeat-unit" onChange={(e) => change({ ...(effective ?? { every: 1 }), unit: e.currentTarget.value })}>
            {[['day', 'days'], ['week', 'weeks'], ['month', 'months'], ['year', 'years']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      )}
      {showCustom && effective?.unit === 'week' && (
        <div class="row wrap" role="group" aria-label="On these days">
          {DAYS.map((name, d) => {
            const on = !!effective.days?.includes(d);
            return (
              <button key={name} type="button" class={`btn day-btn${on ? ' on' : ''}`} aria-pressed={on} data-testid={`repeat-day-${d}`}
                onClick={() => change({ ...effective, days: on ? effective.days.filter((x) => x !== d) : [...(effective.days ?? []), d].sort((a, b) => a - b) })}>
                {name}
              </button>
            );
          })}
        </div>
      )}
      {effective && (
        <div class="row wrap" role="radiogroup" aria-label="Counts from">
          <label class="check-row"><input type="radio" name={`repeat-from-${uid}`} checked={from === 'due'} onChange={() => change({ ...effective, from: 'due' })} data-testid="repeat-from-due" /><span>From the scheduled date</span></label>
          <label class="check-row"><input type="radio" name={`repeat-from-${uid}`} checked={from === 'done'} onChange={() => change({ ...effective, from: 'done' })} data-testid="repeat-from-done" /><span>From the day it is done</span></label>
        </div>
      )}
      <div class="row small">
        {effective && <span class="muted" data-testid="repeat-summary">Repeats {repeatLabel(effective, { withFrom: false })}{!rule && typed ? ` · from “${text.slice(typed.index, typed.index + typed.length)}” in the text` : ''}</span>}
        {rule && (
          <button type="button" class="link" onClick={() => change(null)} data-testid="repeat-stop">
            {typed ? 'Clear picked repeat' : 'Stop repeating'}
          </button>
        )}
      </div>
      {!effective && <p class="muted small">Ticking a repeating task records it as done and moves its due date on. Typing “every 2 weeks” or “every mon and thu” in the task works too.</p>}
    </div>
  );
}

/** The same choices in a sheet, from the due-date menu. */
export function RepeatMenu({ onClose, ...props }) {
  return (
    <Sheet title="Repeat" onClose={onClose}>
      <RepeatEditor {...props} uid="menu" />
      <button type="button" class="btn primary block" onClick={onClose} data-testid="repeat-done">Done</button>
    </Sheet>
  );
}

/** How a completion compares with the date it was for: "on time", "2 days late", "1 day early". */
function lateness(entry, tz) {
  if (!entry.due) return '';
  const day = dateInTz(new Date(entry.at), tz);
  const diff = Math.round((Date.parse(day) - Date.parse(entry.due)) / 86400000);
  if (diff === 0) return 'on time';
  const n = Math.abs(diff);
  return `${n} day${n === 1 ? '' : 's'} ${diff > 0 ? 'late' : 'early'}`;
}

/** A repeating task's history, newest first, with Skip this one and Undo last completion. */
export function CompletionList({ completions = [], tz, repeating, onChange }) {
  const [all, setAll] = useState(false);
  const list = [...completions].reverse();
  const shown = all ? list : list.slice(0, 10);
  const last = completions.at(-1);
  if (!repeating && !completions.length) return null;
  return (
    <div class="field completions" data-testid="task-completions">
      <label>History <span class="count">{completions.filter((c) => !c.skipped).length} done</span></label>
      {shown.length > 0 ? (
        <ul class="completion-list">
          {shown.map((c) => (
            <li key={c.at} data-testid="completion" data-skipped={c.skipped ? 'true' : undefined}>
              <span>{formatDateShort(dateInTz(new Date(c.at), tz))}</span>
              <span class="muted small">{c.skipped ? 'skipped' : 'done'}{c.due ? ` · for ${formatDateShort(c.due)}` : ''}{!c.skipped && lateness(c, tz) ? ` · ${lateness(c, tz)}` : ''}</span>
            </li>
          ))}
        </ul>
      ) : <p class="muted small">Not done yet. Each tick is recorded here.</p>}
      {list.length > shown.length && <button type="button" class="link" onClick={() => setAll(true)} data-testid="completions-all">Show all {list.length}</button>}
      <div class="row">
        {repeating && <button type="button" class="btn" onClick={() => onChange({ skip: true })} data-testid="task-skip">Skip this one</button>}
        {last?.prev && <button type="button" class="btn" onClick={() => onChange({ undoCompletion: true })} data-testid="task-undo-completion">Undo last {last.skipped ? 'skip' : 'completion'}</button>}
      </div>
    </div>
  );
}
