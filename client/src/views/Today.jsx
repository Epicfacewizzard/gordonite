import { useEffect, useState } from 'preact/hooks';
import { api, NetworkError } from '../api.js';
import { sync } from '../sync.js';
import { useSession, useToday } from '../hooks.js';
import { NoteCard } from './NoteCard.jsx';
import { EditorBar } from './EditorBar.jsx';
import { TasksView } from './Tasks.jsx';
import { getDashboard, getDashboardTasks } from '../prefs.js';
import { MoodWidget } from './Mood.jsx';
import { EarlierNotes } from './EarlierNotes.jsx';
import { HabitsWidget } from './Habits.jsx';
import { useMentions, peopleInText } from '../mentions.js';
import { plainText } from '../../../shared/doc.js';

// The Dashboard (route "/") is a stack of independent sections ("widgets"). Each is a component that gets the same
// context (today's date, config, tags, the chosen daily tag) and draws its own part. To add one, write the
// component, add it to WIDGETS below and to DASHBOARD_WIDGETS in prefs.js (which Settings uses to show, hide and
// reorder them on this device).

const longDate = (today) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${today}T00:00:00Z`));

const streamHref = (tag) => `#/t/${encodeURIComponent(tag).replaceAll('%2F', '/')}`;

function NavWidget() {
  return (
    <nav class="today-nav" aria-label="Start something">
      <a class="btn primary" href="#/new" data-testid="today-new-note">
        New note
      </a>
      <a class="btn" href="#/skin" data-testid="today-skin">
        Log skin
      </a>
    </nav>
  );
}

