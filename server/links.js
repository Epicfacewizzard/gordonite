// Links between notes (see docs/LINKS.md): which notes a [[link]] opens, which notes link to a note ("Linked from",
// "Mentioned in" on a person), and the names the editor suggests after "[[".
//
// The index is a cache of each note's links, kept in memory and checked against the note's revision on every read, so
// every way a note's text changes (typing, the assistant, a restored version, an import) is picked up without a hook in
// each of them, and nothing new is stored in the database.
import { HttpError } from './errors.js';
import { checkId } from './ids.js';
import { linksInDoc, linkTitle } from '../shared/wiki-links.js';
import { PEOPLE_TAG } from '../shared/people.js';

const lc = (s) => s.toLowerCase();

export class LinkIndex {
  #cache = new Map(); // note id → { stamp, links }

  constructor(db) {
    this.db = db;
  }

  // Every note's row (without its text), with the cache brought up to date.
  #rows() {
    const rows = this.db.prepare('SELECT id, revision, updated_at, title, kind, note_date, deleted_at FROM notes').all();
    const docOf = this.db.prepare('SELECT doc FROM notes WHERE id = ?');
    const seen = new Set();
    for (const r of rows) {
      seen.add(r.id);
      const stamp = `${r.revision}|${r.updated_at}`;
      if (this.#cache.get(r.id)?.stamp === stamp) continue;
      let links = [];
      try {
        links = linksInDoc(JSON.parse(docOf.get(r.id).doc));
      } catch {
        /* a document this version cannot read has no links */
      }
      this.#cache.set(r.id, { stamp, links });
    }
    for (const id of this.#cache.keys()) if (!seen.has(id)) this.#cache.delete(id);
    return rows;
  }

  // The "Also called" names of every live person: note id → names.
  #aliases() {
    const rows = this.db
      .prepare(
        `SELECT p.note_id, p.data FROM people p JOIN notes n ON n.id = p.note_id WHERE n.deleted_at IS NULL AND EXISTS (
           SELECT 1 FROM note_tags x JOIN tags t ON t.id = x.tag_id WHERE x.note_id = n.id AND (t.path = ? OR t.path LIKE ?))`,
      )
      .all(PEOPLE_TAG, `${PEOPLE_TAG}/%`);
    const out = new Map();
    for (const r of rows) {
      try {
        const names = JSON.parse(r.data).aliases;
        if (Array.isArray(names)) out.set(r.note_id, names.filter((a) => typeof a === 'string' && a.trim()).map((a) => a.trim()));
      } catch {
        /* unreadable details: no other names */
      }
    }
    return out;
  }

  #tags(ids) {
    const out = new Map(ids.map((id) => [id, []]));
    if (!ids.length) return out;
    const rows = this.db
      .prepare(`SELECT nt.note_id, t.path FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id IN (${ids.map(() => '?').join(',')}) ORDER BY t.path`)
      .all(...ids);
    for (const r of rows) out.get(r.note_id).push(r.path);
    return out;
  }

  /**
   * The notes a link's text opens: the live notes with that title (any number: names can repeat), or when there are
   * none, the people with it among their "Also called" names. { notes: [{ id, title, date, alias? }] }
   */
  resolve(target) {
    const title = linkTitle(String(target ?? ''));
    if (!title) return { notes: [] };
    const byTitle = this.db
      .prepare('SELECT id, title, note_date AS date FROM notes WHERE deleted_at IS NULL AND title = ? COLLATE NOCASE ORDER BY note_date DESC, id')
      .all(title);
    if (byTitle.length) return { notes: byTitle };
    const notes = [];
    for (const [id, names] of this.#aliases()) {
      if (!names.some((n) => lc(n) === lc(title))) continue;
      const n = this.db.prepare('SELECT id, title, note_date AS date FROM notes WHERE id = ?').get(id);
      notes.push({ ...n, alias: title });
    }
    return { notes };
  }

  /**
   * The notes that link to this one: by its title, and for a person by their "Also called" names too (unless another
   * note has that title, which the link would open instead). Newest first, each with the lines holding the links.
   */
  backlinks(noteId) {
    checkId(noteId, 'note id');
    const rows = this.#rows();
    const target = rows.find((r) => r.id === noteId && !r.deleted_at);
    if (!target) throw new HttpError(404, 'not_found', 'Note not found');
    const live = rows.filter((r) => !r.deleted_at);
    const titles = new Set(live.filter((r) => r.title).map((r) => lc(r.title)));
    const names = new Set(target.title ? [lc(target.title)] : []);
    for (const a of this.#aliases().get(noteId) ?? []) if (!titles.has(lc(a))) names.add(lc(a));

    const found = [];
    for (const r of live) {
      if (r.id === noteId) continue;
      const hits = this.#cache.get(r.id).links.filter((l) => names.has(lc(l.title)));
      if (!hits.length) continue;
      found.push({ id: r.id, title: r.title ?? null, kind: r.kind, date: r.note_date, count: hits.length, lines: [...new Set(hits.map((l) => l.line))].slice(0, 3) });
    }
    found.sort((a, b) => b.date.localeCompare(a.date) || (a.title ?? '').localeCompare(b.title ?? '') || a.id.localeCompare(b.id));
    const tags = this.#tags(found.map((f) => f.id));
    return { noteId, title: target.title ?? null, backlinks: found.map((f) => ({ ...f, tags: tags.get(f.id) })) };
  }

  /** What "[[" can suggest: every live note with a title, and the people's other names. */
  names() {
    const rows = this.db
      .prepare(
        `SELECT n.id, n.title, n.note_date AS date, EXISTS (
           SELECT 1 FROM note_tags x JOIN tags t ON t.id = x.tag_id WHERE x.note_id = n.id AND (t.path = ? OR t.path LIKE ?)) AS person
         FROM notes n WHERE n.deleted_at IS NULL AND n.title IS NOT NULL ORDER BY n.updated_at DESC`,
      )
      .all(PEOPLE_TAG, `${PEOPLE_TAG}/%`);
    const notes = rows.map((r) => ({ id: r.id, title: r.title, date: r.date, person: r.person === 1 }));
    const titleOf = new Map(notes.map((n) => [n.id, n.title]));
    const aliases = [];
    for (const [id, names] of this.#aliases()) for (const name of names) if (titleOf.has(id)) aliases.push({ id, name, title: titleOf.get(id) });
    return { notes, aliases };
  }
}
