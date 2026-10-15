// The skin log on this device (see docs/SKIN-LOG.md). What an entry says and where it goes in a note is in
// shared/skin.js. Here:
//   - the month's note is found (or started) and the entry's line added, edited or removed through the save queue,
//     so it works offline like any other edit;
//   - the entry itself, as data, is sent to the server (/api/skin) through a small queue of its own kept in local
//     storage: an entry leaves the queue only when the server has it, so a save made offline is sent later;
//   - the pick lists and the last few entries' picks ("Same as last time") are kept on this device.
import { api, NetworkError } from './api.js';
import { sync } from './sync.js';
import { addEntry, removeEntry, monthTitle, entryText } from '../../shared/skin.js';
import { emptyDoc } from '../../shared/doc.js';
import { uuid } from '../../shared/ids.js';
import { createRecordQueue } from './record-queue.js';

export const SKIN_TAG = 'skin';
const NOTES_KEY = 'hq-skin-notes'; // { "2026-09": noteId }: so the month's note is found offline too
const LISTS_KEY = 'hq-skin-lists';
const QUEUE_KEY = 'hq-skin-pending'; // [{ op: 'put'|'delete', id, body?, error? }] in the order they were made

// Each list: the everyday words shown first, then clinical / less common ones behind "More".
export const DEFAULT_LISTS = {
  symptoms: {
    common: ['Itch', 'Redness', 'Dryness', 'Burning', 'Irritation', 'Scarring', 'Flaking', 'No irritation'],
    more: ['Pruritus', 'Erythema', 'Xerosis', 'Excoriation', 'Lichenification', 'Scaling', 'Fissures', 'Papules', 'Vesicles', 'Weeping / exudate', 'Crusting', 'Edema', 'Stinging', 'Pain', 'Warmth', 'Hyperpigmentation', 'Hypopigmentation', 'Bleeding'],
  },
  areas: {
    common: ['Face', 'Neck', 'Arms', 'Elbows', 'Wrists', 'Hands', 'Legs', 'Behind knees', 'Lower legs'],
    more: ['Scalp', 'Forehead', 'Eyelids', 'Cheeks', 'Perioral', 'Chest', 'Back', 'Abdomen', 'Upper arms', 'Forearms', 'Antecubital fossa', 'Dorsal hands', 'Fingers', 'Thighs', 'Popliteal fossa', 'Shins', 'Calves', 'Ankles', 'Feet'],
  },
  products: {
    common: ['Betaderm', 'Protopic', 'Eucerin', 'CeraVe', 'Vaseline', 'Dimethicone'],
    more: ['Hydrocortisone', 'Emollient', 'Barrier cream', 'Oral antihistamine', 'Cool compress', 'Wet wrap', 'Oatmeal bath', 'Gentle cleanser', 'Sunscreen'],
  },
  response: {
    common: ['Relief', 'Partial relief', 'No change', 'Worse', 'Stung on application'],
    more: ['Itch resolved', 'Redness reduced', 'Slept through'],
  },
  triggers: {
    common: ['Sweat / exercise', 'Alcohol', 'Heat', 'Woke up itchy', 'New product', 'Stress'],
    more: ['Scratching', 'Hot shower', 'Dry air / cold', 'Fabric / wool', 'Laundry detergent', 'Food', 'Poor sleep', 'Pets', 'Fragrance'],
  },
};

const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // storage unavailable: the choice lasts until the page closes
  }
};

/** The pick lists ({ kind: { common, more } }); anything added on this device joins the everyday words. */
export function getLists() {
  const saved = read(LISTS_KEY, {});
  return Object.fromEntries(
    Object.entries(DEFAULT_LISTS).map(([k, { common, more }]) => {
      const added = Array.isArray(saved[k]) ? saved[k] : [];
      return [k, { common: [...new Set([...common, ...added])], more: more.filter((w) => !added.includes(w)) }];
    }),
  );
}
export function addToList(kind, word) {
  const w = word.trim();
  if (!w) return getLists();
  const saved = read(LISTS_KEY, {});
  saved[kind] = [...new Set([...(saved[kind] ?? []), w])];
  write(LISTS_KEY, saved);
  return getLists();
}

// The last few entries' picks (no date, time or comment), newest first, for "Same as last time" and "Use again".
const RECENT_KEY = 'hq-skin-recent';
const LISTED = ['symptoms', 'areas', 'products', 'response', 'triggers'];
/** What was picked, without date, time, comment or reassessments. An older entry's one side/aspect becomes each area's. */
export function picksOf(entry) {
  const picks = Object.fromEntries(LISTED.map((k) => [k, Array.isArray(entry[k]) ? entry[k] : []]));
  picks.severity = entry.severity ?? null;
  const legacy = entry.side || entry.aspect ? { side: entry.side ?? null, aspect: entry.aspect ?? null } : null;
  picks.where = Object.fromEntries(picks.areas.map((a) => [a, entry.where?.[a] ?? legacy ?? { side: null, aspect: null }]));
  return picks;
}
export function getRecent() {
  const list = read(RECENT_KEY, []);
  return Array.isArray(list) ? list : [];
}
export function rememberRecent(entry, line) {
  const picks = picksOf(entry);
  const same = JSON.stringify(picks);
  const list = [{ picks, line }, ...getRecent().filter((r) => JSON.stringify(r.picks) !== same)].slice(0, 5);
  write(RECENT_KEY, list);
  return list;
}

// ----- the month notes -----

