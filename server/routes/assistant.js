// The assistant door (needs the ASSISTANT_TOKEN key; see docs/ASSISTANT.md). The key itself is checked by the dispatcher.
import fs from 'node:fs';
import { sendJson } from '../http.js';
import { HttpError } from '../errors.js';
import { checkId } from '../ids.js';
import { dateInTz, addDays } from '../../shared/dates.js';
import { addMood, listMoods } from '../moods.js';

export function registerAssistantRoutes({ route, assistant, db, config, files, store }) {
  // ----- assistant (needs the ASSISTANT_TOKEN key; see docs/ASSISTANT.md) -----
  route('GET', '/api/assistant/ping', async ({ res }) => sendJson(res, 200, { ok: true, today: dateInTz(new Date(), config.tz), tz: config.tz }));
  route('GET', '/api/assistant/moods', async ({ res, query }) => {
    // ?days=N (default 14) counts back from today; ?from= and ?to= give exact days
    const days = Math.min(Math.max(Number(query.get('days')) || 14, 1), 400);
    const to = query.get('to') || dateInTz(new Date(), config.tz);
    sendJson(res, 200, listMoods(db, config, { from: query.get('from') || addDays(to, -(days - 1)), to }));
  });
  route('POST', '/api/assistant/moods', async ({ res, body }) => sendJson(res, 200, addMood(db, config, body)));
  route('GET', '/api/assistant/overview', async ({ res }) => sendJson(res, 200, assistant.overview()));
  route('GET', '/api/assistant/notes', async ({ res, query }) => {
    sendJson(res, 200, store.listNotes({ tag: query.get('tag'), sub: query.get('sub') === '1', untagged: query.get('untagged') === '1', q: query.get('q') ?? '', limit: query.get('limit'), offset: query.get('offset'), sort: query.get('sort') }));
  });
  route('GET', '/api/assistant/notes/:id', async ({ res, params }) => sendJson(res, 200, assistant.getNote(params.id)));
  route('POST', '/api/assistant/notes/:id/trash', async ({ res, params, body }) => {
    if (body.confirmed !== true) throw new HttpError(400, 'confirmation_required', 'Ask the user to confirm this specific note before moving it to Trash');
    const note = assistant.getNote(checkId(params.id));
    if (body.expectedRevision !== note.revision) throw new HttpError(409, 'revision_conflict', 'The note changed. Read it and ask for confirmation again');
    sendJson(res, 200, store.deleteNote(note.id));
  });
  route('POST', '/api/assistant/notes', async ({ res, body }) => sendJson(res, 200, assistant.createNote(body)));
  route('POST', '/api/assistant/notes/:id/append', async ({ res, params, body }) => sendJson(res, 200, assistant.append(params.id, body.markdown)));
  route('POST', '/api/assistant/notes/:id/replace-text', async ({ res, params, body }) => sendJson(res, 200, assistant.replaceText(params.id, body)));
  route('POST', '/api/assistant/notes/:id/replace-section', async ({ res, params, body }) => sendJson(res, 200, assistant.replaceSection(params.id, body)));
  route('POST', '/api/assistant/daily/append', async ({ res, body }) => sendJson(res, 200, assistant.appendDaily(body)));
  route('POST', '/api/assistant/notes/:id/tasks/:taskId', async ({ res, params, body }) => {
    sendJson(res, 200, assistant.updateTask(params.id, params.taskId, body));
  });
  // Files (see docs/ATTACHMENTS.md). Bytes travel as base64 in JSON, like everything else on this door.
  const ASSISTANT_FILE_LIMIT = 25 * 1024 * 1024;
  const listArgs = (query) => ({ noteId: query.get('noteId'), unattached: query.get('unattached') === '1', q: query.get('q') ?? '', kind: query.get('kind'), limit: query.get('limit'), offset: query.get('offset') });
  route('GET', '/api/assistant/attachments', async ({ res, query }) => sendJson(res, 200, files.list(listArgs(query))));
  route('GET', '/api/assistant/attachments/:id', async ({ res, params }) => {
    const attachment = files.get(checkId(params.id, 'file id'));
    if (!attachment) throw new HttpError(404, 'file_not_found', 'No such file');
    sendJson(res, 200, { attachment });
  });
  route('GET', '/api/assistant/attachments/:id/content', async ({ res, params, query }) => {
    const info = files.fileFor(checkId(params.id, 'file id'), { original: query.get('original') === '1' });
    if (!info) throw new HttpError(404, 'file_not_found', 'No such file');
    if (info.size > ASSISTANT_FILE_LIMIT) throw new HttpError(413, 'too_large', `That file is ${Math.round(info.size / 1024 / 1024)} MB; the assistant door sends files up to 25 MB`);
    sendJson(res, 200, { id: params.id, name: info.name, mime: info.mime, size: info.size, encoding: 'base64', data: fs.readFileSync(info.path).toString('base64') });
  });
  route('POST', '/api/assistant/attachments', async ({ res, body }) => {
    if (typeof body.data !== 'string' || !body.data) throw new HttpError(400, 'bad_file', '"data" must be the file as base64');
    const noteId = body.noteId ? checkId(body.noteId, 'note id') : null;
    const attachment = await files.add(Buffer.from(body.data, 'base64'), { name: body.name, noteId, source: 'assistant' });
    sendJson(res, 200, { attachment });
  });
  route('POST', '/api/assistant/notes/:id/attach', async ({ res, params, body }) => {
    sendJson(res, 200, assistant.attach(params.id, body.attachmentId));
  });
}
