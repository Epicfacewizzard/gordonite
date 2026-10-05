import { useEffect, useState } from 'preact/hooks';
import { api } from './api.js';
import { sync } from './sync.js';
import { go, useHashRoute, useSession } from './hooks.js';
import { StreamView } from './views/Stream.jsx';
import { HomeView } from './views/Home.jsx';
import { TasksView } from './views/Tasks.jsx';
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

function Header({ route }) {
  const onHome = route === '/';
  const title = route.startsWith('/t/') ? route.slice(3) : route === '/tasks' ? 'Tasks' : route === '/trash' ? 'Trash' : route === '/data' ? 'Data & backups' : 'Personal HQ';
  return (
    <header class="topbar">
      {!onHome && (
        <a class="icon-btn back" href="#/" aria-label="Back to all tags">
          ‹
        </a>
      )}
      <h1 class="title" data-testid="title">
        {title}
      </h1>
      <GlobalStatus />
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
  } else if (route === '/tasks') {
    view = <TasksView />;
  } else if (route === '/trash') {
    view = <TrashView config={config} />;
  } else if (route === '/data') {
    view = <DataView config={config} />;
  } else {
    view = <HomeView />;
  }

  return (
    <>
      <Header route={route} />
      <main class="page">{view}</main>
    </>
  );
}
