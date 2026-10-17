// The note save protocol, one situation per test, with the network, the device storage and the clock all faked.
// What these pin down (see client/src/sync.js and docs/ARCHITECTURE.md):
//   - text is kept on the device until the server confirms that exact text;
//   - a confirmation never clears text typed after the request was sent;
//   - a request whose answer was lost is named in the next one, so the server can tell a repeat from a new edit;
//   - a failure is visible (status, error) and retried with back-off, and never discards anything;
//   - a conflict stops sending and keeps both versions until the person chooses.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SyncManager } from '../../client/src/sync.js';
import { DOC_FORMAT } from '../../shared/doc.js';
import { doc, apiError, networkError, fakeClock, deferredApi, fakeStore, fakeLifecycle, settle, sequentialIds } from './fakes.js';

async function setup() {
  const clock = fakeClock();
  const api = deferredApi();
  const store = fakeStore();
  const lifecycle = fakeLifecycle();
  const makeManager = (overrides = {}) =>
    new SyncManager({ api, store, timers: clock.timers, now: clock.now, newId: sequentialIds('op'), lifecycle, ...overrides });
  const sync = makeManager();
  await sync.init(); // loads nothing (empty device storage) and installs the page-lifecycle handlers
  return { clock, api, store, lifecycle, makeManager, sync };
}

// The editor: a function the session asks for the current text.
function typeInto(session, current) {
  session.attach(() => current.doc);
  return {
    set(next) {
      current.doc = next;
      session.touch();
    },
  };
}

// A new note, with `text` typed, captured and on its way (the request is open).
async function noteWithOpenRequest(env, text = 'first') {
  const session = env.sync.draft('journal', '2026-10-05');
  const current = { doc: doc('') };
  const editor = typeInto(session, current);
  editor.set(doc(text));
  await env.clock.advance(300); // capture
  await env.clock.advance(500); // flush
  assert.equal(env.api.calls.length, 1, 'one request is open');
  return { session, current, editor };
}

