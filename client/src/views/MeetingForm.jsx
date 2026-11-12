import { useState } from 'preact/hooks';
import { api } from '../api.js';
import { usePeople } from './PersonProfile.jsx';

// New meeting (docs/MEETINGS.md): the minutes, who was there, the commitments, and a transcript pasted from another app
// with where it came from. It makes two notes in the project (minutes and transcript) and the record that ties them.
// Needs the server (it makes the notes and the record together), so it says so when out of reach.
export function MeetingForm({ project, today, onDone }) {
  const { people } = usePeople();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today);
  const [source, setSource] = useState('');
  const [attendees, setAttendees] = useState([]);
  const [minutes, setMinutes] = useState('');
  const [commitments, setCommitments] = useState('');
  const [transcript, setTranscript] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const toggle = (id) => setAttendees((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
  const chosen = people.filter((p) => attendees.includes(p.noteId));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.createMeeting({ projectId: project.id, title, date, source, attendees, minutes, commitments, transcript });
      onDone(r.meeting);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <form class="meeting-form" onSubmit={submit} data-testid="meeting-form">
      <div class="field">
        <label for="meeting-title">Meeting</label>
        <input id="meeting-title" type="text" value={title} maxLength={100} placeholder="e.g. Spring kickoff" onInput={(e) => setTitle(e.currentTarget.value)} data-testid="meeting-title" required />
      </div>
      <div class="field">
        <label for="meeting-date">Date</label>
        <input id="meeting-date" type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} data-testid="meeting-date" required />
      </div>
      <div class="field" data-testid="meeting-attendees">
        <label>Who was there</label>
        <div class="pills">
          {chosen.map((p) => (
            <button key={p.noteId} type="button" class="pill" aria-pressed="true" onClick={() => toggle(p.noteId)}>
              {p.title} ×
            </button>
          ))}
          <select aria-label="Add someone who was there" value="" onChange={(e) => e.currentTarget.value && toggle(e.currentTarget.value)} data-testid="meeting-attendee-select">
            <option value="">Add a person…</option>
            {people.filter((p) => !attendees.includes(p.noteId)).map((p) => (
              <option key={p.noteId} value={p.noteId}>{p.title}</option>
            ))}
          </select>
        </div>
      </div>
      <div class="field">
        <label for="meeting-minutes">Minutes (optional)</label>
        <textarea id="meeting-minutes" rows={4} value={minutes} onInput={(e) => setMinutes(e.currentTarget.value)} data-testid="meeting-minutes" />
      </div>
      <div class="field">
        <label for="meeting-commitments">Commitments (one per line, optional)</label>
        <textarea id="meeting-commitments" rows={3} value={commitments} placeholder={'Sam: send the budget by Friday\nbook the hall'} onInput={(e) => setCommitments(e.currentTarget.value)} data-testid="meeting-commitments" />
        <p class="muted small">A line that starts with the name of someone who was there becomes their task; the rest are yours.</p>
      </div>
      <div class="field">
        <label for="meeting-source">Where the transcript came from</label>
        <input id="meeting-source" type="text" value={source} maxLength={200} placeholder="e.g. the recording app that made it" onInput={(e) => setSource(e.currentTarget.value)} data-testid="meeting-source" />
      </div>
      <div class="field">
        <label for="meeting-transcript">Transcript (paste it as it is)</label>
        <textarea id="meeting-transcript" rows={6} value={transcript} onInput={(e) => setTranscript(e.currentTarget.value)} data-testid="meeting-transcript" />
        <p class="muted small">Kept word for word in its own note, with its source. It is not edited or summarised.</p>
      </div>
      {error && <p class="error inline" role="alert">{error}</p>}
      <div class="row">
        <button type="submit" class="btn primary" disabled={busy || !title.trim() || (!!transcript.trim() && !source.trim())} data-testid="meeting-create">Save meeting</button>
        <button type="button" class="btn" onClick={() => onDone(null)}>Cancel</button>
      </div>
    </form>
  );
}