async function openNote(id) {
  const s = sync.get(id);
  if (s && !s.discarded) return s;
  const { note } = await api.getNote(id);
  return note.deletedAt ? null : sync.adopt(note);
}

// The month's note, if there is one: remembered on this device, else looked up on the server by its name.
async function findMonthNote(month) {
  const known = read(NOTES_KEY, {})[month];
  if (known) {
    try {
      const s = await openNote(known);
      if (s) return s;
    } catch (err) {
      if (err instanceof NetworkError) throw new NetworkError('Can’t reach the server, and this month’s skin log is not on this phone yet.');
      // gone (404): look it up again below
    }
  }
  const title = monthTitle(`${month}-01`);
  const { notes = [] } = await api.notes({ tag: SKIN_TAG, q: title, limit: 20, offset: 0 });
  const found = notes.find((n) => n.title === title && !n.deletedAt);
  return found ? openNote(found.id) : null;
}

// Put a line into its month's note (starting the note if needed). Resolves to the note's id.
async function addLine({ date, time, text }) {
  await sync.ready;
  const month = date.slice(0, 7);
  let session;
  try {
    session = await findMonthNote(month);
  } catch (err) {
    // Out of reach and never seen here: only a remembered note would be safe to add to; starting a second note for
    // the month offline could leave two. With nothing remembered, a new note is started.
    if (!(err instanceof NetworkError) || read(NOTES_KEY, {})[month]) throw err;
    session = null;
  }
  if (session) {
    await session.editDoc((doc) => addEntry(doc, { date, time, text }));
  } else {
    session = sync.newNote(date, [SKIN_TAG]);
    await session.fill(addEntry(emptyDoc(), { date, time, text }), monthTitle(date));
  }
  write(NOTES_KEY, { ...read(NOTES_KEY, {}), [month]: session.id });
  return session.id;
}

// Take a line out of its note. Resolves to whether it was found (someone may have edited the note by hand).
async function removeLine(noteId, { date, text }) {
  if (!noteId) return false;
  await sync.ready;
  const session = await openNote(noteId).catch((err) => {
    if (err instanceof NetworkError) throw new NetworkError('Can’t reach the server, and the note with this entry is not on this phone.');
    return null;
  });
  if (!session) return false;
  let found = false;
  await session.editDoc((doc) => {
    const r = removeEntry(doc, { date, text });
    found = r.found;
    return r.doc;
  });
  return found;
}

// ----- the entries as data: a queue to the server (record-queue.js) -----

export const skinQueue = createRecordQueue({
  storageKey: QUEUE_KEY,
  async send(c) {
    if (c.op === 'delete') return api.deleteSkin(c.id);
    const r = await api.saveSkin(c.id, c.body);
    // a product in it started or extended a habit's course on the server: the habits on screen are out of date
    if (r?.habits?.length && typeof window !== 'undefined') window.dispatchEvent(new Event('hq-habits-changed'));
    return r;
  },
});
const enqueue = (change) => skinQueue.add({ key: change.id, ...change });
export const flushSkinQueue = () => skinQueue.flush();
const getQueue = () => skinQueue.get();

/** Recent entries (the last 30 days): the server's, corrected by what this device has not sent yet. Newest first. */
export async function recentEntries() {
  let entries = [];
  try {
    entries = (await api.skinEntries()).entries ?? [];
  } catch (err) {
    if (!(err instanceof NetworkError)) throw err;
  }
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const op of getQueue()) {
    if (op.op === 'delete') byId.delete(op.id);
    else byId.set(op.id, { id: op.id, ...op.body, waiting: true, error: op.error ?? null });
  }
  return [...byId.values()].sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
}

// ----- what the screen does -----

const dataOf = (entry) => ({ ...picksOf(entry), comment: entry.comment ?? '', reassessments: Array.isArray(entry.reassessments) ? entry.reassessments : [] });

/** A new entry (or a reassessment, with followsId). Resolves to { id, noteId }. */
export async function addSkinEntry({ date, time, text, entry, followsId = null }) {
  const noteId = await addLine({ date, time, text });
  const id = uuid();
  enqueue({ op: 'put', id, body: { date, time, text, data: dataOf(entry), noteId, followsId } });
  return { id, noteId };
}

/** Change an entry: its line in the note is replaced (moved, if the date changed) and the entry saved again. */
export async function editSkinEntry(old, { date, time, text, entry }) {
  const found = await removeLine(old.noteId, old);
  const noteId = await addLine({ date, time, text });
  enqueue({ op: 'put', id: old.id, body: { date, time, text, data: dataOf(entry), noteId, followsId: old.followsId ?? null } });
  return { id: old.id, noteId, lineWasFound: found };
}

/** Delete an entry: its line comes out of the note and the entry is deleted. */
export async function deleteSkinEntry(old) {
  const found = await removeLine(old.noteId, old);
  enqueue({ op: 'delete', id: old.id });
  return { lineWasFound: found };
}

/**
 * Reassess an entry: the reassessment ({ date, time, response, symptoms, severity, comment }) is added to that entry
 * and its line in the note says it at the end ("… Reassessed at 2345: partial relief."). Where and what was applied
 * stay the entry's own.
 */
export async function reassessSkinEntry(old, reassessment) {
  const data = { ...old.data, reassessments: [...(old.data?.reassessments ?? []), reassessment] };
  const text = entryText({ ...data, time: old.time, date: old.date });
  return editSkinEntry(old, { date: old.date, time: old.time, text, entry: data });
}
