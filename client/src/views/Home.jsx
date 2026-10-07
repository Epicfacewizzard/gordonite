import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../api.js';
import { normalizeTag } from '../../../shared/tags.js';
import { formatDateShort } from '../../../shared/dates.js';
import { tagFolders, folderLabel, planMove } from '../tag-folders.js';

const parentOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

function findChildren(nodes, path) {
  for (const n of nodes) {
    if (n.path === path) return n.children;
    const hit = findChildren(n.children, path);
    if (hit) return hit;
  }
  return null;
}

export function HomeView() {
  const [tags, setTags] = useState(null);
  const [order, setOrder] = useState({});
  const [error, setError] = useState(null);
  const [text, setText] = useState('');
  const [formError, setFormError] = useState(null);
  const [creating, setCreating] = useState(false);
  // Parents start collapsed; this is the set of folder paths the person has opened.
  const [expanded, setExpanded] = useState(() => new Set());
  const [drag, setDrag] = useState(null); // { path, x, y } while a tag is being carried
  const [drop, setDrop] = useState(null); // { path, pos: 'before' | 'after' | 'into' } where it would land ('' = top level)

  const load = () =>
    api
      .tags()
      .then((r) => {
        setTags(r.tags);
        setOrder(r.order ?? {});
        setError(null);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const folders = tagFolders(tags ?? [], order);
  const live = useRef({});
  live.current = { folders, expanded };

  // Optimistic: flip the star at once, put it back if the server says no.
  const toggleFavorite = async (tag) => {
    const next = !tag.favorite;
    const set = (favorite) => setTags((list) => list.map((t) => (t.id === tag.id ? { ...t, favorite } : t)));
    set(next);
    try {
      await api.setFavorite(tag.id, next);
    } catch (e) {
      set(!next);
      setError(e.message);
    }
  };

  const setOpen = (path, open) =>
    setExpanded((cur) => {
      if (cur.has(path) === open) return cur;
      const next = new Set(cur);
      if (open) next.add(path);
      else next.delete(path);
      return next;
    });

  // ----- drag to nest, un-nest or reorder -----
  // Pointer events rather than HTML5 drag-and-drop, so it also works with a finger. The grip is the only thing that
  // starts a drag; everything else on a row still scrolls and taps as before.
  const stop = useRef(null);
  useEffect(() => () => stop.current?.(false), []);

  const startDrag = (e, from) => {
    if (e.button) return;
    e.preventDefault();
    stop.current?.(false);
    const pointer = { x: e.clientX, y: e.clientY };
    let target = null;

    const aim = () => {
      const el = document.elementFromPoint(pointer.x, pointer.y);
      const node = el?.closest('[data-drop]');
      let next = null;
      if (node) {
        const path = node.getAttribute('data-drop');
        const box = node.getBoundingClientRect();
        const f = (pointer.y - box.top) / box.height;
        const openFolder = node.hasAttribute('data-folder') && live.current.expanded.has(path);
        const pos = f < 0.3 ? 'before' : f > 0.7 && !openFolder ? 'after' : 'into';
        if (planMove(live.current.folders, from, path, pos)) next = { path, pos };
      } else if (el?.closest('[data-drop-root]')) {
        next = { path: '', pos: 'into' };
      }
      if (next?.path !== target?.path || next?.pos !== target?.pos) {
        target = next;
        setDrop(next);
      }
    };
    const onMove = (ev) => {
      pointer.x = ev.clientX;
      pointer.y = ev.clientY;
      setDrag({ path: from, x: pointer.x, y: pointer.y });
      aim();
    };
    const onKey = (ev) => {
      if (ev.key === 'Escape') finish(false);
    };
    // Keep the list scrolling while the grip is held near the top or bottom edge of the screen.
    const timer = setInterval(() => {
      const edge = 70;
      if (pointer.y < edge) window.scrollBy(0, -14);
      else if (pointer.y > window.innerHeight - edge) window.scrollBy(0, 14);
      aim();
    }, 40);
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    function finish(commit) {
      stop.current = null;
      clearInterval(timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      const landed = target;
      setDrag(null);
      setDrop(null);
      if (commit && landed) place(from, landed);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    stop.current = finish;
    setDrag({ path: from, x: pointer.x, y: pointer.y });
  };

  const place = async (from, landed) => {
    const plan = planMove(live.current.folders, from, landed.path, landed.pos);
    if (!plan) return;
    if (plan.into === parentOf(from)) {
      const now = (plan.into ? findChildren(live.current.folders, plan.into) : live.current.folders).map((n) => n.name);
      if (now.join('/') === plan.order.join('/')) return; // dropped back where it already was
    }
    try {
      const moved = await api.moveTag(from, plan.into, plan.order);
      // Keep what was open open under its new name, and show where the tag landed.
      setExpanded((cur) => {
        const next = new Set();
        for (const p of cur) next.add(p === from || p.startsWith(`${from}/`) ? moved.path + p.slice(from.length) : p);
        for (let p = parentOf(moved.path); p; p = parentOf(p)) next.add(p);
        return next;
      });
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  // Hovering over a closed folder for a moment opens it, so a tag can be dropped deeper inside.
  useEffect(() => {
    if (!drag || drop?.pos !== 'into' || !drop.path || expanded.has(drop.path)) return undefined;
    if (!findChildren(folders, drop.path)?.length) return undefined;
    const t = setTimeout(() => setOpen(drop.path, true), 600);
    return () => clearTimeout(t);
  }, [Boolean(drag), drop?.path, drop?.pos]);

  const dropClass = (path) => {
    const bits = [];
    if (drag?.path === path) bits.push('drag-source');
    if (drop && drop.path === path && path !== '') bits.push(`drop-${drop.pos}`);
    return bits.join(' ');
  };

  const grip = (path) => (
    <button
      type="button"
      class="drag-handle"
      aria-label={`Move ${path}. Drag onto a tag to put it inside, or between tags to reorder`}
      data-testid="tag-grip"
      onPointerDown={(e) => startDrag(e, path)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      ⋮⋮
    </button>
  );

  const row = (t, { movable = true } = {}) => (
    <li
      key={t.id}
      class={`tag-item ${movable ? dropClass(t.path) : ''}`}
      data-drop={movable ? t.path : undefined}
      style={{ paddingLeft: `${Math.min(t.path.split('/').length - 1, 4) * 14}px` }}
    >
      {movable && grip(t.path)}
      <a class="tag-row" href={`#/t/${encodeURIComponent(t.path).replaceAll('%2F', '/')}`} data-testid="tag-link">
        <span class="tag-name">
          {t.path.includes('/') && <span class="tag-parent">{t.path.slice(0, t.path.lastIndexOf('/') + 1)}</span>}
          {t.path.slice(t.path.lastIndexOf('/') + 1)}
        </span>
        <span class="tag-meta">
          {t.noteCount} {t.noteCount === 1 ? 'note' : 'notes'}
          {t.lastDate ? ` · last ${formatDateShort(t.lastDate)}` : ''}
        </span>
      </a>
      <button
        type="button"
        class={`star${t.favorite ? ' on' : ''}`}
        onClick={() => toggleFavorite(t)}
        aria-pressed={t.favorite}
        aria-label={t.favorite ? `Remove ${t.path} from favorites` : `Add ${t.path} to favorites`}
        data-testid="tag-star"
      >
        {t.favorite ? '★' : '☆'}
      </button>
    </li>
  );

  const byPath = new Map((tags ?? []).map((t) => [t.path, t]));
  const branch = (folder) =>
    folder.children.length ? (
      <li key={folder.path} class="tag-branch">
        <details open={expanded.has(folder.path)} onToggle={(e) => setOpen(folder.path, e.currentTarget.open)}>
          <summary class={dropClass(folder.path)} data-drop={folder.path} data-folder="" data-testid="tag-folder">
            {grip(folder.path)}
            <span class="folder-title">{folderLabel(folder.name)}</span>
          </summary>
          <ul class="tag-list">
            {byPath.has(folder.path) && row(byPath.get(folder.path), { movable: false })}
            {folder.children.map(branch)}
          </ul>
        </details>
      </li>
    ) : (
      row(byPath.get(folder.path))
    );

  const open = async (e) => {
    e.preventDefault();
    const path = normalizeTag(text);
    if (!path) return setFormError('Tag names use letters, numbers, - _ . and / for sub-tags, e.g. school/fall26.');
    setFormError(null);
    setCreating(true);
    try {
      await api.createTag(path);
      setText('');
      // Open the folders above a new nested tag so it can be seen where it landed.
      setExpanded((cur) => {
        const next = new Set(cur);
        for (let p = parentOf(path); p; p = parentOf(p)) next.add(p);
        return next;
      });
      load();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div class={`home${drag ? ' dragging' : ''}`}>
      <form class="row open-tag" onSubmit={open}>
        <input type="text" value={text} onInput={(e) => setText(e.currentTarget.value)} placeholder="New tag, e.g. school/fall26" aria-label="Tag to create" autocapitalize="none" autocomplete="off" enterkeyhint="done" data-testid="open-tag-input" />
        <button type="submit" class="btn primary" disabled={creating} data-testid="open-tag-button">{creating ? 'Creating…' : 'Create tag'}</button>
      </form>
      {formError && <p class="error" role="alert">{formError}</p>}
      <p class="small muted">Tap a parent to expand it. Tap a tag to open it; the star adds it to Today. Drag the grip ⋮⋮ onto a tag to put it inside, or between tags to reorder.</p>
      <h2 class="section">Your tags</h2>
      {error && (
        <div class="banner error" role="alert">
          <span>{tags ? error : `Can’t reach the server: ${error}`}</span>
          <button type="button" class="btn" onClick={load}>
            Retry
          </button>
        </div>
      )}
      {tags && tags.length === 0 && <p class="muted">No tags yet. Create one above, e.g. “daily-jots”.</p>}
      <ul class="tag-list" data-testid="tag-list">
        {folders.map(branch)}
      </ul>
      {drag && (
        <div class={`tag-root-drop${drop?.path === '' ? ' drop-into' : ''}`} data-drop-root data-testid="tag-root-drop">
          Drop here to move to the top level
        </div>
      )}
      {drag && (
        <div class="drag-ghost" style={{ left: `${drag.x + 14}px`, top: `${drag.y + 14}px` }}>
          {drag.path}
        </div>
      )}
    </div>
  );
}
