import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.js';
import { sync } from '../sync.js';
import { useSession, useToday } from '../hooks.js';
import { NoteCard } from './Stream.jsx';
import { EditorBar } from './EditorBar.jsx';
import { TasksView } from './Tasks.jsx';
import { getDashboard, getDashboardTasks } from '../prefs.js';
import { MoodWidget } from './Mood.jsx';

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
    <section class="widget" data-testid="widget-tasks">
      <TasksView config={config} compact scope={getDashboardTasks()} />
    </section>
  );
}

// Today's entry of the chosen daily tag, ready to write in (created on the first keystroke, like in a stream).
// Under it, the tag it comes from can be changed in one tap: the current tag and every starred tag are offered.
function TodayNoteWidget({ config, today, dailyTag, tags, visited, chooseDailyTag }) {
  useSession();
  const [pickError, setPickError] = useState('');
  const [state, setState] = useState({ status: 'loading', id: null, error: null });
  const [editor, setEditor] = useState(null);
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
        setState({ status: session ? 'ready' : 'off', id: session?.id ?? null, error: null });
      } catch (err) {
        if (!cancelled) setState({ status: 'error', id: null, error: err.message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dailyTag, today, nonce]);

  const session = state.id ? sync.get(state.id) : null;
  // The current tag, every starred tag, and any tag used since this page was opened (so there is always a way back).
  // Alphabetical, so the choices do not jump around when one is picked. A tag whose daily entry is switched off has
  // nothing to write in, so it is left out (unless it is the current one, which always shows).
  const unusable = (path) => path !== dailyTag && tags.find((t) => t.path === path)?.daily === false;
  const choices = [...new Set([dailyTag, ...visited, ...tags.filter((t) => t.favorite).map((t) => t.path)])].filter((path) => path && !unusable(path)).sort();
  const pick = async (path) => {
    if (path === dailyTag || unusable(path)) return;
    setPickError('');
    try {
      await chooseDailyTag(path);
    } catch (err) {
      setPickError(err.message);
    }
  };

  return (
    <section class="widget" data-testid="widget-note">
      <h2 class="section">Today’s note</h2>
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
          “{dailyTag}” has no entry for today (its daily entry is switched off). Pick another tag below.
        </p>
      )}
      {session && !session.discarded && (
        <>
          <NoteCard session={session} tag={dailyTag} today={today} tz={config.tz} active onChanged={() => setNonce((n) => n + 1)} onEditor={setEditor} />
          <div class="toolbar-spacer" />
          <EditorBar editor={editor} noteDate={session.date} today={today} />
        </>
      )}
      {dailyTag && (
        <div class="today-source small" data-testid="daily-tag-from">
          <ul class="chips today-source-chips" role="radiogroup" aria-label="Which tag today’s note comes from">
            {choices.map((path) => (
              <li key={path} class="chip">
                <button type="button" role="radio" aria-checked={path === dailyTag} data-testid="daily-tag-choice" data-tag={path} onClick={() => pick(path)}>
                  {path}
                </button>
              </li>
            ))}
          </ul>
          {pickError && <span class="error" role="alert">{pickError}</span>}
        </div>
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

export function TodayView({ config, onConfigChanged }) {
  const today = useToday(config.tz);
  const [tags, setTags] = useState([]);
  const [dailyTag, setDailyTag] = useState(config.dailyTag ?? 'daily-jots');
  const [visited, setVisited] = useState([]); // tags the note has come from since this page opened
  useEffect(() => {
    if (dailyTag) setVisited((v) => (v.includes(dailyTag) ? v : [...v, dailyTag]));
  }, [dailyTag]);

  useEffect(() => {
    api.tags().then((r) => setTags(r.tags)).catch(() => {});
    api.config().then((c) => setDailyTag(c.dailyTag ?? 'daily-jots')).catch(() => {});
  }, []);

  // Which tag today's note comes from is one setting kept on the server (the same one as in Settings).
  const chooseDailyTag = async (next) => {
    const before = dailyTag;
    setDailyTag(next);
    try {
      await api.setSettings({ dailyTag: next });
      onConfigChanged?.();
    } catch (err) {
      setDailyTag(before);
      throw err;
    }
  };

  const context = { config, today, tags, dailyTag, visited, chooseDailyTag };
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
