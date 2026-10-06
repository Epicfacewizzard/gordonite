import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../server/config.js';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { uuid } from '../shared/ids.js';

// Separate, persistent sample data. Never uses the normal server or vault database.
const config = loadConfig({ DATA_DIR: path.resolve('data/local-preview'), HOST: '127.0.0.1', PORT: '8091', BACKUP_INTERVAL_HOURS: '0' });
fs.mkdirSync(config.dataDir, { recursive: true });
const db = openDb(config.dbFile);
const { server, store } = createApp({ config, db });
const marker = path.join(config.dataDir, '.samples-created');
if (!fs.existsSync(marker) && db.prepare('SELECT COUNT(*) AS n FROM notes').get().n === 0) {
  const samples = [
    ['School hub', ['School'], 'Sample notes for exploring the folder browser. These are not imported from your vault.'],
    ['Clinical preparation', ['School/Clinical', 'Projects/Study'], 'Review the practice checklist and write down questions before the next session.'],
    ['Practice evaluation', ['School/Clinical/Evaluations'], 'What went well? What would I practise next time?'],
    ['Fall reading list', ['School/Fall26'], 'A place to keep reading notes and ideas.'],
    ['Home project', ['Projects/Home'], 'Write the first small step, then turn it into a task using the toolbar.'],
    ['Loose idea', [], 'Try adding a tag to organise this sample note.'],
  ];
  for (const [title, tags, text] of samples) {
    store.saveNote(uuid(), { baseRevision: 0, kind: 'note', title, date: '2026-10-05', tags, docFormat: 1,
      doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } });
  }
  fs.writeFileSync(marker, 'Sample notes created.\n');
}
server.listen(config.port, config.host, () => console.log('Local sample preview: http://127.0.0.1:8091/#/notes\nEdits stay in data/local-preview. CasaOS and your vault are untouched.'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
