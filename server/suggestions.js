// Suggestions filed by an assistant for the Debrief (docs/DEBRIEF.md): proposals the owner accepts or dismisses in the
// app. This module only stores and lists them; it never changes a note, a task or a person. Accepting is done by the app
// through its normal save path (so it works with revisions, history and conflicts), which then marks the proposal.
import { HttpError } from './errors.js';
import { checkId } from './ids.js';
import { uuid } from '../shared/ids.js';
import { isValidDateString } from '../shared/dates.js';
import { cleanProposal } from '../shared/suggestions.js';

const MAX_PER_CALL = 50;
const MAX_OPEN_PER_DAY = 200;
const STATUSES = ['open', 'accepted', 'dismissed', 'withdrawn'];
const nowIso = () => new Date().toISOString();

const toProposal = (r) => ({ id: r.id, day: r.day, noteId: r.note_id ?? null, ...JSON.parse(r.data), source: r.source, status: r.status, createdAt: r.created_at, resolvedAt: r.resolved_at ?? null });

/** File proposals for a day: { filed: [proposal] }. All or none (one bad item refuses the call). */
export function fileProposals(db, { day, items, source = 'assistant' }) {
  if (!isValidDateString(day)) throw new HttpError(400, 'bad_day', '"day" must be a date like 2026-11-12');
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'bad_suggestions', '"items" must be a list of suggestions');
  if (items.length > MAX_PER_CALL) throw new HttpError(400, 'bad_suggestions', `At most ${MAX_PER_CALL} suggestions in one call`);
  const clean = items.map((raw, i) => {
    try {
      return cleanProposal(raw);
    } catch (err) {
      throw new HttpError(400, 'bad_suggestion', `Suggestion ${i + 1}: ${err.message}`);
    }
  });
  const open = db.prepare("SELECT COUNT(*) AS c FROM suggestions WHERE day = ? AND status = 'open'").get(day).c;
  if (open + clean.length > MAX_OPEN_PER_DAY) throw new HttpError(409, 'too_many_suggestions', `That day already has ${open} open suggestions. Ask the owner to clear them in the Debrief first`);
  const insert = db.prepare('INSERT INTO suggestions (id, day, note_id, kind, data, source, status, created_at) VALUES (?,?,?,?,?,?,?,?)');
  const at = nowIso();
  db.exec('BEGIN IMMEDIATE');
  let ids;
  try {
    ids = clean.map(({ noteId, ...rest }) => {
      const id = uuid();
      insert.run(id, day, noteId ?? null, rest.kind, JSON.stringify(rest), source, 'open', at);
      return id;
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { filed: ids.map((id) => getProposal(db, id)) };
}

export function getProposal(db, id) {
  const row = db.prepare('SELECT * FROM suggestions WHERE id = ?').get(checkId(id, 'suggestion id'));
  if (!row) throw new HttpError(404, 'suggestion_not_found', 'No such suggestion');
  return toProposal(row);
}

/** Proposals for a day (every day when none is given), oldest first; open ones unless a status is asked for. */
export function listProposals(db, { day = null, status = 'open' } = {}) {
  if (day != null && !isValidDateString(day)) throw new HttpError(400, 'bad_day', '"day" must be a date like 2026-11-12');
  if (status !== 'all' && !STATUSES.includes(status)) throw new HttpError(400, 'bad_status', `"status" must be one of ${STATUSES.join(', ')} or all`);
  const where = [day ? 'day = ?' : null, status === 'all' ? null : 'status = ?'].filter(Boolean);
  const args = [day, status === 'all' ? null : status].filter((v) => v !== null);
  const rows = db.prepare(`SELECT * FROM suggestions ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at, rowid LIMIT 500`).all(...args);
  return rows.map(toProposal);
}

/** The app says what became of a proposal: accepted or dismissed (an assistant may withdraw its own). Only an open one changes. */
export function resolveProposal(db, id, status) {
  if (!['accepted', 'dismissed', 'withdrawn'].includes(status)) throw new HttpError(400, 'bad_status', '"status" must be accepted, dismissed or withdrawn');
  const current = getProposal(db, id);
  if (current.status !== 'open') throw new HttpError(409, 'suggestion_closed', `That suggestion is already ${current.status}`);
  db.prepare('UPDATE suggestions SET status = ?, resolved_at = ? WHERE id = ?').run(status, nowIso(), id);
  return getProposal(db, id);
}
