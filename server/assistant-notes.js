// What the assistant door does to notes: create, append, replace text or a section, attach a file, change a task,
// and read a note as Markdown. Each is synchronous, so a read and the write after it are one step: nothing can change
// in between. They all go through Store.saveNote, so they follow the same rules as any save (validation, versions,
// revisions, conflicts); this file only turns Markdown and small requests into documents.
import { uuid } from '../shared/ids.js';
import { normalizeTag } from '../shared/tags.js';
import { dateInTz, isValidDateString, isValidTime, timeInTz, hasStarted, isOverdue } from '../shared/dates.js';
import { DOC_FORMAT, attachmentsIn, plainText } from '../shared/doc.js';
import { extractTasks, updateTask } from '../shared/tasks.js';
import { markdownToDoc } from '../shared/markdown-import.js';
import { docToMarkdown } from './markdown.js';
import { HttpError } from './errors.js';
import { checkId } from './ids.js';

export class AssistantNotes {
  constructor(store) {
    this.store = store;
  }

  // Each of these is synchronous, so a read and the write after it are one step: nothing can change in between.
  // They go through saveNote, so they follow the same rules as any save (validation, versions, revisions).

  #today() {
    return dateInTz(new Date(), this.store.cfg.tz);
  }

  #liveNote(id) {
    const note = this.store.getNote(checkId(id, 'note id'));
    if (!note || note.deletedAt) throw new HttpError(404, 'not_found', 'Note not found');
    return note;
  }

  #markdown(value) {
    if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, 'bad_markdown', '"markdown" must be some text');
    if (value.length > 500_000) throw new HttpError(400, 'too_long', '"markdown" is too long');
    return value;
  }

  // Markdown from the assistant -> blocks. A line that is just ![name](gordonite-file:ID) (or [name](...)) becomes
  // the attachment with that id, when it exists; anything else about files stays plain text.
  #blocks(value) {
    const blocks = markdownToDoc(this.#markdown(value), { resolveAttachment: (id) => this.attachmentAttrs(id) }).content;
    // A file cannot have the cursor placed after it, so a note never ends on one: leave a line to write on.
    return blocks.at(-1)?.type === 'attachment' ? [...blocks, { type: 'paragraph' }] : blocks;
  }

  /** The attributes a note stores for a file (what an attachment node carries), or null if there is no such file. */
  attachmentAttrs(id) {
    const r = this.store.db.prepare('SELECT id, name, mime, size FROM attachments WHERE id = ? AND deleted_at IS NULL').get(id);
    return r ? { id: r.id, name: r.name, mime: r.mime, size: r.size } : null;
  }

  createNote({ title, markdown, tags, date }) {
    const id = uuid();
    const res = this.store.saveNote(id, {
      baseRevision: 0,
      doc: { type: 'doc', content: this.#blocks(markdown) },
      docFormat: DOC_FORMAT,
      kind: 'note',
      tags: Array.isArray(tags) ? tags : [],
      date: date ?? this.#today(),
      opId: uuid(),
      ...(title !== undefined ? { title } : {}),
    });
    return { id, revision: res.revision };
  }

  // Add to the end of a note. The earlier text is kept as a version first, so it can be restored from History.
  append(id, markdown) {
    const note = this.#liveNote(id);
    const blocks = this.#blocks(markdown);
    const existing = note.doc.content ?? [];
    const blank = existing.length === 1 && existing[0].type === 'paragraph' && !existing[0].content?.length;
    const res = this.store.saveNote(id, {
      baseRevision: note.revision,
      doc: { ...note.doc, content: [...(blank ? [] : existing), ...blocks] },
      docFormat: DOC_FORMAT,
      opId: uuid(),
      keepPrevious: true,
    });
    return { id, revision: res.revision };
  }

  // Put a file that is already stored (see the file routes) at the end of a note. The earlier text is kept as a version.
  attach(id, attachmentId) {
    const note = this.#liveNote(id);
    const attrs = this.attachmentAttrs(checkId(attachmentId, 'file id'));
    if (!attrs) throw new HttpError(404, 'file_not_found', 'No such file. Upload it first, then attach it');
    const existing = note.doc.content ?? [];
    const blank = existing.length === 1 && existing[0].type === 'paragraph' && !existing[0].content?.length;
    const res = this.store.saveNote(id, {
      baseRevision: note.revision,
      doc: { ...note.doc, content: [...(blank ? [] : existing), { type: 'attachment', attrs }, { type: 'paragraph' }] },
      docFormat: DOC_FORMAT,
      opId: uuid(),
      keepPrevious: true,
    });
    return { id, revision: res.revision, attachment: attrs };
  }

  // Edits to text that is already there. Both need the revision the assistant last read, so they cannot overwrite a
  // newer version, and both keep the previous text as a version (⋯ → History to restore).
  #reviewed(note, expectedRevision) {
    if (!Number.isInteger(expectedRevision)) throw new HttpError(400, 'bad_revision', '"expectedRevision" must be the revision you last read');
    if (expectedRevision !== note.revision) throw new HttpError(409, 'revision_conflict', 'The note changed since you read it. Read it again and retry');
  }

  // Replace exact text inside a paragraph, heading or list item (plain text: no ** or \ from the Markdown view).
  // The replacement takes the bold/italic of the first character it replaces. Task ids, dates and ticks are untouched.
  replaceText(id, { find, replace, all, expectedRevision }) {
    const note = this.#liveNote(id);
    this.#reviewed(note, expectedRevision);
    if (typeof find !== 'string' || !find) throw new HttpError(400, 'bad_find', '"find" must be some text');
    if (typeof replace !== 'string') throw new HttpError(400, 'bad_replace', '"replace" must be text (use "" to remove the found text)');
    if (find.length > 5_000 || replace.length > 100_000) throw new HttpError(400, 'too_long', '"find" or "replace" is too long');
    const doc = structuredClone(note.doc);
    const blocks = [];
    const collect = (node) => {
      if (node.type === 'paragraph' || node.type === 'heading') blocks.push(node);
      else for (const child of node.content ?? []) collect(child);
    };
    collect(doc);
    const hits = [];
    for (const block of blocks) {
      const chars = [];
      for (const n of block.content ?? []) {
        if (n.type === 'hardBreak') chars.push({ ch: '\n', hard: true });
        else for (const ch of n.text) chars.push({ ch, marks: n.marks });
      }
      const text = chars.map((c) => c.ch).join('');
      const at = [];
      for (let i = text.indexOf(find); i >= 0; i = text.indexOf(find, i + find.length)) at.push(i);
      if (at.length) hits.push({ block, chars, at });
    }
    const count = hits.reduce((n, h) => n + h.at.length, 0);
    if (count === 0) throw new HttpError(404, 'text_not_found', 'That text is not in the note. "find" is matched against plain text inside one paragraph, heading or list item, without Markdown symbols');
    if (count > 1 && all !== true) throw new HttpError(409, 'ambiguous', `Found ${count} matches. Use more surrounding text to pick one, or set all:true to change every match`, { matches: count });
    for (const { block, chars, at } of hits) {
      const out = [];
      let from = 0;
      for (const start of at) {
        out.push(...chars.slice(from, start));
        const marks = chars[start].marks;
        for (const ch of replace) out.push(ch === '\n' ? { ch, hard: true } : { ch, marks });
        from = start + find.length;
      }
      out.push(...chars.slice(from));
      const content = [];
      for (const c of out) {
        const last = content.at(-1);
        if (c.hard) content.push({ type: 'hardBreak' });
        else if (last?.type === 'text' && JSON.stringify(last.marks ?? null) === JSON.stringify(c.marks ?? null)) last.text += c.ch;
        else content.push({ type: 'text', text: c.ch, ...(c.marks?.length ? { marks: c.marks } : {}) });
      }
      if (content.length) block.content = content;
      else delete block.content;
    }
    const res = this.store.saveNote(id, { baseRevision: note.revision, doc, docFormat: DOC_FORMAT, opId: uuid(), keepPrevious: true });
    return { id, revision: res.revision, replaced: count };
  }

  // Replace the body under a heading (up to the next heading of the same or a higher level) with new Markdown.
  // The heading itself stays unless includeHeading is true, in which case the Markdown replaces it too ("" removes the
  // whole section). Tasks inside the replaced part are new tasks; tasks outside it are untouched.
  replaceSection(id, { heading, markdown, includeHeading, expectedRevision }) {
    const note = this.#liveNote(id);
    this.#reviewed(note, expectedRevision);
    if (typeof heading !== 'string' || !heading.replace(/^#+\s*/, '').trim()) throw new HttpError(400, 'bad_heading', '"heading" must be the heading text');
    if (typeof markdown !== 'string' || markdown.length > 500_000) throw new HttpError(400, 'bad_markdown', '"markdown" must be text');
    if (!markdown.trim() && includeHeading !== true) throw new HttpError(400, 'bad_markdown', 'Empty "markdown" would only blank the section: set includeHeading:true to remove it entirely');
    const want = heading.replace(/^#+\s*/, '').trim().toLowerCase();
    const top = note.doc.content ?? [];
    const matches = top.flatMap((n, i) => (n.type === 'heading' && plainText({ type: 'doc', content: [n] }).trim().toLowerCase() === want ? [i] : []));
    if (matches.length === 0) throw new HttpError(404, 'heading_not_found', 'No heading with that text. Use the heading text as shown, without the # marks');
    if (matches.length > 1) throw new HttpError(409, 'ambiguous', `${matches.length} headings have that text`, { matches: matches.length });
    const start = matches[0];
    const level = top[start].attrs.level;
    let end = top.findIndex((n, i) => i > start && n.type === 'heading' && n.attrs.level <= level);
    if (end < 0) end = top.length;
    const blocks = markdown.trim() ? markdownToDoc(markdown, { resolveAttachment: (fileId) => this.attachmentAttrs(fileId) }).content : [];
    const content = [...top.slice(0, includeHeading ? start : start + 1), ...blocks, ...top.slice(end)];
    const res = this.store.saveNote(id, { baseRevision: note.revision, doc: { ...note.doc, content: content.length ? content : [{ type: 'paragraph' }] }, docFormat: DOC_FORMAT, opId: uuid(), keepPrevious: true });
    return { id, revision: res.revision };
  }

  // Add to today's entry in a tag (the Today screen's tag by default), creating it if it is not there yet.
  appendDaily({ markdown, tag }) {
    const path = normalizeTag(tag ?? this.store.getSettings().dailyTag);
    if (!path) throw new HttpError(400, 'bad_tag', 'Invalid tag');
    const date = this.#today();
    const row = this.store.db
      .prepare(
        `SELECT n.id FROM note_tags nt JOIN tags t ON t.id = nt.tag_id JOIN notes n ON n.id = nt.note_id
         WHERE t.path = ? AND nt.note_date = ? AND nt.live = 1 AND nt.slot = 1 AND n.deleted_at IS NULL`,
      )
      .get(path, date);
    if (row) return { ...this.append(row.id, markdown), tag: path, date };
    const id = uuid();
    const res = this.store.saveNote(id, { baseRevision: 0, doc: { type: 'doc', content: this.#blocks(markdown) }, docFormat: DOC_FORMAT, kind: 'daily', tags: [path], date, opId: uuid() });
    return { id, revision: res.revision, tag: path, date, created: true };
  }

  getNote(id) {
    const note = this.#liveNote(id);
    return {
      id: note.id,
      title: note.title,
      kind: note.kind,
      date: note.date,
      tags: note.tags.map((t) => t.path),
      revision: note.revision,
      updatedAt: note.updatedAt,
      markdown: docToMarkdown(note.doc),
      tasks: extractTasks(note.doc, note.date),
      // Files in the note. Their lines in "markdown" are ![name](gordonite-file:ID) / [name](gordonite-file:ID).
      attachments: attachmentsIn(note.doc),
    };
  }

  updateTask(noteId, taskId, patch) {
    const note = this.#liveNote(noteId);
    const clean = {};
    for (const [k, v] of Object.entries(patch ?? {})) {
      if (k === 'priority') {
        if (v !== null && !['both', 'urgent', 'important'].includes(v)) throw new HttpError(400, 'bad_task', '"priority" must be both, urgent, important or null');
        clean[k] = v;
      } else if (k === 'checked' || k === 'hidden') {
        if (typeof v !== 'boolean') throw new HttpError(400, 'bad_task', `"${k}" must be true or false`);
        clean[k] = v;
      } else if (k === 'dueTime' || k === 'startTime') {
        if (v !== null && !isValidTime(v)) throw new HttpError(400, 'bad_task', 'Time must be HH:mm or null');
        clean[k] = v;
      } else if (k === 'due' || k === 'start' || k === 'hideUntil') {
        if (v !== null && !isValidDateString(v)) throw new HttpError(400, 'bad_task', `"${k}" must be YYYY-MM-DD or null`);
        clean[k] = v;
      }
    }
    if (Object.keys(clean).length === 0) throw new HttpError(400, 'bad_task', 'Nothing to change (use checked, due, start, hidden, hideUntil or priority)');
    const doc = updateTask(note.doc, taskId, clean);
    if (!doc) throw new HttpError(404, 'not_found', 'Task not found in that note');
    const res = this.store.saveNote(noteId, { baseRevision: note.revision, doc, docFormat: DOC_FORMAT, opId: uuid() });
    return { id: noteId, taskId, revision: res.revision };
  }

  // What is open right now, with where each task sits: overdue / today / upcoming (next 7 days) / later / nodate.
  overview() {
    const today = this.#today();
    const now = timeInTz(new Date(), this.store.cfg.tz);
    const soon = dateInTz(new Date(Date.now() + 7 * 86_400_000), this.store.cfg.tz);
    const tasks = this.store.listTasks()
      .filter((t) => !t.checked && !t.dismissedAt && !t.hidden && !(t.hideUntil && t.hideUntil > today) && hasStarted(t.start, t.startTime, today, now))
      .map((t) => ({
        ...t,
        bucket: !t.due ? 'nodate' : isOverdue(t.due, t.dueTime, today, now) ? 'overdue' : t.due === today ? 'today' : t.due <= soon ? 'upcoming' : 'later',
      }));
    return { today, tasks };
  }
}
