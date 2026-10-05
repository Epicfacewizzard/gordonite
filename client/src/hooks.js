import { useEffect, useReducer, useState } from 'preact/hooks';
import { dateInTz } from '../../shared/dates.js';
import { sync } from './sync.js';

export function useRerender(subscribe) {
  const [, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => subscribe(bump), [subscribe]);
}

// Re-render when a session (or any session, when none is given) changes.
export function useSession(session) {
  const [, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => (session ?? sync).subscribe(bump), [session]);
}

export function useHashRoute() {
  const read = () => decodeURIComponent(location.hash.replace(/^#/, '')) || '/';
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const go = (path) => {
  location.hash = `#${path.split('/').map((s, i) => (i === 0 ? s : encodeURIComponent(s))).join('/')}`;
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
