import { useEffect, useRef, useState } from 'preact/hooks';
import { addDays } from '../../../shared/dates.js';

const monthName = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${date}T00:00:00Z`));
const short = (date, today) => date ? new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', month: 'short', day: 'numeric', ...(date.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }) }).format(new Date(`${date}T00:00:00Z`)) : 'Any';

/** Two taps choose an inclusive range. Dates stay calendar dates in the home timezone. */
export function DateRangePicker({ from, to, today, onChange }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => `${(to || today).slice(0, 7)}-01`);
  const [position, setPosition] = useState({ top: 64, right: 8 });
  const [anchor, setAnchor] = useState(null);
  const root = useRef(null), trigger = useRef(null);
  const close = () => { setOpen(false); setAnchor(null); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const outside = (e) => { if (!root.current?.contains(e.target)) { setOpen(false); setAnchor(null); } };
    const escape = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    window.addEventListener('resize', close);
    const popup = root.current?.querySelector('.range-popover');
    const rect = trigger.current.getBoundingClientRect();
    const size = popup.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(rect.right - size.width, window.innerWidth - size.width - 8)), top: Math.max(64, Math.min(rect.bottom + 6, window.innerHeight - size.height - 64)) });
    root.current?.querySelector('.range-month button')?.focus();
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); window.removeEventListener('resize', close); };
  }, [open]);
  const move = (n) => { const d = new Date(`${month}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); setMonth(d.toISOString().slice(0, 10)); };
  const first = addDays(month, -new Date(`${month}T00:00:00Z`).getUTCDay());
  const pick = (date) => {
    if (!anchor) { setAnchor(date); onChange(date, date); }
    else { onChange(date < anchor ? date : anchor, date < anchor ? anchor : date); close(); }
  };
  return <div class="range-picker" ref={root}>
    <button class="range-trigger" ref={trigger} aria-label="Task history date range" aria-expanded={open} onClick={() => { setMonth(`${(to || today).slice(0, 7)}-01`); setOpen(!open); setAnchor(null); }} data-testid="archive-calendar">▦ {from || to ? `${short(from, today)} – ${short(to, today)}` : 'All dates'} ▾</button>
    {open && <div class="range-popover" style={position} role="dialog" aria-label="Task history date range calendar">
      <div class="range-month"><strong>{monthName(month)}</strong><button aria-label="Previous month" onClick={() => move(-1)}>‹</button><button aria-label="Next month" onClick={() => move(1)}>›</button></div>
      <div class="range-grid">{['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => <span class="muted" key={day}>{day}</span>)}
        {Array.from({ length: 42 }, (_, i) => { const date = addDays(first, i), selected = !!from && !!to && date >= from && date <= to; return <button key={date} class={`${date.slice(0, 7) !== month.slice(0, 7) ? 'outside ' : ''}${selected ? 'in-range ' : ''}${date === from ? 'range-start ' : ''}${date === to ? 'range-end' : ''}`} aria-label={date} aria-pressed={selected} aria-current={date === today ? 'date' : undefined} onClick={() => pick(date)}>{Number(date.slice(-2))}</button>; })}
      </div>
      <p class="small muted" aria-live="polite">{anchor ? 'Choose the end date' : 'Choose the start date'}</p>
      <div class="archive-range"><label>From<input type="date" value={from} onChange={(e) => { setAnchor(null); onChange(e.currentTarget.value, to); }} data-testid="archive-from" /></label><label>Through<input type="date" value={to} onChange={(e) => { setAnchor(null); onChange(from, e.currentTarget.value); }} data-testid="archive-to" /></label></div>
      <div class="row"><button class="link" onClick={() => { onChange('', ''); close(); }}>All dates</button><button class="link" onClick={close}>Done</button></div>
    </div>}
  </div>;
}
