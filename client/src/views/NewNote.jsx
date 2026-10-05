import { useEffect } from 'preact/hooks';
import { sync } from '../sync.js';
import { dateInTz } from '../../../shared/dates.js';
import { normalizeTag } from '../../../shared/tags.js';

/**
 * #/new[?tag=school/fall26]: start a free note (optionally already tagged) and land on its own page.
 * Nothing is created on the server until something is typed, so opening this and leaving leaves no trace.
 * The redirect replaces this address, so Back skips it.
 */
export function NewNoteView({ route, config }) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await sync.ready;
      if (cancelled) return;
      const tag = normalizeTag(new URLSearchParams(route.split('?')[1] ?? '').get('tag') ?? '');
      const session = sync.newNote(dateInTz(new Date(), config.tz), tag ? [tag] : []);
      location.replace(`#/n/${session.id}`);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return <p class="muted center">Starting a new note…</p>;
}
