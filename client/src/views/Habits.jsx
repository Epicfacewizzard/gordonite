import { useEffect, useRef, useState } from 'preact/hooks';
import { useToday } from '../hooks.js';
import { addDays } from '../../../shared/dates.js';
import {
  DAYS,
  COLORS,
  weekStart,
  scheduled,
  currentStreak,
  bestStreak,
  habitScore,
  weekProgress,
  dueToday,
  periodProgress,
  byPeriod,
  freqOf,
  frequencyLabel,
  targetLabel,
  streakUnit,
  met,
} from '../../../shared/habits.js';
import { loadHabits, habitState, subscribeHabits, toggleHabit, setHabitEntry, clearHabitEntry, saveHabit, moveHabit, deleteHabit, habitQueue, earliestDay } from '../habit-data.js';
import { getLists } from '../skin-log.js';

// Habits (see docs/HABITS.md): a Dashboard widget with today's habits, #/habits with each habit's week, streaks,
// adding, editing, reordering and archiving, and #/habits/<id> with one habit's months, streaks and score. Layout
// follows the habit tracker beta test (codex/habit-tracker-beta-test); the habits themselves are kept on the server
// like moods, sent through a queue so ticking works offline. Which options a habit has (how often, a number with a
// target, colour, question, reminder time, skipped days) follows Loop Habit Tracker's behaviour; no code is taken from it.
// A habit can be a course started by the skin log: "when I log Betaderm, keep this going for 7 days".

const dateLabel = (date, options = { month: 'short', day: 'numeric' }) => new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { ...options, timeZone: 'UTC' });
const timeLabel = (hhmm) => new Date(`2000-01-01T${hhmm}:00Z`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
const habitStyle = (habit) => (habit.color && COLORS[habit.color] ? { '--habit': COLORS[habit.color] } : undefined);
const numberText = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));
const PERIOD_WORD = { week: 'this week', month: 'this month', every: 'in these days' };
// The habit as it would be if logging `date` moved its start back to that day (habit-data.js does so when it is logged).
const startingBy = (habit, date) => (date < habit.created ? { ...habit, created: date } : habit);
const dayName = (date, today) => (date === today ? 'Today' : date === addDays(today, -1) ? 'Yesterday' : dateLabel(date, { weekday: 'short', month: 'short', day: 'numeric' }));

function useHabits(today) {
  const [, rerender] = useState(0);
  useEffect(() => {
    const stop = subscribeHabits(() => rerender((n) => n + 1));
    loadHabits(today);
    return stop;
  }, [today]);
  return habitState();
}

/** Open a <dialog> as a modal while mounted; Escape (or Back) closes it. */
function useModal(onClose) {
  const dialog = useRef(null);
  useEffect(() => {
    const node = dialog.current;
    node.showModal();
    const cancel = (event) => {
      event.preventDefault();
      onClose();
    };
    node.addEventListener('cancel', cancel);
    return () => {
      node.removeEventListener('cancel', cancel);
      node.close();
    };
  }, []);
  return dialog;
}

// The course a habit is in today, if it is a course habit: "Betaderm course · until Oct 21".
function courseNote(habit, today) {
  if (!habit.trigger) return null;
  const running = (habit.courses ?? []).find((c) => c.from <= today && today <= c.to);
  return running ? `${habit.trigger.product} course · until ${dateLabel(running.to)}` : `Starts when you log ${habit.trigger.product}`;
}

/** "2 of 3 this week" for a habit counted per period; '' otherwise. */
function periodNote(habit, today, entry) {
  if (!byPeriod(habit)) return '';
  const p = periodProgress(habit, today, entry);
  if (freqOf(habit).type === 'every') return p.complete ? `Done for these ${freqOf(habit).n} days` : `Once in these ${freqOf(habit).n} days`;
  return `${Math.min(p.done + p.skipped, p.needed)} of ${p.needed} ${PERIOD_WORD[freqOf(habit).type]}`;
}

function Problems({ state }) {
  return (
    <>
      {state.error && (
        <p class="banner error small" role="alert">
          {state.error}
        </p>
      )}
      {state.refused.map((c) => (
        <p key={c.key} class="banner error small" role="alert">
          A habit change was not saved: {c.error}{' '}
          <button type="button" class="btn ghost" onClick={() => habitQueue.retry(c.key)}>
            Try again
          </button>
          <button type="button" class="btn ghost" onClick={() => habitQueue.discard(c.key)}>
            Discard
          </button>
        </p>
      ))}
    </>
  );
}

