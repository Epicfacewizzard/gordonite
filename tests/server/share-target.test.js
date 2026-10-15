import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let app;
before(async () => (app = await startServer()));
after(async () => app.close());

test('a share that reaches the server (no service worker yet) is sent to the share page, and nothing is stored', async () => {
  const form = new FormData();
  form.set('title', 'shared');
  form.set('files', new Blob(['hello']), 'a.txt');
  const res = await fetch(`${app.url}/share-target`, { method: 'POST', body: form, redirect: 'manual' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/#/share');
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM notes').get().n, 0);
});

test('other non-GET requests to pages are still refused', async () => {
  const res = await fetch(`${app.url}/share-target-not`, { method: 'POST', body: 'x' });
  assert.equal(res.status, 405);
});
