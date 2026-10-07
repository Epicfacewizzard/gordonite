import { useEffect, useState } from 'preact/hooks';
import { api } from './api.js';
import { sync } from './sync.js';
import { go, useHashRoute, useSession } from './hooks.js';
import { StreamView } from './views/Stream.jsx';
import { HomeView } from './views/Home.jsx';
import { TodayView } from './views/Today.jsx';
import { TasksView } from './views/Tasks.jsx';
import { SettingsView } from './views/Settings.jsx';
import { NoteView } from './views/NotePage.jsx';
import { NotesView } from './views/Notes.jsx';
import { PeopleView } from './views/People.jsx';
import { LinkTarget } from './views/LinkTarget.jsx';
import { NewNoteView } from './views/NewNote.jsx';
import { TrashView } from './views/Trash.jsx';
import { DataView } from './views/Data.jsx';
import { STATUS_TEXT } from './views/parts.jsx';

const CONFIG_CACHE = 'hq-config';

function loadCachedConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_CACHE));
  } catch {
    return null;
  }
}

// Green = on the server, yellow = safe on the phone and on its way, red = needs a look.
// The words live in the tooltip and the accessible label, not on screen.
const TONE = { saved: 'ok', saving: 'wait', pending: 'wait', offline: 'wait', failed: 'bad', conflict: 'bad' };

function GlobalStatus() {
  useSession();
  const { status, count, storageError, localError } = sync.summary();
  const unsafe = !!(storageError || localError); // edits are not being held durably on the phone
  const tone = unsafe ? 'bad' : TONE[status];
  const label = `${STATUS_TEXT[status]}${count > 1 ? ` (${count})` : ''}${unsafe ? ' · not stored on this phone' : ''}`;
  if (status === 'saved' && !unsafe) {
    return (
      <span class={`status-dot ${tone}`} data-testid="global-status" data-status="saved" role="status" aria-label={label} title={label}>
        <span class="dot" aria-hidden="true" />
      </span>
    );
  }
  const onClick = () => {
    if (status === 'conflict') {
      const s = [...sync.sessions.values()].find((x) => x.conflict);
      if (s?.tags[0]) go(`/t/${s.tags[0]}`);
    } else {
      sync.retryAll();
    }
  };
  return (
    <button type="button" class={`status-dot ${tone} as-button`} data-testid="global-status" data-status={status} aria-label={label} title={label} onClick={onClick}>
      <span class="dot" aria-hidden="true" />
    </button>
  );
}

// A tag's name as a trail: each part before the last is a link to that parent tag (school/fall26 -> school).
function TagCrumbs({ path }) {
  const parts = path.split('/');
  return parts.map((part, i) => {
    const upTo = parts.slice(0, i + 1);
    const last = i === parts.length - 1;
    return (
      <>
        {i > 0 && '/'}
        {last ? (
          part
        ) : (
          <a class="crumb" href={`#/t/${upTo.map(encodeURIComponent).join('/')}`} data-testid="crumb">
            {part}
          </a>
        )}
      </>
    );
  });
}

const Icon = ({ d }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d={d} />
  </svg>
);

