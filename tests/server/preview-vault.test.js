import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyVaultToPreview } from '../../scripts/preview-vault.js';
import { openDb } from '../../server/db.js';
test('preview vault copies preserve original bytes and never overwrite edited or trashed notes on rerun', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gordonite-vault-preview-'));
  const vault = path.join(tmp, 'vault');
  const data = path.join(tmp, 'data');
  const raw = '\uFEFF---\r\nstatus: active\r\n---\r\n# Sample\r\n- [ ] Try this\r\n[[A link]]\r\n';
  try {
    for (const folder of ['00 Inbox', '10 School', '20 CSS']) fs.mkdirSync(path.join(vault, folder), { recursive: true });
    fs.writeFileSync(path.join(vault, '10 School', 'Sample.md'), raw);
    fs.writeFileSync(path.join(vault, '10 School', 'AGENTS.md'), 'old instructions');
    assert.deepEqual(copyVaultToPreview(vault, data), { copied: 1, skipped: 0, failed: [] });
    assert.equal(fs.readFileSync(path.join(data, 'vault-originals', '10 School', 'Sample.md'), 'utf8'), raw);
    assert.equal(fs.readFileSync(path.join(vault, '10 School', 'Sample.md'), 'utf8'), raw);
    const db = openDb(path.join(data, 'hq.sqlite'));
    try {
      assert.equal(db.prepare('SELECT path FROM tags').get().path, '10-school');
      db.prepare('UPDATE notes SET title = ?, deleted_at = ?').run('User changed this', new Date().toISOString());
    } finally { db.close(); }
    fs.writeFileSync(path.join(vault, '10 School', 'Sample.md'), 'A later vault version');
    assert.deepEqual(copyVaultToPreview(vault, data), { copied: 0, skipped: 1, failed: [] });
    const reopened = openDb(path.join(data, 'hq.sqlite'));
    try { assert.equal(reopened.prepare('SELECT title FROM notes').get().title, 'User changed this'); } finally { reopened.close(); }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
