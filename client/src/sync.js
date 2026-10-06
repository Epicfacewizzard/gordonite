// Client-side save engine.
//
// The editor never waits on the network and is never re-initialised by a save:
//   keystroke -> session.touch() -> (300 ms) capture doc -> IndexedDB -> (500 ms) PUT to server
// A save response only updates revision bookkeeping; it does not touch the editor,
// so the selection, keyboard and undo history are left alone.
//
// Sessions live here, not in components, so saving continues when an editor unmounts.
import { api, ApiError, NetworkError } from './api.js';
import { pendingStore } from './pending.js';
import { uuid } from '../../shared/ids.js';
import { DOC_FORMAT, emptyDoc, isEmptyDoc } from '../../shared/doc.js';
import { updateTask } from '../../shared/tasks.js';

const CAPTURE_DEBOUNCE_MS = 300;
const CAPTURE_MAX_WAIT_MS = 1000;
const FLUSH_DELAY_MS = 500;
const BACKOFF_MS = [2000, 4000, 8000, 15000, 30000];

class Emitter {
  #subs = new Set();
  subscribe(fn) {
    this.#subs.add(fn);
    return () => this.#subs.delete(fn);
  }
  emit() {
    for (const fn of [...this.#subs]) fn();
  }
}

// Give repeated task ids new ones (a merged document can contain the same task twice).
export function dedupeTaskIds(doc) {
  const seen = new Set();
  const walk = (n) => {
    if (n.type === 'taskItem') {
      if (!n.attrs?.id || seen.has(n.attrs.id)) n = { ...n, attrs: { ...n.attrs, id: uuid() } };
      seen.add(n.attrs.id);
    }
    return n.content ? { ...n, content: n.content.map(walk) } : n;
  };
  return walk(doc);
}

function combineDocs(serverDoc, mineDoc) {
  const marker = {
    type: 'paragraph',
    content: [{ type: 'text', text: 'Merged from the other version of this note:', marks: [{ type: 'italic' }] }],
  };
  return dedupeTaskIds({ type: 'doc', content: [...serverDoc.content, marker, ...mineDoc.content] });
}

export class Session extends Emitter {
  constructor(sync, { id, tags, date, revision = 0, doc = null, kind = 'daily', createdAt = null, title = null }) {
    super();
    this.sync = sync;
    this.id = id;
    this.tags = tags; // tag paths; used when the note is first created on the server
    this.date = date;
    this.title = title; // the note's name (free notes only); null = untitled
    this.kind = kind; // 'daily' (a stream's entry for a day) or 'note' (a free note: any number per day, may have no tag)
    this.createdAt = createdAt ?? new Date().toISOString(); // only used to order notes of one day
    this.revision = revision; // server revision our edits are based on (0 = not on server yet)
    this.serverDoc = doc; // last content known to be on the server
    this.pending = null; // { doc, seq }: newest captured content not yet confirmed
    this.dirtySeq = 0;
    this.capturedSeq = 0;
    this.inFlight = null;
    this.unknownOps = []; // requests whose outcome we never learned (lost response)
    this.keepPrevious = false;
    this.conflict = null; // { reason: 'revision'|'deleted'|'slot', note }
    this.error = null; // { kind: 'network'|'server', message }
    this.localError = null; // IndexedDB failed: edits are only held in memory
    this.generation = 0; // bumped when content is replaced from outside the editor
    this.provider = null;
    this.retryCount = 0;
    this.captureTimer = null;
    this.captureMaxTimer = null;
    this.flushTimer = null;
    this.retryTimer = null;
    this.idbChain = Promise.resolve();
    this.discarded = false;
  }

  // ----- state for the UI -----

  currentDoc() {
    return this.pending?.doc ?? this.serverDoc ?? emptyDoc();
  }

  get hasUnsaved() {
    return !!this.pending || !!this.inFlight || this.dirtySeq > this.capturedSeq;
  }

  /** saved | pending | saving | offline | failed | conflict */
  get status() {
    if (this.conflict) return 'conflict';
    if (!this.hasUnsaved) return 'saved';
    if (this.error) return this.error.kind === 'network' ? 'offline' : 'failed';
    return this.inFlight ? 'saving' : 'pending';
  }

  // ----- editor hooks -----

  attach(provider) {
    this.provider = provider;
  }

  detach() {
    this.captureNow();
    this.provider = null;
  }

  touch() {
    const wasClean = !this.hasUnsaved;
    this.dirtySeq++;
    clearTimeout(this.captureTimer);
    this.captureTimer = setTimeout(() => this.captureNow(), CAPTURE_DEBOUNCE_MS);
    this.captureMaxTimer ??= setTimeout(() => this.captureNow(), CAPTURE_MAX_WAIT_MS);
    if (wasClean) this.emit(); // status flips to "pending"; later keystrokes need no re-render
  }

  captureNow({ schedule = true } = {}) {
    clearTimeout(this.captureTimer);
    clearTimeout(this.captureMaxTimer);
    this.captureTimer = this.captureMaxTimer = null;
    if (!this.provider || this.dirtySeq === this.capturedSeq) return;
    const doc = this.provider();
    this.capturedSeq = this.dirtySeq;
    if (this.revision === 0 && isEmptyDoc(doc) && !this.pending) {
      // Nothing has been saved yet and there is still no content: do not create a note.
      this.emit();
      return;
    }
    this.pending = this.#pendingOf(doc, this.dirtySeq);
    this.persist();
    if (schedule) this.scheduleFlush();
    this.emit();
  }

  // What is waiting to be sent: the text and the name as they are right now.
  #pendingOf(doc, seq) {
    return { doc, seq, title: this.title };
  }

  // ----- durable local copy -----

  persist() {
    if (!this.pending) return this.idbChain;
    const record = {
      noteId: this.id,
      doc: this.pending.doc,
      title: this.pending.title ?? null,
      tags: this.tags,
      date: this.date,
      kind: this.kind,
      baseRevision: this.revision,
      unknownOps: [...this.unknownOps],
      seq: this.pending.seq,
      updatedAt: Date.now(),
    };
    this.idbChain = this.idbChain
      .then(() => pendingStore.put(record))
      .then(() => {
        if (this.localError) {
          this.localError = null;
          this.emit();
        }
      })
      .catch((err) => {
        this.localError = err;
        this.emit();
      });
    return this.idbChain;
  }

  #forgetLocal(seq = Infinity) {
    this.idbChain = this.idbChain.then(() => pendingStore.deleteIfSeq(this.id, seq)).catch((err) => {
      this.localError = err;
      this.emit();
    });
    return this.idbChain;
  }

