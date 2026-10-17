// What the assistant door does to habits, the skin log and People (docs/ASSISTANT.md). It uses the same functions as
// the app's own routes (habits.js, skin.js, people.js) and changes notes only through Store.saveNote, so a skin log
// line or a person's log line is a normal edit of the note, with its previous text kept in History.
// Edits here are patches: fields left out keep what is saved, unlike the app's routes, which replace the whole record.
import { uuid } from '../shared/ids.js';
import { DOC_FORMAT } from '../shared/doc.js';
import { dateInTz, isValidDateString } from '../shared/dates.js';
import { monthTitle, entryText, entryIsEmpty, addEntry, removeEntry } from '../shared/skin.js';
import { PEOPLE_TAG, isPersonTags, addLogLine } from '../shared/people.js';
import { listHabits, saveHabit, deleteHabit, setCheck, OPTION_DEFAULTS } from './habits.js';
import { listSkinEntries, saveSkinEntry, deleteSkinEntry, cleanSkinEntry } from './skin.js';
import { listPeople, getPerson, savePerson } from './people.js';
import { HttpError } from './errors.js';
import { checkId } from './ids.js';

const pickOptions = (body) => Object.fromEntries(Object.keys(OPTION_DEFAULTS).filter((k) => body?.[k] !== undefined).map((k) => [k, body[k]]));

const SKIN_TAG = 'skin'; // client/src/skin-log.js
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
// What an entry's picks are (shared/skin.js entryText); anything else in "data" is refused so a typo is not silently kept.
const SKIN_FIELDS = ['symptoms', 'severity', 'areas', 'where', 'side', 'aspect', 'products', 'response', 'triggers', 'comment', 'reassessments'];

export class AssistantRecords {
  constructor(store) {
    this.store = store;
    this.db = store.db;
    this.cfg = store.cfg;
  }

