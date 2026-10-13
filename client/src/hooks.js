import { useEffect, useReducer, useState } from 'preact/hooks';
import { dateInTz, timeInTz } from '../../shared/dates.js';
import { sync } from './sync.js';
import { taskData } from './task-data.js';
import { getOpeningPage } from './prefs.js';

export function useRerender(subscribe) {
  const [, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => subscribe(bump), [subscribe]);
}

// Re-render when a session (or any session, when none is given) changes.
export function useSession(session) {
  const [, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => (session ?? sync).subscribe(bump), [session]);
}

/**
 * The app's task list (see task-data.js): re-renders when it changes and keeps it current while this screen is shown.
 * Read it with data.tasks() (null until the first answer), data.error(), and change what is shown with
 * data.optimistic() and data.refresh().
 */
export function useTaskData() {
  const [, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    const stopListening = taskData.subscribe(bump);
    const stopWatching = taskData.watch();
    return () => {
      stopListening();
      stopWatching();
    };
  }, []);
  return taskData;
}

export function useHashRoute() {
  const read = () => decodeURIComponent(location.hash.replace(/^#/, '')) || '/';
  const [route, setRoute] = useState(() => read() === '/' ? getOpeningPage() : read());
  useEffect(() => {
    // Only the initial app opening uses this preference. Today remains reachable,
    // and explicit note/stream links always win over the opening-page setting.
    if (read() === '/' && route !== '/') history.replaceState(null, '', `#${route}`);
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const go = (path, { replace = false } = {}) => {
  const hash = `#${path.split('/').map((s, i) => (i === 0 ? s : encodeURIComponent(s))).join('/')}`;
  if (replace) location.replace(hash);
  else location.hash = hash;
};

/** Today's date in the home timezone, following the device clock (and crossing midnight). */
export function useToday(tz) {
  const [today, setToday] = useState(() => dateInTz(new Date(), tz));
  useEffect(() => {
    const tick = () => setToday(dateInTz(new Date(), tz));
    tick();
    const id = setInterval(tick, 15_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [tz]);
  return today;
}

export function useNowTime(tz) {
  const [time, setTime] = useState(() => timeInTz(new Date(), tz));
  useEffect(() => {
    const tick = () => setTime(timeInTz(new Date(), tz));
    tick(); const id = setInterval(tick, 15_000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [tz]);
  return time;
}
