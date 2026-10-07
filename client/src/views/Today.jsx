import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.js';
import { sync } from '../sync.js';
import { useSession, useToday } from '../hooks.js';
import { NoteCard } from './Stream.jsx';
import { EditorBar } from './EditorBar.jsx';
import { TasksView } from './Tasks.jsx';
import { getDashboard } from '../prefs.js';

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
      <TasksView config={config} compact />
    </section>
  );
}

// Today's entry of the chosen daily tag, ready to write in (created on the first keystroke, like in a stream).
function TodayNoteWidget({ config, today, dailyTag }) {
  useSession();
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
          “{dailyTag}” has no entry for today (its daily entry is switched off). Pick another tag in Settings.
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
        <p class="today-source small muted" data-testid="daily-tag-from">
          Comes from “{dailyTag}” · <a href="#/settings">change in Settings</a>
        </p>
      )}
    </section>
  );
}

// id → component. The order and which are shown come from getDashboard() (Settings).
const WIDGETS = new Map([
  ['nav', NavWidget],
  ['pinned', PinnedWidget],
  ['tasks', TasksWidget],
  ['note', TodayNoteWidget],
]);

export function TodayView({ config }) {
  const today = useToday(config.tz);
  const [tags, setTags] = useState([]);
  const [dailyTag, setDailyTag] = useState(config.dailyTag ?? 'daily-jots');

  useEffect(() => {
    api.tags().then((r) => setTags(r.tags)).catch(() => {});
    api.config().then((c) => setDailyTag(c.dailyTag ?? 'daily-jots')).catch(() => {});
  }, []);

  const context = { config, today, tags, dailyTag };
  const shown = getDashboard().filter((w) => w.shown);
  return (
    <div class="today" data-testid="today">
      <h2 class="today-date" data-testid="today-date">
        {longDate(today)}
      </h2>
      {shown.map(({ id }) => {
        const Widget = WIDGETS.get(id);
        return Widget && <Widget key={id} {...context} />;
      })}
      {shown.length === 0 && (
        <p class="muted" data-testid="dashboard-empty">
          Nothing is shown here. Choose widgets in <a href="#/settings">Settings</a>.
        </p>
      )}
    </div>
  );
}
