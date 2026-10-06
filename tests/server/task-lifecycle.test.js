import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, save, para, docOf, task } from './helpers.js';
import { uuid } from '../../shared/ids.js';
import { removeTask, updateTask, extractTasks } from '../../shared/tasks.js';
import { validateDoc } from '../../shared/doc.js';
test('deletion removes empty lists, dismissal preserves content and restores; stale deletion cannot overwrite', async () => {
  const app = await startServer();
  try {
    const id = uuid(), taskId = uuid();
    const original = docOf(para('Long note content '.repeat(30)), { type: 'taskList', content: [task('Accidental', false, taskId)] });
    await save(app, id, original);
    const dismissed = updateTask(original, taskId, { dismissedAt: '2026-10-05T20:00:00.000Z' });
    assert.equal(validateDoc(dismissed), null);
    await save(app, id, dismissed, { base: 1 });
    assert.equal(extractTasks(dismissed, '2026-10-05')[0].checked, false);
    assert.deepEqual(updateTask(dismissed, taskId, { dismissedAt: null }), original);
    const removed = removeTask(dismissed, taskId);
    assert.equal(validateDoc(removed), null);
    const stale = await save(app, id, removed, { base: 1 });
    assert.equal(stale.status, 409);
    assert.ok((await app.api('GET', `/api/notes/${id}`)).json.note.doc.content[1].content[0].attrs.dismissedAt);
    await save(app, id, removed, { base: 2 });
    const version = app.db.prepare("SELECT id, doc FROM note_versions WHERE note_id = ? AND kind = 'guard' ORDER BY rowid DESC").get(id);
    assert.deepEqual(JSON.parse(version.doc), dismissed);
    const restored = app.store.restoreVersion(id, version.id);
    assert.deepEqual(restored.doc, dismissed);
    const copy = await startServer();
    try {
      const exported = (await app.api('GET', '/api/export/json')).json;
      const imported = await copy.api('POST', '/api/import?mode=replace', exported);
      assert.equal(imported.status, 200);
      assert.deepEqual((await copy.api('GET', `/api/notes/${id}`)).json.note.doc, dismissed);
    } finally { await copy.close(); }
    assert.deepEqual(removeTask(docOf({ type: 'taskList', content: [task('Only task', false, taskId)] }), taskId), { type: 'doc', content: [{ type: 'paragraph' }] });
    assert.equal(removeTask(original, uuid()), null);
  } finally { await app.close(); }
});