describe('saving', () => {
  test('typing is captured to the device first, then sent once, then the device copy is cleared', async () => {
    const env = await setup();
    const session = env.sync.draft('journal', '2026-10-05');
    const current = { doc: doc('') };
    const editor = typeInto(session, current);

    editor.set(doc('hello'));
    assert.equal(session.status, 'pending');
    await env.clock.advance(300);
    assert.equal(env.store.records.get(session.id).doc.content[0].content[0].text, 'hello', 'held on the device before any request');
    assert.equal(env.api.calls.length, 0, 'nothing is sent until the flush delay');

    await env.clock.advance(500);
    assert.equal(env.api.calls.length, 1);
    const sent = env.api.calls[0];
    assert.equal(sent.id, session.id);
    assert.equal(sent.body.baseRevision, 0);
    assert.equal(sent.body.docFormat, DOC_FORMAT);
    assert.deepEqual(sent.body.afterOps, []);
    assert.equal(session.status, 'saving');

    sent.resolve({ revision: 1 });
    await settle();
    assert.equal(session.status, 'saved');
    assert.equal(session.revision, 1);
    assert.equal(env.store.records.size, 0, 'confirmed: the device copy is gone');
  });

  test('text typed while a request is open is kept, sent next, and never cleared by the first confirmation', async () => {
    const env = await setup();
    const { session, editor } = await noteWithOpenRequest(env, 'one');

    editor.set(doc('one two'));
    await env.clock.advance(300); // captured while request 1 is still open
    assert.equal(env.api.calls.length, 1, 'only one request at a time');

    env.api.calls[0].resolve({ revision: 1 }); // the server confirms "one"
    await settle();
    assert.equal(session.revision, 1);
    assert.equal(session.status, 'pending', 'there is newer text that has not been confirmed');
    assert.equal(session.pending.doc.content[0].content[0].text, 'one two');
    const held = env.store.records.get(session.id);
    assert.equal(held.doc.content[0].content[0].text, 'one two', 'the newer text is still held on the device');
    assert.equal(held.baseRevision, 1, 'and it is based on the revision just confirmed');

    await env.clock.advance(100); // the follow-up flush
    assert.equal(env.api.calls.length, 2);
    assert.equal(env.api.calls[1].body.baseRevision, 1);
    assert.equal(env.api.calls[1].body.doc.content[0].content[0].text, 'one two');
    env.api.calls[1].resolve({ revision: 2 });
    await settle();
    assert.equal(session.status, 'saved');
    assert.equal(env.store.records.size, 0);
  });

  test('a server error is visible, keeps the text, and is retried with back-off naming the earlier attempt', async () => {
    const env = await setup();
    const { session } = await noteWithOpenRequest(env);
    const firstOp = env.api.calls[0].body.opId;

    env.api.calls[0].reject(apiError(503, 'http_503', 'Server error 503'));
    await settle();
    assert.equal(session.status, 'failed');
    assert.equal(session.error.kind, 'server');
    assert.deepEqual(session.unknownOps, [firstOp]);
    assert.equal(env.store.records.size, 1, 'kept on the device');

    await env.clock.advance(1999);
    assert.equal(env.api.calls.length, 1, 'not before the back-off');
    await env.clock.advance(1);
    assert.equal(env.api.calls.length, 2);
    assert.deepEqual(env.api.calls[1].body.afterOps, [firstOp], 'the repeat names the attempt whose answer was never seen');
    assert.equal(env.api.calls[1].body.baseRevision, 0);

    env.api.calls[1].reject(apiError(503, 'http_503'));
    await settle();
    await env.clock.advance(3999);
    assert.equal(env.api.calls.length, 2, 'the second wait is longer');
    await env.clock.advance(1);
    assert.equal(env.api.calls.length, 3);

    env.api.calls[2].resolve({ revision: 1 });
    await settle();
    assert.equal(session.status, 'saved');
    assert.deepEqual(session.unknownOps, []);
    assert.equal(session.error, null);
    assert.equal(env.store.records.size, 0);
  });

  test('a lost reply (network error) is shown as offline and the repeat carries its id', async () => {
    const env = await setup();
    const { session } = await noteWithOpenRequest(env);
    const lostOp = env.api.calls[0].body.opId;

    env.api.calls[0].reject(networkError());
    await settle();
    assert.equal(session.status, 'offline');
    assert.deepEqual(session.unknownOps, [lostOp]);

    env.lifecycle.handlers.retryAll(); // the browser's "online" event
    await settle();
    assert.equal(env.api.calls.length, 2, 'retried at once, without waiting for the back-off');
    assert.deepEqual(env.api.calls[1].body.afterOps, [lostOp]);
  });

  test('an expired login keeps the text and sends it after logging in', async () => {
    const env = await setup();
    const { session } = await noteWithOpenRequest(env);
    env.api.calls[0].reject(apiError(401, 'login_required', 'Log in to continue'));
    await settle();
    assert.equal(session.status, 'failed');
    assert.match(session.error.message, /Log in/);
    assert.equal(env.store.records.size, 1);

    env.lifecycle.handlers.retryAll(); // back from the login page
    await settle();
    env.api.calls[1].resolve({ revision: 1 });
    await settle();
    assert.equal(session.status, 'saved');
    assert.equal(env.store.records.size, 0);
  });

  test('a document the server refuses stays on the device and is visible as failed', async () => {
    const env = await setup();
    const { session, editor } = await noteWithOpenRequest(env);
    env.api.calls[0].reject(apiError(400, 'bad_doc', 'unsupported node type "table"'));
    await settle();
    assert.equal(session.status, 'failed');
    assert.match(session.error.message, /unsupported node/);
    assert.equal(env.store.records.size, 1);

    // changing the text produces a new attempt (after the back-off) that can succeed
    editor.set(doc('fixed'));
    await env.clock.advance(300);
    env.lifecycle.handlers.retryAll();
    await settle();
    env.api.calls.at(-1).resolve({ revision: 1 });
    await settle();
    assert.equal(session.status, 'saved');
  });

  test('when the device cannot store the text that is reported, and the text is still sent', async () => {
    const env = await setup();
    env.store.failWrites = true;
    const session = env.sync.draft('journal', '2026-10-05');
    const editor = typeInto(session, { doc: doc('') });
    editor.set(doc('only in memory'));
    await env.clock.advance(300);
    assert.ok(session.localError, 'the failed write is recorded on the session');
    assert.equal(env.sync.summary().localError, true, 'and shown by the global indicator');
    assert.equal(env.store.records.size, 0);

    await env.clock.advance(500);
    assert.equal(env.api.calls.length, 1, 'the server is still tried');
    env.api.calls[0].resolve({ revision: 1 });
    await settle();
    assert.equal(session.status, 'saved');

    // storage comes back: the next edit is held again and the report clears
    env.store.failWrites = false;
    const again = typeInto(session, { doc: doc('') });
    again.set(doc('now stored'));
    await env.clock.advance(300);
    assert.equal(session.localError, null);
    assert.equal(env.sync.summary().localError, false);
    assert.equal(env.store.records.size, 1);
  });

  test('unsent text is back after a reload and is sent against the revision it was based on', async () => {
    const env = await setup();
    const session = env.sync.draft('journal', '2026-10-05');
    const editor = typeInto(session, { doc: doc('') });
    editor.set(doc('written offline'));
    await env.clock.advance(300);
    await env.clock.advance(500);
    const lost = env.api.calls[0].body.opId;
    env.api.calls[0].reject(networkError());
    await settle();
    assert.equal(env.store.records.size, 1);

    // the page is closed; a new one opens over the same device storage
    const reopened = new SyncManager({ api: env.api, store: env.store, timers: env.clock.timers, now: env.clock.now, newId: sequentialIds('op2'), lifecycle: env.lifecycle });
    await reopened.init();
    const back = reopened.get(session.id);
    assert.ok(back, 'the session is rebuilt from the device copy');
    assert.equal(back.pending.doc.content[0].content[0].text, 'written offline');
    assert.equal(back.status, 'saving', 'and it is sent straight away');
    const call = env.api.calls.at(-1);
    assert.equal(call.body.baseRevision, 0);
    assert.deepEqual(call.body.afterOps, [lost], 'the request whose answer was lost travels with it');
    call.resolve({ revision: 1 });
    await settle();
    assert.equal(back.status, 'saved');
    assert.equal(env.store.records.size, 0);
  });

  test('closing or hiding the page keeps a copy of what was typed without waiting for the debounce', async () => {
    const env = await setup();
    const session = env.sync.draft('journal', '2026-10-05');
    const editor = typeInto(session, { doc: doc('') });
    editor.set(doc('about to leave'));
    assert.equal(env.store.records.size, 0, 'not captured yet');
    env.lifecycle.handlers.persistAll(); // visibilitychange to hidden / pagehide
    await settle();
    assert.equal(env.store.records.get(session.id).doc.content[0].content[0].text, 'about to leave');
    assert.equal(env.api.calls.length, 0, 'persisting does not need the network');
  });

  test('detaching the editor captures what it holds before letting go of it', async () => {
    const env = await setup();
    const session = env.sync.draft('journal', '2026-10-05');
    const editor = typeInto(session, { doc: doc('') });
    editor.set(doc('typed then navigated away'));
    session.detach(); // the editor is unmounting, before the capture timer fired
    await settle();
    assert.equal(session.provider, null);
    assert.equal(env.store.records.get(session.id).doc.content[0].content[0].text, 'typed then navigated away');
    await env.clock.advance(500);
    assert.equal(env.api.calls.length, 1, 'and it still gets sent, with no editor open');
  });

  test('an empty new note is never created on the server', async () => {
    const env = await setup();
    const session = env.sync.draft('journal', '2026-10-05');
    const editor = typeInto(session, { doc: doc('') });
    editor.set({ type: 'doc', content: [{ type: 'paragraph' }] });
    await env.clock.advance(5000);
    assert.equal(env.api.calls.length, 0);
    assert.equal(env.store.records.size, 0);
    assert.equal(session.status, 'saved');
  });
});

