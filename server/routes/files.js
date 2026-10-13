// Files: images, PDFs and other documents (see docs/ATTACHMENTS.md).
import { sendJson, readRaw, sendFile } from '../http.js';
import { HttpError } from '../errors.js';
import { checkId } from '../ids.js';

export function registerFileRoutes({ route, config, files }) {
  // ----- files: images, PDFs and other documents (see docs/ATTACHMENTS.md) -----
  // The body is the file itself. ?name= is its name; ?noteId= the note it is for, if known (a saved note that
  // refers to the file claims it anyway).
  route(
    'POST',
    '/api/attachments',
    async ({ req, res, query }) => {
      const noteId = query.get('noteId');
      if (noteId) checkId(noteId, 'note id');
      const data = await readRaw(req, config.maxUploadBytes);
      sendJson(res, 200, { attachment: await files.add(data, { name: query.get('name') ?? '', noteId: noteId || null, source: 'upload' }) });
    },
    { raw: true },
  );
  route('GET', '/api/attachments', async ({ res, query }) => {
    // ?removed=1 lists the files that were removed, so one can be brought back.
    const listed = files.list({ noteId: query.get('noteId'), unattached: query.get('unattached') === '1', q: query.get('q') ?? '', kind: query.get('kind'), removed: query.get('removed') === '1', limit: query.get('limit'), offset: query.get('offset') });
    sendJson(res, 200, { ...listed, total: files.stats() });
  });
  route('GET', '/api/attachments/:id', async ({ res, params }) => {
    const attachment = files.get(checkId(params.id, 'file id'));
    if (!attachment) throw new HttpError(404, 'file_not_found', 'No such file');
    sendJson(res, 200, { attachment });
  });
  route('GET', '/api/attachments/:id/file', async ({ req, res, params, query }) => {
    const info = files.fileFor(checkId(params.id, 'file id'));
    if (!info) throw new HttpError(404, 'file_not_found', 'No such file');
    sendFile(req, res, info, { download: query.get('download') === '1' });
  });
  route('GET', '/api/attachments/:id/original', async ({ req, res, params }) => {
    const info = files.fileFor(checkId(params.id, 'file id'), { original: true });
    if (!info) throw new HttpError(404, 'file_not_found', 'No such file');
    sendFile(req, res, info, { download: true });
  });
  route('DELETE', '/api/attachments/:id', async ({ res, params }) => {
    if (!files.remove(checkId(params.id, 'file id'))) throw new HttpError(404, 'file_not_found', 'No such file');
    sendJson(res, 200, { ok: true });
  });
  // Undo a removal: the file is shown again, in the Files page and in every note that has it.
  route('POST', '/api/attachments/:id/restore', async ({ res, params }) => {
    const attachment = files.restore(checkId(params.id, 'file id'));
    if (!attachment) throw new HttpError(404, 'file_not_found', 'That file is not among the removed files');
    sendJson(res, 200, { attachment });
  });
}
