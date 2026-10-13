// Tags: listing, creating, flags, and moving a tag with everything under it. Functions over the database; the note
// store uses ensureTag when a note is first saved or given a tag.
import { tx } from './db.js';
import { uuid } from '../shared/ids.js';
import { normalizeTag, MAX_DEPTH } from '../shared/tags.js';
import { HttpError } from './errors.js';
import { cleanOrderNames, followTagMove, readTagOrder, writeTagOrder } from './settings.js';

/**
 * The tag with this path, made if it is not there. A tag created by writing a free note in it is a plain topic (no
 * daily entry); one created by a stream's daily note, or by hand, keeps the daily entry on.
 */
export function ensureTag(db, path, { daily = true } = {}) {
  const row = db.prepare('SELECT id, path FROM tags WHERE path = ?').get(path);
  if (row) return { id: row.id, path: row.path };
  const id = uuid();
  db.prepare('INSERT INTO tags (id, path, created_at, daily) VALUES (?, ?, ?, ?)').run(id, path, new Date().toISOString(), daily ? 1 : 0);
  return { id, path };
}

export function listTags(db) {
  return db
    .prepare(
      `SELECT t.id, t.path, t.created_at AS createdAt, t.favorite, t.daily, COUNT(n.id) AS noteCount, MAX(nt.note_date) AS lastDate
       FROM tags t
       LEFT JOIN note_tags nt ON nt.tag_id = t.id AND nt.live = 1
       LEFT JOIN notes n ON n.id = nt.note_id AND n.deleted_at IS NULL
       GROUP BY t.id ORDER BY t.path`,
    )
    .all()
    .map((t) => ({ ...t, favorite: t.favorite === 1, daily: t.daily === 1 }));
}

export function setTagDaily(db, id, daily) {
  if (typeof daily !== 'boolean') throw new HttpError(400, 'bad_daily', '"daily" must be true or false');
  const res = db.prepare('UPDATE tags SET daily = ? WHERE id = ?').run(daily ? 1 : 0, id);
  if (res.changes === 0) throw new HttpError(404, 'not_found', 'Tag not found');
  return { id, daily };
}

export function setTagFavorite(db, id, favorite) {
  if (typeof favorite !== 'boolean') throw new HttpError(400, 'bad_favorite', '"favorite" must be true or false');
  const res = db.prepare('UPDATE tags SET favorite = ? WHERE id = ?').run(favorite ? 1 : 0, id);
  if (res.changes === 0) throw new HttpError(404, 'not_found', 'Tag not found');
  return { id, favorite };
}

export function createTag(db, rawPath) {
  const path = normalizeTag(rawPath);
  if (!path) throw new HttpError(400, 'bad_tag', 'Tag names use letters, numbers, - _ . and / for sub-tags');
  return tx(db, () => ensureTag(db, path));
}

// Move a tag, with everything under it, to be a child of `into` ('' = top level) and set the order of that
// parent's children (`order` lists the child names, including the moved one). Tag ids, notes and favourites stay
// as they are; only paths change. Refuses to overwrite an existing tag or to move a tag into itself.
export function moveTag(db, { from, into, order }) {
  const source = normalizeTag(from);
  const parent = into === '' || into == null ? '' : normalizeTag(into);
  if (!source || parent === null) throw new HttpError(400, 'bad_tag', 'Choose a valid tag to move and a valid place to put it');
  if (parent === source || parent.startsWith(source + '/')) throw new HttpError(400, 'bad_move', 'A tag cannot be moved into itself');
  const leaf = source.split('/').at(-1);
  const target = parent ? `${parent}/${leaf}` : leaf;
  const oldParent = source.includes('/') ? source.slice(0, source.lastIndexOf('/')) : '';
  // (the names must all be plain, normalised names, at most 500, and include the tag being moved)
  if (order !== undefined && (!Array.isArray(order) || cleanOrderNames(order)?.length !== order.length || !order.includes(leaf))) {
    throw new HttpError(400, 'bad_order', '"order" must list the names inside the destination, including the moved tag');
  }
  return tx(db, () => {
    const like = source.replace(/[\\%_]/g, (c) => '\\' + c) + '/%';
    const moving = db.prepare("SELECT id, path FROM tags WHERE path = ? OR path LIKE ? ESCAPE '\\'").all(source, like);
    if (moving.length === 0) throw new HttpError(404, 'not_found', 'Tag not found');
    if (target !== source) {
      const renamed = moving.map((t) => ({ id: t.id, path: target + t.path.slice(source.length) }));
      if (renamed.some((t) => !normalizeTag(t.path) || t.path.split('/').length > MAX_DEPTH)) {
        throw new HttpError(400, 'too_deep', 'That would make the tag path too long or too deep');
      }
      const taken = db.prepare('SELECT path FROM tags WHERE path = ?');
      for (const t of renamed) {
        if (taken.get(t.path)) throw new HttpError(409, 'tag_exists', `A tag named ${t.path} already exists`);
      }
      const set = db.prepare('UPDATE tags SET path = ? WHERE id = ?');
      for (const t of renamed) set.run(t.path, t.id);
      followTagMove(db, source, target);
    }
    const next = {};
    for (const [key, list] of Object.entries(readTagOrder(db))) {
      const inside = key === source || key.startsWith(source + '/');
      next[inside ? target + key.slice(source.length) : key] = key === oldParent ? list.filter((n) => n !== leaf) : list;
    }
    if (order !== undefined) next[parent] = order;
    else if (next[parent]) next[parent] = [...next[parent].filter((n) => n !== leaf), leaf];
    writeTagOrder(db, next);
    return { from: source, path: target };
  });
}
