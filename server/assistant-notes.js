// What the assistant door does to notes: create, append, replace text or a section, attach a file, change a task,
// and read a note as Markdown. Each is synchronous, so a read and the write after it are one step: nothing can change
// in between. They all go through Store.saveNote, so they follow the same rules as any save (validation, versions,
// revisions, conflicts); this file only turns Markdown and small requests into documents.
import { uuid } from '../shared/ids.js';
import { normalizeTag } from '../shared/tags.js';
import { dateInTz, isValidDateString, isValidTime, timeInTz, hasStarted, isOverdue } from '../shared/dates.js';
import { DOC_FORMAT, attachmentsIn, plainText } from '../shared/doc.js';
import { isValidRepeat } from '../shared/repeat.js';
import { extractTasks, updateTask, removeTask, findTask, taskText, patchedTaskAttrs } from '../shared/tasks.js';
import { markdownToDoc, inlineToNodes } from '../shared/markdown-import.js';
import { docToMarkdown } from './markdown.js';
import { HttpError } from './errors.js';
import { checkId } from './ids.js';
import { isPersonTags } from '../shared/people.js';

// get_note shows a task's picked dates after its text, " (due 2026-10-20 at 09:00)" / " (start note date)", and a
// dismissed task with " (dismissed …)". They are not part of the text. This reads them back off the end of a line.
const SCHEDULE = /\s*\((due|start) (\d{4}-\d{2}-\d{2}|note date)(?: at ([01]\d|2[0-3]):([0-5]\d))?\)|\s*\(dismissed [^()]*\)/y;
const SCHEDULE_TAIL = /(?:\s*\((?:due|start) (?:\d{4}-\d{2}-\d{2}|note date)(?: at (?:[01]\d|2[0-3]):[0-5]\d)?\)|\s*\(dismissed [^()]*\))+\s*$/;
export function splitSchedule(line) {
  const tail = SCHEDULE_TAIL.exec(line);
  if (!tail) return { text: line, schedule: null };
  const schedule = { due: null, dueTime: null, start: null, startTime: null };
  SCHEDULE.lastIndex = tail.index;
  for (let m; (m = SCHEDULE.exec(line)); ) {
    if (!m[1]) continue; // (dismissed …): kept from the task as it was
    if (m[2] !== 'note date') schedule[m[1]] = m[2];
    if (m[3]) schedule[`${m[1]}Time`] = `${m[3]}:${m[4]}`;
  }
  return { text: line.slice(0, tail.index), schedule };
}

