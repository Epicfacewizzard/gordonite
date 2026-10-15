import { useEffect, useRef, useState } from 'preact/hooks';
import { useToday } from '../hooks.js';
import { addDays } from '../../../shared/dates.js';
import { HabitStore, HABIT_KEY, DAYS, weekStart, scheduled, checked, currentStreak, weekProgress, validateHabits } from '../habit-data.js';

const store = new HabitStore({
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
});
const dateLabel = (date, options = { month: 'short', day: 'numeric' }) => new Date(date + 'T12:00:00Z').toLocaleDateString(undefined, { ...options, timeZone: 'UTC' });
function useHabits(today) {
  const [, rerender] = useState(0);
  useEffect(() => {
    const stop = store.subscribe(() => rerender((n) => n + 1));
    const changed = (event) => { if (event.key === HABIT_KEY || event.key === null) store.externalChange(); };
    window.addEventListener('storage', changed);
    return () => { stop(); window.removeEventListener('storage', changed); };
  }, []);
  return store.read(today);
}
function StorageWarning() {
  return store.error ? <p class="banner error small" role="alert">{store.error}</p> : null;
}

export function HabitsWidget({ today }) {
  const { habits } = useHabits(today);
  const due = habits.filter((habit) => scheduled(habit, today));
  const done = due.filter((habit) => checked(habit, today)).length;
  return <section class="widget" data-testid="widget-habits">
    <div class="habit-heading"><h2 class="section">Habits</h2><a href="#/habits" class="small">History &amp; manage</a></div>
    <StorageWarning />
    <p class="muted small">{done} of {due.length} today · saved in this browser</p>
    <div class="habit-today-list">
      {due.map((habit) => <label class="habit-today-row" key={habit.id}>
        <input type="checkbox" checked={checked(habit, today)} onChange={() => store.toggle(habit.id, today, today)} />
        <span><span class={checked(habit, today) ? 'muted' : ''}>{habit.name}</span>{habit.detail && <span class="habit-detail">{habit.detail}</span>}</span>
      </label>)}
    </div>
    {!due.length && <p class="muted small">No habits scheduled today. <a href="#/habits">Choose a habit</a>.</p>}
  </section>;
}

function HabitEditor({ habit, today, onClose }) {
  const dialog = useRef(null);
  const [name, setName] = useState(habit?.name ?? '');
  const [detail, setDetail] = useState(habit?.detail ?? '');
  const [days, setDays] = useState(habit?.days ?? [0, 1, 2, 3, 4, 5, 6]);
  const [error, setError] = useState('');
  useEffect(() => {
    const node = dialog.current; node.showModal();
    const cancel = (event) => { event.preventDefault(); onClose(); };
    node.addEventListener('cancel', cancel);
    return () => { node.removeEventListener('cancel', cancel); node.close(); };
  }, []);
  const save = (event) => {
    event.preventDefault();
    if (!name.trim() || !days.length) { setError('Give your habit a name and choose at least one day.'); return; }
    try {
      store.change(today, (data) => {
        const existing = habit && data.habits.find((h) => h.id === habit.id);
        if (habit && !existing) throw Error('This habit was removed in another tab. Close this form and add it again.');
        if (!existing && data.habits.length >= 100) throw Error('This preview supports up to 100 habits.');
        const next = { ...(existing ?? { id: crypto.randomUUID(), created: today, checks: [] }), name: name.trim(), detail: detail.trim(), days };
        data.habits = existing ? data.habits.map((h) => h.id === next.id ? next : h) : [...data.habits, next];
        return data;
      });
      onClose();
    } catch (err) { setError(err.message); }
  };
  const remove = () => {
    if (!confirm('Delete “' + habit.name + '” and its check-in history?')) return;
    store.change(today, (data) => ({ ...data, habits: data.habits.filter((h) => h.id !== habit.id) })); onClose();
  };
  return <dialog ref={dialog} class="habit-dialog" aria-labelledby="habit-editor-title">
    <form onSubmit={save}>
      <div class="habit-heading"><h2 id="habit-editor-title">{habit ? 'Edit habit' : 'New habit'}</h2><button type="button" class="icon-btn" aria-label="Close habit editor" onClick={onClose}>×</button></div>
      <label class="habit-field" for="habit-name">Habit name</label><input autoFocus type="text" id="habit-name" value={name} maxLength={80} required onInput={(e) => setName(e.currentTarget.value)} placeholder="Read a few pages" />
      <label class="habit-field" for="habit-detail">Small goal (optional)</label><input type="text" id="habit-detail" value={detail} maxLength={100} onInput={(e) => setDetail(e.currentTarget.value)} placeholder="Ten minutes is enough" />
      <fieldset class="habit-days"><legend>Repeat on</legend>
        <div class="row"><button type="button" class="btn" onClick={() => setDays([0, 1, 2, 3, 4, 5, 6])}>Every day</button><button type="button" class="btn" onClick={() => setDays([1, 2, 3, 4, 5])}>Weekdays</button></div>
        <div class="habit-day-options">{[1, 2, 3, 4, 5, 6, 0].map((n) => <label key={n}><input type="checkbox" checked={days.includes(n)} onChange={() => setDays(days.includes(n) ? days.filter((d) => d !== n) : [...days, n])} />{DAYS[n]}</label>)}</div>
      </fieldset>
      {habit && <p class="muted small">Changing the schedule recalculates past weeks and streaks. Existing check-ins are retained.</p>}
      <p class="error small" role="status">{error}</p>
      <div class="row habit-form-actions">{habit && <button type="button" class="btn ghost" onClick={remove}>Delete habit</button>}<button type="button" class="btn" onClick={onClose}>Cancel</button><button class="btn primary" type="submit">Save habit</button></div>
    </form>
  </dialog>;
}

