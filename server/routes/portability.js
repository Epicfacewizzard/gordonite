// Export and import.
import { sendJson, sendDownload, fileStamp } from '../http.js';
import { exportAll, exportMarkdownZip, exportFilesZip, importAll } from '../portability.js';

export function registerPortabilityRoutes({ route, db, config, store, files }) {
  route('GET', '/api/export/json', async ({ res }) => {
    sendDownload(res, `personal-hq-export-${fileStamp()}.json`, 'application/json', Buffer.from(JSON.stringify(exportAll(db, config), null, 1)));
  });
  route('GET', '/api/export/markdown', async ({ res }) => {
    sendDownload(res, `personal-hq-markdown-${fileStamp()}.zip`, 'application/zip', exportMarkdownZip(store, db, files));
  });
  // Every attached file in one zip (with an index.json). The JSON export lists them but does not carry the bytes.
  route('GET', '/api/export/files', async ({ res }) => {
    sendDownload(res, `personal-hq-files-${fileStamp()}.zip`, 'application/zip', exportFilesZip(db, files));
  });
  route('POST', '/api/import', async ({ res, query, body }) => {
    sendJson(res, 200, importAll(db, config, body, query.get('mode') ?? 'merge'));
  });
}
