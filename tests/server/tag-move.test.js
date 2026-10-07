import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, save, para, docOf } from './helpers.js';
import { uuid } from '../../shared/ids.js';
import { tagFolders, planMove } from '../../client/src/tag-folders.js';

const paths = async (t) => (await t.api('GET', '/api/tags')).json.tags.map((x) => x.path);

test('moving a tag nests it with its children, keeps notes and ids, and can be moved back out', async () => {
  const t = await startServer();
  try {
    const id = uuid();
    await save(t, id, docOf(para('hello')), { tags: ['school/clinical/eval', 'projects'], kind: 'note' });
    await t.api('POST', '/api/tags', { path: 'inbox' });
    const before = (await t.api('GET', '/api/tags')).json.tags.find((x) => x.path === 'school/clinical/eval');

    let r = await t.api('POST', '/api/tags/move', { from: 'school/clinical', into: 'projects', order: ['clinical'] });
    assert.equal(r.status, 200);
    assert.equal(r.json.path, 'projects/clinical');
    assert.deepEqual((await paths(t)).sort(), ['inbox', 'projects', 'projects/clinical/eval']);
    const after = (await t.api('GET', '/api/tags')).json.tags.find((x) => x.path === 'projects/clinical/eval');
    assert.equal(after.id, before.id, 'the tag keeps its id');
    assert.equal(after.noteCount, 1, 'the note stays attached');
    assert.equal((await t.api('GET', `/api/notes/${id}`)).json.note.tags.some((x) => x.path === 'projects/clinical/eval'), true);

    r = await t.api('POST', '/api/tags/move', { from: 'projects/clinical', into: '', order: ['inbox', 'clinical', 'projects'] });
    assert.equal(r.status, 200);
    assert.deepEqual((await paths(t)).sort(), ['clinical/eval', 'inbox', 'projects']);
    assert.deepEqual((await t.api('GET', '/api/tags')).json.order[''], ['inbox', 'clinical', 'projects']);
  } finally {
    await t.close();
  }
});

test('moves that would clobber a tag, loop, or go too deep are refused and change nothing', async () => {
  const t = await startServer();
  try {
    for (const p of ['a/x', 'b/x', 'a/y/z', 'l1/l2/l3/l4/l5/l6']) await t.api('POST', '/api/tags', { path: p });
    const snapshot = JSON.stringify(await paths(t));
    let r = await t.api('POST', '/api/tags/move', { from: 'a/x', into: 'b' });
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, 'tag_exists');
    r = await t.api('POST', '/api/tags/move', { from: 'a', into: 'a/y' });
    assert.equal(r.status, 400);
    r = await t.api('POST', '/api/tags/move', { from: 'a', into: 'a' });
    assert.equal(r.status, 400);
    r = await t.api('POST', '/api/tags/move', { from: 'b', into: 'l1/l2/l3/l4/l5/l6' });
    assert.equal(r.status, 400);
    r = await t.api('POST', '/api/tags/move', { from: 'nope', into: 'a' });
    assert.equal(r.status, 404);
    r = await t.api('POST', '/api/tags/move', { from: 'a/x', into: '', order: ['not-me'] });
    assert.equal(r.status, 400);
    assert.equal(JSON.stringify(await paths(t)), snapshot);
  } finally {
    await t.close();
  }
});

test('the Today tag follows a move, and manual order travels with an export', async () => {
  const t = await startServer();
  try {
    await t.api('POST', '/api/tags', { path: 'journal/daily' });
    await t.api('POST', '/api/tags', { path: 'archive' });
    await t.api('PUT', '/api/settings', { dailyTag: 'journal/daily' });
    const r = await t.api('POST', '/api/tags/move', { from: 'journal', into: 'archive', order: ['journal'] });
    assert.equal(r.status, 200);
    assert.equal(t.store.getSettings().dailyTag, 'archive/journal/daily');
    const out = (await t.api('GET', '/api/export/json')).json;
    assert.deepEqual(out.settings.tagOrder.archive, ['journal']);
    const other = await startServer();
    try {
      assert.equal((await other.api('POST', '/api/import?mode=replace', out)).status, 200);
      assert.deepEqual((await other.api('GET', '/api/tags')).json.order.archive, ['journal']);
    } finally {
      await other.close();
    }
  } finally {
    await t.close();
  }
});

test('the folder tree honours the saved order and plans nest, reorder and un-nest drops', () => {
  const tags = ['a', 'b/c', 'b/d', 'e'].map((path) => ({ path }));
  const names = (nodes) => nodes.map((n) => n.name);
  assert.deepEqual(names(tagFolders(tags)), ['a', 'b', 'e']);
  assert.deepEqual(names(tagFolders(tags, { '': ['e', 'a'] })), ['e', 'a', 'b']);
  const tree = tagFolders(tags);
  assert.deepEqual(planMove(tree, 'e', 'a', 'into'), { into: 'a', order: ['e'] });
  assert.deepEqual(planMove(tree, 'e', 'a', 'before'), { into: '', order: ['e', 'a', 'b'] });
  assert.deepEqual(planMove(tree, 'a', 'b/c', 'after'), { into: 'b', order: ['c', 'a', 'd'] });
  assert.deepEqual(planMove(tree, 'b/d', '', 'into'), { into: '', order: ['a', 'b', 'e', 'd'] });
  assert.equal(planMove(tree, 'b', 'b/c', 'into'), null, 'cannot drop a tag inside itself');
  assert.equal(planMove(tree, 'b', 'b', 'before'), null);
});