  // ----- talking to the server -----

  scheduleFlush(delay = FLUSH_DELAY_MS) {
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), delay);
  }

  retryNow() {
    clearTimeout(this.retryTimer);
    this.error = null;
    this.retryCount = 0;
    this.emit();
    return this.flush();
  }

  async flush() {
    clearTimeout(this.flushTimer);
    if (this.inFlight || this.conflict) return;
    this.captureNow({ schedule: false });
    if (!this.pending) return;

    const snap = this.pending;
    const opId = uuid();
    this.inFlight = { seq: snap.seq, opId };
    this.emit();
    try {
      const res = await api.saveNote(this.id, {
        baseRevision: this.revision,
        doc: snap.doc,
        docFormat: DOC_FORMAT,
        // only free notes have a name; a daily entry is named by its date
        ...(this.kind === 'note' ? { title: snap.title ?? null } : {}),
        tags: this.tags,
        date: this.date,
        kind: this.kind,
        opId,
        afterOps: this.unknownOps,
        keepPrevious: this.keepPrevious || undefined,
      });
      this.revision = res.revision;
      this.unknownOps = [];
      this.keepPrevious = false;
      this.error = null;
      this.retryCount = 0;
      this.serverDoc = snap.doc;
      if (this.pending?.seq === snap.seq) {
        this.pending = null;
        this.#forgetLocal(snap.seq);
      } else {
        this.persist(); // newer edits exist; record the new base revision with them
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.body?.status === 'conflict') {
        this.conflict = { reason: err.body.reason, note: err.body.note };
      } else {
        this.unknownOps = [...this.unknownOps, opId].slice(-50);
        this.error =
          err instanceof NetworkError
            ? { kind: 'network', message: err.message }
            : { kind: 'server', message: err.message ?? String(err) };
        this.scheduleRetry();
      }
      this.persist();
    } finally {
      this.inFlight = null;
      this.emit();
    }
    if (!this.conflict && !this.error && this.pending) this.scheduleFlush(100);
  }

  scheduleRetry() {
    clearTimeout(this.retryTimer);
    const delay = BACKOFF_MS[Math.min(this.retryCount++, BACKOFF_MS.length - 1)];
    this.retryTimer = setTimeout(() => {
      this.error = null;
      this.flush();
    }, delay);
  }

  // ----- conflict resolution (always keeps the other version somewhere recoverable) -----

  #replaceContent(doc, { revision, markPending, serverDoc = doc, title }) {
    if (title !== undefined) this.title = title;
    this.serverDoc = serverDoc;
    this.revision = revision;
    this.conflict = null;
    this.error = null;
    this.unknownOps = [];
    this.generation++;
    if (markPending) {
      this.dirtySeq++;
      this.capturedSeq = this.dirtySeq;
      this.pending = this.#pendingOf(doc, this.dirtySeq);
      this.persist();
      this.scheduleFlush(100);
    } else {
      this.pending = null;
      this.dirtySeq = this.capturedSeq = 0;
      this.#forgetLocal();
    }
    this.emit();
  }

  /** Replace the other version with this phone's text (the replaced text stays in history). */
  async resolveKeepMine() {
    const { reason, note } = this.conflict;
    if (reason === 'deleted') {
      const restored = await api.restoreNote(this.id); // may throw slot_taken; the UI shows it
      this.revision = restored.note.revision;
    } else if (reason === 'revision') {
      this.revision = note.revision;
    } else {
      throw new Error('Another note already exists for this day; combine them instead.');
    }
    this.keepPrevious = true;
    this.conflict = null;
    this.emit();
    this.scheduleFlush(0);
  }

  /** Take the server's text; this phone's text is already kept in the note's history. */
  resolveUseServer() {
    const { reason, note } = this.conflict;
    if (reason === 'revision') {
      this.#replaceContent(note.doc, { revision: note.revision, markPending: false, title: note.title ?? null });
    } else {
      this.#discard();
    }
  }

  /** Put both versions into one note (the other version first, then this phone's text). */
  async resolveCombine() {
    const { reason, note } = this.conflict;
    const mine = this.currentDoc();
    if (reason === 'revision') {
      this.#replaceContent(combineDocs(note.doc, mine), { revision: note.revision, markPending: true, serverDoc: note.doc, title: this.title ?? note.title ?? null });
    } else if (reason === 'slot') {
      const target = this.sync.adopt(note);
      target.#replaceContent(combineDocs(note.doc, mine), { revision: note.revision, markPending: true, serverDoc: note.doc });
      this.#discard();
      return target;
    } else {
      throw new Error('This note is in the trash; restore it first.');
    }
    return this;
  }

  /** Change the tags of a note that is not on the server yet (they are sent when it is first saved). */
  setLocalTags(paths) {
    this.tags = paths;
    if (this.pending) this.persist(); // keep the phone copy's tags in step with the text
    this.emit();
  }

  /**
   * Tick or untick a task without an editor (the combined Tasks view). It is saved like any
   * other edit: held on the phone first, then sent against this session's revision, so a note
   * changed elsewhere gives a visible conflict instead of an overwrite. False if the task is gone.
   */
  setTaskChecked(taskId, checked) {
    return this.editTask(taskId, { checked });
  }

  /**
   * Change a task wherever the note is: through the open editor if there is one (so the editor and the saved copy never
   * disagree, and it is one undoable edit), otherwise straight through the save session.
   */
  applyTaskPatch(taskId, patch) {
    if (this.provider && this.taskPatcher) return this.taskPatcher(taskId, patch);
    return this.editTask(taskId, patch);
  }

  /** Same, for any task change: { checked, due, start, hidden } (null date or hidden: false clears it). */
  editTask(taskId, patch) {
    const doc = updateTask(this.currentDoc(), taskId, patch);
    if (!doc) return false;
    this.dirtySeq++;
    this.capturedSeq = this.dirtySeq;
    this.pending = this.#pendingOf(doc, this.dirtySeq);
    this.persist();
    this.scheduleFlush(100);
    this.emit();
    return true;
  }

  /**
   * Rename a free note (empty = untitled). It travels with the text through the same save path: kept on the
   * phone first, then sent against the note's revision, so a stale rename is a visible conflict, not an overwrite.
   */
  editTitle(title) {
    this.title = String(title ?? '').slice(0, 120);
    const doc = this.provider ? this.provider() : this.currentDoc();
    if (this.revision === 0 && isEmptyDoc(doc) && !this.title.trim() && !this.pending) {
      this.emit(); // an unsaved note with no text and no name is still nothing
      return;
    }
    this.dirtySeq++;
    this.capturedSeq = this.dirtySeq;
    this.pending = this.#pendingOf(doc, this.dirtySeq);
    this.persist();
    this.scheduleFlush();
    this.emit();
  }

  /** Show exactly what the server has (e.g. after restoring a version). Remounts the editor. */
  applyServerNote(note) {
    this.tags = note.tags.map((t) => t.path);
    this.#replaceContent(note.doc, { revision: note.revision, markPending: false, title: note.title ?? null });
  }

  #discard() {
    this.pending = null;
    this.conflict = null;
    this.discarded = true;
    clearTimeout(this.flushTimer);
    clearTimeout(this.retryTimer);
    this.#forgetLocal();
    this.sync.forget(this);
    this.emit();
  }

  /** Drop unsent edits of a note that never reached the server. */
  discardUnsaved() {
    this.#discard();
  }
}

