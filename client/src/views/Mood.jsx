import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../api.js';
import { addDays, dateInTz, timeInTz, formatDateShort } from '../../../shared/dates.js';
import { MOOD_LABELS, MAX_MOOD_NOTE, dayAverages, moodStreak } from '../../../shared/moods.js';
import { logMood, flushMoods, pendingMoods, dropPendingMood } from '../moods.js';
import { getMoodPrefs } from '../prefs.js';

const FACES = ['😞', '🙁', '😐', '🙂', '😄'];
const WINDOW_DAYS = 30; // how far back to load (the streak can run longer than the table)
const TABLE_DAYS = 7;
const colourOf = (avg) => `hsl(${(avg - 1) * 30} 55% 50% / 0.35)`; // 1 = red ... 5 = green, softened
const weekdayLetter = (day) => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', weekday: 'narrow' }).format(new Date(`${day}T00:00:00Z`));

// A compact band for the top of the dashboard. Tap a face to pick how you feel; a Note box and a Log button then
// appear, and nothing is saved until Log is tapped (as often as you like). Two switches in Settings → Dashboard
// (prefs.js, MOOD_OPTIONS) change this: one tap logs straight away, and the history (the 7-day table, the streak and
// today's entries with their delete buttons) can be shown. The history is off until you turn it on.
export function MoodWidget({ config, today }) {
  const { askNote, history } = getMoodPrefs();
  const [saved, setSaved] = useState({ moods: [], streak: 0 });
  const [queued, setQueued] = useState(pendingMoods);
  const [picked, setPicked] = useState(null); // the face chosen but not logged yet (1-5)
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('');
  const [done, setDone] = useState(null); // the score just logged, shown briefly as a confirmation
  const doneTimer = useRef(null);
  const from = addDays(today, -(WINDOW_DAYS - 1));

  const load = async () => {
    try {
      const sent = await flushMoods();
      setQueued(pendingMoods());
      if (pendingMoods().length) throw new Error('waiting to be sent');
      if (sent) setStatus('');
      if (history) setSaved(await api.moods(from, today));
    } catch {
      setStatus(pendingMoods().length ? 'Not sent yet. It is kept on this device and goes up when the connection is back.' : 'Can’t reach the server right now.');
    }
  };
  useEffect(() => {
    load();
    window.addEventListener('online', load);
    return () => window.removeEventListener('online', load);
  }, [today]);
  useEffect(() => () => clearTimeout(doneTimer.current), []);

  const log = async (chosen = picked) => {
    if (!chosen) return;
    const score = chosen;
    logMood(score, note);
    setPicked(null);
    setNote('');
    setQueued(pendingMoods());
    setStatus('');
    setDone(score);
    clearTimeout(doneTimer.current);
    doneTimer.current = setTimeout(() => setDone(null), 3000);
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
  const rows = dayAverages(all, addDays(today, -(TABLE_DAYS - 1)), today);
  const streak = Math.max(moodStreak(new Set(all.map((m) => m.day)), today), saved.streak);
  const logged = rows.filter((r) => r.count > 0).length;

  return (
    <section class="widget mood" data-testid="widget-mood">
      <div class="mood-head">
        <h2 class="section">Mood</h2>
        {history && (
          <span class="muted small" data-testid="mood-summary">
            {streak > 0 ? `${streak}-day streak · ` : ''}
            {logged} of the last {TABLE_DAYS} days
          </span>
        )}
      </div>
      <div class={`mood-body${history ? '' : ' solo'}`}>
        <div class="mood-input">
          <div class="mood-faces" role="group" aria-label="How are you feeling?">
            {FACES.map((face, i) => (
              <button key={i} type="button" class="mood-face" data-testid={`mood-${i + 1}`} aria-pressed={picked === i + 1} aria-label={`Mood ${i + 1} of 5: ${MOOD_LABELS[i]}`} onClick={() => (askNote ? setPicked(picked === i + 1 ? null : i + 1) : log(i + 1))}>
                {face}
              </button>
            ))}
          </div>
          {picked && (
            <form
              class="mood-log"
              data-testid="mood-log-form"
              onSubmit={(e) => {
                e.preventDefault();
                log(picked);
              }}
            >
              <input class="mood-note" type="text" maxLength={MAX_MOOD_NOTE} placeholder="Note" aria-label={`Note for this mood (${MOOD_LABELS[picked - 1]})`} autocomplete="off" enterkeyhint="done" data-testid="mood-note" value={note} onInput={(e) => setNote(e.currentTarget.value)} />
              <button type="submit" class="btn primary" data-testid="mood-log">
                Log
              </button>
            </form>
          )}
          {done && !status && (
            <p class="muted small" role="status" data-testid="mood-done">
              Logged {FACES[done - 1]}
            </p>
          )}
        </div>
        {history && (
          <table class="mood-table" data-testid="mood-table" aria-label={`Mood for the last ${TABLE_DAYS} days`}>
            <thead>
              <tr>
                {rows.map((r) => (
                  <th key={r.day} scope="col" class={r.day === today ? 'today' : ''} title={formatDateShort(r.day)}>
                    {weekdayLetter(r.day)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {rows.map((r) => (
                  <td
                    key={r.day}
                    data-testid="mood-cell"
                    data-day={r.day}
                    style={r.avg === null ? undefined : { background: colourOf(r.avg) }}
                    title={r.avg === null ? `${formatDateShort(r.day)}: nothing logged` : `${formatDateShort(r.day)}: average ${r.avg.toFixed(1)} (${r.count} ${r.count === 1 ? 'entry' : 'entries'})`}
                  >
                    {r.avg === null ? <span class="muted">·</span> : FACES[Math.round(r.avg) - 1]}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        )}
      </div>
      {status && (
        <p class="muted small" role="status" data-testid="mood-status">
          {status}
        </p>
      )}
      {history && todays.length > 0 && (
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
    </section>
  );
}