export function HabitsView({ config }) {
  const today = useToday(config.tz);
  const data = useHabits(today);
  const { habits } = data;
  const [week, setWeek] = useState(() => weekStart(today));
  const [editing, setEditing] = useState(null); // null = closed, {} = new
  const [message, setMessage] = useState('');
  const [backup, setBackup] = useState(null);
  const [restore, setRestore] = useState('');
  const due = habits.filter((h) => scheduled(h, today));
  const completed = due.filter((h) => checked(h, today)).length;
  const progress = weekProgress(habits, today);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  useEffect(() => setWeek(weekStart(today)), [today]);
  const restoreBackup = () => {
    try {
      if (restore.length > 5 * 1024 * 1024) throw Error('Choose a backup smaller than 5 MB.');
      const value = validateHabits(JSON.parse(restore), today);
      if (!confirm('Replace this preview’s habits with ' + value.habits.length + ' habits from this backup? Copy your current backup first if you want to keep it.')) return;
      store.change(today, () => value); setRestore(''); setMessage('Habit backup restored.');
    } catch (error) { setMessage(error instanceof SyntaxError ? 'That is not valid JSON. Nothing was replaced.' : error.message); }
  };
  return <div class="habits-view">
    <p class="muted small">Habits live in this browser for this local experiment. They are separate from notes and do not sync.</p>
    <StorageWarning />
    <div class="habit-heading"><h2 class="section">Your habits</h2><button type="button" class="btn primary" onClick={() => setEditing({})}>New habit</button></div>
    <div class="habit-summary" aria-label="Habit progress">
      <div><strong>{completed} / {due.length}</strong><span>today</span></div>
      <div><strong>{progress.total ? Math.round(progress.done / progress.total * 100) : 0}%</strong><span>this week so far</span></div>
      <div><strong>{Math.max(0, ...habits.map((h) => currentStreak(h, today)))}</strong><span>longest current streak</span></div>
    </div>
    <div class="habit-week-nav"><button type="button" class="icon-btn" aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))}>‹</button><strong>{dateLabel(week)} – {dateLabel(addDays(week, 6), { month: 'short', day: 'numeric', year: 'numeric' })}</strong><button type="button" class="icon-btn" aria-label="Next week" disabled={week >= weekStart(today)} onClick={() => setWeek(addDays(week, 7))}>›</button><button type="button" class="btn" onClick={() => setWeek(weekStart(today))}>Today</button></div>
    <p class="muted small">Tap a square to check in or undo. You can fill in past days.</p>
    <div class="habit-cards">
      {habits.map((habit) => <section class="habit-card" key={habit.id}>
        <div class="habit-heading"><div><h3>{habit.name}</h3><p class="muted small">{habit.detail || (habit.days.length === 7 ? 'Every day' : habit.days.map((d) => DAYS[d]).join(', '))}</p></div><button type="button" class="icon-btn" aria-label={'Edit ' + habit.name} onClick={() => setEditing(habit)}>⋯</button></div>
        <div class="habit-week" role="group" aria-label={habit.name + ' check-ins'}>
          {dates.map((date) => {
            const due = scheduled(habit, date), future = date > today, done = due && checked(habit, date);
            return <div class={date === today ? 'habit-day habit-is-today' : 'habit-day'} key={date}>
              <span>{dateLabel(date, { weekday: 'short' })}</span><span class="habit-day-number">{Number(date.slice(-2))}</span>
              <button type="button" class={'habit-check' + (done ? ' habit-done' : '')} aria-label={habit.name + ', ' + date + ': ' + (!due ? 'not scheduled' : future ? 'future' : done ? 'completed' : 'not completed')} aria-pressed={done} disabled={!due || future} onClick={() => store.toggle(habit.id, date, today)}>{!due ? '—' : future ? '·' : done ? '✓' : ''}</button>
            </div>;
          })}
        </div>
        <p class="muted small habit-streak">{currentStreak(habit, today)} scheduled days in a row</p>
      </section>)}
      {!habits.length && <p class="muted">No habits yet. Add one small thing you want to keep doing.</p>}
    </div>
    <p class="muted small">— Not scheduled · · Future day. Streaks count scheduled days; an unfinished today does not break yesterday’s streak.</p>
    <details class="habit-data-tools"><summary>Sample data &amp; backups</summary>
      <p class="muted small">This preview starts with fictional habits and history. You can remove them and make your own. Copy a backup before clearing browser data.</p>
      <div class="row"><button type="button" class="btn" onClick={() => setBackup(JSON.stringify(store.read(today), null, 2))}>Show backup</button><button type="button" class="btn" onClick={() => { if (confirm('Remove all habits and check-ins in this local preview?')) { store.change(today, () => ({ format: 1, habits: [] })); setMessage('Ready for your own habits.'); } }}>Start fresh</button></div>
      {backup !== null && <><label class="habit-field" for="habit-backup">Copy this text into a .json file to keep a backup</label><textarea id="habit-backup" readOnly value={backup} onFocus={(e) => e.currentTarget.select()} /><button type="button" class="btn" onClick={() => setBackup(null)}>Close backup</button></>}
      <label class="habit-field" for="habit-restore">Paste a habit backup to restore</label><textarea id="habit-restore" value={restore} onInput={(e) => setRestore(e.currentTarget.value)} placeholder="Paste the JSON from a habit backup" />
      <button type="button" class="btn" disabled={!restore.trim()} onClick={restoreBackup}>Restore backup</button>
      <p role="status" class="small">{message}</p>
    </details>
    {editing && <HabitEditor habit={editing.id ? editing : null} today={today} onClose={() => setEditing(null)} />}
  </div>;
}