// Starred tags, one tap away.
function PinnedWidget({ tags }) {
  const pinned = tags.filter((t) => t.favorite);
  if (pinned.length === 0) return null;
  return (
    <section class="widget" data-testid="widget-pinned">
      <ul class="chips" aria-label="Starred tags">
        {pinned.map((t) => (
          <li key={t.id} class="chip">
            <a href={streamHref(t.path)}>{t.path}</a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TasksWidget({ config }) {
  return (
    <section class="widget dash-first" data-testid="widget-tasks">
      <TasksView config={config} compact scope={getDashboardTasks()} />
    </section>
  );
}

// A short pause after the last change before the value is used, so a screen that works something out from what is being
// typed does it when the typing stops, not on every key.
function useSettled(value, ms = 400) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

// The other notes dated today (other tags' daily entries and free notes, not the journal entry), read in full so the
// people they name can be found. Nothing here when the server cannot be reached.
function useNotesToday(today, journalId, nonce) {
  const [notes, setNotes] = useState([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await api.notes({ date: today, limit: 50 });
        const full = await Promise.all(list.notes.filter((n) => n.id !== journalId).map((n) => api.getNote(n.id).then((r) => r.note).catch(() => null)));
        if (!cancelled) setNotes(full.filter(Boolean));
      } catch {
        if (!cancelled) setNotes([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [today, journalId, nonce]);
  return notes;
}

const firstLine = (doc) => plainText(doc).split('\n').map((l) => l.trim()).find(Boolean) ?? '';

// Who today's writing is about: a chip for each person named (plainly or with a [[link]]) in the journal entry and in
// the other notes dated today. The journal entry is read as it is typed, after a short pause.
function PeopleToday({ journalText, others }) {
  const mentions = useMentions();
  const settled = useSettled(journalText);
  const ids = peopleInText([settled, ...others.map((n) => plainText(n.doc))].join('\n'), mentions);
  if (!ids.length) return null;
  return (
    <section class="today-people" aria-label="People today" data-testid="people-today">
      <h3 class="today-sub">People today</h3>
      <ul class="chips">
        {ids.map((id) => (
          <li key={id} class="chip">
            <a href={`#/people/${id}`}>{mentions.people.find((p) => p.id === id).title}</a>
          </li>
        ))}
      </ul>
    </section>
  );
}

// The other notes written today, one row each: its name (or its first tag) and its first line.
function AlsoToday({ others }) {
  if (!others.length) return null;
  return (
    <section class="today-also" aria-label="Also today" data-testid="also-today">
      <h3 class="today-sub">Also today</h3>
      <ul>
        {others.map((n) => (
          <li key={n.id}>
            <a href={`#/n/${n.id}`} data-testid="also-today-note">
              <span class="also-title">{n.title || n.tags[0]?.path || 'Note'}</span>
              <span class="muted small also-line">{firstLine(n.doc)}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Today's journal entry (the daily entry of the journal tag, a server setting changed in Settings), ready to write in
// (created on the first keystroke, like in a stream). Under it: the people named today and the other notes dated today.
// Under those, the last couple of days' entries of that tag (EarlierNotes), greyed until tapped: a tap opens that
// day for editing right there, and only one note is ever open for editing. A button brings in older days.
function TodayNoteWidget({ config, today, dailyTag }) {
  useSession();
  const [state, setState] = useState({ status: 'loading', id: null, error: null });
  const [earlier, setEarlier] = useState(null); // this tag's first page of notes, for the earlier days under today's
  const [editor, setEditor] = useState(null);
  const [activeId, setActiveId] = useState(null); // the note being edited; null means today's
  const [focusRequest, setFocusRequest] = useState(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!dailyTag) return;
    let cancelled = false;
    setState((s) => ({ status: s.id ? 'ready' : 'loading', id: s.id, error: null }));
    (async () => {
      try {
        await sync.ready;
        const res = await api.stream(dailyTag);
        if (cancelled) return;
        res.notes.forEach((n) => sync.adopt(n));
        const existing = res.notes.find((n) => n.date === today && n.kind === 'daily');
        // A tag with its daily entry switched off has nothing to write in here.
        const session = existing ? sync.get(existing.id) : res.tag.daily ? sync.draft(dailyTag, today) : null;
        setEarlier({ notes: res.notes, hasMore: res.hasMore });
        setState({ status: session ? 'ready' : 'off', id: session?.id ?? null, error: null });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof NetworkError) {
          // Out of reach and no copy on this phone: write in today's entry anyway. It is held here and sent later; if
          // another device wrote today's entry meanwhile, saving shows the usual conflict panel (combine keeps both).
          const session = sync.draft(dailyTag, today);
          setState({ status: 'ready', id: session.id, error: null });
        } else {
          setState({ status: 'error', id: null, error: err.message });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dailyTag, today, nonce]);

  // Back in reach (VPN turned on): fetch again, so today's entry and the earlier days are the server's.
  useEffect(() => {
    const again = () => setNonce((n) => n + 1);
    window.addEventListener('hq-reconnected', again);
    return () => window.removeEventListener('hq-reconnected', again);
  }, []);

  const session = state.id ? sync.get(state.id) : null;
  const editingId = activeId ?? session?.id ?? null;
  const editing = editingId ? sync.get(editingId) : null; // today's note, or an earlier day the person tapped
  const activate = (id, req) => {
    setActiveId(id);
    setFocusRequest(req ? { ...req, n: Date.now() } : null);
  };
  const changed = () => setNonce((n) => n + 1);
  const others = useNotesToday(today, state.id, nonce);
  const journalText = session && !session.discarded ? plainText(session.currentDoc()) : '';

  return (
    <section class="widget dash-second" data-testid="widget-note">
      <div class="widget-head">
        <h2 class="section">Today’s note</h2>
      </div>
      {state.status === 'error' && (
        <div class="banner error" role="alert" data-testid="load-error">
          <span>Can’t reach the server: {state.error}. Text already typed on this phone is safe.</span>
          <button type="button" class="btn" onClick={() => setNonce((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}
      {state.status === 'off' && (
        <p class="muted" data-testid="note-off">
          “{dailyTag}” has no entry for today (its daily entry is switched off). Choose another journal tag in Settings.
        </p>
      )}
      {session && !session.discarded && (
        <NoteCard
          session={session}
          tag={dailyTag}
          today={today}
          tz={config.tz}
          active={editingId === session.id}
          onActivate={activate}
          onChanged={changed}
          onEditor={editingId === session.id ? setEditor : undefined}
          focusRequest={editingId === session.id ? focusRequest : null}
        />
      )}
      <PeopleToday journalText={journalText} others={others} />
      <AlsoToday others={others} />
      {earlier && state.status !== 'error' && (
        <EarlierNotes
          tag={dailyTag}
          today={today}
          tz={config.tz}
          initial={earlier}
          activeId={activeId}
          focusRequest={focusRequest}
          onActivate={activate}
          onEditor={setEditor}
          onChanged={changed}
        />
      )}
      {/* the room kept for the fixed editor bar goes last, so it does not leave a gap above the earlier days */}
      {editing && !editing.discarded && (
        <>
          <div class="toolbar-spacer" />
          <EditorBar editor={editor} noteDate={editing.date} today={today} />
        </>
      )}
    </section>
  );
}

// id → component. Which widgets are shown, which column each sits in and their order inside it all come from
// getDashboard() (Settings → Dashboard), so every widget can be moved to any column. Columns: an optional band across
// the top, then up to three side by side (left, middle, right). On a phone they stack in that order.
const WIDGETS = new Map([
  ['nav', NavWidget],
  ['pinned', PinnedWidget],
  ['tasks', TasksWidget],
  ['mood', MoodWidget],
  ['habits', HabitsWidget],
  ['note', TodayNoteWidget],
]);
const COLUMNS = ['left', 'center', 'right'];
// How much room a widget wants (a column gets the largest of what is in it). Change a number to change the balance.
const WIDTH = { note: 2, tasks: 1.3, mood: 1.3, pinned: 0.8, nav: 0.8 };

// The CSS for the columns that are actually in use, so an empty column leaves no gap.
function gridFor(shown) {
  const used = COLUMNS.filter((c) => shown.some((w) => w.region === c));
  const top = shown.some((w) => w.region === 'top');
  const weight = (c) => Math.max(...shown.filter((w) => w.region === c).map((w) => WIDTH[w.id] ?? 1));
  const columns = used.length ? used.map((c) => `minmax(0, ${weight(c)}fr)`).join(' ') : 'minmax(0, 1fr)';
  const span = Math.max(used.length, 1);
  const rows = [top && `"${Array(span).fill('top').join(' ')}"`, used.length && `"${used.join(' ')}"`].filter(Boolean);
  return { '--dash-cols': columns, '--dash-areas': rows.join(' ') };
}

export function TodayView({ config }) {
  const today = useToday(config.tz);
  const [tags, setTags] = useState([]);
  // The journal tag is one setting kept on the server, changed in Settings. Asked for again each time this opens.
  const [dailyTag, setDailyTag] = useState(config.dailyTag ?? 'daily-jots');

  useEffect(() => {
    api.tags().then((r) => setTags(r.tags)).catch(() => {});
    api.config().then((c) => setDailyTag(c.dailyTag ?? 'daily-jots')).catch(() => {});
    try {
      localStorage.removeItem('hq-daily-tag-unsent'); // a pick kept by an older version, which no longer exists
    } catch {
      /* storage unavailable: nothing was kept */
    }
  }, []);

  const context = { config, today, tags, dailyTag };
  // A widget with nothing to show (starred tags, when none are starred) is left out, so it cannot hold a column open.
  const shown = getDashboard().filter((w) => w.shown && !(w.id === 'pinned' && !tags.some((t) => t.favorite)));
  return (
    <div class="today" data-testid="today">
      <h2 class="today-date" data-testid="today-date">
        {longDate(today)}
      </h2>
      <div class="dashboard-grid" style={gridFor(shown)}>
        {['top', ...COLUMNS].map((region) => {
          const here = shown.filter((w) => w.region === region);
          return (
            here.length > 0 && (
              <div key={region} class={`dash-region dash-${region}`} data-region={region}>
                {here.map(({ id }) => {
                  const Widget = WIDGETS.get(id);
                  // the note starts fresh when its tag changes, so one tag's entry is never shown under another's name
                  return <Widget key={id === 'note' ? `note:${dailyTag}` : id} {...context} />;
                })}
              </div>
            )
          );
        })}
      </div>
      {shown.length === 0 && (
        <p class="muted" data-testid="dashboard-empty">
          Nothing is shown here. Choose widgets in <a href="#/settings">Settings</a>.
        </p>
      )}
    </div>
  );
}
