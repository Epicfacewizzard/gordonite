// The day's debrief, for an assistant that was asked for one (docs/DEBRIEF.md): what was written, who was named, the tasks
// made that day, the tasks still open and overdue, the suggestions the built-in rules would offer and the ones already
// filed. It reads; it never changes a note. The app's own Debrief screen draws the same things from the phone's copy.
import { dateInTz, isValidDateString } from '../shared/dates.js';
import { plainText } from '../shared/doc.js';
import { suggest } from '../shared/suggestions.js';
import { listProposals } from './suggestions.js';
import { HttpError } from './errors.js';

const CLIP = 4000;

export function buildDebrief({ db, store, links, config }, day) {
  const today = dateInTz(new Date(), config.tz);
  day = day || today;
  if (!isValidDateString(day)) throw new HttpError(400, 'bad_day', '"day" must be a date like 2026-11-12');
  const { people, matcher } = links.peopleMatcher();

  const ids = db.prepare('SELECT id FROM notes WHERE deleted_at IS NULL AND note_date = ? ORDER BY CASE kind WHEN \'daily\' THEN 0 ELSE 1 END, created_at, id').all(day);
  const written = [];
  const named = new Map();
  const rule = [];
  for (const { id } of ids) {
    const note = store.getNote(id);
    if (!note) continue;
    const isPerson = note.tags.some((t) => t.path === '05-people' || t.path.startsWith('05-people/'));
    const text = plainText(note.doc);
    written.push({ noteId: note.id, kind: note.kind, title: note.title ?? null, tags: note.tags.map((t) => t.path), isPerson, text: text.length > CLIP ? `${text.slice(0, CLIP)}…` : text, truncated: text.length > CLIP });
    if (!isPerson) {
      for (const m of matcher(text)) {
        const p = people.find((x) => x.id === m.id);
        if (p && p.id !== note.id) named.set(p.id, { id: p.id, title: p.title });
      }
      for (const s of suggest({ doc: note.doc, noteDate: day, matcher, people })) rule.push({ noteId: note.id, kind: s.kind, line: s.line, ...(s.name ? { name: s.name } : {}), ...(s.personId ? { personId: s.personId } : {}), ...(s.due ? { due: s.due } : {}) });
    }
  }

  const tasks = store.listTasks();
  const open = (t) => !t.checked && !t.dismissedAt;
  const brief = (t) => ({ noteId: t.noteId, taskId: t.taskId, text: t.text, due: t.due, ...(t.person ? { personId: t.person } : {}), ...(t.owner ? { ownerId: t.owner } : {}) });
  return {
    day,
    today,
    written,
    people: [...named.values()],
    tasksMade: tasks.filter((t) => t.date === day).map((t) => ({ ...brief(t), checked: t.checked })),
    // The owner's own tasks; other people's commitments (a task with an ownerId) are listed apart.
    open: tasks.filter((t) => open(t) && !t.hidden && !t.owner).map(brief),
    overdue: tasks.filter((t) => open(t) && !t.hidden && !t.owner && t.due && t.due < today).map(brief),
    othersOpen: tasks.filter((t) => open(t) && !t.hidden && t.owner).map(brief),
    // What the built-in rules would offer for that day's writing. The owner's dismissals are kept on their phone, not here.
    ruleSuggestions: rule,
    // What an assistant has already filed for the owner to accept or dismiss in the app.
    filed: listProposals(db, { day, status: 'open' }),
    note: 'Suggestions are proposals only: file them with file_suggestions and the owner accepts or dismisses each in the app. Do not change notes to carry them out unless the owner asks.',
  };
}
