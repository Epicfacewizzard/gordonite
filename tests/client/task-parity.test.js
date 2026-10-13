// A change to a task must give the same task whether or not the note's editor is open.
//
// With an editor open the change is a ProseMirror transaction (client/src/editor/task-ops.js); without one it is made
// on the JSON document (shared/tasks.js). Both take their decisions from patchedTaskAttrs. These tests run the same
// change down both paths on generated documents and compare the results, so a rule changed on one side is caught.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@tiptap/pm/state';
import { putTaskPatch, putTaskRemoval } from '../../client/src/editor/task-ops.js';
import { updateTask, removeTask, cleanTaskAttrs, findTask, patchedTaskAttrs } from '../../shared/tasks.js';
import { validateDoc } from '../../shared/doc.js';
import { SyncManager } from '../../client/src/sync.js';
import { createTaskCommands } from '../../client/src/task-commands.js';
import { schema, rng, pick, generate } from './generators.js';
import { doc as textDoc, deferredApi, fakeStore, fakeClock, fakeLifecycle, sequentialIds, settle } from './fakes.js';

const NOW = '2026-10-13T12:00:00.000Z';
// The same document through ProseMirror's own normalisation (adjacent text with the same marks is joined, defaults are
// filled in), then without empty optional attributes: what the editor would save.
const canonical = (json) => cleanTaskAttrs(schema.nodeFromJSON(json).toJSON());

function taskIds(doc) {
  const ids = [];
  (function walk(n) {
    if (n.type === 'taskItem') ids.push(n.attrs.id);
    (n.content ?? []).forEach(walk);
  })(doc);
  return ids;
}

function throughEditor(doc, taskId, patch) {
  const state = EditorState.create({ schema, doc: schema.nodeFromJSON(doc) });
  const tr = state.tr;
  const found = putTaskPatch(tr, schema, taskId, patch, { now: NOW });
  return { found, doc: state.apply(tr).doc.toJSON() };
}

const paragraph = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const PATCHES = [
  { checked: true },
  { checked: false },
  { due: '2026-11-01' },
  { due: null },
  { dueTime: '09:30', due: '2026-11-02' },
  { start: '2026-10-20', startTime: null },
  { hidden: true },
  { hidden: false },
  { hideUntil: '2026-10-25' },
  { priority: 'urgent' },
  { priority: null },
  { dismissedAt: '2026-10-13T11:00:00.000Z' },
  { dismissedAt: null },
  { checked: false, dismissedAt: null, completedAt: null },
  { checked: true, completedAt: '2026-10-01T08:00:00.000Z' },
  { content: [paragraph('renamed task')] },
  { content: [paragraph('two'), paragraph('paragraphs')] },
];

describe('one change, two paths', () => {
  test('every patch gives the same document with or without an editor', () => {
    const r = rng(51);
    let compared = 0;
    for (let i = 0; i < 300; i++) {
      const doc = generate(schema.topNodeType, r);
      for (const id of taskIds(doc)) {
        // two patches in a row, so refusals and clearing run on a task that already has attributes
        const patches = [pick(r, PATCHES), pick(r, PATCHES)];
        let viaJson = doc;
        let viaEditor = doc;
        for (const patch of patches) {
          viaJson = updateTask(viaJson, id, patch, { now: NOW });
          const edited = throughEditor(viaEditor, id, patch);
          assert.equal(edited.found, true);
          viaEditor = edited.doc;
          assert.notEqual(viaJson, null);
        }
        assert.deepEqual(canonical(viaEditor), canonical(viaJson), `patches ${JSON.stringify(patches)} on ${JSON.stringify(doc)}`);
        assert.equal(validateDoc(viaEditor), null);
        compared++;
      }
    }
    assert.ok(compared > 100, `only ${compared} tasks were compared`);
  });

  test('removing a task gives the same document with or without an editor', () => {
    const r = rng(52);
    let compared = 0;
    for (let i = 0; i < 300; i++) {
      const doc = generate(schema.topNodeType, r);
      for (const id of taskIds(doc)) {
        const state = EditorState.create({ schema, doc: schema.nodeFromJSON(doc) });
        const tr = state.tr;
        assert.equal(putTaskRemoval(tr, id), true);
        const viaEditor = state.apply(tr).doc.toJSON();
        const viaJson = removeTask(doc, id);
        assert.deepEqual(canonical(viaEditor), canonical(viaJson), `removing ${id} from ${JSON.stringify(doc)}`);
        assert.equal(validateDoc(viaEditor), null, 'the document is still one the editor can hold');
        compared++;
      }
    }
    assert.ok(compared > 100);
  });

  test('a task that is not there is reported the same way by both', () => {
    const doc = { type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { id: 'task-real-001', checked: false }, content: [paragraph('x')] }] }] };
    assert.equal(updateTask(doc, 'task-missing', { checked: true }), null);
    assert.equal(throughEditor(doc, 'task-missing', { checked: true }).found, false);
    assert.equal(removeTask(doc, 'task-missing'), null);
    const state = EditorState.create({ schema, doc: schema.nodeFromJSON(doc) });
    assert.equal(putTaskRemoval(state.tr, 'task-missing'), false);
  });

  test('a dismissed task cannot be completed, on either path, and the task is still reported as there', () => {
    const doc = { type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { id: 'task-dism-001', checked: false, dismissedAt: '2026-10-12T10:00:00.000Z' }, content: [paragraph('x')] }] }] };
    const viaJson = updateTask(doc, 'task-dism-001', { checked: true }, { now: NOW });
    const viaEditor = throughEditor(doc, 'task-dism-001', { checked: true });
    assert.deepEqual(canonical(viaJson), canonical(doc));
    assert.equal(viaEditor.found, true);
    assert.deepEqual(canonical(viaEditor.doc), canonical(doc));
    // un-dismissing and completing in one go is allowed
    assert.equal(findTask(updateTask(doc, 'task-dism-001', { checked: true, dismissedAt: null }, { now: NOW }), 'task-dism-001').attrs.completedAt, NOW);
  });

  test('the completion time is stamped when the tick really changes, and cleared when it is undone', () => {
    const open = { checked: false, id: 'task-time-001' };
    assert.equal(patchedTaskAttrs(open, { checked: true }, NOW).completedAt, NOW);
    assert.equal(patchedTaskAttrs({ ...open, checked: true, completedAt: NOW }, { checked: true }, '2026-10-14T00:00:00.000Z').completedAt, NOW, 'ticking a ticked task keeps its time');
    assert.equal('completedAt' in patchedTaskAttrs({ ...open, checked: true, completedAt: NOW }, { checked: false }, NOW), false);
    assert.equal(patchedTaskAttrs(open, { due: '2026-11-01' }, NOW).completedAt, undefined, 'other changes stamp nothing');
    assert.equal(patchedTaskAttrs(open, { checked: true, completedAt: '2026-10-01T00:00:00.000Z' }, NOW).completedAt, '2026-10-01T00:00:00.000Z', 'a patch can set its own');
  });
});

