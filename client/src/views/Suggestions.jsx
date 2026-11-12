import { useEffect, useState } from 'preact/hooks';
import { sync } from '../sync.js';
import { loadPeople } from '../people-data.js';
import { useMentions } from '../mentions.js';
import { dismiss, dismissedKeys, addedNames, rememberAdded, subscribeSuggestions } from '../suggestion-store.js';
import { suggest, undismissed, makeLineATask } from '../../../shared/suggestions.js';
import { makeLineATaskInEditor } from '../editor/suggestion-ops.js';
import { PEOPLE_TAG } from '../../../shared/people.js';
import { formatDateShort } from '../../../shared/dates.js';

// A short pause after the last change before the value is used, so a rule is not offered mid-sentence.
function useSettled(value, ms = 1200) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/** The suggestions for a document that have not been dismissed, re-read when a dismissal changes (this screen, or the Debrief). */
export function useSuggestions(doc, noteDate, settle = 1200) {
  const mentions = useMentions();
  const [, again] = useState(0);
  useEffect(() => subscribeSuggestions(() => again((n) => n + 1)), []);
  const signature = useSettled(JSON.stringify(doc), settle);
  let settledDoc = doc;
  try {
    settledDoc = JSON.parse(signature);
  } catch {
    /* keep the live one */
  }
  return undismissed(suggest({ doc: settledDoc, noteDate, matcher: mentions?.matcher ?? null, knownNames: addedNames() }), dismissedKeys());
}

/** Make the line a task: through the open editor (one undoable edit) or, with no editor, through the note's save session. */
export function acceptTask(session, editor, s) {
  if (editor && !editor.isDestroyed && session.provider) return makeLineATaskInEditor(editor, s.line, session.date);
  if (session.provider) return false;
  let done = false;
  session.editDoc((doc) => {
    const next = makeLineATask(doc, s.line, { noteDate: session.date });
    done = !!next;
    return next ?? doc;
  });
  return done;
}

/** Add the person: a new note in People, named as written, saved like any note (held on the phone first). The name then links itself. */
export async function acceptPerson(s, today) {
  await sync.ready;
  const person = sync.newNote(today, [PEOPLE_TAG]);
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Added from a journal entry.' }] }] };
  await person.fill(doc, s.name);
  rememberAdded(s.name);
  // Once the new person reaches the server the people list is read again, so the name is drawn as a link.
  const stop = person.subscribe(() => {
    if (person.status === 'saved') {
      stop();
      loadPeople();
    }
  });
  setTimeout(() => {
    stop();
    loadPeople();
  }, 6000);
}

const snippet = (line) => (line.length > 70 ? `${line.slice(0, 67)}…` : line);

/** One suggestion: the line it is about, one button to accept and one to dismiss. */
export function SuggestionRow({ s, onAccept }) {
  const [busy, setBusy] = useState(false);
  const label = s.kind === 'task' ? 'Make this a task' : `Add ${s.name} as a person`;
  return (
    <li class="suggestion" data-testid="suggestion" data-kind={s.kind}>
      <span class="suggestion-line" title={s.line}>
        {s.kind === 'person' ? <strong>{s.name}</strong> : '“'}
        {s.kind === 'person' ? <span class="muted"> in “{snippet(s.line)}”</span> : `${snippet(s.line)}”`}
        {s.due && <span class="muted"> · due {formatDateShort(s.due)}</span>}
      </span>
      <span class="suggestion-actions">
        <button
          type="button"
          class="btn suggestion-accept"
          disabled={busy}
          data-testid={`suggestion-${s.kind}`}
          onClick={async () => {
            setBusy(true);
            try {
              await onAccept(s);
            } finally {
              setBusy(false);
            }
          }}
        >
          {label}
        </button>
        <button type="button" class="btn ghost suggestion-dismiss" aria-label={`Dismiss: ${label}`} data-testid="suggestion-dismiss" onClick={() => dismiss(s.key)}>
          Dismiss
        </button>
      </span>
    </li>
  );
}

// Under the journal entry: what the built-in rules noticed in today's writing. Nothing changes unless one is tapped.
export function Suggestions({ session, editor, today }) {
  const list = useSuggestions(session.currentDoc(), session.date);
  const [problem, setProblem] = useState(null);
  if (!list.length && !problem) return null;
  const accept = async (s) => {
    setProblem(null);
    try {
      const ok = s.kind === 'task' ? acceptTask(session, editor, s) : (await acceptPerson(s, today), true);
      if (!ok) setProblem('That line has changed, so nothing was done.');
    } catch (err) {
      setProblem(err.message);
    }
  };
  return (
    <section class="suggestions" aria-label="Suggestions" data-testid="suggestions">
      <h3 class="today-sub">Suggestions</h3>
      <ul>
        {list.slice(0, 4).map((s) => (
          <SuggestionRow key={s.key} s={s} onAccept={accept} />
        ))}
      </ul>
      {list.length > 4 && <p class="muted small">{list.length - 4} more in the Debrief.</p>}
      {problem && <p class="error inline" role="alert">{problem}</p>}
    </section>
  );
}
