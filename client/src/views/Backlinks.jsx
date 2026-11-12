import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.js';
import { formatDateLabel } from '../../../shared/dates.js';

/** The notes that link to a note (for a person: that mention them), re-read after each save. null while loading, then { backlinks } or { error, backlinks }. */
export function useBacklinks(noteId, revision) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!noteId) return setState(null);
    let alive = true;
    api
      .backlinks(noteId)
      .then((r) => alive && setState({ backlinks: r.backlinks }))
      .catch((e) => alive && setState({ error: e.status === 404 ? null : e.message, backlinks: [] }));
    return () => {
      alive = false;
    };
  }, [noteId, revision]); // again after each save: a rename changes which links point here
  return state;
}

/**
 * Under a note on its own page: the notes that link to it with [[its title]] ("Linked from"), or for a person the
 * notes that mention them, also by an "Also called" name ("Everything written", on a person's card page). See docs/LINKS.md.
 */
export function Backlinks({ noteId, title, person, today, revision, state: given = null }) {
  const own = useBacklinks(given ? null : noteId, revision);
  const state = given ?? own;
  if (!state) return null;
  const heading = person ? 'Everything written' : 'Linked from';
  const list = state.backlinks;
  return (
    <section class="backlinks" aria-label={heading} data-testid="backlinks">
      <h3>
        {heading}
        {list.length > 0 && <span class="muted"> · {list.length}</span>}
      </h3>
      {state.error && <p class="muted small">Can’t show the links now: {state.error}</p>}
      {!state.error && list.length === 0 && (
        <p class="muted small" data-testid="backlinks-empty">
          {title ? `No notes link here yet. Type [[${title}]] in a note to link it.` : 'Give this note a name to link to it from other notes with [[ ]].'}
        </p>
      )}
      <ul>
        {list.map((b) => (
          <li key={b.id} data-testid="backlink">
            <a href={`#/n/${b.id}`}>
              <span class="backlink-title">{b.title || (b.tags[0] ? `${b.tags[0]} · ${formatDateLabel(b.date, today)}` : formatDateLabel(b.date, today))}</span>
              {b.title && <span class="muted small"> · {formatDateLabel(b.date, today)}</span>}
            </a>
            {b.lines.map((line, i) => (
              <p key={i} class="backlink-line small">
                {line}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
