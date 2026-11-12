import { useEffect, useState } from 'preact/hooks';
import { api, NetworkError } from '../api.js';
import { sync } from '../sync.js';
import { useSession, useTaskData, useToday } from '../hooks.js';
import { taskCommands } from '../task-commands.js';
import { shownPatch } from '../task-data.js';
import { useMentions, peopleInText } from '../mentions.js';
import { dismiss, dismissedKeys, subscribeSuggestions } from '../suggestion-store.js';
import { plainText } from '../../../shared/doc.js';
import { addDays, formatDateLabel, formatDateShort, isOverdue } from '../../../shared/dates.js';
import { taskKey } from '../../../shared/tasks.js';
import { makeLineATask, taskFromParagraph, normalLine } from '../../../shared/suggestions.js';
import { savePersonProfile, peopleState } from '../people-data.js';
import { SuggestionRow, acceptTask, acceptPerson, useSuggestions } from './Suggestions.jsx';
import { useNowTime } from '../hooks.js';

// The journal's session for a day: the one this device has, or a draft. Not found on the server and out of reach: a draft.
async function journalSession(tag, day) {
  await sync.ready;
  try {
    const res = await api.stream(tag);
    res.notes.forEach((n) => sync.adopt(n));
    const existing = res.notes.find((n) => n.date === day && n.kind === 'daily');
    return existing ? sync.get(existing.id) : res.tag.daily ? sync.draft(tag, day) : null;
  } catch (err) {
    if (err instanceof NetworkError) return sync.draft(tag, day);
    throw err;
  }
}

const proposalKey = (id) => `proposal:${id}`;

// Carry out a suggestion an assistant filed. Everything goes through the usual save path (the phone first, then the server
// against a revision), exactly as if the owner had done it by hand; the server only learns afterwards that it was accepted.
async function acceptProposal(p, { dailyTag, day }) {
  if (p.kind === 'person') {
    await acceptPerson({ name: p.name }, day);
    return true;
  }
  if (p.kind === 'remember') {
    const profile = peopleState().profileOf(p.personId);
    if (!peopleState().people.some((x) => x.noteId === p.personId)) throw new Error('That person is no longer in People.');
    if (profile.remember.some((x) => x.toLowerCase() === p.text.toLowerCase())) return true;
    savePersonProfile(p.personId, { ...profile, remember: [...profile.remember, p.text] });
    return true;
  }
  // task: turn the journal line into it, or add it to the end of the day's entry
  const session = await journalSession(dailyTag, day);
  if (!session) throw new Error('There is no journal entry for that day to add the task to.');
  if (session.provider) throw new Error('Close the journal entry on Today first.');
  const wanted = p.line ? normalLine(p.line) : null;
  session.editDoc((doc) => {
    const converted = wanted ? makeLineATask(doc, wanted, { noteDate: session.date, due: p.due ?? undefined }) : null;
    if (converted) return converted;
    const paragraph = { type: 'paragraph', content: [{ type: 'text', text: p.text }] };
    return { ...doc, content: [...(doc.content ?? []).filter((n, i, all) => !(i === all.length - 1 && n.type === 'paragraph' && !n.content?.length)), taskFromParagraph(paragraph, { due: p.due ?? null })] };
  });
  return true;
}

function useProposals(day) {
  const [list, setList] = useState([]);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    api.suggestions(day).then((r) => !cancelled && setList(r.suggestions)).catch(() => !cancelled && setList([]));
    return () => {
      cancelled = true;
    };
  }, [day, nonce]);
  const [, again] = useState(0);
  useEffect(() => subscribeSuggestions(() => again((n) => n + 1)), []);
  const hidden = dismissedKeys();
  return [list.filter((p) => !hidden.has(proposalKey(p.id))), () => setNonce((n) => n + 1)];
}

function ProposalRow({ p, onAccept, onDismiss }) {
  const [busy, setBusy] = useState(false);
  const label = p.kind === 'task' ? 'Make this a task' : p.kind === 'person' ? `Add ${p.name} as a person` : 'Remember this';
  return (
    <li class="suggestion" data-testid="proposal" data-kind={p.kind}>
      <span class="suggestion-line">
        {p.kind === 'person' ? <strong>{p.name}</strong> : p.kind === 'remember' ? `“${p.text}”` : p.text}
        {p.due && <span class="muted"> · due {formatDateShort(p.due)}</span>}
        <span class="muted small"> · from your assistant{p.reason ? `: ${p.reason}` : ''}</span>
      </span>
      <span class="suggestion-actions">
        <button
          type="button"
          class="btn suggestion-accept"
          disabled={busy}
          data-testid="proposal-accept"
          onClick={async () => {
            setBusy(true);
            try {
              await onAccept(p);
            } finally {
              setBusy(false);
            }
          }}
        >
          {label}
        </button>
        <button type="button" class="btn ghost suggestion-dismiss" data-testid="proposal-dismiss" onClick={() => onDismiss(p)}>
          Dismiss
        </button>
      </span>
    </li>
  );
}

