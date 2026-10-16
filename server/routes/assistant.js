// The assistant door (needs the ASSISTANT_TOKEN key; see docs/ASSISTANT.md). The key itself is checked by the dispatcher.
import fs from 'node:fs';
import { sendJson } from '../http.js';
import { HttpError } from '../errors.js';
import { checkId } from '../ids.js';
import { dateInTz, addDays } from '../../shared/dates.js';
import { normalizeTag } from '../../shared/tags.js';
import { addMood, listMoods, updateMood, deleteMood, restoreMood } from '../moods.js';
import { AssistantRecords } from '../assistant-records.js';

export function registerAssistantRoutes({ route, assistant, db, config, files, store, appVersion }) {
  const records = new AssistantRecords(store);
  // ----- assistant (needs the ASSISTANT_TOKEN key; see docs/ASSISTANT.md) -----
  route('GET', '/api/assistant/ping', async ({ res }) => sendJson(res, 200, { ok: true, today: dateInTz(new Date(), config.tz), tz: config.tz, dailyTag: store.getSettings().dailyTag, version: appVersion }));
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

  // ----- editing (0.11.0): everything goes through the same store functions as the app -----
  // Notes: title, tags, the whole text, History, Trash.
  route('PUT', '/api/assistant/notes/:id/title', async ({ res, params, body }) => sendJson(res, 200, assistant.setTitle(params.id, body.title)));
  route('POST', '/api/assistant/notes/:id/tags', async ({ res, params, body }) => sendJson(res, 200, assistant.addTag(params.id, body.tag)));
  route('POST', '/api/assistant/notes/:id/tags/remove', async ({ res, params, body }) => sendJson(res, 200, assistant.removeTag(params.id, body.tag)));
  route('POST', '/api/assistant/notes/:id/rewrite', async ({ res, params, body }) => sendJson(res, 200, assistant.rewrite(params.id, body)));
  route('GET', '/api/assistant/notes/:id/versions', async ({ res, params }) => sendJson(res, 200, assistant.listVersions(params.id)));
  route('GET', '/api/assistant/notes/:id/versions/:vid', async ({ res, params }) => sendJson(res, 200, assistant.getVersion(params.id, params.vid)));
  route('POST', '/api/assistant/notes/:id/versions/:vid/restore', async ({ res, params }) => sendJson(res, 200, assistant.restoreVersion(params.id, params.vid)));
  route('GET', '/api/assistant/trash', async ({ res }) => sendJson(res, 200, assistant.listTrash()));
  route('POST', '/api/assistant/notes/:id/restore', async ({ res, params, body }) => sendJson(res, 200, assistant.restoreNote(params.id, body)));
  // Tasks: delete one, move one to another note (changing one is POST /notes/:id/tasks/:taskId above).
  route('DELETE', '/api/assistant/notes/:id/tasks/:taskId', async ({ res, params }) => sendJson(res, 200, assistant.deleteTask(params.id, params.taskId)));
  route('POST', '/api/assistant/notes/:id/tasks/:taskId/move', async ({ res, params, body }) => sendJson(res, 200, assistant.moveTask(params.id, params.taskId, body.toNoteId)));
  // Tags and settings.
  route('GET', '/api/assistant/tags', async ({ res }) => sendJson(res, 200, { tags: store.listTags(), dailyTag: store.getSettings().dailyTag }));
  route('POST', '/api/assistant/tags/move', async ({ res, body }) => {
    const from = normalizeTag(body.tag);
    if (!from) throw new HttpError(400, 'bad_tag', '"tag" must be the tag to move or rename, e.g. projects/old');
    const into = body.into ?? (from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '');
    sendJson(res, 200, store.moveTag({ from, into, name: body.name }));
  });
  route('PUT', '/api/assistant/tags/flags', async ({ res, body }) => {
    const tag = store.listTags().find((t) => t.path === normalizeTag(body.tag));
    if (!tag) throw new HttpError(404, 'tag_not_found', 'No such tag. list_tags lists them');
    if (body.favorite === undefined && body.daily === undefined) throw new HttpError(400, 'bad_flags', 'Give favorite and/or daily (true or false)');
    if (body.favorite !== undefined) store.setTagFavorite(tag.id, body.favorite);
    if (body.daily !== undefined) store.setTagDaily(tag.id, body.daily);
    sendJson(res, 200, { tag: store.listTags().find((t) => t.id === tag.id) });
  });
  route('PUT', '/api/assistant/settings', async ({ res, body }) => {
    if (body.dailyTag === undefined) throw new HttpError(400, 'bad_settings', 'Give dailyTag');
    sendJson(res, 200, store.setDailyTag(body.dailyTag));
  });
  // Moods.
  route('PUT', '/api/assistant/moods/:id', async ({ res, params, body }) => sendJson(res, 200, updateMood(db, config, params.id, body)));
  route('DELETE', '/api/assistant/moods/:id', async ({ res, params }) => sendJson(res, 200, { ...deleteMood(db, params.id), undo: 'restore_mood with this moodId' }));
  route('POST', '/api/assistant/moods/:id/restore', async ({ res, params }) => sendJson(res, 200, restoreMood(db, params.id)));
  // Habits.
  route('GET', '/api/assistant/habits', async ({ res, query }) => sendJson(res, 200, records.habits({ from: query.get('from'), to: query.get('to') })));
  route('POST', '/api/assistant/habits', async ({ res, body }) => sendJson(res, 200, records.addHabit(body)));
  route('PUT', '/api/assistant/habits/:id', async ({ res, params, body }) => sendJson(res, 200, records.editHabit(params.id, body)));
  route('DELETE', '/api/assistant/habits/:id', async ({ res, params }) => sendJson(res, 200, records.deleteHabit(params.id)));
  route('POST', '/api/assistant/habits/:id/checks', async ({ res, params, body }) => sendJson(res, 200, records.tickHabit(params.id, body)));
  // Skin log.
  route('GET', '/api/assistant/skin', async ({ res, query }) => sendJson(res, 200, records.skinLog({ from: query.get('from'), to: query.get('to') })));
  route('POST', '/api/assistant/skin', async ({ res, body }) => sendJson(res, 200, records.addSkin(body)));
  route('PUT', '/api/assistant/skin/:id', async ({ res, params, body }) => sendJson(res, 200, records.editSkin(params.id, body)));
  route('DELETE', '/api/assistant/skin/:id', async ({ res, params }) => sendJson(res, 200, records.deleteSkin(params.id)));
  // People.
  route('GET', '/api/assistant/people', async ({ res }) => sendJson(res, 200, records.people()));
  route('GET', '/api/assistant/people/:noteId', async ({ res, params }) => sendJson(res, 200, records.person(params.noteId)));
  route('PUT', '/api/assistant/people/:noteId', async ({ res, params, body }) => sendJson(res, 200, records.editPerson(params.noteId, body.profile)));
  route('POST', '/api/assistant/people/:noteId/log', async ({ res, params, body }) => sendJson(res, 200, records.logPerson(params.noteId, body)));
}
