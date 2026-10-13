import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../api.js';
import { sync } from '../sync.js';
import { isEmptyDoc } from '../../../shared/doc.js';
import { NoteCard } from './NoteCard.jsx';

// How many earlier days show at first, and how many each "Show more" adds.
const FIRST = 2;
const STEP = 3;

// The last few days' entries of the chosen tag, under today's note. Each is the same note card a stream uses, so a tap
// puts the cursor right there and you can edit or add to it; the one not being edited is greyed. Only one editor is
// ever open (today's note or one of these), which keeps the page light. Days with nothing written are skipped.
const usable = (notes, today) =>
  notes.filter((n) => n.kind === 'daily' && n.date < today && !isEmptyDoc(sync.get(n.id)?.currentDoc() ?? n.doc));

const oldestDate = (notes) => notes.reduce((min, n) => (min === null || n.date < min ? n.date : min), null);

// Greys out a note that is not being edited, and fades a long one at the bottom (it opens in full when tapped).
function EarlierItem({ note, active, children }) {
  const box = useRef(null);
  const [clamped, setClamped] = useState(false);
  useEffect(() => {
    const body = box.current?.querySelector('.static');
    setClamped(!active && !!body && body.scrollHeight > body.clientHeight + 1);
  });
  return (
    <div ref={box} class={`earlier-item${active ? ' is-active' : ''}${clamped ? ' clamped' : ''}`} data-testid="prev-note" data-date={note.date} data-note-id={note.id}>
      {children}
    </div>
  );
}

/**
 * props: tag; today (YYYY-MM-DD); tz; initial = the first page of that tag's stream ({ notes, hasMore });
 * activeId / focusRequest / onActivate / onEditor / onChanged: the editing state, owned by the Today note widget.
 */
export function EarlierNotes({ tag, today, tz, initial, activeId, focusRequest, onActivate, onEditor, onChanged }) {
  const [pool, setPool] = useState(() => usable(initial.notes, today));
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [before, setBefore] = useState(() => oldestDate(initial.notes));
  const [shown, setShown] = useState(FIRST);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // The widget refetches after something changes (a tag edit, a deleted note, a resolved conflict): take what it has
  // now, but keep how many days were open.
  useEffect(() => {
    setPool(usable(initial.notes, today));
    setHasMore(initial.hasMore);
    setBefore(oldestDate(initial.notes));
  }, [initial, today]);

  const showMore = async () => {
    const want = shown + STEP;
    let list = pool;
    let more = hasMore;
    let cursor = before;
    setLoading(true);
    setError(null);
    try {
      // Older pages are fetched only when the ones already loaded run out.
      while (list.length < want && more && cursor) {
        const res = await api.stream(tag, cursor);
        res.notes.forEach((n) => sync.adopt(n));
        list = [...list, ...usable(res.notes, today)];
        more = res.hasMore && res.notes.length > 0;
        cursor = oldestDate(res.notes) ?? cursor;
      }
      setPool(list);
      setHasMore(more);
      setBefore(cursor);
      setShown(want);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const visible = pool.slice(0, shown).filter((n) => sync.get(n.id) && !sync.get(n.id).discarded);
  if (visible.length === 0 && !hasMore) return null;
  const canShowMore = pool.length > shown || hasMore;
  return (
    <div class="earlier" data-testid="earlier-notes">
      {visible.map((n) => {
        const session = sync.get(n.id);
        const active = activeId === n.id;
        return (
          <EarlierItem key={n.id} note={n} active={active}>
            <NoteCard
              session={session}
              tag={tag}
              today={today}
              tz={tz}
              active={active}
              onActivate={onActivate}
              onChanged={onChanged}
              onEditor={active ? onEditor : undefined}
              focusRequest={active ? focusRequest : null}
            />
          </EarlierItem>
        );
      })}
      {error && (
        <p class="error small" role="alert">
          Couldn’t load more notes: {error}
        </p>
      )}
      {canShowMore && (
        <button type="button" class="btn block" disabled={loading} onClick={showMore} data-testid="earlier-more">
          {loading ? 'Loading…' : 'Show older notes'}
        </button>
      )}
    </div>
  );
}