describe('conflicts', () => {
  const serverNote = (revision, text) => ({ id: 'n', revision, doc: doc(text), title: null, tags: [{ path: 'journal' }] });
  const conflictError = (note) => apiError(409, 'revision_conflict', 'changed elsewhere', { status: 'conflict', reason: 'revision', note });

  async function conflicted(text = 'mine') {
    const env = await setup();
    const opened = await noteWithOpenRequest(env, text);
    env.api.calls[0].reject(conflictError(serverNote(5, 'theirs')));
    await settle();
    return { env, ...opened };
  }

  test('a conflict stops sending and keeps both versions', async () => {
    const { env, session } = await conflicted();
    assert.equal(session.status, 'conflict');
    assert.equal(session.conflict.reason, 'revision');
    assert.equal(session.conflict.note.revision, 5);
    assert.equal(session.pending.doc.content[0].content[0].text, 'mine', 'this device’s text is still here');
    assert.equal(env.store.records.size, 1);

    await env.clock.advance(60_000);
    assert.equal(env.api.calls.length, 1, 'nothing more is sent until the person chooses');
    env.lifecycle.handlers.retryAll();
    await settle();
    assert.equal(env.api.calls.length, 1, 'not even when the network comes back');
  });

  test('keeping this device’s text sends it on top of the other revision and asks the server to keep the old one', async () => {
    const { env, session } = await conflicted();
    await session.resolveKeepMine();
    await env.clock.advance(1);
    await settle();
    assert.equal(session.conflict, null);
    assert.equal(env.api.calls.length, 2);
    const call = env.api.calls[1];
    assert.equal(call.body.baseRevision, 5);
    assert.equal(call.body.keepPrevious, true);
    assert.equal(call.body.doc.content[0].content[0].text, 'mine');
    call.resolve({ revision: 6 });
    await settle();
    assert.equal(session.status, 'saved');
    assert.equal(session.keepPrevious, false);
  });

  test('taking the other version replaces this device’s text and clears the device copy', async () => {
    const { env, session } = await conflicted();
    const before = session.generation;
    session.resolveUseServer();
    await settle();
    assert.equal(session.conflict, null);
    assert.equal(session.status, 'saved');
    assert.equal(session.revision, 5);
    assert.equal(session.currentDoc().content[0].content[0].text, 'theirs');
    assert.equal(session.generation, before + 1, 'the editor is told to show the new text');
    assert.equal(env.store.records.size, 0);
    assert.equal(env.api.calls.length, 1);
  });

  test('combining puts both versions in one note and sends it against the other revision', async () => {
    const { env, session } = await conflicted();
    const result = await session.resolveCombine();
    assert.equal(result, session);
    await env.clock.advance(100);
    assert.equal(env.api.calls.length, 2);
    const sent = env.api.calls[1].body;
    assert.equal(sent.baseRevision, 5);
    const texts = sent.doc.content.map((block) => block.content?.map((x) => x.text).join(''));
    assert.deepEqual(texts, ['theirs', 'Merged from the other version of this note:', 'mine']);
  });
});

