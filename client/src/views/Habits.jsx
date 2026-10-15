import { useEffect, useRef, useState } from 'preact/hooks';
import { useToday } from '../hooks.js';
import { addDays } from '../../../shared/dates.js';
import { DAYS, weekStart, scheduled, currentStreak, weekProgress } from '../../../shared/habits.js';
import { loadHabits, habitState, subscribeHabits, toggleHabit, saveHabit, deleteHabit, habitQueue } from '../habit-data.js';
import { getLists } from '../skin-log.js';

// Habits (see docs/HABITS.md): a Dashboard widget with today's habits, and #/habits with each habit's week, streaks,
// and adding, editing and deleting. Layout follows the habit tracker beta test (codex/habit-tracker-beta-test); the
// habits themselves are kept on the server like moods, sent through a queue so ticking works offline.
// A habit can be a course started by the skin log: "when I log Betaderm, keep this going for 7 days".

const dateLabel = (date, options = { month: 'short', day: 'numeric' }) => new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { ...options, timeZone: 'UTC' });

function useHabits(today) {
  const [, rerender] = useState(0);
  useEffect(() => {
    const stop = subscribeHabits(() => rerender((n) => n + 1));
    loadHabits(today);
    return stop;
  }, [today]);
  return habitState();
}

// The course a habit is in today, if it is a course habit: "Betaderm course · until Oct 21".
function courseNote(habit, today) {
  if (!habit.trigger) return null;
  const running = (habit.courses ?? []).find((c) => c.from <= today && today <= c.to);
  return running ? `${habit.trigger.product} course · until ${dateLabel(running.to)}` : `Starts when you log ${habit.trigger.product}`;
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

export function HabitsWidget({ today }) {
  const state = useHabits(today);
  const due = state.habits.filter((h) => scheduled(h, today));
  const done = due.filter((h) => state.done(h.id, today)).length;
  return (
    <section class="widget" data-testid="widget-habits">
      <div class="habit-heading">
        <h2 class="section">Habits</h2>
        <a href="#/habits" class="small">
          History &amp; manage
        </a>
      </div>
      <Problems state={state} />
      {due.length > 0 && (
        <p class="muted small">
          {done} of {due.length} today{state.waiting ? ' · waiting to be sent' : ''}
        </p>
      )}
      <div class="habit-today-list">
        {due.map((h) => (
          <label class="habit-today-row" key={h.id} data-testid="habit-today">
            <input type="checkbox" checked={state.done(h.id, today)} onChange={() => toggleHabit(h.id, today)} />
            <span>
              <span class={state.done(h.id, today) ? 'muted' : ''}>{h.name}</span>
              {(h.detail || h.trigger) && <span class="habit-detail">{courseNote(h, today) ?? h.detail}</span>}
            </span>
          </label>
        ))}
      </div>
      {!due.length && (
        <p class="muted small">
          Nothing due today. <a href="#/habits">Add a habit</a>.
        </p>
      )}
    </section>
  );
}

function HabitEditor({ habit, today, onClose }) {
  const dialog = useRef(null);
  const [name, setName] = useState(habit?.name ?? '');
  const [detail, setDetail] = useState(habit?.detail ?? '');
  const [days, setDays] = useState(habit?.days ?? [0, 1, 2, 3, 4, 5, 6]);
  const [linked, setLinked] = useState(!!habit?.trigger);
  const [product, setProduct] = useState(habit?.trigger?.product ?? '');
  const [courseDays, setCourseDays] = useState(habit?.trigger?.days ?? 7);
  const [error, setError] = useState('');
  const products = [...getLists().products.common, ...getLists().products.more];
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
  const save = (event) => {
    event.preventDefault();
    if (!name.trim() || !days.length) return setError('Give the habit a name and choose at least one day.');
    const n = Number(courseDays);
    if (linked && (!product.trim() || !Number.isInteger(n) || n < 1 || n > 365)) return setError('Choose the product, and a course of 1 to 365 days.');
    try {
      saveHabit({ id: habit?.id ?? null, name: name.trim(), detail: detail.trim(), days, created: habit?.created ?? today, trigger: linked ? { product: product.trim(), days: n } : null, sort: habit?.sort ?? 0 });
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
  const toggleDay = (n) => setDays(days.includes(n) ? days.filter((d) => d !== n) : [...days, n]);
  return (
    <dialog ref={dialog} class="habit-dialog" aria-labelledby="habit-editor-title">
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
        <label class="habit-field" for="habit-detail">
          Small goal (optional)
        </label>
        <input type="text" id="habit-detail" value={detail} maxLength={100} onInput={(e) => setDetail(e.currentTarget.value)} placeholder="Legs and arms, at night" />
        <fieldset class="habit-days">
          <legend>Repeat on</legend>
          <div class="row">
            <button type="button" class="btn" onClick={() => setDays([0, 1, 2, 3, 4, 5, 6])}>
              Every day
            </button>
            <button type="button" class="btn" onClick={() => setDays([1, 2, 3, 4, 5])}>
              Weekdays
            </button>
          </div>
          <div class="habit-day-options">
            {[1, 2, 3, 4, 5, 6, 0].map((n) => (
              <label key={n}>
                <input type="checkbox" checked={days.includes(n)} onChange={() => toggleDay(n)} />
                {DAYS[n]}
              </label>
            ))}
          </div>
        </fieldset>
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
        {habit && <p class="muted small">Changing the schedule recalculates past weeks and streaks. Check-ins are kept.</p>}
        <p class="error small" role="status">
          {error}
        </p>
        <div class="row habit-form-actions">
          {habit && (
            <button type="button" class="btn ghost" onClick={remove}>
              Delete habit
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

export function HabitsView({ config }) {
  const today = useToday(config.tz);
  const state = useHabits(today);
  const { habits, done } = state;
  const [week, setWeek] = useState(() => weekStart(today));
  const [editing, setEditing] = useState(null); // null = closed, {} = new, a habit = editing it
  useEffect(() => setWeek(weekStart(today)), [today]);
  const due = habits.filter((h) => scheduled(h, today));
  const completed = due.filter((h) => done(h.id, today)).length;
  const progress = weekProgress(habits, today, done);
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
          <strong>{Math.max(0, ...habits.map((h) => currentStreak(h, today, done)))}</strong>
          <span>longest current streak</span>
        </div>
      </div>
      <div class="habit-week-nav">
        <button type="button" class="icon-btn" aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))}>
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
      <p class="muted small">Tap a square to tick or untick. Past days can be filled in.</p>
      <div class="habit-cards">
        {habits.map((habit) => (
          <section class="habit-card" key={habit.id} data-testid="habit-card">
            <div class="habit-heading">
              <div>
                <h3>{habit.name}</h3>
                <p class="muted small">{habit.detail || (habit.days.length === 7 ? 'Every day' : habit.days.map((d) => DAYS[d]).join(', '))}</p>
                {habit.trigger && <span class="habit-course-chip">{courseNote(habit, today)}</span>}
              </div>
              <button type="button" class="icon-btn" aria-label={`Edit ${habit.name}`} onClick={() => setEditing(habit)}>
                ⋯
              </button>
            </div>
            <div class="habit-week" role="group" aria-label={`${habit.name} check-ins`}>
              {dates.map((date) => {
                const isDue = scheduled(habit, date);
                const future = date > today;
                const isDone = isDue && done(habit.id, date);
                return (
                  <div class={date === today ? 'habit-day habit-is-today' : 'habit-day'} key={date}>
                    <span>{dateLabel(date, { weekday: 'short' })}</span>
                    <span class="habit-day-number">{Number(date.slice(-2))}</span>
                    <button
                      type="button"
                      class={`habit-check${isDone ? ' habit-done' : ''}`}
                      aria-label={`${habit.name}, ${date}: ${!isDue ? 'not due' : future ? 'future' : isDone ? 'done' : 'not done'}`}
                      aria-pressed={isDone}
                      disabled={!isDue || future}
                      onClick={() => toggleHabit(habit.id, date)}
                    >
                      {!isDue ? '—' : future ? '·' : isDone ? '✓' : ''}
                    </button>
                  </div>
                );
              })}
            </div>
            <p class="muted small habit-streak">{currentStreak(habit, today, done)} due days in a row</p>
          </section>
        ))}
        {!habits.length && <p class="muted">No habits yet. Add one small thing you want to keep doing, or a treatment course started from the skin log.</p>}
      </div>
      <p class="muted small">— Not due · · Future day. Streaks count due days; an unfinished today does not break yesterday’s streak.</p>
      {editing && <HabitEditor habit={editing.id ? editing : null} today={today} onClose={() => setEditing(null)} />}
    </div>
  );
}
