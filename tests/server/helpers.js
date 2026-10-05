import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../server/config.js';
import { openDb } from '../../server/db.js';
import { createApp } from '../../server/app.js';
import { uuid } from '../../shared/ids.js';

export function para(text, marks) {
  return { type: 'paragraph', content: text ? [{ type: 'text', text, ...(marks ? { marks } : {}) }] : undefined };
}
export const docOf = (...blocks) => ({ type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] });
export const task = (text, checked = false, id = uuid()) => ({
  type: 'taskItem',
  attrs: { checked, id },
  content: [para(text)],
});

export async function startServer(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-test-'));
  const config = loadConfig({ DATA_DIR: dir, BACKUP_INTERVAL_HOURS: '0', STATIC_DIR: path.join(dir, 'no-client'), ...env });
  const db = openDb(config.dbFile);
  const silent = { log() {}, error() {} };
  const { server, store } = createApp({ config, db, log: silent });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;

  async function api(method, p, body) {
    const res = await fetch(url + p, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* binary or empty */
    }
    return { status: res.status, json, text, headers: res.headers };
  }

  return {
    url,
    dir,
    config,
    db,
    store,
    api,
    // Stop the app but keep its data directory (like stopping the container).
    async stop() {
      await new Promise((r) => server.close(r));
      db.close();
    },
    async close() {
      await this.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// Save helper: create/update with sensible defaults.
export function save(t, id, doc, { base = 0, tags = ['daily-jots'], date = '2026-10-05', opId, afterOps } = {}) {
  return t.api('PUT', `/api/notes/${id}`, { baseRevision: base, doc, docFormat: 1, tags, date, opId, afterOps });
}
