import { useState } from 'preact/hooks';
import { Sheet } from './parts.jsx';
import { addDays, formatDateShort } from '../../../shared/dates.js';
import { PRIORITY_LABEL } from '../../../shared/tasks.js';
import { ICON_PATHS } from '../editor/taskIcons.js';

// The small menus behind a task's round buttons: when it is due (or starts), how important it is, and
// hiding it for a while. Each applies its choice straight away and closes.

const dow = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** The quick picks every menu shares: [label, date]. "This weekend" is the coming Saturday. */
export function presets(today) {
  const toSaturday = (6 - dow(today) + 7) % 7 || 7;
  return [
    ['Today', today],
    ['Tomorrow', addDays(today, 1)],
    ['This weekend', addDays(today, toSaturday)],
    ['One week', addDays(today, 7)],
    ['Three weeks', addDays(today, 21)],
  ];
}

const PATHS = ICON_PATHS;

export const Glyph = ({ name, size = 18 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d={PATHS[name]} />
  </svg>
);

/** Star for a priority: filled = urgent & important, half = urgent, outline = important, dim outline = none. */
export function PriorityStar({ value, size = 18 }) {
  const filled = value === 'both';
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill={filled ? 'currentColor' : 'none'}>
      {value === 'urgent' && (
        <>
          <clipPath id="star-half">
            <rect x="0" y="0" width="12" height="24" />
          </clipPath>
          <path d={PATHS.star} fill="currentColor" clip-path="url(#star-half)" />
        </>
      )}
      <path d={PATHS.star} />
    </svg>
  );
}

function Row({ label, hint, onClick, on, testid, children }) {
  return (
    <button type="button" class={`menu-item menu-row${on ? ' on' : ''}`} onClick={onClick} data-testid={testid}>
      <span class="menu-row-label">
        {children}
        {label}
      </span>
      {hint && <span class="muted">{hint}</span>}
    </button>
  );
}

// "Choose date…": reveals a date field in place; picking a day applies it.
function ChooseDate({ onPick }) {
  const [open, setOpen] = useState(false);
  if (!open) return <Row label="Choose date…" onClick={() => setOpen(true)} testid="menu-choose-date" />;
  return (
    <div class="menu-item choose-date">
      <input type="date" aria-label="Choose a date" autofocus onChange={(e) => e.currentTarget.value && onPick(e.currentTarget.value)} data-testid="menu-date-input" />
    </div>
  );
}

/** Due date. The footer switches the same menu to the start date ("Starts at"). */
export function DateMenu({ today, due, start, onPick, onClose }) {
  const [mode, setMode] = useState('due');
  const current = mode === 'due' ? due : start;
  const pick = (date) => {
    onPick({ [mode]: date });
    onClose();
  };
  return (
    <Sheet title={mode === 'due' ? 'Due' : 'Starts at'} onClose={onClose}>
      <div class="menu-list" data-testid={`menu-${mode}`}>
        {presets(today).map(([label, date]) => (
          <Row key={label} label={label} hint={formatDateShort(date)} onClick={() => pick(date)} testid={`pick-${label.toLowerCase().replace(/ /g, '-')}`} />
        ))}
        <ChooseDate key={mode} onPick={pick} />
        {current && <Row label={mode === 'due' ? 'Clear due date' : 'Clear start date'} onClick={() => pick(null)} testid="menu-clear" />}
        <Row label={mode === 'due' ? 'Add start date' : 'Back to due date'} onClick={() => setMode(mode === 'due' ? 'start' : 'due')} testid="menu-switch" />
      </div>
    </Sheet>
  );
}

/** Hide a task until a day (it comes back by itself), or until you show it again. */
export function HideMenu({ today, hidden, hideUntil, onPick, onClose }) {
  const [days, setDays] = useState(null); // a number box once "Choose number of days…" is tapped
  const isHidden = hidden || (hideUntil && hideUntil > today);
  const pick = (patch) => {
    onPick(patch);
    onClose();
  };
  const until = (date) => pick({ hideUntil: date, hidden: false });
  return (
    <Sheet title="Hide until" onClose={onClose}>
      <div class="menu-list" data-testid="menu-hide">
        {isHidden && <Row label="Show again" onClick={() => pick({ hidden: false, hideUntil: null })} testid="menu-show-again" />}
        {presets(today)
          .slice(1)
          .map(([label, date]) => (
            <Row key={label} label={label} hint={formatDateShort(date)} onClick={() => until(date)} testid={`hide-${label.toLowerCase().replace(/ /g, '-')}`} />
          ))}
        <ChooseDate onPick={until} />
        {days === null ? (
          <Row label="Choose number of days…" onClick={() => setDays('')} testid="menu-choose-days" />
        ) : (
          <form
            class="menu-item choose-date row"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(days);
              if (Number.isInteger(n) && n >= 1 && n <= 3650) until(addDays(today, n));
            }}
          >
            <input type="number" min="1" max="3650" inputMode="numeric" value={days} autofocus aria-label="Number of days" placeholder="Days" onInput={(e) => setDays(e.currentTarget.value)} data-testid="menu-days-input" />
            <button type="submit" class="btn primary" data-testid="menu-days-go">
              Hide
            </button>
          </form>
        )}
        {!hidden && <Row label="Hide until I show it" onClick={() => pick({ hidden: true, hideUntil: null })} testid="menu-hide-forever" />}
      </div>
    </Sheet>
  );
}

const PRIORITIES = [
  ['both', 'Urgent & Important'],
  ['urgent', 'Urgent'],
  ['important', 'Important'],
  [null, 'None'],
];

export function PriorityMenu({ value, onPick, onClose }) {
  return (
    <Sheet title="Set priority" onClose={onClose}>
      <div class="menu-list" data-testid="menu-priority">
        {PRIORITIES.map(([id, label]) => (
          <Row
            key={label}
            label={label}
            on={(value ?? null) === id}
            onClick={() => {
              onPick({ priority: id });
              onClose();
            }}
            testid={`priority-${id ?? 'none'}`}
          >
            <span class={`prio prio-${id ?? 'none'}`}>
              <PriorityStar value={id} />
            </span>
          </Row>
        ))}
      </div>
    </Sheet>
  );
}

export { PRIORITY_LABEL };
