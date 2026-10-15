import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../server/config.js';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { uuid } from '../shared/ids.js';
import { dateInTz } from '../shared/dates.js';

// Only this isolated checkout's sample database is opened. No environment credentials are inherited.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = loadConfig({ DATA_DIR: path.join(root, 'data/habits-preview'), HOST: '127.0.0.1', PORT: '8094', BACKUP_INTERVAL_HOURS: '0' });
fs.mkdirSync(config.dataDir, { recursive: true });
const db = openDb(config.dbFile);
const { server, store } = createApp({ config, db });
const marker = path.join(config.dataDir, '.samples-created');
if (!fs.existsSync(marker) && db.prepare('SELECT COUNT(*) AS n FROM notes').get().n === 0) {
  const today = dateInTz(new Date(), config.tz);
  store.saveNote(uuid(), {
    baseRevision: 0, kind: 'daily', title: '', date: today, tags: ['daily-jots'], docFormat: 1,
    doc: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'A sample day in Gordonite. Try the habit check-ins beside this note, then open History & manage to see the whole week.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'What felt good today? A short walk, a few pages, and a moment to pause.' }] },
    ] },
  });
  store.saveNote(uuid(), {
    baseRevision: 0, kind: 'note', title: 'Weekend ideas', date: today, tags: ['Projects'], docFormat: 1,
    doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fictional sample note. Visit the library and plan a walk somewhere new.' }] }] },
  });
  fs.writeFileSync(marker, 'Fictional preview notes created.\n');
}
server.on('error', (error) => { console.error(error.code === 'EADDRINUSE' ? 'Port 8094 is already in use. Stop the earlier habit preview before restarting.' : error.message); db.close(); process.exitCode = 1; });
server.listen(config.port, config.host, () => console.log('Habit preview: http://127.0.0.1:8094/#/\nBased on 0.8.1. Sample data in this checkout only. Assistant access disabled.'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