class SyncManager extends Emitter {
  constructor() {
    super();
    this.sessions = new Map();
    this.drafts = new Map(); // "tag|date" -> session for notes that may not exist on the server yet
    this.storageError = null;
    this.inProgress = 0; // see track()
    this.ready = null;
  }

  #make(init) {
    const s = new Session(this, init);
    s.subscribe(() => this.emit());
    this.sessions.set(s.id, s);
    return s;
  }

  /** Load unsent edits left by a previous visit and send them. Call once at startup. */
  init() {
    this.ready ??= (async () => {
      let records = [];
      try {
        records = await pendingStore.getAll();
      } catch (err) {
        this.storageError = err;
      }
      for (const r of records) {
        const s = this.#make({ id: r.noteId, tags: r.tags, date: r.date, revision: r.baseRevision, kind: r.kind ?? 'daily', title: r.title ?? null });
        s.pending = { doc: r.doc, seq: r.seq, title: r.title ?? null };
        s.dirtySeq = s.capturedSeq = r.seq;
        s.unknownOps = r.unknownOps ?? [];
        if (r.baseRevision === 0 && s.kind === 'daily') for (const t of r.tags) this.drafts.set(`${t}|${r.date}`, s);
        s.flush();
      }
      this.#installLifecycleHooks();
      this.emit();
    })();
    return this.ready;
  }

  #installLifecycleHooks() {
    const persistAll = () => {
      for (const s of this.sessions.values()) s.captureNow({ schedule: false });
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') persistAll();
      else this.retryAll();
    });
    window.addEventListener('pagehide', persistAll);
    window.addEventListener('online', () => this.retryAll());
  }

  retryAll() {
    for (const s of this.sessions.values()) if (s.pending && !s.conflict && !s.inFlight) s.retryNow();
  }

  get(id) {
    return this.sessions.get(id);
  }

  forget(session) {
    this.sessions.delete(session.id);
    for (const [k, v] of this.drafts) if (v === session) this.drafts.delete(k);
  }

  /** Register a note fetched from the server. Local unsent edits always win over server content. */
  adopt(note) {
    let s = this.sessions.get(note.id);
    if (!s) {
      s = this.#make({ id: note.id, tags: note.tags.map((t) => t.path), date: note.date, revision: note.revision, doc: note.doc, kind: note.kind, createdAt: note.createdAt, title: note.title ?? null });
    } else if (!s.hasUnsaved && !s.conflict && !s.provider) {
      // Only refresh a note nobody is editing. With an editor open, its text is based on the
      // revision it was loaded at; moving that base forward without showing the new text would
      // let the next keystroke silently overwrite someone else's change. A stale base instead
      // produces a visible conflict when saving.
      s.revision = note.revision;
      s.serverDoc = note.doc;
      s.title = note.title ?? null;
    }
    s.tags = note.tags.map((t) => t.path);
    return s;
  }

  /** The editable entry for a tag+date that may not have a note yet. Creates nothing on the server. */
  draft(tag, date) {
    const key = `${tag}|${date}`;
    let s = this.drafts.get(key);
    if (!s || s.discarded) {
      s = this.#make({ id: uuid(), tags: [tag], date, revision: 0 });
      this.drafts.set(key, s);
    }
    return s;
  }

  /** A new free note (not tied to a day's slot), optionally already tagged. Creates nothing on the server until text is typed. */
  newNote(date, tags = []) {
    return this.#make({ id: uuid(), tags, date, revision: 0, kind: 'note' });
  }

  /** Unsent notes (not yet on the server) that belong to this tag. */
  unsavedNewFor(tag) {
    return [...this.sessions.values()].filter((s) => s.revision === 0 && s.pending && s.tags.includes(tag) && !s.discarded);
  }

  /**
   * Wrap an edit made outside an editor (it first has to find its note's session) so the
   * status dot is not green while that edit is still on its way into the save queue.
   */
  async track(work) {
    this.inProgress++;
    this.emit();
    try {
      return await work;
    } finally {
      this.inProgress--;
      this.emit();
    }
  }

  /** Worst state across all notes, for the always-visible indicator. */
  summary() {
    const order = ['conflict', 'failed', 'offline', 'saving', 'pending', 'saved'];
    let worst = this.inProgress > 0 ? 'saving' : 'saved';
    let count = 0;
    for (const s of this.sessions.values()) {
      const st = s.status;
      if (st !== 'saved') count++;
      if (order.indexOf(st) < order.indexOf(worst)) worst = st;
    }
    return { status: worst, count, storageError: this.storageError, localError: [...this.sessions.values()].some((s) => s.localError) };
  }
}

export const sync = new SyncManager();