  #today() {
    return dateInTz(new Date(), this.cfg.tz);
  }

  // ----- habits -----

  #habitRow(id) {
    const row = this.db.prepare('SELECT * FROM habits WHERE id = ?').get(checkId(id, 'habit id'));
    if (!row) throw new HttpError(404, 'habit_not_found', 'No such habit. get_habits lists the habits and their ids');
    return row;
  }

  habits({ from, to } = {}) {
    return listHabits(this.db, this.cfg, { from, to });
  }

  // A new habit: a name, and the days of the week it is for (0 = Sunday … 6 = Saturday; every day if left out), plus
  // any of the habit options (OPTION_DEFAULTS in habits.js: frequency, yes-no or a number, colour, reminder …).
  addHabit(body) {
    const id = uuid();
    const { habit } = saveHabit(this.db, id, { ...pickOptions(body), name: body.name, detail: body.detail ?? '', days: body.days ?? ALL_DAYS, created: body.created ?? this.#today(), sort: body.sort });
    return { habit, created: true };
  }

  // Change some of a habit's fields. A deleted habit's id brings it back with its ticks.
  editHabit(id, patch) {
    const row = this.#habitRow(id);
    const was = { name: row.name, detail: row.detail, days: JSON.parse(row.days), created: row.created, trigger: row.trigger ? JSON.parse(row.trigger) : null, sort: row.sort, ...OPTION_DEFAULTS, ...JSON.parse(row.options ?? '{}') };
    const next = { ...was, ...pickOptions(patch) };
    for (const k of ['name', 'detail', 'days', 'created', 'sort']) if (patch[k] !== undefined) next[k] = patch[k];
    if (patch.trigger !== undefined) next.trigger = patch.trigger;
    const { habit } = saveHabit(this.db, row.id, next);
    return { habit, previous: was, ...(row.deleted_at ? { restored: true } : {}) };
  }

  deleteHabit(id) {
    const row = this.#habitRow(id);
    deleteHabit(this.db, row.id);
    return { ok: true, habitId: row.id, undo: 'edit_habit with this habitId (any field, e.g. its name) brings it back with its ticks' };
  }

  // value: the number entered for a number habit; skip: the day does not count against it (both only with done:true).
  tickHabit(id, { date, done, value, skip }) {
    const row = this.#habitRow(id);
    if (row.deleted_at) throw new HttpError(404, 'habit_not_found', 'That habit is deleted');
    if (typeof done !== 'boolean') throw new HttpError(400, 'bad_done', '"done" must be true or false');
    const entry = value !== undefined || skip !== undefined ? { value, skip } : null;
    setCheck(this.db, this.cfg, row.id, date ?? this.#today(), done, 'assistant', entry);
    return { ok: true, habitId: row.id, date: date ?? this.#today(), done, ...(entry ? { value: value ?? null, skip: skip === true } : {}) };
  }

  // ----- skin log (docs/SKIN-LOG.md) -----
  // Each entry is a record and one line in its month's note ("Skin log · October 2026", tag skin), under the day's
  // heading. Adding, editing and deleting change both, as the Skin screen does.

  #skinRow(id) {
    const row = this.db.prepare('SELECT * FROM skin_entries WHERE id = ? AND deleted_at IS NULL').get(checkId(id, 'entry id'));
    if (!row) throw new HttpError(404, 'entry_not_found', 'No such skin log entry. get_skin_log lists the entries and their ids');
    return { id: row.id, date: row.entry_date, time: row.entry_time, data: JSON.parse(row.data), text: row.text, noteId: row.note_id, followsId: row.follows_id };
  }

  #skinData(data) {
    if (data === undefined) return {};
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'bad_data', '"data" must be an object');
    const unknown = Object.keys(data).filter((k) => !SKIN_FIELDS.includes(k));
    if (unknown.length) throw new HttpError(400, 'bad_data', `Unknown field(s) in "data": ${unknown.join(', ')}. Use ${SKIN_FIELDS.join(', ')}`);
    for (const k of ['symptoms', 'areas', 'products', 'response', 'triggers', 'reassessments']) {
      if (data[k] !== undefined && !Array.isArray(data[k])) throw new HttpError(400, 'bad_data', `"${k}" must be a list`);
    }
    if (data.comment !== undefined && typeof data.comment !== 'string') throw new HttpError(400, 'bad_data', '"comment" must be text');
    return data;
  }

  #monthNote(date) {
    const row = this.db
      .prepare(
        `SELECT n.id FROM notes n JOIN note_tags nt ON nt.note_id = n.id JOIN tags t ON t.id = nt.tag_id
         WHERE t.path = ? AND n.title = ? AND n.deleted_at IS NULL ORDER BY n.created_at LIMIT 1`,
      )
      .get(SKIN_TAG, monthTitle(date));
    return row ? this.store.getNote(row.id) : null;
  }

  #saveDoc(note, doc) {
    return this.store.saveNote(note.id, { baseRevision: note.revision, doc, docFormat: DOC_FORMAT, opId: uuid(), keepPrevious: true });
  }

  // Take the old line out of its note (when there is one) and put the new one in its month's note. Returns the note
  // the line is now in, and whether the old line was found (it may have been changed by hand).
  #placeLine(old, next) {
    let lineWasFound = null;
    let month = next ? this.#monthNote(next.date) : null;
    if (old?.noteId) {
      const note = this.store.getNote(old.noteId);
      if (note && !note.deletedAt) {
        const r = removeEntry(note.doc, old);
        lineWasFound = r.found;
        if (next && month?.id === note.id) {
          this.#saveDoc(note, addEntry(r.doc, next));
          return { noteId: note.id, lineWasFound };
        }
        if (r.found) this.#saveDoc(note, r.doc);
      } else lineWasFound = false;
    }
    if (!next) return { noteId: null, lineWasFound };
    if (month) {
      month = this.store.getNote(month.id); // its revision may have just changed above
      this.#saveDoc(month, addEntry(month.doc, next));
      return { noteId: month.id, lineWasFound };
    }
    const id = uuid();
    this.store.saveNote(id, { baseRevision: 0, doc: addEntry({ type: 'doc', content: [] }, next), docFormat: DOC_FORMAT, kind: 'note', tags: [SKIN_TAG], date: next.date, title: monthTitle(next.date), opId: uuid() });
    return { noteId: id, lineWasFound, noteCreated: true };
  }

  skinLog({ from, to } = {}) {
    return listSkinEntries(this.db, this.cfg, { from, to });
  }

  addSkin(body) {
    const date = body.date ?? this.#today();
    if (!isValidDateString(date)) throw new HttpError(400, 'bad_date', '"date" must be a date like 2026-10-07');
    const time = body.time ?? '';
    const data = this.#skinData(body.data ?? {});
    if (entryIsEmpty(data)) throw new HttpError(400, 'bad_data', 'Nothing to log: give symptoms, areas, products, response, triggers or a comment');
    const text = entryText({ ...data, time, date });
    cleanSkinEntry({ date, time, text, data }); // refused before the note is touched
    const placed = this.#placeLine(null, { date, time, text });
    const id = uuid();
    const saved = saveSkinEntry(this.db, this.cfg, id, { date, time, text, data, noteId: placed.noteId });
    return { entry: saved.entry, habits: saved.habits, noteId: placed.noteId, ...(placed.noteCreated ? { noteCreated: true } : {}) };
  }

  // Change an entry: what is given in "data" replaces those picks; the line is written again from the picks.
  editSkin(id, patch) {
    const old = this.#skinRow(id);
    const data = { ...old.data, ...this.#skinData(patch.data) };
    const date = patch.date ?? old.date;
    const time = patch.time ?? old.time;
    if (!isValidDateString(date)) throw new HttpError(400, 'bad_date', '"date" must be a date like 2026-10-07');
    const text = entryText({ ...data, time, date });
    cleanSkinEntry({ date, time, text, data }); // refused before the note is touched
    const placed = this.#placeLine(old, { date, time, text });
    const saved = saveSkinEntry(this.db, this.cfg, old.id, { date, time, text, data, noteId: placed.noteId, followsId: old.followsId });
    return { entry: saved.entry, previous: old, noteId: placed.noteId, lineWasFound: placed.lineWasFound };
  }

  deleteSkin(id) {
    const old = this.#skinRow(id);
    const placed = this.#placeLine(old, null);
    deleteSkinEntry(this.db, old.id);
    return { ok: true, entryId: old.id, previous: old, lineWasFound: placed.lineWasFound };
  }

  // ----- People (docs/PEOPLE.md) -----

  #personNote(noteId) {
    const note = this.store.getNote(checkId(noteId, 'note id'));
    if (!note || note.deletedAt) throw new HttpError(404, 'not_found', 'Note not found');
    if (!isPersonTags(note.tags.map((t) => t.path))) throw new HttpError(400, 'not_a_person', `That note is not a person: People are notes tagged ${PEOPLE_TAG} (or a group under it)`);
    return note;
  }

  // Everyone, without the note text (get_note reads a person's page).
  people() {
    return { people: listPeople(this.db).people.map(({ text, ...p }) => p) };
  }

  person(noteId) {
    this.#personNote(noteId);
    return getPerson(this.db, noteId);
  }

  // Change some details: each field given replaces that field (a list replaces the whole list); others stay.
  editPerson(noteId, patch) {
    this.#personNote(noteId);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new HttpError(400, 'bad_profile', '"profile" must be an object of the fields to change');
    const previous = getPerson(this.db, noteId).profile;
    const saved = savePerson(this.db, noteId, { profile: { ...previous, ...patch } });
    return { ...saved, previous };
  }

  // A conversation, added at the top of the Log in the person's note ("Oct 15, 2026 · Coffee: …").
  logPerson(noteId, { date, how, text }) {
    const note = this.#personNote(noteId);
    const day = date ?? this.#today();
    if (!isValidDateString(day)) throw new HttpError(400, 'bad_date', '"date" must be a date like 2026-10-15');
    if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new HttpError(400, 'bad_text', '"text" must be what was talked about');
    if (how !== undefined && (typeof how !== 'string' || how.length > 30 || /:/.test(how))) throw new HttpError(400, 'bad_how', '"how" is a short word such as Coffee, Call, Text, Email or In person');
    const res = this.#saveDoc(note, addLogLine(note.doc, { date: day, how: how?.trim() ?? '', text }));
    return { noteId: note.id, revision: res.revision, date: day };
  }
}
