import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../api.js';
import { addDays, dateInTz, timeInTz, formatDateShort } from '../../../shared/dates.js';
import { MOOD_LABELS, MAX_MOOD_NOTE, dayAverages, moodStreak } from '../../../shared/moods.js';
import { logMood, flushMoods, pendingMoods, dropPendingMood, retryMood, moodStorageProblem, subscribeMoods } from '../moods.js';
import { getMoodPrefs } from '../prefs.js';

const FACES = ['😞', '🙁', '😐', '🙂', '😄'];
const NOT_SENT = 'Not sent yet. It is kept on this device and goes up when the connection is back.';
const NEEDS_LOGIN = 'Log in to send this. It is kept on this device until then.';
const NOT_STORED = 'Not sent yet, and this device could not store a copy. Keep this page open until it is sent.';
const UNREACHABLE = 'Can’t reach the server right now.';
// Why the server refused an entry, in words for the person (the server's own message is the fallback).
const REFUSED = {
  bad_score: 'The server did not accept the mood score.',
  bad_note: 'The server did not accept the note.',
  bad_time: 'The server did not accept the time of this entry. Check this device’s clock.',
  bad_body: 'The server did not accept this entry.',
};
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
  const [lastSend, setLastSend] = useState({ failure: null, paused: false }); // how the latest attempt to send ended
  const [picked, setPicked] = useState(null); // the face chosen but not logged yet (1-5)
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('');
  const [done, setDone] = useState(null); // the score just logged, shown briefly as a confirmation
  const [undo, setUndo] = useState(null); // the entry just deleted, with a short window to bring it back
  const doneTimer = useRef(null);
  const undoTimer = useRef(null);
  const from = addDays(today, -(WINDOW_DAYS - 1));

  // Entries still waiting on this device (and any the server refused) always come from the queue itself.
  useEffect(() => subscribeMoods(() => setQueued(pendingMoods())), []);

  const load = async () => {
    const result = await flushMoods();
    setLastSend({ failure: result.failure, paused: result.paused });
    if (result.sent) setStatus('');
    if (result.failure) return; // the server could not be reached or wants a login: nothing more to ask it
    if (history) {
      try {
        setSaved(await api.moods(from, today));
        setStatus((s) => (s === UNREACHABLE ? '' : s));
      } catch {
        setStatus(UNREACHABLE);
      }
    }
  };
  useEffect(() => {
    load();
    window.addEventListener('online', load);
    return () => window.removeEventListener('online', load);
  }, [today]);
  useEffect(
    () => () => {
      clearTimeout(doneTimer.current);
      clearTimeout(undoTimer.current);
    },
    [],
  );

  const log = async (chosen = picked) => {
    if (!chosen) return;
    const score = chosen;
    logMood(score, note);
    setPicked(null);
    setNote('');
    setStatus('');
    setDone(score);
    clearTimeout(doneTimer.current);
    doneTimer.current = setTimeout(() => setDone(null), 3000);
    await load();
  };
  const tryAgain = async (id) => {
    retryMood(id);
    await load();
  };
  const remove = async (entry) => {
    if (entry.pending) {
      dropPendingMood(entry.id);
      return;
    }
    setSaved((s) => ({ ...s, moods: s.moods.filter((m) => m.id !== entry.id) }));
    try {
      await api.deleteMood(entry.id);
      // A tap in the wrong place should not cost an entry: offer to bring it back for a while.
      setUndo({ id: entry.id, score: entry.score });
      clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndo(null), 15_000);
    } catch {
      setStatus('Could not delete that one. Try again when the connection is back.');
    }
    await load();
  };
  const undoDelete = async () => {
    const back = undo;
    if (!back) return;
    clearTimeout(undoTimer.current);
    setUndo(null);
    try {
      await api.restoreMood(back.id);
    } catch {
      setStatus('Could not bring that one back. Try again when the connection is back.');
    }
    await load();
  };

  // what the server has plus what is still waiting to be sent
  const waiting = queued.map((m) => ({ id: m.id, score: m.score, note: m.note, at: m.at, day: dateInTz(new Date(m.at), config.tz), pending: true, refused: !!m.rejected }));
  const refused = queued.filter((m) => m.rejected);
  const unsent = queued.length - refused.length;
  // Why entries are still here. A storage problem matters more than the connection: closing the page loses them.
  const storageProblem = unsent > 0 ? moodStorageProblem() : null;
  let queueNote = '';
  if (unsent > 0 && lastSend.paused) queueNote = NEEDS_LOGIN;
  else if (unsent > 0 && lastSend.failure) queueNote = storageProblem ? NOT_STORED : NOT_SENT;
  const message = status || queueNote;
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
          {done && !message && (
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
      {message && (
        <p class="muted small" role="status" data-testid="mood-status">
          {message}
        </p>
      )}
      {refused.length > 0 && (
        <ul class="mood-entries mood-refused" data-testid="mood-refused" aria-label="Entries the server did not accept">
          {refused.map((m) => (
            <li key={m.id} data-testid="mood-refused-entry">
              <span aria-label={MOOD_LABELS[m.score - 1]}>{FACES[m.score - 1]}</span>
              <span class="mood-text">
                <span class="muted small">{timeInTz(new Date(m.at), config.tz)}</span> {m.note}
                <span class="small" title={m.rejected.message}>
                  {' '}
                  {REFUSED[m.rejected.code] ?? m.rejected.message}
                </span>
              </span>
              <button type="button" class="btn" data-testid="mood-refused-retry" onClick={() => tryAgain(m.id)}>
                Try again
              </button>
              <button type="button" class="btn" data-testid="mood-refused-discard" onClick={() => dropPendingMood(m.id)}>
                Discard
              </button>
            </li>
          ))}
        </ul>
      )}
      {undo && (
        <p class="muted small" role="status" data-testid="mood-undo">
          Deleted {FACES[undo.score - 1]}.{' '}
          <button type="button" class="link" data-testid="mood-undo-button" onClick={undoDelete}>
            Undo
          </button>
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
                {m.pending && <span class="muted small">{m.refused ? ' (not accepted)' : ' (not sent yet)'}</span>}
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