describe('the open editor is attached to its note explicitly', () => {
  const env = () => {
    const sync = new SyncManager({ api: deferredApi(), store: fakeStore(), timers: fakeClock().timers, newId: sequentialIds('op'), lifecycle: fakeLifecycle() });
    return { sync, session: sync.draft('journal', '2026-10-13') };
  };
  const adapter = (name, log) => ({
    provider: () => textDoc(name),
    updateTask: (taskId, patch) => (log.push([name, 'update', taskId, patch]), true),
    removeTask: (taskId) => (log.push([name, 'remove', taskId]), true),
  });

  test('task changes go to the open editor and, once it lets go, to the note itself', () => {
    const { session } = env();
    const log = [];
    const release = session.attachEditor(adapter('A', log));
    assert.equal(session.applyTaskPatch('task-1', { checked: true }), true);
    assert.equal(session.removeTask('task-1'), true);
    assert.deepEqual(log.map((e) => e.slice(0, 3)), [['A', 'update', 'task-1'], ['A', 'remove', 'task-1']]);
    release();
    assert.equal(session.provider, null);
    assert.equal(session.applyTaskPatch('task-1', { checked: true }), false, 'no editor, and no such task in the note: reported as gone');
    assert.equal(log.length, 2, 'the released editor is not asked again');
  });

  test('an editor torn down late cannot disconnect the one that replaced it', () => {
    const { session } = env();
    const log = [];
    const releaseOld = session.attachEditor(adapter('old', log));
    const releaseNew = session.attachEditor(adapter('new', log));
    releaseOld(); // the old editor's cleanup runs after the new one attached
    assert.ok(session.provider, 'the new editor is still attached');
    session.applyTaskPatch('task-1', { checked: true });
    assert.equal(log.at(-1)[0], 'new');
    releaseNew();
    assert.equal(session.provider, null);
  });

  test('letting go captures what the editor held, so nothing typed last is lost', async () => {
    const { session, sync } = env();
    let current = textDoc('');
    const release = session.attachEditor({ provider: () => current, updateTask: () => true, removeTask: () => true });
    current = textDoc('typed just before the screen closed');
    session.touch();
    release();
    await settle();
    assert.equal(session.pending.doc.content[0].content[0].text, 'typed just before the screen closed');
    assert.ok(sync.get(session.id));
  });
});