/** A day's check-in: the number (for a number habit), a plain tick, or a skipped day. */
function EntryDialog({ habit, date, entry, onClose }) {
  const dialog = useModal(onClose);
  const number = habit.kind === 'number';
  const [value, setValue] = useState(entry && !entry.skip && entry.value != null ? String(entry.value) : '');
  const [error, setError] = useState('');
  const save = (event) => {
    event.preventDefault();
    if (number) {
      const n = Number(value.replace(',', '.'));
      if (value.trim() === '' || !Number.isFinite(n)) return setError('Enter a number.');
      setHabitEntry(habit.id, date, { value: n });
    } else setHabitEntry(habit.id, date, { value: null });
    onClose();
  };
  return (
    <dialog ref={dialog} class="habit-dialog" aria-labelledby="habit-entry-title" data-testid="habit-entry-dialog" style={habitStyle(habit)}>
      <form onSubmit={save}>
        <div class="habit-heading">
          <h2 id="habit-entry-title">
            {habit.name} · {dateLabel(date, { weekday: 'short', month: 'short', day: 'numeric' })}
          </h2>
          <button type="button" class="icon-btn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {habit.question && <p>{habit.question}</p>}
        {date < habit.created && (
          <p class="muted small" data-testid="habit-entry-early">
            This is before the habit’s start ({dateLabel(habit.created)}). Logging it moves the start back to this day.
          </p>
        )}
        {number && (
          <>
            <label class="habit-field" for="habit-entry-value">
              How many{habit.unit ? ` ${habit.unit}` : ''}? <span class="muted">(target: {targetLabel(habit)})</span>
            </label>
            <input autoFocus type="text" inputMode="decimal" id="habit-entry-value" value={value} onInput={(e) => setValue(e.currentTarget.value)} data-testid="habit-entry-value" />
          </>
        )}
        <p class="error small" role="status">
          {error}
        </p>
        <p class="muted small">Skip a day you could not do it (ill, away): it does not break the streak.</p>
        <div class="row habit-form-actions">
          {entry && (
            <button
              type="button"
              class="btn ghost"
              onClick={() => {
                clearHabitEntry(habit.id, date);
                onClose();
              }}
              data-testid="habit-entry-clear"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            class="btn"
            onClick={() => {
              setHabitEntry(habit.id, date, { skip: true });
              onClose();
            }}
            data-testid="habit-entry-skip"
          >
            Skip day
          </button>
          <button class="btn primary" type="submit" data-testid="habit-entry-save">
            {number ? 'Save' : 'Done'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/**
 * One day's square: tap to tick (yes-or-no) or to enter the number; `detailed` opens the day for every habit. Any past
 * day the app has loaded can be logged; a day before the habit's start opens the day, which says the start moves back.
 */
function DayCell({ habit, date, today, state, onOpen, detailed = false }) {
  const isDue = scheduled(startingBy(habit, date), date);
  const future = date > today;
  const early = date < habit.created;
  const tooOld = date < earliestDay(today);
  const e = isDue ? state.entry(habit.id, date) : null;
  const isMet = met(habit, e);
  const number = habit.kind === 'number';
  const text = !isDue ? '—' : future ? '·' : e?.skip ? '↷' : number && e?.value != null ? numberText(e.value) : isMet ? '✓' : '';
  const status = !isDue ? 'not due' : future ? 'future' : tooOld ? 'not loaded' : e?.skip ? 'skipped' : number && e?.value != null ? `${numberText(e.value)}${isMet ? ', target met' : ''}` : isMet ? 'done' : early ? 'before the start' : 'not done';
  const cls = `habit-check${isMet ? ' habit-done' : ''}${e?.skip ? ' habit-skipped' : ''}${number && e?.value != null && !isMet ? ' habit-partial' : ''}${early && !e ? ' habit-early' : ''}`;
  return (
    <button
      type="button"
      class={cls}
      aria-label={`${habit.name}, ${date}: ${status}`}
      aria-pressed={isMet}
      disabled={!isDue || future || tooOld}
      onClick={() => (number || detailed || early ? onOpen(habit, date) : toggleHabit(habit.id, date))}
    >
      {text}
    </button>
  );
}

/** ‹ day › for the Dashboard's habits: step back to log a past day; never past today or the loaded history. */
function DayStepper({ day, today, onDay }) {
  const earliest = earliestDay(today);
  return (
    <div class="habit-day-stepper" role="group" aria-label="Day to log">
      <button type="button" class="icon-btn" aria-label="Previous day" disabled={day <= earliest} onClick={() => onDay(addDays(day, -1))} data-testid="habit-day-prev">
        ‹
      </button>
      <label class="habit-day-pick">
        <span>{dayName(day, today)}</span>
        <input
          type="date"
          value={day}
          min={earliest}
          max={today}
          aria-label="Choose a day"
          onClick={(e) => {
            try {
              e.currentTarget.showPicker?.();
            } catch {
              // a browser without showPicker opens its own picker
            }
          }}
          onChange={(e) => {
            const v = e.currentTarget.value;
            if (v && v >= earliest && v <= today) onDay(v);
          }}
          data-testid="habit-day-pick"
        />
      </label>
      <button type="button" class="icon-btn" aria-label="Next day" disabled={day >= today} onClick={() => onDay(addDays(day, 1))} data-testid="habit-day-next">
        ›
      </button>
      {day !== today && (
        <button type="button" class="btn ghost" onClick={() => onDay(today)} data-testid="habit-day-today">
          Today
        </button>
      )}
    </div>
  );
}

export function HabitsWidget({ today }) {
  const state = useHabits(today);
  const [day, setDay] = useState(today); // the day being logged: today, or a past day stepped back to
  const [entering, setEntering] = useState(null); // { habit, date }
  useEffect(() => setDay(today), [today]);
  const order = (h) => h.reminder ?? '99';
  // On a past day, a habit made later is listed too: logging that day moves its start back (see habit-data.js).
  const due = state.habits.filter((h) => dueToday(startingBy(h, day), day, state.entry)).sort((a, b) => order(a).localeCompare(order(b)));
  const done = due.filter((h) => met(h, state.entry(h.id, day))).length;
  const when = day === today ? 'today' : day === addDays(today, -1) ? 'yesterday' : `on ${dateLabel(day, { weekday: 'short', month: 'short', day: 'numeric' })}`;
  return (
    <section class="widget" data-testid="widget-habits">
      <div class="habit-heading">
        <h2 class="section">Habits</h2>
        <a href="#/habits" class="small">
          History &amp; manage
        </a>
      </div>
      <Problems state={state} />
      <DayStepper day={day} today={today} onDay={setDay} />
      {due.length > 0 && (
        <p class="muted small" data-testid="habit-day-count">
          {done} of {due.length} {when}
          {state.waiting ? ' · waiting to be sent' : ''}
        </p>
      )}
      <div class="habit-today-list">
        {due.map((h) => {
          const e = state.entry(h.id, day);
          const early = day < h.created && `before its start (${dateLabel(h.created)}); logging moves the start back`;
          const detail = [early, h.question || courseNote(h, day) || h.detail, periodNote(startingBy(h, day), day, state.entry), h.reminder && timeLabel(h.reminder)].filter(Boolean).join(' · ');
          const name = <span class={met(h, e) || e?.skip ? 'muted' : ''}>{h.name}{e?.skip ? ' (skipped)' : ''}</span>;
          return h.kind === 'number' ? (
            <div class="habit-today-row" key={h.id} data-testid="habit-today" style={habitStyle(h)}>
              <button type="button" class={`habit-amount${met(h, e) ? ' habit-done' : ''}`} onClick={() => setEntering({ habit: h, date: day })} aria-label={`Enter ${h.name} for ${when}`} data-testid="habit-today-amount">
                {e?.value != null ? numberText(e.value) : '+'}
              </button>
              <span>
                {name}
                <span class="habit-detail">{[targetLabel(h), detail].filter(Boolean).join(' · ')}</span>
              </span>
            </div>
          ) : (
            <label class="habit-today-row" key={h.id} data-testid="habit-today" style={habitStyle(h)}>
              <input type="checkbox" checked={met(h, e)} onChange={() => toggleHabit(h.id, day)} />
              <span>
                {name}
                {detail && <span class="habit-detail">{detail}</span>}
              </span>
            </label>
          );
        })}
      </div>
      {!due.length && (
        <p class="muted small">
          Nothing due {when}. <a href="#/habits">Add a habit</a>.
        </p>
      )}
      {entering && <EntryDialog habit={entering.habit} date={entering.date} entry={state.entry(entering.habit.id, entering.date)} onClose={() => setEntering(null)} />}
    </section>
  );
}

function HabitEditor({ habit, today, nextSort = 0, onClose }) {
  const dialog = useModal(onClose);
  const [name, setName] = useState(habit?.name ?? '');
  const [question, setQuestion] = useState(habit?.question ?? '');
  const [detail, setDetail] = useState(habit?.detail ?? '');
  const [kind, setKind] = useState(habit?.kind ?? 'yesno');
  const [target, setTarget] = useState(habit?.target != null ? String(habit.target) : '');
  const [unit, setUnit] = useState(habit?.unit ?? '');
  const [targetType, setTargetType] = useState(habit?.targetType ?? 'atLeast');
  const f = habit?.freq ?? { type: 'days' };
  const [freqType, setFreqType] = useState(f.type);
  const [times, setTimes] = useState(String(f.times ?? f.n ?? (f.type === 'month' ? 4 : 3)));
  const [days, setDays] = useState(habit?.days ?? [0, 1, 2, 3, 4, 5, 6]);
  const [color, setColor] = useState(habit?.color ?? null);
  const [reminder, setReminder] = useState(habit?.reminder ?? '');
  const [linked, setLinked] = useState(!!habit?.trigger);
  const [product, setProduct] = useState(habit?.trigger?.product ?? '');
  const [courseDays, setCourseDays] = useState(habit?.trigger?.days ?? 7);
  const [created, setCreated] = useState(habit?.created ?? today);
  const [error, setError] = useState('');
  const products = [...getLists().products.common, ...getLists().products.more];
  const save = (event) => {
    event.preventDefault();
    if (!name.trim()) return setError('Give the habit a name.');
    const type = linked ? 'days' : freqType;
    if (type === 'days' && !days.length) return setError('Choose at least one day.');
    const n = Number(times);
    const max = type === 'week' ? 7 : type === 'month' ? 31 : 365;
    if (type !== 'days' && (!Number.isInteger(n) || n < 1 || n > max)) return setError(`Choose a number from 1 to ${max}.`);
    const t = Number(target.replace(',', '.'));
    if (kind === 'number' && (target.trim() === '' || !Number.isFinite(t) || t < 0)) return setError('Give the number habit a target of 0 or more.');
    const c = Number(courseDays);
    if (linked && (!product.trim() || !Number.isInteger(c) || c < 1 || c > 365)) return setError('Choose the product, and a course of 1 to 365 days.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(created) || created > today) return setError('The start must be a day up to today.');
    const freq = type === 'days' ? { type } : type === 'every' ? { type, n } : { type, times: n };
    try {
      saveHabit({
        ...(habit ?? {}),
        id: habit?.id ?? null,
        name: name.trim(),
        question: question.trim(),
        detail: detail.trim(),
        days: type === 'days' ? days : [0, 1, 2, 3, 4, 5, 6],
        freq,
        kind,
        target: kind === 'number' ? t : null,
        unit: kind === 'number' ? unit.trim() : '',
        targetType,
        color,
        reminder: reminder || null,
        archived: habit?.archived ?? false,
        created,
        trigger: linked ? { product: product.trim(), days: c } : null,
        sort: habit?.sort ?? nextSort,
      });
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };
  const remove = () => {
    if (!confirm(`Delete “${habit.name}” and its check-in history?`)) return;
    deleteHabit(habit.id);
    onClose();
  };
  const archive = (archived) => {
    saveHabit({ ...habit, archived });
    onClose();
  };
  const toggleDay = (d) => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d]);
  return (
    <dialog ref={dialog} class="habit-dialog" aria-labelledby="habit-editor-title" style={habitStyle({ color })}>
      <form onSubmit={save}>
        <div class="habit-heading">
          <h2 id="habit-editor-title">{habit ? 'Edit habit' : 'New habit'}</h2>
          <button type="button" class="icon-btn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <label class="habit-field" for="habit-name">
          Habit
        </label>
        <input autoFocus type="text" id="habit-name" value={name} maxLength={80} onInput={(e) => setName(e.currentTarget.value)} placeholder="Apply Betaderm" data-testid="habit-name" />
        <label class="habit-field" for="habit-question">
          Question (optional)
        </label>
        <input type="text" id="habit-question" value={question} maxLength={120} onInput={(e) => setQuestion(e.currentTarget.value)} placeholder="Did you stretch today?" data-testid="habit-question" />
        <label class="habit-field" for="habit-detail">
          Small goal or notes (optional)
        </label>
        <input type="text" id="habit-detail" value={detail} maxLength={100} onInput={(e) => setDetail(e.currentTarget.value)} placeholder="Legs and arms, at night" />

        <fieldset class="habit-days">
          <legend>Type</legend>
          <div class="row habit-segment">
            <label>
              <input type="radio" name="habit-kind" checked={kind === 'yesno'} onChange={() => setKind('yesno')} /> Yes or no
            </label>
            <label>
              <input type="radio" name="habit-kind" checked={kind === 'number'} onChange={() => setKind('number')} data-testid="habit-kind-number" /> A number
            </label>
          </div>
          {kind === 'number' && (
            <div class="row habit-target">
              <select value={targetType} onChange={(e) => setTargetType(e.currentTarget.value)} aria-label="At least or at most" data-testid="habit-target-type">
                <option value="atLeast">At least</option>
                <option value="atMost">At most</option>
              </select>
              <input type="text" inputMode="decimal" value={target} onInput={(e) => setTarget(e.currentTarget.value)} aria-label="Target" placeholder="8" data-testid="habit-target" />
              <input type="text" value={unit} maxLength={20} onInput={(e) => setUnit(e.currentTarget.value)} aria-label="Unit" placeholder="glasses" data-testid="habit-unit" />
              <span class="muted small">a day</span>
            </div>
          )}
        </fieldset>

        <fieldset class="habit-days" disabled={linked}>
          <legend>How often</legend>
          <select value={linked ? 'days' : freqType} onChange={(e) => setFreqType(e.currentTarget.value)} data-testid="habit-freq">
            <option value="days">On chosen days of the week</option>
            <option value="week">A number of times a week</option>
            <option value="month">A number of times a month</option>
            <option value="every">Once every few days</option>
          </select>
          {(linked || freqType === 'days') && (
            <>
              <div class="row">
                <button type="button" class="btn" onClick={() => setDays([0, 1, 2, 3, 4, 5, 6])}>
                  Every day
                </button>
                <button type="button" class="btn" onClick={() => setDays([1, 2, 3, 4, 5])}>
                  Weekdays
                </button>
              </div>
              <div class="habit-day-options">
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <label key={d}>
                    <input type="checkbox" checked={days.includes(d)} onChange={() => toggleDay(d)} />
                    {DAYS[d]}
                  </label>
                ))}
              </div>
            </>
          )}
          {!linked && freqType !== 'days' && (
            <label class="row habit-times">
              {freqType === 'every' ? 'Once every' : null}
              <input type="number" min="1" max={freqType === 'week' ? 7 : freqType === 'month' ? 31 : 365} value={times} onInput={(e) => setTimes(e.currentTarget.value)} data-testid="habit-times" />
              {freqType === 'week' ? 'times a week' : freqType === 'month' ? 'times a month' : 'days'}
            </label>
          )}
          {linked && <p class="muted small">A course from the skin log runs on chosen days.</p>}
        </fieldset>

        <fieldset class="habit-days">
          <legend>Colour</legend>
          <div class="habit-colors">
            <label class="habit-swatch" title="Default">
              <input type="radio" name="habit-color" checked={!color} onChange={() => setColor(null)} aria-label="Default colour" />
              <span style={{ background: 'var(--accent)' }} />
            </label>
            {Object.entries(COLORS).map(([key, hex]) => (
              <label class="habit-swatch" key={key} title={key}>
                <input type="radio" name="habit-color" checked={color === key} onChange={() => setColor(key)} aria-label={key} data-testid={`habit-color-${key}`} />
                <span style={{ background: hex }} />
              </label>
            ))}
          </div>
        </fieldset>

        <label class="habit-field" for="habit-reminder">
          Reminder time (optional)
        </label>
        <input type="time" id="habit-reminder" value={reminder} onInput={(e) => setReminder(e.currentTarget.value)} data-testid="habit-reminder" />
        <p class="muted small">Shown on the Dashboard, which lists habits by this time. The phone does not notify you yet.</p>

        <label class="habit-field" for="habit-created">
          Started on
        </label>
        <input type="date" id="habit-created" value={created} max={today} onInput={(e) => setCreated(e.currentTarget.value)} data-testid="habit-created" />
        <p class="muted small">Streaks and the score count from this day. Logging a day before it moves it back.</p>

        <div class="habit-course" data-testid="habit-course">
          <label>
            <input type="checkbox" checked={linked} onChange={(e) => setLinked(e.currentTarget.checked)} data-testid="habit-linked" />
            Start from the skin log
          </label>
          {linked && (
            <>
              <label>
                When I log
                <select value={product} onChange={(e) => setProduct(e.currentTarget.value)} data-testid="habit-product">
                  <option value="">choose…</option>
                  {[...new Set([...products, ...(product ? [product] : [])])].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                keep this going for
                <input type="number" min="1" max="365" value={courseDays} onInput={(e) => setCourseDays(e.currentTarget.value)} data-testid="habit-course-days" />
                days
              </label>
              <p class="muted small">It is due only during a course. Logging the product starts one (or extends the one running) and ticks that day.</p>
            </>
          )}
        </div>
        {habit && <p class="muted small">Changing the schedule or target recalculates past weeks, streaks and the score. Check-ins are kept.</p>}
        <p class="error small" role="status">
          {error}
        </p>
        <div class="row habit-form-actions">
          {habit && (
            <button type="button" class="btn ghost" onClick={remove}>
              Delete habit
            </button>
          )}
          {habit && (
            <button type="button" class="btn ghost" onClick={() => archive(!habit.archived)} data-testid="habit-archive">
              {habit.archived ? 'Unarchive' : 'Archive'}
            </button>
          )}
          <button type="button" class="btn" onClick={onClose}>
            Cancel
          </button>
          <button class="btn primary" type="submit" data-testid="habit-save">
            Save habit
          </button>
        </div>
      </form>
    </dialog>
  );
}

function HabitCard({ habit, index, count, list, dates, today, state, onEdit, onOpen }) {
  const streak = currentStreak(habit, today, state.entry);
  return (
    <section class="habit-card" data-testid="habit-card" style={habitStyle(habit)}>
      <div class="habit-heading">
        <div>
          <h3>
            <a href={`#/habits/${habit.id}`} data-testid="habit-open">
              {habit.name}
            </a>
          </h3>
          <p class="muted small">{[frequencyLabel(habit), targetLabel(habit), habit.reminder && timeLabel(habit.reminder)].filter(Boolean).join(' · ')}</p>
          {(habit.question || habit.detail) && <p class="muted small">{habit.question || habit.detail}</p>}
          {habit.trigger && <span class="habit-course-chip">{courseNote(habit, today)}</span>}
        </div>
        <div class="habit-card-tools">
          <button type="button" class="icon-btn" aria-label={`Move ${habit.name} up`} disabled={index === 0} onClick={() => moveHabit(list, habit.id, -1)}>
            ↑
          </button>
          <button type="button" class="icon-btn" aria-label={`Move ${habit.name} down`} disabled={index === count - 1} onClick={() => moveHabit(list, habit.id, 1)}>
            ↓
          </button>
          <button type="button" class="icon-btn" aria-label={`Edit ${habit.name}`} onClick={() => onEdit(habit)}>
            ⋯
          </button>
        </div>
      </div>
      <div class="habit-week" role="group" aria-label={`${habit.name} check-ins`}>
        {dates.map((date) => (
          <div class={date === today ? 'habit-day habit-is-today' : 'habit-day'} key={date}>
            <span>{dateLabel(date, { weekday: 'short' })}</span>
            <span class="habit-day-number">{Number(date.slice(-2))}</span>
            <DayCell habit={habit} date={date} today={today} state={state} onOpen={onOpen} />
          </div>
        ))}
      </div>
      <p class="muted small habit-streak">
        {streak} {streakUnit(habit, streak)} in a row · score {Math.round(habitScore(habit, today, state.entry) * 100)}%{byPeriod(habit) ? ` · ${periodNote(habit, today, state.entry)}` : ''}
      </p>
    </section>
  );
}

function monthDays(month) {
  const first = `${month}-01`;
  const start = weekStart(first);
  const out = [];
  for (let d = start; d.slice(0, 7) <= month || out.length % 7; d = addDays(d, 1)) out.push(d);
  return out;
}

function HabitDetail({ habit, today, state, onEdit, onOpen }) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const shift = (by) => {
    const d = new Date(`${month}-15T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + by);
    setMonth(d.toISOString().slice(0, 7));
  };
  const streak = currentStreak(habit, today, state.entry);
  const best = bestStreak(habit, today, state.entry);
  let total = 0;
  for (let d = habit.created; d <= today; d = addDays(d, 1)) if (met(habit, state.entry(habit.id, d))) total++;
  return (
    <div class="habits-view" data-testid="habit-detail" style={habitStyle(habit)}>
      <Problems state={state} />
      <p>
        <a href="#/habits">‹ All habits</a>
      </p>
      <div class="habit-heading">
        <div>
          <h2 class="section habit-title">{habit.name}</h2>
          <p class="muted small">{[frequencyLabel(habit), targetLabel(habit), habit.reminder && `reminder ${timeLabel(habit.reminder)}`, habit.archived && 'archived'].filter(Boolean).join(' · ')}</p>
          {habit.question && <p>{habit.question}</p>}
          {habit.detail && <p class="muted small">{habit.detail}</p>}
        </div>
        <button type="button" class="btn" onClick={() => onEdit(habit)}>
          Edit
        </button>
      </div>
      <div class="habit-summary habit-summary-4" aria-label="Habit statistics">
        <div>
          <strong data-testid="habit-score">{Math.round(habitScore(habit, today, state.entry) * 100)}%</strong>
          <span>score</span>
        </div>
        <div>
          <strong data-testid="habit-current-streak">{streak}</strong>
          <span>{streakUnit(habit, streak)} in a row now</span>
        </div>
        <div>
          <strong data-testid="habit-best-streak">{best}</strong>
          <span>best streak</span>
        </div>
        <div>
          <strong data-testid="habit-total">{total}</strong>
          <span>days done</span>
        </div>
      </div>
      <p class="muted small">The score grows with each day done and shrinks slowly with each one missed, so one bad day does not undo a long run. Streaks and totals cover the last 400 days.</p>
      <div class="habit-week-nav">
        <button type="button" class="icon-btn" aria-label="Previous month" disabled={month <= earliestDay(today).slice(0, 7)} onClick={() => shift(-1)}>
          ‹
        </button>
        <strong>{dateLabel(`${month}-15`, { month: 'long', year: 'numeric' })}</strong>
        <button type="button" class="icon-btn" aria-label="Next month" disabled={month >= today.slice(0, 7)} onClick={() => shift(1)}>
          ›
        </button>
        <button type="button" class="btn" onClick={() => setMonth(today.slice(0, 7))}>
          Today
        </button>
      </div>
      <div class="habit-month" role="group" aria-label={`${habit.name}, ${month}`}>
        {[1, 2, 3, 4, 5, 6, 0].map((d) => (
          <span class="habit-month-head" key={d}>
            {DAYS[d]}
          </span>
        ))}
        {monthDays(month).map((date) => (
          <div class={`habit-day${date === today ? ' habit-is-today' : ''}${date.slice(0, 7) !== month ? ' habit-other-month' : ''}`} key={date}>
            <span class="habit-day-number">{Number(date.slice(-2))}</span>
            <DayCell habit={habit} date={date} today={today} state={state} onOpen={onOpen} detailed />
          </div>
        ))}
      </div>
      <p class="muted small">Tap any past day to tick it, enter a number, skip it or clear it (a day before the habit’s start moves the start back). ↷ Skipped · — Not due · · Future day.</p>
    </div>
  );
}

export function HabitsView({ config, open = null }) {
  const today = useToday(config.tz);
  const state = useHabits(today);
  const { habits, archived } = state;
  const [week, setWeek] = useState(() => weekStart(today));
  const [editing, setEditing] = useState(null); // null = closed, {} = new, a habit = editing it
  const [entering, setEntering] = useState(null); // { habit, date }
  useEffect(() => setWeek(weekStart(today)), [today]);
  const openEntry = (habit, date) => setEntering({ habit, date });
  const dialogs = (
    <>
      {editing && <HabitEditor habit={editing.id ? editing : null} today={today} nextSort={Math.max(0, ...[...habits, ...archived].map((h) => h.sort ?? 0)) + 10} onClose={() => setEditing(null)} />}
      {entering && <EntryDialog habit={entering.habit} date={entering.date} entry={state.entry(entering.habit.id, entering.date)} onClose={() => setEntering(null)} />}
    </>
  );
  if (open) {
    const habit = [...habits, ...archived].find((h) => h.id === open);
    return habit ? (
      <>
        <HabitDetail habit={habit} today={today} state={state} onEdit={setEditing} onOpen={openEntry} />
        {dialogs}
      </>
    ) : (
      <div class="habits-view">
        <p class="muted">This habit is not here (it may have been deleted). <a href="#/habits">All habits</a></p>
      </div>
    );
  }
  const due = habits.filter((h) => dueToday(h, today, state.entry));
  const completed = due.filter((h) => met(h, state.entry(h.id, today))).length;
  const progress = weekProgress(habits, today, state.entry);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  return (
    <div class="habits-view" data-testid="habits">
      <Problems state={state} />
      <div class="habit-heading">
        <h2 class="section">Your habits</h2>
        <button type="button" class="btn primary" onClick={() => setEditing({})} data-testid="habit-new">
          New habit
        </button>
      </div>
      <div class="habit-summary" aria-label="Habit progress">
        <div>
          <strong>
            {completed} / {due.length}
          </strong>
          <span>today</span>
        </div>
        <div>
          <strong>{progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%</strong>
          <span>this week so far</span>
        </div>
        <div>
          <strong>{Math.max(0, ...habits.filter((h) => !byPeriod(h)).map((h) => currentStreak(h, today, state.entry)))}</strong>
          <span>longest current streak (days)</span>
        </div>
      </div>
      <div class="habit-week-nav">
        <button type="button" class="icon-btn" aria-label="Previous week" disabled={week <= earliestDay(today)} onClick={() => setWeek(addDays(week, -7))}>
          ‹
        </button>
        <strong>
          {dateLabel(week)} – {dateLabel(addDays(week, 6), { month: 'short', day: 'numeric', year: 'numeric' })}
        </strong>
        <button type="button" class="icon-btn" aria-label="Next week" disabled={week >= weekStart(today)} onClick={() => setWeek(addDays(week, 7))}>
          ›
        </button>
        <button type="button" class="btn" onClick={() => setWeek(weekStart(today))}>
          Today
        </button>
      </div>
      <p class="muted small">Tap a square to tick or untick, or to enter a number. Past days can be filled in, also before a habit’s start (which then moves back). Open a habit for its months, best streak and score, and to skip a day; on the Dashboard, ‹ steps back a day.</p>
      <div class="habit-cards">
        {habits.map((habit, i) => (
          <HabitCard key={habit.id} habit={habit} index={i} count={habits.length} list={habits} dates={dates} today={today} state={state} onEdit={setEditing} onOpen={openEntry} />
        ))}
        {!habits.length && <p class="muted">No habits yet. Add one small thing you want to keep doing, or a treatment course started from the skin log.</p>}
      </div>
      <p class="muted small">— Not due · · Future day · ↷ Skipped. Streaks count due days (or weeks, months); an unfinished today does not break yesterday’s streak.</p>
      {archived.length > 0 && (
        <details class="habit-archived" data-testid="habit-archived">
          <summary>Archived ({archived.length})</summary>
          {archived.map((h) => (
            <div class="row habit-archived-row" key={h.id}>
              <a href={`#/habits/${h.id}`}>{h.name}</a>
              <button type="button" class="btn ghost" onClick={() => saveHabit({ ...h, archived: false })}>
                Unarchive
              </button>
            </div>
          ))}
        </details>
      )}
      {dialogs}
    </div>
  );
}
