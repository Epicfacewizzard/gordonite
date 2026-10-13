import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createMoodQueue } from '../../client/src/moods.js';
import { classifyFailure } from '../../client/src/failure.js';
import { apiError, networkError, fakeStorage, sequentialIds } from './fakes.js';

const KEY = 'hq-mood-pending';

// An api whose saveMood answers from a script: each call takes the next outcome (an Error is thrown, anything else
// is the server's acknowledgment). It records what was sent.
function scriptedApi(...outcomes) {
  const sent = [];
  const script = [...outcomes];
  return {
    sent,
    saveMood: async (id, body) => {
      sent.push({ id, ...body });
      const next = script.length ? script.shift() : 'ok';
      if (next instanceof Error) throw next;
      return { mood: { id }, created: true };
    },
  };
}

const queueOver = (api, storage = fakeStorage()) => createMoodQueue({ api, storage, newId: sequentialIds('mood') });
const stored = (storage) => JSON.parse(storage.getItem(KEY) ?? '[]');

describe('error classification', () => {
  test('only input the server names as bad is rejected; everything else keeps the data', () => {
    const kind = (err) => classifyFailure(err).kind;
    assert.equal(kind(networkError()), 'network');
    assert.equal(kind(apiError(401, 'login_required')), 'login');
    assert.equal(kind(apiError(503, 'http_503')), 'retry');
    assert.equal(kind(apiError(500, 'internal')), 'retry');
    assert.equal(kind(apiError(429, 'too_many_tries')), 'retry');
    assert.equal(kind(apiError(400, 'bad_score')), 'rejected');
    assert.equal(kind(apiError(400, 'bad_doc')), 'rejected');
    assert.equal(kind(apiError(413, 'too_large')), 'rejected');
    // an unknown 4xx says nothing about the data (an old server mid-update, a proxy, a blocked request)
    assert.equal(kind(apiError(404, 'not_found')), 'retry');
    assert.equal(kind(apiError(403, 'cross_site')), 'retry');
    assert.equal(kind(apiError(405, 'method_not_allowed')), 'retry');
    assert.equal(kind(new TypeError('x is not a function')), 'retry');
    assert.equal(kind(apiError(409, 'revision_conflict', 'x', { status: 'conflict', reason: 'revision' })), 'conflict');
    assert.equal(kind(apiError(409, 'client_outdated')), 'retry', 'a 409 that is not a note conflict is not one');
  });
});