describe('links after a rename (docs/LINKS.md)', () => {
  test('notes the server relinked are refreshed on this phone unless they hold unsent text', async () => {
    const env = await setup();
    const note = (id, text, revision = 3) => ({ id, tags: [{ path: 'journal' }], date: '2026-10-05', revision, doc: doc(text), kind: 'note', title: null });
    const renamed = env.sync.adopt({ ...note('a', 'trip'), title: 'Trip ideas' });
    const linking = env.sync.adopt(note('b', 'see [[Trip ideas]]'));
    const busy = env.sync.adopt(note('c', 'also [[Trip ideas]]'));
    const fetched = [];
    env.api.getNote = async (id) => (fetched.push(id), { note: note(id, `see [[Trip plan]] ${id}`, 4) });
    const typing = typeInto(busy, { doc: doc('also [[Trip ideas]]') });
    typing.set(doc('also [[Trip ideas]] and more'));
    const generation = linking.generation;

    renamed.editTitle('Trip plan');
    await env.clock.advance(1000);
    const save = env.api.calls.find((c) => c.id === 'a');
    save.resolve({ status: 'ok', revision: 4, relinked: ['b', 'c'] });
    await settle();

    assert.deepEqual(fetched, ['b'], 'the note with unsent text is left to meet a visible conflict');
    assert.equal(linking.revision, 4);
    assert.equal(linking.serverDoc.content[0].content[0].text, 'see [[Trip plan]] b');
    assert.ok(linking.generation > generation, 'an open editor is remounted with the new text');
    assert.equal(busy.revision, 3);
  });
});
