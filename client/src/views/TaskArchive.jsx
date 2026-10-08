import { DateRangePicker } from './DateRangePicker.jsx';
import { useRef, useState } from 'preact/hooks';
import { addDays, dateInTz, formatDateShort, changeTimestampDay, isValidDateString } from '../../../shared/dates.js';
import { extractTasks } from '../../../shared/tasks.js';
import { Sheet } from './parts.jsx';
import { getDoneDays } from '../prefs.js';

/** A view over the tasks still in this note; there is no duplicate history database. */
export function TaskArchive({ doc, noteDate, today, tz, onReactivate, onPatch }) {
  const [kind, setKind] = useState('all');
  const [from, setFrom] = useState(() => (getDoneDays() > 0 ? addDays(today, -(getDoneDays() - 1)) : '')); // the length is a setting
  const [to, setTo] = useState(() => (getDoneDays() > 0 ? today : ''));
  const [error, setError] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [dropDay, setDropDay] = useState(null);
  const [editing, setEditing] = useState(null);
  const [pickedDay, setPickedDay] = useState(today);
  const gesture = useRef(null);
  const tasks = extractTasks(doc, noteDate).filter((t) => t.checked || t.dismissedAt).map((t) => {
    const timestamp = t.dismissedAt || t.completedAt;
    return { ...t, day: timestamp ? dateInTz(new Date(timestamp), tz) : null, state: t.dismissedAt ? 'dismissed' : 'completed' };
  }).sort((a, b) => (b.day || '').localeCompare(a.day || ''));
  if (!tasks.length) return null;
  const valid = !from || !to || from <= to;
  const shown = tasks.filter((t) => (kind === 'all' || t.state === kind) && (!t.day || (valid && (!from || t.day >= from) && (!to || t.day <= to))));
  const older = tasks.filter((t) => t.day && from && t.day < from && (kind === 'all' || t.state === kind));
  const groups = new Map();
  for (const t of shown) { const day = t.day || 'unknown'; if (!groups.has(day)) groups.set(day, []); groups.get(day).push(t); }
  const dragging = tasks.find((task) => task.id === dragId);
  if (dragging) for (let i = 0; i < 14; i++) {
    const day = addDays(dragging.day || today, -i);
    if (day <= today && !groups.has(day)) groups.set(day, []);
  }
  const changeDay = (task, day) => {
    try {
      if (!isValidDateString(day) || day > today) throw new Error('Choose a date on or before today.');
      if (day === task.day) { setEditing(null); setError(null); return; }
      const key = task.dismissedAt ? 'dismissedAt' : 'completedAt';
      const timestamp = changeTimestampDay(task[key], day, tz);
      if (!onPatch?.(task.id, { [key]: timestamp })) throw new Error('That task is no longer in its note.');
      if (from && day < from) setFrom(day);
      if (to && day > to) setTo(day);
      setError(null); setEditing(null);
    } catch (e) { setError(e.message); }
  };
  return <details class={`task-archive${dragging ? ' is-dragging' : ''}`} data-testid="task-archive">
    <summary>Task history · {tasks.length}</summary>
    <div class="archive-tools"><nav aria-label="Task history status">{[['all', 'All'], ['completed', 'Completed'], ['dismissed', 'Dismissed']].map(([id, label]) => <button key={id} class="link" aria-pressed={kind === id} onClick={() => setKind(id)}>{label}</button>)}</nav><DateRangePicker from={from} to={to} today={today} onChange={(a, b) => { setFrom(a); setTo(b); }} /></div>
    {!valid && <p class="error" role="alert">The start date must come before the end date.</p>}
    {error && <p class="error" role="alert">{error}</p>}
    {!shown.length && <p class="muted">No tasks in this date range.</p>}
    {dragging && <p class="small muted" role="status">Drop on a day to change the recorded date. Tap the grip to choose any older date.</p>}
    {[...groups].sort(([a], [b]) => b.localeCompare(a)).map(([day, items]) => <section key={day} class={`archive-day${dragging ? ' drop-zone' : ''}${dropDay === day ? ' drop-active' : ''}`} data-history-day={day} onDragOver={(e) => { if (dragging && day !== 'unknown' && day <= today) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropDay(day); } }} onDrop={(e) => { if (dragging && day !== 'unknown') { e.preventDefault(); changeDay(dragging, day); setDragId(null); setDropDay(null); } }}><h3 class="section">{day === 'unknown' ? 'Date not recorded' : formatDateShort(day)}</h3><ul class="archive-list">{items.map((task) => <li key={task.id} data-testid="archive-task" data-state={task.state}>
      <button type="button" class="archive-grip" aria-label={`Change recorded date for ${task.text}`} title="Drag to another day, or tap to choose a date"
        onPointerDown={(e) => { if (e.button !== 0 || !onPatch) return; gesture.current = { x: e.clientX, y: e.clientY, moved: false, active: true }; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => {
          const g = gesture.current;
          if (!g?.active || (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) < 6)) return;
          g.moved = true; setDragId(task.id);
          if (e.clientY > innerHeight - 80) window.scrollBy(0, 12);
          else if (e.clientY < 80) window.scrollBy(0, -12);
          const day = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-history-day]')?.dataset.historyDay;
          g.day = day && day !== 'unknown' && day <= today ? day : null;
          setDropDay(g.day);
        }}
        onPointerUp={(e) => { const g = gesture.current; if (g) g.active = false; if (g?.moved && g.day) changeDay(task, g.day); setDragId(null); setDropDay(null); if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
        onPointerCancel={() => { gesture.current = null; setDragId(null); setDropDay(null); }}
        onClick={() => { if (gesture.current?.moved) { gesture.current = null; return; } gesture.current = null; setError(null); setPickedDay(task.day || today); setEditing(task); }}>⠿</button>
      <button class="archive-restore" aria-label="Bring back" title={`Bring back ${task.state} task`} onClick={() => { try { if (!onReactivate(task.id)) throw new Error('That task is no longer in its note.'); setError(null); } catch (e) { setError(e.message); } }}>{task.state === 'dismissed' ? '⊠' : '☑'}</button><span class="archive-task-text">{task.text}</span></li>)}</ul></section>)}
    {editing && <Sheet title="Change recorded task date" onClose={() => setEditing(null)}><p>{editing.text}</p><label class="field">{editing.state === 'dismissed' ? 'Dismissed on' : 'Completed on'}<input type="date" value={pickedDay} max={today} data-testid="history-date" onChange={(e) => setPickedDay(e.currentTarget.value)} /></label><p class="small muted">Changes the history date in {tz}. The task stays in its original note, and its recorded clock time is retained. Undo reverses the change.</p>{error && <p class="error" role="alert">{error}</p>}<button class="btn primary" data-testid="history-date-apply" onClick={() => changeDay(editing, pickedDay)}>Apply date</button></Sheet>}
    {older.length > 0 && <button class="btn block" data-testid="archive-older" onClick={() => { setFrom(older.map((t) => t.day).sort()[0]); if (to && to < from) setTo(today); }}>Show older tasks ({older.length})</button>}
  </details>;
}
