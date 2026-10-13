// Backups: the status, a snapshot, a bundle of the database and its files, and stored backups.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sendJson, sendDownload, fileStamp } from '../http.js';
import { HttpError } from '../errors.js';
import { createBackup, backupPath, backupStatus } from '../backup.js';
import { writeBundle } from '../bundle.js';

export function registerBackupRoutes({ route, db, config, log, appVersion }) {
  route('GET', '/api/backups', async ({ res }) => sendJson(res, 200, backupStatus(config)));
  route('POST', '/api/backups', async ({ res }) => sendJson(res, 200, createBackup(db, config, 'manual')));
  // A fresh consistent snapshot streamed straight to the client; nothing is kept on the server.
  route('GET', '/api/backups/snapshot', async ({ res }) => {
    const tmp = path.join(os.tmpdir(), `hq-snapshot-${process.pid}-${Date.now()}.sqlite`);
    try {
      db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      sendDownload(res, `personal-hq-${fileStamp()}.sqlite`, 'application/vnd.sqlite3', fs.readFileSync(tmp));
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });
  // Everything in one file: a consistent snapshot of the database and every stored file, with a manifest that
  // names each one and its SHA-256 (see docs/BACKUPS.md). Streamed, so a large workspace is not held in memory.
  // If it fails part way the connection is dropped, so the download fails instead of looking like a whole zip.
  route('GET', '/api/backups/bundle', async ({ res }) => {
    res.writeHead(200, {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="gordonite-bundle-${fileStamp()}.zip"`,
      'cache-control': 'no-store',
    });
    try {
      await writeBundle(db, config, res, { appVersion });
    } catch (err) {
      log.error('[bundle] download failed:', err);
      res.destroy(err);
    }
  });
  route('GET', '/api/backups/file/:name', async ({ res, params }) => {
    const p = backupPath(config, params.name);
    if (!p) throw new HttpError(404, 'not_found', 'No such backup');
    sendDownload(res, params.name, 'application/vnd.sqlite3', fs.readFileSync(p));
  });
}