// "find" as plain text: no \ escapes, ** or * marks, list or heading markers, or a task's shown dates.
function plainFind(find) {
  return splitSchedule(
    find
      .replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|#{1,6}\s+|\d+[.)]\s+)/, '')
      .replace(/\\([\\`*_{}[\]()#+\-.!>|~])/g, '$1')
      .replace(/\*\*|__/g, ''),
  ).text.trim();
}

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
    // Agents often copy "find" out of get_note's Markdown, with its \ escapes, ** marks, list markers and the
    // "(due …)" a task line is shown with. When the text as given is not there, it is tried once without those.
    let hits = this.#hits(blocks, find);
    let matchedAs = null;
    const plain = plainFind(find);
    if (!hits.length && plain && plain !== find) {
      hits = this.#hits(blocks, plain);
      if (hits.length) find = matchedAs = plain;
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
    return { id, revision: res.revision, replaced: count, ...(matchedAs ? { matchedAs } : {}) };
  }

  // Where "find" is, block by block: [{ block, chars, at: [start, ...] }].
  #hits(blocks, find) {
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
    return hits;
  }

  // Replace the body under a heading (up to the next heading of the same or a higher level) with new Markdown.
  // The heading itself stays unless includeHeading is true, in which case the Markdown replaces it too ("" removes the
  // whole section). Tasks inside the replaced part are new tasks; tasks outside it are untouched.
  replaceSection(id, { heading, markdown, includeHeading, occurrence, expectedRevision }) {
    const note = this.#liveNote(id);
    this.#reviewed(note, expectedRevision);
    if (typeof heading !== 'string' || !heading.replace(/^#+\s*/, '').trim()) throw new HttpError(400, 'bad_heading', '"heading" must be the heading text');
    if (typeof markdown !== 'string' || markdown.length > 500_000) throw new HttpError(400, 'bad_markdown', '"markdown" must be text');
    if (!markdown.trim() && includeHeading !== true) throw new HttpError(400, 'bad_markdown', 'Empty "markdown" would only blank the section: set includeHeading:true to remove it entirely');
    const want = heading.replace(/^#+\s*/, '').trim().toLowerCase();
    const top = note.doc.content ?? [];
    const matches = top.flatMap((n, i) => (n.type === 'heading' && plainText({ type: 'doc', content: [n] }).trim().toLowerCase() === want ? [i] : []));
    if (matches.length === 0) throw new HttpError(404, 'heading_not_found', 'No heading with that text. Use the heading text as shown, without the # marks');
    if (occurrence !== undefined && (!Number.isInteger(occurrence) || occurrence < 1 || occurrence > matches.length)) throw new HttpError(400, 'bad_occurrence', `"occurrence" must be 1 to ${matches.length}`);
    if (matches.length > 1 && occurrence === undefined) throw new HttpError(409, 'ambiguous', `${matches.length} headings have that text. Set occurrence (1 = the first from the top) to pick one`, { matches: matches.length });
    const start = matches[(occurrence ?? 1) - 1];
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
      } else if (k === 'repeat') {
        // A repeat rule { every, unit: day|week|month|year, days? (week, 0 = Sunday), from: due|done }, or null to stop repeating.
        if (v !== null && !isValidRepeat(v)) throw new HttpError(400, 'bad_task', '"repeat" must be null or { every: 1-365, unit: day|week|month|year, days?: [0-6] (weekly only), from?: due|done }');
        clean[k] = v;
      } else if (k === 'skip' || k === 'undoCompletion') {
        if (v !== true) throw new HttpError(400, 'bad_task', `"${k}" must be true`);
        clean[k] = v;
      } else if (k === 'project') {
        // A project of its own (docs/PROJECTS.md); null goes back to the note's project.
        if (v !== null) {
          const p = this.store.db.prepare('SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL').get(checkId(v, 'project id'));
          if (!p) throw new HttpError(404, 'project_not_found', 'No such project. list_projects lists them');
        }
        clean.project = v;
      } else if (k === 'person') {
        // Who the task is with: a People note (tagged 05-people). null takes the person off (and stops waiting).
        if (v !== null) {
          const person = this.store.getNote(checkId(v, 'person note id'));
          if (!person || person.deletedAt || !isPersonTags(person.tags.map((t) => t.path))) throw new HttpError(404, 'person_not_found', 'No such person. list_people lists them (use their noteId)');
        }
        clean.person = v;
        if (v === null) clean.waitingSince = null;
      } else if (k === 'waiting') {
        if (typeof v !== 'boolean') throw new HttpError(400, 'bad_task', '"waiting" must be true or false');
        clean.waitingSince = v ? (patch.waitingSince ?? this.#today()) : null;
      } else if (k === 'waitingSince') {
        if (v !== null && !isValidDateString(v)) throw new HttpError(400, 'bad_task', '"waitingSince" must be YYYY-MM-DD or null');
        if (patch.waiting === undefined) clean.waitingSince = v;
      } else if (k === 'text') {
        // The task's own words (bold/italic Markdown allowed); tasks nested under it stay.
        if (typeof v !== 'string' || !v.trim() || v.length > 5_000 || /\n/.test(v)) throw new HttpError(400, 'bad_task', '"text" must be one line of text');
        clean.content = [{ type: 'paragraph', content: inlineToNodes(v.trim()) }];
      }
    }
    if (Object.keys(clean).length === 0) throw new HttpError(400, 'bad_task', 'Nothing to change (use text, checked, due, start, dueTime, startTime, hidden, hideUntil, priority, repeat, skip, undoCompletion, project, person, waiting or waitingSince)');
    if (clean.waitingSince) {
      const task = findTask(note.doc, taskId);
      if (task && !(clean.person ?? task.attrs?.person)) throw new HttpError(400, 'bad_task', 'Waiting needs a person: give person (a People noteId) too');
    }
    const doc = updateTask(note.doc, taskId, clean, { noteDate: note.date, tz: this.store.cfg.tz });
    if (doc && (clean.skip || clean.undoCompletion) && JSON.stringify(doc) === JSON.stringify(note.doc)) throw new HttpError(400, 'bad_task', clean.skip ? 'Only a repeating task can be skipped' : 'There is no completion to undo on that task');
    if (!doc) throw new HttpError(404, 'task_not_found', 'No task with that id in that note. Read the note again with get_note: its "tasks" list has the ids');
    const res = this.store.saveNote(noteId, { baseRevision: note.revision, doc, docFormat: DOC_FORMAT, opId: uuid(), ...(clean.content ? { keepPrevious: true } : {}) });
    return { id: noteId, taskId, revision: res.revision };
  }

  // Take one task (and anything nested under it) out of its note. The note before is kept in History.
  deleteTask(noteId, taskId) {
    const note = this.#liveNote(noteId);
    const doc = removeTask(note.doc, taskId);
    if (!doc) throw new HttpError(404, 'task_not_found', 'No task with that id in that note. Read the note again with get_note: its "tasks" list has the ids');
    const res = this.store.saveNote(noteId, { baseRevision: note.revision, doc, docFormat: DOC_FORMAT, opId: uuid(), keepPrevious: true });
    return { id: noteId, taskId, revision: res.revision, deleted: true };
  }

  // Move one task, unchanged (same id, dates and tick), to the end of another note's last task list. It is added to the
  // other note first and only then taken out of this one, so a failure in between leaves it in both, never in neither.
  // Both notes keep their previous text in History.
  moveTask(noteId, taskId, toNoteId) {
    const from = this.#liveNote(noteId);
    const to = this.#liveNote(toNoteId);
    if (from.id === to.id) throw new HttpError(400, 'same_note', 'The task is already in that note');
    const item = findTask(from.doc, taskId);
    if (!item) throw new HttpError(404, 'task_not_found', 'No task with that id in that note. Read the note again with get_note: its "tasks" list has the ids');
    if (findTask(to.doc, taskId)) throw new HttpError(409, 'task_exists', 'The other note already has this task');
    const content = [...(to.doc.content ?? [])];
    let end = content.length;
    while (end > 0 && content[end - 1].type === 'paragraph' && !content[end - 1].content?.length) end--; // above the blank line(s) left for writing
    if (content[end - 1]?.type === 'taskList') content[end - 1] = { ...content[end - 1], content: [...content[end - 1].content, item] };
    else content.splice(end, 0, { type: 'taskList', content: [item] });
    const added = this.store.saveNote(to.id, { baseRevision: to.revision, doc: { ...to.doc, content }, docFormat: DOC_FORMAT, opId: uuid(), keepPrevious: true });
    const removed = this.store.saveNote(from.id, { baseRevision: from.revision, doc: removeTask(from.doc, taskId), docFormat: DOC_FORMAT, opId: uuid(), keepPrevious: true });
    return { taskId, from: { id: from.id, revision: removed.revision }, to: { id: to.id, revision: added.revision } };
  }

  // ----- the note itself: title, tags, the whole text, History, Trash -----

  setTitle(id, title) {
    const note = this.#liveNote(id);
    if (note.kind !== 'note') throw new HttpError(400, 'no_title', 'Only free notes have a title. A daily entry is named by its tag and date');
    if (typeof title !== 'string' && title !== null) throw new HttpError(400, 'bad_title', '"title" must be text (or "" to remove it)');
    const res = this.store.saveNote(id, { baseRevision: note.revision, doc: note.doc, docFormat: DOC_FORMAT, opId: uuid(), title: title ?? '' });
    return { id, revision: res.revision, title: this.store.getNote(id).title };
  }

  addTag(id, tag) {
    this.#liveNote(id);
    return { id, tags: this.store.addTagToNote(id, tag).map((t) => t.path) };
  }

  removeTag(id, tag) {
    const note = this.#liveNote(id);
    const path = normalizeTag(tag);
    const found = note.tags.find((t) => t.path === path);
    if (!found) throw new HttpError(404, 'tag_not_found', `The note is not tagged ${tag}. Its tags are: ${note.tags.map((t) => t.path).join(', ') || 'none'}`);
    return { id, tags: this.store.removeTagFromNote(id, found.id).map((t) => t.path) };
  }

  /**
   * Replace the whole note with new Markdown (from get_note, edited). A task line whose text is still there keeps its
   * task: the same id, completion time, priority, hiding, project, person and waiting; its tick and its shown dates ("(due 2026-10-20)") are taken
   * from the new line. Lines that match no task become new tasks; tasks left out are removed. The previous text is kept
   * in History. Needs the revision that was read.
   */
  rewrite(id, { markdown, expectedRevision }) {
    const note = this.#liveNote(id);
    this.#reviewed(note, expectedRevision);
    const doc = { ...note.doc, content: this.#blocks(markdown) };
    const old = new Map(); // task text -> taskItems with that text, in order
    const collectOld = (node) => {
      if (node.type === 'taskItem' && node.attrs?.id) {
        const t = taskText(node);
        old.set(t, [...(old.get(t) ?? []), node]);
      }
      for (const child of node.content ?? []) collectOld(child);
    };
    collectOld(note.doc);
    const counts = { kept: 0, added: 0 };
    const walk = (node) => {
      let next = node;
      if (node.type === 'taskItem') {
        const [first, ...rest] = node.content ?? [];
        let schedule = null;
        let head = first;
        const lastText = first?.content?.at(-1);
        if (lastText?.type === 'text') {
          const split = splitSchedule(lastText.text);
          if (split.schedule || split.text !== lastText.text) {
            schedule = split.schedule;
            const inline = [...first.content.slice(0, -1), ...(split.text ? [{ ...lastText, text: split.text.replace(/\s+$/, '') }] : [])].filter((n) => n.type !== 'text' || n.text);
            head = { ...first, content: inline.length ? inline : undefined };
            if (!head.content) delete head.content;
          }
        }
        next = { ...node, content: [head, ...rest].filter(Boolean) };
        const match = old.get(taskText(next))?.shift();
        const sched = schedule ?? { due: null, dueTime: null, start: null, startTime: null };
        if (match) {
          counts.kept++;
          next.attrs = patchedTaskAttrs(match.attrs, { ...sched, checked: !!node.attrs.checked }) ?? match.attrs;
        } else {
          counts.added++;
          next.attrs = patchedTaskAttrs({ ...node.attrs }, sched);
        }
      }
      return next.content ? { ...next, content: next.content.map(walk) } : next;
    };
    const content = doc.content.map(walk);
    const removed = [...old.values()].reduce((n, list) => n + list.length, 0);
    const res = this.store.saveNote(id, { baseRevision: note.revision, doc: { ...doc, content }, docFormat: DOC_FORMAT, opId: uuid(), keepPrevious: true });
    return { id, revision: res.revision, tasks: { kept: counts.kept, added: counts.added, removed }, ...(res.unchanged ? { unchanged: true } : {}) };
  }

  listVersions(id) {
    this.#liveNote(id);
    return { id, versions: this.store.listVersions(id) };
  }

  getVersion(id, versionId) {
    this.#liveNote(id);
    const v = this.store.getVersion(id, checkId(versionId, 'version id'));
    return { id, versionId: v.id, revision: v.revision, kind: v.kind, createdAt: v.createdAt, markdown: docToMarkdown(v.doc) };
  }

  // The text now is kept as a version first, so restoring can itself be undone.
  restoreVersion(id, versionId) {
    this.#liveNote(id);
    const note = this.store.restoreVersion(id, checkId(versionId, 'version id'));
    return { id, revision: note.revision };
  }

  listTrash() {
    return {
      notes: this.store.listTrash().map((n) => ({ id: n.id, title: n.title, kind: n.kind, date: n.date, tags: n.tags.map((t) => t.path), deletedAt: n.deletedAt, preview: plainText(n.doc).trim().slice(0, 160) })),
    };
  }

  restoreNote(id, { dropConflictingTags } = {}) {
    const { note, droppedTags } = this.store.restoreNote(checkId(id, 'note id'), { dropConflictingTags: dropConflictingTags === true });
    return { id: note.id, revision: note.revision, droppedTags };
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
