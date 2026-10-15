// People on this device (see docs/PEOPLE.md): the server's list of people (each a note plus its details), corrected by
// the detail changes this device has not sent yet (record-queue.js), so an edit shows at once and works offline.
// The note itself (name, text, groups as tags) is saved the usual way, through the note's save session.
import { api, NetworkError } from './api.js';
import { createRecordQueue } from './record-queue.js';
import { emptyProfile } from '../../shared/people.js';

let sent = false; // something reached the server since it was last asked
export const peopleQueue = createRecordQueue({
  storageKey: 'hq-people-pending',
  async send(c) {
    await api.savePerson(c.noteId, c.profile);
    sent = true;
  },
});

let server = { people: [] }; // what the server (or the phone copy) last said
let loaded = false;
let loading = null;
let error = null;
let fromPhoneCopy = null;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());
// A sent change leaves the queue: ask the server again so the screen keeps showing it (now as the server's).
peopleQueue.subscribe(() => {
  emit();
  if (sent && loaded) {
    sent = false;
    loadPeople();
  }
});

/** Ask the server again (the phone copy when out of reach). */
export function loadPeople() {
  if (loading) return loading;
  loading = (async () => {
    try {
      const r = await api.people();
      server = r;
      fromPhoneCopy = r.fromPhoneCopy ?? null;
      error = null;
    } catch (err) {
      error = err instanceof NetworkError ? null : err.message; // offline with no copy: show what waits on the phone
    } finally {
      loaded = true;
      loading = null;
      emit();
    }
  })();
  return loading;
}

if (typeof window !== 'undefined') {
  window.addEventListener('hq-reconnected', () => {
    peopleQueue.flush().then(() => loaded && loadPeople());
  });
}

/** { people, loaded, error, fromPhoneCopy, waiting, refused, profileOf(noteId) } with this device's unsent changes applied. */
export function peopleState() {
  const waiting = peopleQueue.get();
  const pending = new Map(waiting.map((c) => [c.noteId, c.profile]));
  const people = server.people.map((p) => {
    if (!pending.has(p.noteId)) return p;
    const profile = pending.get(p.noteId);
    return { ...p, profile, lastTalked: [p.lastTalked ?? '', profile.lastTalked].sort().at(-1), waiting: true };
  });
  return {
    people,
    loaded,
    error,
    fromPhoneCopy,
    waiting: waiting.length,
    refused: waiting.filter((c) => c.error),
    profileOf: (noteId) => pending.get(noteId) ?? server.people.find((p) => p.noteId === noteId)?.profile ?? emptyProfile(),
    isWaiting: (noteId) => pending.has(noteId),
  };
}

export function subscribePeople(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Save a person's details (the whole record; a newer save replaces one still waiting). */
export function savePersonProfile(noteId, profile) {
  peopleQueue.add({ key: `person:${noteId}`, noteId, profile });
}