// One task in the Debrief: the tick, the words, and When in one tap.
function DebriefTask({ t, today, now, apply }) {
  const overdue = !t.checked && isOverdue(t.due, t.dueTime, today, now);
  const choices = [['today', 'Today', today], ['tomorrow', 'Tomorrow', addDays(today, 1)], ['nextweek', 'Next week', addDays(today, 7 - ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7))]];
  return (
    <li key={taskKey(t)} class={`task-row${t.checked ? ' done' : ''}`} data-testid="debrief-task" data-bar={overdue ? 'red' : 'none'}>
      <label class="task-check">
        <input type="checkbox" checked={t.checked} onChange={() => apply(t, { checked: !t.checked })} aria-label={`Done: ${t.text}`} />
      </label>
      <div class="task-body">
        <a class="task-text" href={`#/n/${t.noteId}`}>{t.text}</a>
        <span class="task-meta">
          {t.due && <span class={`task-chip${overdue ? ' overdue' : ''}`}>due {formatDateLabel(t.due, today)}</span>}
          {!t.checked && (
            <span class="debrief-when" role="group" aria-label="When">
              {choices.map(([id, label, date]) => (
                <button key={id} type="button" class="btn ghost small" aria-pressed={t.due === date} data-testid={`debrief-when-${id}`} onClick={() => apply(t, { due: date })}>
                  {label}
                </button>
              ))}
            </span>
          )}
        </span>
      </div>
    </li>
  );
}

const firstLine = (doc) => plainText(doc).split('\n').map((l) => l.trim()).find(Boolean) ?? '';
const MORE = 8;