describe('mood queue', () => {
  test('a temporary server error keeps the entry, and a later run sends it', async () => {
    const storage = fakeStorage();
    const api = scriptedApi(apiError(503, 'http_503', 'Server error 503'));
    const queue = queueOver(api, storage);
    queue.log(4, 'ok day');

    const first = await queue.flush();
    assert.equal(first.sent, 0, 'a refused request is not a sent entry');
    assert.equal(first.pending, 1);
    assert.equal(first.rejected, 0);
    assert.equal(first.paused, false);
    assert.equal(first.failure.kind, 'retry');
    assert.equal(stored(storage).length, 1, 'still held on the device');

    const second = await queue.flush();
    assert.equal(second.sent, 1);
    assert.equal(second.pending, 0);
    assert.equal(second.failure, null);
    assert.deepEqual(stored(storage), []);
    assert.equal(api.sent.length, 2);
    assert.equal(api.sent[0].id, api.sent[1].id, 'the same id both times, so the server can ignore a repeat');
  });

  test('an entry survives a reload while the server is failing', async () => {
    const storage = fakeStorage();
    const before = queueOver(scriptedApi(apiError(503, 'http_503')), storage);
    before.log(2, null);
    await before.flush();

    const api = scriptedApi();
    const after = queueOver(api, storage); // a fresh page over the same device storage
    assert.equal(after.pending().length, 1);
    const result = await after.flush();
    assert.equal(result.sent, 1);
    assert.equal(api.sent[0].score, 2);
  });

  test('an expired login pauses the queue; nothing is dropped, and it sends once logged in', async () => {
    const storage = fakeStorage();
    const api = scriptedApi(apiError(401, 'login_required', 'Log in to continue'));
    const queue = queueOver(api, storage);
    queue.log(5, null);
    queue.log(1, 'rough');

    const blocked = await queue.flush();
    assert.equal(blocked.paused, true);
    assert.equal(blocked.sent, 0);
    assert.equal(blocked.pending, 2, 'both entries wait');
    assert.equal(api.sent.length, 1, 'the run stops at the first refusal instead of knocking on the door twice');
    assert.equal(stored(storage).length, 2);

    const resumed = await queue.flush(); // after logging in
    assert.equal(resumed.paused, false);
    assert.equal(resumed.sent, 2);
    assert.deepEqual(api.sent.slice(1).map((m) => m.score), [5, 1], 'oldest first');
    assert.deepEqual(stored(storage), []);
  });

  test('being offline keeps everything, in order, and stops at the first failure', async () => {
    const api = scriptedApi(networkError());
    const queue = queueOver(api);
    queue.log(3, null);
    queue.log(4, null);
    queue.log(5, null);
    const result = await queue.flush();
    assert.equal(result.failure.kind, 'network');
    assert.equal(result.pending, 3);
    assert.equal(api.sent.length, 1);
  });

  test('an entry the server will never accept is kept visible and does not block the others', async () => {
    const storage = fakeStorage();
    const api = scriptedApi('ok', apiError(400, 'bad_time', '"at" cannot be in the future'), 'ok');
    const queue = queueOver(api, storage);
    queue.log(3, 'first');
    const bad = queue.log(2, 'second');
    queue.log(4, 'third');

    const result = await queue.flush();
    assert.equal(result.sent, 2, 'the entries on either side were sent');
    assert.equal(result.rejected, 1);
    assert.equal(result.pending, 0);
    assert.equal(result.failure, null, 'a rejected entry is not a connection problem');
    const left = queue.pending();
    assert.equal(left.length, 1);
    assert.equal(left[0].id, bad.id);
    assert.equal(left[0].rejected.code, 'bad_time');
    assert.match(left[0].rejected.message, /future/);
    assert.equal(stored(storage)[0].rejected.code, 'bad_time', 'the refusal is remembered across reloads');

    // it is not sent again unchanged, however often the queue runs
    await queue.flush();
    await queue.flush();
    assert.equal(api.sent.filter((m) => m.id === bad.id).length, 1);

    // Try again is a deliberate choice, and sends it
    queue.retry(bad.id);
    const retried = await queue.flush();
    assert.equal(retried.sent, 1);
    assert.equal(api.sent.filter((m) => m.id === bad.id).length, 2);
    assert.deepEqual(queue.pending(), []);
  });

  test('a refused entry can be discarded', async () => {
    const queue = queueOver(scriptedApi(apiError(400, 'bad_score')));
    const entry = queue.log(3, null);
    await queue.flush();
    assert.equal(queue.pending().length, 1);
    queue.drop(entry.id);
    assert.deepEqual(queue.pending(), []);
  });

  test('an unknown client error is treated as temporary, not as a reason to delete', async () => {
    const api = scriptedApi(apiError(404, 'not_found', 'No such endpoint'));
    const queue = queueOver(api);
    queue.log(3, null);
    const result = await queue.flush();
    assert.equal(result.pending, 1);
    assert.equal(result.rejected, 0);
    assert.equal(result.failure.kind, 'retry');
  });

  test('the sent count only includes entries the server acknowledged', async () => {
    const api = scriptedApi('ok', 'ok', apiError(503, 'http_503'));
    const queue = queueOver(api);
    for (const score of [1, 2, 3, 4]) queue.log(score, null);
    const result = await queue.flush();
    assert.equal(result.sent, 2);
    assert.equal(result.pending, 2);
  });

  test('an entry logged while a run is in progress is sent by that same run', async () => {
    const api = scriptedApi();
    const queue = queueOver(api);
    queue.log(3, null);
    const running = queue.flush();
    assert.equal(queue.flush(), running, 'a second call shares the run');
    queue.log(4, null);
    const result = await running;
    assert.equal(result.sent, 2);
    assert.deepEqual(queue.pending(), []);
  });

  test('two tabs over the same storage never lose each other’s entries', async () => {
    const storage = fakeStorage();
    const api = scriptedApi();
    const tabA = queueOver(api, storage);
    const tabB = queueOver(api, storage); // opened before A logged anything
    tabA.log(1, 'from A');
    tabB.log(5, 'from B');
    assert.deepEqual(stored(storage).map((m) => m.note).sort(), ['from A', 'from B']);

    // B sends both; A, which still thinks it has its own entry, finds nothing left to send
    const sentByB = await tabB.flush();
    assert.equal(sentByB.sent, 2);
    assert.deepEqual((await tabA.flush()).sent, 0);
    assert.deepEqual(stored(storage), []);
  });

  test('when the device cannot store entries, they are kept in memory and the problem is reported', async () => {
    const storage = fakeStorage();
    storage.failWrites = true;
    const api = scriptedApi(networkError());
    const queue = queueOver(api, storage);
    queue.log(4, 'kept only in memory');
    assert.match(queue.storageProblem(), /Quota/);
    assert.equal(queue.pending().length, 1, 'the entry is still there to be sent');

    const offline = await queue.flush();
    assert.equal(offline.pending, 1);
    assert.match(queue.storageProblem(), /Quota/, 'still reported while it waits');

    storage.failWrites = false;
    queue.log(5, 'second');
    assert.equal(queue.storageProblem(), null, 'a write that works clears the report');
    assert.deepEqual(stored(storage).map((m) => m.note), ['kept only in memory', 'second'], 'the earlier entry reached storage too');
    const result = await queue.flush();
    assert.equal(result.sent, 2);
  });

  test('with no storage at all the queue works for this visit and says it cannot keep anything', async () => {
    const api = scriptedApi(networkError());
    const queue = createMoodQueue({ api, storage: null, newId: sequentialIds('mood') });
    queue.log(3, null);
    assert.match(queue.storageProblem(), /not available/);
    await queue.flush();
    assert.equal(queue.pending().length, 1);
    const result = await queue.flush();
    assert.equal(result.sent, 1);
  });

  test('storage that throws on read falls back to this visit’s entries', async () => {
    const storage = fakeStorage();
    const queue = queueOver(scriptedApi(), storage);
    queue.log(3, null);
    storage.failReads = true;
    assert.equal(queue.pending().length, 1);
    queue.log(4, null);
    assert.equal(queue.pending().length, 2);
  });

  test('subscribers hear about every change', async () => {
    const queue = queueOver(scriptedApi());
    let heard = 0;
    const stop = queue.subscribe(() => heard++);
    const entry = queue.log(3, null);
    assert.equal(heard, 1);
    await queue.flush();
    assert.equal(heard, 2, 'the acknowledgment removed it');
    stop();
    queue.log(2, null);
    assert.equal(heard, 2);
    assert.ok(entry.id);
  });
});