// The main places, always one tap away. Hidden inside a stream or a note (they have their own toolbar) and
// while typing (the keyboard needs the room).
const TABS = [
  { id: 'today', label: 'Dashboard', href: '#/', match: (r) => r === '/', icon: 'M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M17.7 6.3l1.4-1.4M4.9 19.1l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z' },
  { id: 'tasks', label: 'Tasks', href: '#/tasks', match: (r) => r === '/tasks', icon: 'M4 4h16v16H4zM8.5 12.5l2.5 2.5 4.5-5' },
  { id: 'people', label: 'People', href: '#/people', match: (r) => r === '/people', icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
  { id: 'notes', label: 'Notes', href: '#/notes', match: (r) => r === '/notes' || r === '/tags', icon: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7' },
];
const showsTabBar = (route) => !route.startsWith('/t/') && !route.startsWith('/n/') && !route.startsWith('/new');

function TabBar({ route }) {
  return (
    <nav class="tabbar" aria-label="Main" data-testid="tabbar">
      {TABS.map((t) => (
        <a key={t.id} href={t.href} aria-current={t.match(route) ? 'page' : undefined} data-testid={`tab-${t.id}`}>
          <Icon d={t.icon} />
          <span>{t.label}</span>
        </a>
      ))}
    </nav>
  );
}

// Mark the page while a text field has the cursor, so CSS can give the keyboard the room.
//   data-typing  any field (search box, tag box, note text)   data-editing  a note's text
function useTypingMarks() {
  useEffect(() => {
    const mark = () => {
      const el = document.activeElement;
      document.body.toggleAttribute('data-typing', !!el?.matches?.('input, textarea, select, [contenteditable="true"]'));
      document.body.toggleAttribute('data-editing', !!el?.closest?.('.note-text'));
    };
    const later = () => setTimeout(mark, 0); // during focusout the next element is not focused yet
    document.addEventListener('focusin', mark);
    document.addEventListener('focusout', later);
    return () => {
      document.removeEventListener('focusin', mark);
      document.removeEventListener('focusout', later);
    };
  }, []);
}

// On a note page, Back returns to the stream or list you came from; with no history it goes home.
function goBack(e) {
  if (history.length > 1) {
    e.preventDefault();
    history.back();
  }
}

function Header({ route }) {
  const onHome = route === '/';
  const title = route.startsWith('/t/') ? route.slice(3) : route.startsWith('/n/') ? 'Note' : route === '/notes' ? 'Notes' : route.startsWith('/new') ? 'New note' : route === '/tasks' ? 'Tasks' : route === '/people' ? 'People' : route === '/trash' ? 'Trash' : route === '/data' ? 'Data & backups' : route === '/settings' ? 'Settings' : route === '/tags' ? 'Tags' : 'Dashboard';
  return (
    <header class="topbar">
      {!onHome && (
        <a class="icon-btn back" href={route === '/tags' ? '#/notes' : '#/'} aria-label={route.startsWith('/n/') ? 'Back' : route === '/tags' ? 'Back to Notes' : 'Back to Dashboard'} onClick={route.startsWith('/n/') ? goBack : undefined}>
          ‹
        </a>
      )}
      <h1 class="title" data-testid="title">
        {route.startsWith('/t/') ? <TagCrumbs path={route.slice(3)} /> : title}
      </h1>
      <GlobalStatus />
      <a class="icon-btn" href="#/settings" aria-label="Settings" title="Settings" data-testid="settings-link">⚙</a>
    </header>
  );
}

export function App() {
  const route = useHashRoute();
  const [config, setConfig] = useState(loadCachedConfig);
  const [error, setError] = useState(null);

  const loadConfig = () =>
    api
      .config()
      .then((c) => {
        setConfig(c);
        setError(null);
        try {
          localStorage.setItem(CONFIG_CACHE, JSON.stringify(c));
        } catch {
          /* storage may be unavailable */
        }
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    sync.init();
    loadConfig();
    window.addEventListener('focus', loadConfig);
    return () => window.removeEventListener('focus', loadConfig);
  }, []);

  let view;
  if (!config) {
    view = error ? (
      <div class="banner error" role="alert">
        <span>Can’t reach the server: {error}</span>
        <button type="button" class="btn" onClick={loadConfig}>
          Retry
        </button>
      </div>
    ) : (
      <p class="muted center">Loading…</p>
    );
  } else if (route.startsWith('/t/')) {
    const tag = route.slice(3);
    view = <StreamView key={tag} tag={tag} config={config} />;
  } else if (route === '/tags') {
    view = <HomeView />;
  } else if (route === '/settings') {
    view = <SettingsView config={config} onConfigChanged={loadConfig} />;
  } else if (route === '/notes') {
    view = <NotesView />;
  } else if (route === '/people') {
    view = <PeopleView />;
  } else if (route.startsWith('/link/')) {
    view = <LinkTarget key={route} target={route.slice(6)} />;
  } else if (route === '/new' || route.startsWith('/new?')) {
    view = <NewNoteView route={route} config={config} />;
  } else if (route.startsWith('/n/')) {
    const id = route.slice(3);
    view = <NoteView key={id} id={id} config={config} />;
  } else if (route === '/tasks') {
    view = <TasksView config={config} />;
  } else if (route === '/trash') {
    view = <TrashView config={config} />;
  } else if (route === '/data') {
    view = <DataView config={config} />;
  } else {
    view = <TodayView config={config} />;
  }

  useTypingMarks();
  const tabbar = showsTabBar(route);
  return (
    <>
      <Header route={route} />
      <main class={`page${tabbar ? ' has-tabbar' : ''}${route === '/' ? ' wide' : ''}`}>{view}</main>
      {tabbar && <TabBar route={route} />}
    </>
  );
}