// One screen for the day: what was written, who was named, the tasks made and the ones still open, and every suggestion
// waiting, each one tap. It reads what this phone holds, so it works offline; nothing changes until a button is tapped.
export function DebriefView({ config }) {
  useSession();
  const today = useToday(config.tz);
  const now = useNowTime(config.tz);
  const day = today;
  const data = useTaskData();
  const mentions = useMentions();
  const [dailyTag, setDailyTag] = useState(config.dailyTag ?? 'daily-jots');
  const [notes, setNotes] = useState([]);
  const [nonce, setNonce] = useState(0);
  const [problem, setProblem] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [proposals, refreshProposals] = useProposals(day);

  useEffect(() => {
    api.config().then((c) => setDailyTag(c.dailyTag ?? 'daily-jots')).catch(() => {});
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await sync.ready;
        const list = await api.notes({ date: day, limit: 50 });
        const full = await Promise.all(list.notes.map((n) => api.getNote(n.id).then((r) => r.note).catch(() => null)));
        if (!cancelled) setNotes(full.filter(Boolean));
      } catch {
        // out of reach: the journal entry this phone holds still counts
        if (!cancelled) setNotes([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [day, nonce]);

  // Today's journal entry as this phone holds it (it may have text the server has not seen yet).
  const [journal, setJournal] = useState(null);
  useEffect(() => {
    let cancelled = false;
    journalSession(dailyTag, day).then((s) => !cancelled && setJournal(s)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dailyTag, day, nonce]);
  const journalDoc = journal && !journal.discarded ? journal.currentDoc() : null;
  const suggestions = useSuggestions(journalDoc ?? { type: 'doc', content: [] }, day, 0);

  const written = notes.filter((n) => !journal || n.id !== journal.id);
  const text = [journalDoc ? plainText(journalDoc) : '', ...written.map((n) => plainText(n.doc))].join('\n');
  const people = mentions ? peopleInText(text, mentions).map((id) => mentions.people.find((p) => p.id === id)) : [];

  const tasks = data.tasks() ?? [];
  const live = (t) => !t.dismissedAt && !t.hidden;
  const made = tasks.filter((t) => t.date === day && live(t));
  const openTasks = tasks.filter((t) => !t.checked && live(t) && !(t.hideUntil && t.hideUntil > day) && !(t.start && t.start > day));
  const overdue = openTasks.filter((t) => isOverdue(t.due, t.dueTime, today, now));
  const others = openTasks.filter((t) => !overdue.includes(t) && t.date !== day);
  const shownOthers = showAll ? others : others.slice(0, MORE);

  const apply = async (task, patch) => {
    const release = data.optimistic(task.noteId, task.taskId, shownPatch(task, patch));
    try {
      const changed = await taskCommands.update(task.noteId, task.taskId, patch);
      if (!changed) throw new Error('That task is no longer in its note.');
      setProblem(null);
      release();
    } catch (e) {
      release();
      await data.refresh();
      setProblem(e.message);
    }
  };

  const acceptRule = async (s) => {
    setProblem(null);
    try {
      if (s.kind === 'task') {
        if (!journal || !acceptTask(journal, null, s)) throw new Error('That line has changed, so nothing was done. Close the journal entry on Today and try again.');
      } else {
        await acceptPerson(s, day);
      }
    } catch (err) {
      setProblem(err.message);
    }
  };
  const acceptFiled = async (p) => {
    setProblem(null);
    try {
      await acceptProposal(p, { dailyTag, day });
      dismiss(proposalKey(p.id)); // hidden here at once, even if the server cannot be told now
      await api.resolveSuggestion(p.id, 'accepted').catch(() => {});
      refreshProposals();
    } catch (err) {
      setProblem(err.message);
    }
  };
  const dismissFiled = async (p) => {
    dismiss(proposalKey(p.id));
    await api.resolveSuggestion(p.id, 'dismissed').catch(() => {});
    refreshProposals();
  };

  const nothing = !journalDoc && !written.length;
  const waiting = suggestions.length + proposals.length;
  return (
    <div class="debrief" data-testid="debrief">
      <h2 class="today-date" data-testid="debrief-date">Debrief · {formatDateLabel(day, today)}</h2>
      {problem && <p class="error inline" role="alert" data-testid="debrief-problem">{problem}</p>}

      <section class="debrief-section" data-testid="debrief-written" aria-label="Written today">
        <h3 class="today-sub">Written today</h3>
        {nothing && <p class="muted">Nothing written yet today.</p>}
        <ul class="debrief-notes">
          {journal && journalDoc && plainText(journalDoc).trim() && (
            <li>
              <a href="#/" data-testid="debrief-journal"><span class="also-title">Journal</span><span class="muted small also-line">{firstLine(journalDoc)}</span></a>
            </li>
          )}
          {written.map((n) => (
            <li key={n.id}>
              <a href={`#/n/${n.id}`}><span class="also-title">{n.title || n.tags[0]?.path || 'Note'}</span><span class="muted small also-line">{firstLine(n.doc)}</span></a>
            </li>
          ))}
        </ul>
      </section>

      {people.length > 0 && (
        <section class="debrief-section" data-testid="debrief-people" aria-label="People today">
          <h3 class="today-sub">People today</h3>
          <ul class="chips">
            {people.map((p) => (
              <li key={p.id} class="chip"><a href={`#/people/${p.id}`}>{p.title}</a></li>
            ))}
          </ul>
        </section>
      )}

      <section class="debrief-section" data-testid="debrief-suggestions" aria-label="Suggestions">
        <h3 class="today-sub">Suggestions <span class="count">{waiting}</span></h3>
        {waiting === 0 && <p class="muted" data-testid="debrief-no-suggestions">Nothing to suggest.</p>}
        <ul class="debrief-list">
          {suggestions.map((s) => (
            <SuggestionRow key={s.key} s={s} onAccept={acceptRule} />
          ))}
          {proposals.map((p) => (
            <ProposalRow key={p.id} p={p} onAccept={acceptFiled} onDismiss={dismissFiled} />
          ))}
        </ul>
      </section>

      {made.length > 0 && (
        <section class="debrief-section" data-testid="debrief-made" aria-label="Tasks made today">
          <h3 class="today-sub">Tasks made today <span class="count">{made.length}</span></h3>
          <ul class="task-list">{made.map((t) => <DebriefTask key={taskKey(t)} t={t} today={today} now={now} apply={apply} />)}</ul>
        </section>
      )}

      {overdue.length > 0 && (
        <section class="debrief-section" data-testid="debrief-overdue" aria-label="Overdue">
          <h3 class="today-sub overdue">Overdue <span class="count">{overdue.length}</span></h3>
          <ul class="task-list">{overdue.map((t) => <DebriefTask key={taskKey(t)} t={t} today={today} now={now} apply={apply} />)}</ul>
        </section>
      )}

      {others.length > 0 && (
        <section class="debrief-section" data-testid="debrief-open" aria-label="Still open">
          <h3 class="today-sub">Still open <span class="count">{others.length}</span></h3>
          <ul class="task-list">{shownOthers.map((t) => <DebriefTask key={taskKey(t)} t={t} today={today} now={now} apply={apply} />)}</ul>
          {others.length > MORE && !showAll && (
            <button type="button" class="link" onClick={() => setShowAll(true)} data-testid="debrief-show-all">Show all {others.length}</button>
          )}
        </section>
      )}
      <p class="muted small debrief-foot">
        Want a fuller tidy-up? Ask your assistant on the laptop to “debrief today”; what it proposes shows up here for you to accept.
      </p>
      <p><a href="#/" class="btn" data-testid="debrief-done">Back to Today</a></p>
    </div>
  );
}
