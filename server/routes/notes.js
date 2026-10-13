// The combined task list, and notes: reading, saving, trash, tags on a note, versions.
import { sendJson } from '../http.js';
import { HttpError } from '../errors.js';
import { checkId } from '../ids.js';

export function registerNoteRoutes({ route, store }) {
  route('GET', '/api/tasks', async ({ res }) => sendJson(res, 200, { tasks: store.listTasks() }));

  route('GET', '/api/notes', async ({ res, query }) => {
    sendJson(
      res,
      200,
      store.listNotes({
        tag: query.get('tag'),
        sub: query.get('sub') === '1',
        untagged: query.get('untagged') === '1',
        q: query.get('q') ?? '',
        limit: query.get('limit'),
        offset: query.get('offset'),
        sort: query.get('sort'),
      }),
    );
  });
  route('GET', '/api/notes/:id', async ({ res, params }) => {
    const note = store.getNote(checkId(params.id));
    if (!note) throw new HttpError(404, 'not_found', 'Note not found');
    sendJson(res, 200, { note });
  });
  route('PUT', '/api/notes/:id', async ({ res, params, body }) => {
    const result = store.saveNote(params.id, body);
    sendJson(res, result.status === 'ok' ? 200 : 409, result);
  });
  route('DELETE', '/api/notes/:id', async ({ res, params }) => sendJson(res, 200, store.deleteNote(checkId(params.id))));
  route('POST', '/api/notes/:id/restore', async ({ res, params, query }) => {
    sendJson(res, 200, store.restoreNote(checkId(params.id), { dropConflictingTags: query.get('dropConflictingTags') === '1' }));
  });
  route('POST', '/api/notes/:id/tags', async ({ res, params, body }) => {
    sendJson(res, 200, { tags: store.addTagToNote(checkId(params.id), body.path) });
  });
  route('DELETE', '/api/notes/:id/tags/:tagId', async ({ res, params }) => {
    sendJson(res, 200, { tags: store.removeTagFromNote(checkId(params.id), checkId(params.tagId, 'tag id')) });
  });
  route('GET', '/api/notes/:id/versions', async ({ res, params }) => {
    sendJson(res, 200, { versions: store.listVersions(checkId(params.id)) });
  });
  route('GET', '/api/notes/:id/versions/:vid', async ({ res, params }) => {
    sendJson(res, 200, { version: store.getVersion(checkId(params.id), checkId(params.vid, 'version id')) });
  });
  route('POST', '/api/notes/:id/versions/:vid/restore', async ({ res, params }) => {
    sendJson(res, 200, { note: store.restoreVersion(checkId(params.id), checkId(params.vid, 'version id')) });
  });
  route('GET', '/api/trash', async ({ res }) => sendJson(res, 200, { notes: store.listTrash() }));
}
