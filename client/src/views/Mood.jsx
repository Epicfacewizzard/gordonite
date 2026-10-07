import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.js';
import { addDays, dateInTz, timeInTz, formatDateShort } from '../../../shared/dates.js';
import { MOOD_LABELS, MAX_MOOD_NOTE, dayAverages, moodStreak } from '../../../shared/moods.js';
import { logMood, flushMoods, pendingMoods, dropPendingMood } from '../moods.js';

const FACES = ['😞', '🙁', '😐', '🙂', '😄'];
const WINDOW_DAYS = 30; // how far back the widget loads; the chart shows the last 7 or all 30
const colourOf = (avg) => `hsl(${(avg - 1) * 30} 55% 50%)`; // 1 = red ... 5 = green

// Tap a face to log how you feel (several times a day if you like), with an optional one-line note.
// Below: today's entries, a chart of the last 7 or 30 days, and the logging streak.
export function MoodWidget({ config, today }) {
  const [saved, setSaved] = useState({ moods: [], streak: 0 });
  const [queued, setQueued] = useState(pendingMoods);
  const [note, setNote] = useState('');
  const [range, setRange] = useState(7);
  const [status, setStatus] = useState('');
  const from = addDays(today, -(WINDOW_DAYS - 1));

  const load = async () => {
    try {
      const sent = await flushMoods();
      setQueued(pendingMoods());
      if (sent) setStatus('');
      setSaved(await api.moods(from, today));
    } catch {
      setStatus(pendingMoods().length ? 'Not sent yet. It is kept on this device and goes up when the connection is back.' : 'Can’t reach the server right now.');
    }
  };
  useEffect(() => {
    load();
    window.addEventListener('online', load);
    return () => window.removeEventListener('online', load);
  }, [today]);

  const log = async (score) => {
    logMood(score, note);
    setNote('');
    setQueued(pendingMoods());
    setStatus('');
    await load();
  };
  const remove = async (entry) => {
    if (entry.pending) {
      dropPendingMood(entry.id);
      setQueued(pendingMoods());
      return;
    }
    setSaved((s) => ({ ...s, moods: s.moods.filter((m) => m.id !== entry.id) }));
    try {
      await api.deleteMood(entry.id);
    } catch {
      setStatus('Could not delete that one. Try again when the connection is back.');
    }
    await load();
  };

  // what the server has plus what is still waiting to be sent
  const waiting = queued.map((m) => ({ id: m.id, score: m.score, note: m.note, at: m.at, day: dateInTz(new Date(m.at), config.tz), pending: true }));
  const known = new Set(saved.moods.map((m) => m.id));
  const all = [...saved.moods, ...waiting.filter((m) => !known.has(m.id))].sort((a, b) => (a.at < b.at ? -1 : 1));
  const todays = all.filter((m) => m.day === today);
  const rows = dayAverages(all, addDays(today, -(range - 1)), today);
  const days = new Set(all.map((m) => m.day));
  const streak = Math.max(moodStreak(days, today), saved.streak);
  const logged = rows.filter((r) => r.count > 0).length;

  return (
    <section class="widget" data-testid="widget-mood">
      <h2 class="section">Mood</h2>
      <div class="mood-faces" role="group" aria-label="How are you feeling?">
        {FACES.map((face, i) => (
          <button key={i} type="button" class="mood-face" data-testid={`mood-${i + 1}`} aria-label={`Log mood ${i + 1} of 5: ${MOOD_LABELS[i]}`} onClick={() => log(i + 1)}>
            {face}
          </button>
        ))}
      </div>
      <input class="mood-note" type="text" maxLength={MAX_MOOD_NOTE} placeholder="Add a note (optional), then tap a face" aria-label="Note for the next mood entry" data-testid="mood-note" value={note} onInput={(e) => setNote(e.currentTarget.value)} />
      {status && (
        <p class="muted small" role="status" data-testid="mood-status">
          {status}
        </p>
      )}
      {todays.length > 0 && (
        <ul class="mood-entries" data-testid="mood-entries" aria-label="Today’s mood entries">
          {todays.map((m) => (
            <li key={m.id} data-testid="mood-entry">
              <span class="muted small">{timeInTz(new Date(m.at), config.tz)}</span>
              <span aria-label={MOOD_LABELS[m.score - 1]}>{FACES[m.score - 1]}</span>
              <span class="mood-text">
                {m.note}
                {m.pending && <span class="muted small"> (not sent yet)</span>}
              </span>
              <button type="button" class="btn" aria-label="Delete this mood entry" data-testid="mood-delete" onClick={() => remove(m)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div class="mood-range" role="group" aria-label="Chart range">
        {[7, 30].map((n) => (
          <button key={n} type="button" class="btn" aria-pressed={range === n} data-testid={`mood-range-${n}`} onClick={() => setRange(n)}>
            {n} days
          </button>
        ))}
        <span class="muted small" data-testid="mood-summary">
          {streak > 0 ? `${streak}-day streak · ` : ''}
          {logged} of the last {range} days logged
        </span>
      </div>
      <div class="mood-chart" role="img" aria-label={`Mood for the last ${range} days, one bar per day`} data-testid="mood-chart">
        {rows.map((r) => (
          <span
            key={r.day}
            class={`mood-bar${r.avg === null ? ' empty' : ''}`}
            data-testid="mood-bar"
            data-day={r.day}
            title={r.avg === null ? `${formatDateShort(r.day)}: nothing logged` : `${formatDateShort(r.day)}: average ${r.avg.toFixed(1)} (${r.count} ${r.count === 1 ? 'entry' : 'entries'})`}
            style={r.avg === null ? undefined : { height: `${(r.avg / 5) * 100}%`, background: colourOf(r.avg) }}
          />
        ))}
      </div>
      <div class="mood-axis muted small">
        <span>{formatDateShort(rows[0].day)}</span>
        <span>Today</span>
      </div>
    </section>
  );
}