describe('task commands', () => {
  const task = (id, text, attrs = {}) => ({ type: 'taskItem', attrs: { id, checked: false, ...attrs }, content: [paragraph(text)] });
  const noteWith = (id, ...tasks) => ({ id, date: '2026-10-13', kind: 'daily', revision: 3, tags: [{ id: 't1', path: 'journal' }], doc: { type: 'doc', content: [{ type: 'taskList', content: tasks }] } });

  function setup(notes = {}) {
    const clock = fakeClock();
    const requests = [];
    const api = {
      ...deferredApi(),
      getNote: async (id) => {
        requests.push(id);
        if (!notes[id]) throw Object.assign(new Error('Cannot reach the server'), { name: 'NetworkError' });
        return { note: structuredClone(notes[id]) };
      },
    };
    const sync = new SyncManager({ api, store: fakeStore(), timers: clock.timers, now: clock.now, newId: sequentialIds('op'), lifecycle: fakeLifecycle() });
    return { sync, api, requests, clock, commands: createTaskCommands({ api, sync }) };
  }

  test('a task in a note this device has not loaded: the note is fetched, changed and queued for saving', async () => {
    const { sync, commands, requests } = setup({ 'note-aaaa-0001': noteWith('note-aaaa-0001', task('task-a-0001', 'call'), task('task-a-0002', 'write')) });
    const changed = await commands.update('note-aaaa-0001', 'task-a-0001', { checked: true });
    assert.equal(changed, true);
    assert.deepEqual(requests, ['note-aaaa-0001']);
    const session = sync.get('note-aaaa-0001');
    assert.equal(session.status, 'pending', 'held on the device and on its way');
    assert.equal(findTask(session.currentDoc(), 'task-a-0001').attrs.checked, true);
    assert.equal(findTask(session.currentDoc(), 'task-a-0002').attrs.checked, false);
    assert.equal(session.pending.doc.content[0].content.length, 2, 'the rest of the note is untouched');
    assert.equal(sync.summary().status, 'pending');
  });

  test('a task that is not in the note comes back false, and nothing is queued', async () => {
    const { sync, commands } = setup({ 'note-aaaa-0002': noteWith('note-aaaa-0002', task('task-b-0001', 'x')) });
    assert.equal(await commands.update('note-aaaa-0002', 'task-gone', { checked: true }), false);
    assert.equal(sync.get('note-aaaa-0002').pending, null);
    assert.equal(await commands.remove('note-aaaa-0002', 'task-gone'), false);
  });

  test('a note that cannot be fetched rejects, and the status does not stay busy', async () => {
    const { sync, commands } = setup();
    await assert.rejects(commands.update('note-aaaa-0003', 'task-c-0001', { checked: true }));
    assert.equal(sync.summary().status, 'saved', 'nothing is waiting');
  });

  test('unsent edits to the note are kept, and the change is made on top of them', async () => {
    const { sync, commands } = setup({ 'note-aaaa-0004': noteWith('note-aaaa-0004', task('task-d-0001', 'one')) });
    await commands.update('note-aaaa-0004', 'task-d-0001', { due: '2026-11-05' });
    const session = sync.get('note-aaaa-0004');
    // the server's copy changes meanwhile, but this device has unsent work, which wins until it is resolved
    await commands.update('note-aaaa-0004', 'task-d-0001', { priority: 'urgent' });
    const attrs = findTask(session.currentDoc(), 'task-d-0001').attrs;
    assert.equal(attrs.due, '2026-11-05');
    assert.equal(attrs.priority, 'urgent');
  });

  test('with the note’s editor open the change goes through the editor', async () => {
    const { sync, commands } = setup({ 'note-aaaa-0005': noteWith('note-aaaa-0005', task('task-e-0001', 'one')) });
    const session = sync.adopt(noteWith('note-aaaa-0005', task('task-e-0001', 'one')));
    const calls = [];
    session.attachEditor({
      provider: () => session.currentDoc(),
      updateTask: (id, patch) => (calls.push(['update', id, patch]), true),
      removeTask: (id) => (calls.push(['remove', id]), true),
    });
    assert.equal(await commands.update('note-aaaa-0005', 'task-e-0001', { checked: true }), true);
    assert.equal(await commands.remove('note-aaaa-0005', 'task-e-0001'), true);
    assert.deepEqual(calls, [['update', 'task-e-0001', { checked: true }], ['remove', 'task-e-0001']]);
    assert.equal(session.pending, null, 'the editor, not the JSON path, made the change');
  });

  test('editing a task’s words: its own paragraphs come back, nested tasks stay out, and writing keeps them', async () => {
    const nestedNote = noteWith('note-aaaa-0006', {
      ...task('task-f-0001', 'parent words'),
      content: [paragraph('parent words'), { type: 'taskList', content: [task('task-f-0002', 'child words')] }],
    });
    const { sync, commands } = setup({ 'note-aaaa-0006': nestedNote });
    const handle = await commands.text('note-aaaa-0006', 'task-f-0001');
    assert.deepEqual(handle.content, [paragraph('parent words')]);
    assert.equal(handle.write([paragraph('new parent words')]), true);
    const item = findTask(sync.get('note-aaaa-0006').currentDoc(), 'task-f-0001');
    assert.equal(item.content[0].content[0].text, 'new parent words');
    assert.equal(item.content[1].type, 'taskList', 'the nested task is still there');
    assert.equal(await commands.text('note-aaaa-0006', 'task-gone'), null);
  });
});
