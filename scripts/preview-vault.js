// Local preview copies only. This is not a full-fidelity Obsidian migration.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../server/config.js';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { normalizeTag } from '../shared/tags.js';
import { markdownToDoc } from '../shared/markdown-import.js';

const FOLDERS = ['00 Inbox', '10 School', '20 CSS'];
export function copyVaultToPreview(vaultRoot, dataDir = path.resolve('data/local-preview'), folders = FOLDERS) {
  if (folders.some((folder) => ![...FOLDERS, '05 People'].includes(folder))) throw new Error('Only the selected preview folders are supported');
  const root = path.resolve(vaultRoot);
  const config = loadConfig({ DATA_DIR: dataDir, BACKUP_INTERVAL_HOURS: '0' });
  fs.mkdirSync(config.dataDir, { recursive: true });
  const db = openDb(config.dbFile);
  const { store } = createApp({ config, db });
  const result = { copied: 0, skipped: 0, failed: [] };
  const originals = path.join(config.dataDir, 'vault-originals');
  const walk = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || /^(agents|claude)\.md$/i.test(entry.name) || entry.isSymbolicLink()) continue;
      const fullPath = path.join(folder, entry.name);
      if (entry.isDirectory()) { walk(fullPath); continue; }
      if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue;
      const relative = path.relative(root, fullPath);
      // A stable note ID makes rerunning safe, including after editing or trashing a preview copy.
      const hex = createHash('sha256').update(`gordonite-preview:${relative.replaceAll('\\', '/')}`).digest('hex').slice(0, 32);
      const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
      if (db.prepare('SELECT id FROM notes WHERE id = ?').get(id)) { result.skipped++; continue; }
      try {
        const raw = fs.readFileSync(fullPath);
        const tag = normalizeTag(path.dirname(relative).split(path.sep).join('/'));
        if (!tag) throw new Error('Folder path is not a supported tag');
        const original = path.join(originals, relative);
        fs.mkdirSync(path.dirname(original), { recursive: true });
        if (!fs.existsSync(original)) fs.writeFileSync(original, raw, { flag: 'wx' });
        // Read the preserved snapshot on retries, never replace edits with fresh vault contents.
        const markdown = fs.readFileSync(original, 'utf8').replace(/^\uFEFF/, '');
        store.saveNote(id, { baseRevision: 0, kind: 'note', title: path.basename(relative, path.extname(relative)),
          date: /^\d{4}-\d{2}-\d{2}/.exec(entry.name)?.[0] || '2026-10-05', tags: [tag], docFormat: 1, doc: markdownToDoc(markdown) });
        result.copied++;
      } catch (e) { result.failed.push({ file: relative, error: e.message }); }
    }
  };
  try { for (const name of folders) walk(path.join(root, name)); } finally { db.close(); }
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/preview-vault.js "path to vault"');
  console.log(JSON.stringify(copyVaultToPreview(process.argv[2], undefined, process.argv.includes('--people') ? ['05 People'] : FOLDERS), null, 2));
}
