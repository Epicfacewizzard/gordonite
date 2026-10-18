import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, save, docOf, para } from './helpers.js';
import { openDb } from '../../server/db.js';
import { createAuth } from '../../server/auth.js';
import { uuid } from '../../shared/ids.js';

const KEY = 'test-only-assistant-key-123456789';
let app;
before(async () => (app = await startServer({ ASSISTANT_TOKEN: KEY })));
after(async () => app.close());

const cookieOf = (r) => /^(hq_session=[^;]*)/.exec(r.headers.get('set-cookie') ?? '')?.[1] ?? null;

describe('the optional PIN', () => {
  test('there is no login until a password is set: everything is open, and the app says so', async () => {
    assert.deepEqual((await app.api('GET', '/api/auth')).json, { enabled: false, loggedIn: true, pin: false, passkey: false });
    assert.equal((await app.api('GET', '/api/tags')).status, 200);
    assert.equal((await app.api('POST', '/api/auth/login', { password: 'whatever' })).json.error.code, 'auth_off');
  });

  test('anything but exactly 4 digits is refused and nothing changes', async () => {
    for (const password of ['123', '12345', 'abcd', '12a4', ' 1234', 'correct horse', 1234, null]) {
      const r = await app.api('PUT', '/api/auth/password', { password });
      assert.equal(r.status, 400, String(password));
      assert.equal(r.json.error.code, 'bad_pin');
    }
    assert.equal((await app.api('GET', '/api/auth')).json.enabled, false);
  });

  let cookie;
  test('setting a PIN locks the data but not the page, the health check or the assistant key', async () => {
    save(app, uuid(), docOf(para('private words')));
    const r = await app.api('PUT', '/api/auth/password', { password: '4821' });
    assert.equal(r.status, 200);
    cookie = cookieOf(r);
    assert.ok(cookie, 'the browser that set it stays logged in');
    assert.match(r.headers.get('set-cookie'), /HttpOnly/);
    assert.match(r.headers.get('set-cookie'), /SameSite=Lax/);

    for (const p of ['/api/tags', '/api/config', '/api/tasks', '/api/notes', '/api/export/json', '/api/export/files', '/api/backups', '/api/backups/bundle', '/api/moods', '/api/trash']) {
      const denied = await app.api('GET', p);
      assert.equal(denied.status, 401, `${p} needs a login`);
      assert.equal(denied.json.error.code, 'login_required');
    }
    assert.equal((await app.api('PUT', '/api/notes/some-note-id-1', {})).status, 401, 'writes too');
    assert.equal((await app.api('GET', '/api/health')).status, 200, 'the health check is open');
    assert.deepEqual((await app.api('GET', '/api/auth')).json, { enabled: true, loggedIn: false, pin: true, passkey: false });
    assert.equal((await app.api('GET', '/api/assistant/ping', undefined, { authorization: `Bearer ${KEY}` })).status, 200, 'the assistant has its own key');
    assert.equal((await app.api('GET', '/api/assistant/ping')).status, 401);
    assert.equal((await app.api('GET', '/api/tags', undefined, { cookie })).status, 200, 'with the cookie it works');
    assert.deepEqual((await app.api('GET', '/api/auth', undefined, { cookie })).json, { enabled: true, loggedIn: true, pin: true, passkey: false });
  });

  test('the PIN is never stored or exported in plain text, and an import cannot remove it', async () => {
    const stored = app.db.prepare("SELECT value FROM meta WHERE key = 'auth_password'").get().value;
    assert.doesNotMatch(stored, /4821/);
    assert.match(stored, /"salt":"[0-9a-f]{32}"/);
    const exported = await app.api('GET', '/api/export/json', undefined, { cookie });
    assert.equal(exported.status, 200);
    assert.doesNotMatch(exported.text, /auth_password|auth_secret|"salt"|scrypt/);
    const imported = await app.api('POST', '/api/import?mode=replace', exported.json, { cookie });
    assert.equal(imported.status, 200);
    assert.equal((await app.api('GET', '/api/auth')).json.enabled, true, 'a replace-import leaves the password alone');
  });

  test('logging in: a wrong PIN is refused, the right one gives a cookie', async () => {
    const wrong = await app.api('POST', '/api/auth/login', { password: '0000' });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.json.error.code, 'wrong_password');
    assert.equal(cookieOf(wrong), null);
    const right = await app.api('POST', '/api/auth/login', { password: '4821' });
    assert.equal(right.status, 200);
    const fresh = cookieOf(right);
    assert.equal((await app.api('GET', '/api/tags', undefined, { cookie: fresh })).status, 200);
    const out = await app.api('POST', '/api/auth/logout', {}, { cookie: fresh });
    assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  });

  test('a made-up or damaged cookie does not work', async () => {
    const parts = cookie.split('=')[1].split('.');
    const forged = `hq_session=${parts[0]}.${parts[1]}.${'A'.repeat(parts[2].length)}`;
    assert.equal((await app.api('GET', '/api/tags', undefined, { cookie: forged })).status, 401);
    assert.equal((await app.api('GET', '/api/tags', undefined, { cookie: 'hq_session=garbage' })).status, 401);
    const later = `hq_session=${Number(parts[0]) + 999999999}.${parts[1]}.${parts[2]}`;
    assert.equal((await app.api('GET', '/api/tags', undefined, { cookie: later })).status, 401, 'changing the expiry breaks the signature');
  });

  test('changing the PIN needs the current one, logs other browsers out, and keeps this one in', async () => {
    assert.equal((await app.api('PUT', '/api/auth/password', { password: '7305', current: '1111' }, { cookie })).status, 401);
    assert.equal((await app.api('PUT', '/api/auth/password', { password: '7305', current: '4821' })).status, 401, 'and a login');
    const changed = await app.api('PUT', '/api/auth/password', { password: '7305', current: '4821' }, { cookie });
    assert.equal(changed.status, 200);
    const newCookie = cookieOf(changed);
    assert.equal((await app.api('GET', '/api/tags', undefined, { cookie })).status, 401, 'the old login is gone');
    assert.equal((await app.api('GET', '/api/tags', undefined, { cookie: newCookie })).status, 200);
    assert.equal((await app.api('POST', '/api/auth/login', { password: '4821' })).status, 401);
    assert.equal((await app.api('POST', '/api/auth/login', { password: '7305' })).status, 200);
    cookie = newCookie;
  });

  test('turning it off needs the current PIN; afterwards the app is open again', async () => {
    assert.equal((await app.api('POST', '/api/auth/off', { current: '1111' }, { cookie })).status, 401);
    assert.equal((await app.api('POST', '/api/auth/off', { current: '7305' })).status, 401, 'and a login');
    const off = await app.api('POST', '/api/auth/off', { current: '7305' }, { cookie });
    assert.deepEqual(off.json, { enabled: false, loggedIn: true, pin: false, passkey: false });
    assert.equal((await app.api('GET', '/api/tags')).status, 200);
  });

  test('forgot it: the server-side command turns it off and the app opens again', async () => {
    await app.api('PUT', '/api/auth/password', { password: '9090' });
    assert.equal((await app.api('GET', '/api/tags')).status, 401);
    const run = spawnSync(process.execPath, ['server/cli.js', 'password-off'], { env: { ...process.env, DATA_DIR: app.dir }, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /password is off/i);
    assert.equal((await app.api('GET', '/api/tags')).status, 200);
    assert.equal(spawnSync(process.execPath, ['server/cli.js', 'password-off'], { env: { ...process.env, DATA_DIR: app.dir }, encoding: 'utf8' }).stdout.includes('No password was set'), true);
  });

  test('a login still needs a JSON request, like every other change', async () => {
    await app.api('PUT', '/api/auth/password', { password: '2468' });
    const res = await fetch(`${app.url}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'password=2468' });
    assert.equal(res.status, 415);
    await app.api('POST', '/api/auth/off', { current: '2468' }, { cookie: cookieOf(await app.api('POST', '/api/auth/login', { password: '2468' })) });
  });

  test('a longer password from before PINs still logs in, says it is not a PIN, and can be swapped for a PIN', async () => {
    setLegacyPassword(app.db, 'old long password');
    assert.deepEqual((await app.api('GET', '/api/auth')).json, { enabled: true, loggedIn: false, pin: false, passkey: false });
    assert.equal((await app.api('POST', '/api/auth/login', { password: 'nope' })).status, 401);
    const cookie = cookieOf(await app.api('POST', '/api/auth/login', { password: 'old long password' }));
    assert.ok(cookie, 'the old password still works');
    assert.equal((await app.api('GET', '/api/tags', undefined, { cookie })).status, 200);
    assert.equal((await app.api('GET', '/api/assistant/ping', undefined, { authorization: `Bearer ${KEY}` })).status, 200, 'the assistant key is untouched');
    const swapped = await app.api('PUT', '/api/auth/password', { password: '1357', current: 'old long password' }, { cookie });
    assert.equal(swapped.status, 200);
    assert.deepEqual((await app.api('GET', '/api/auth')).json, { enabled: true, loggedIn: false, pin: true, passkey: false });
    assert.equal((await app.api('POST', '/api/auth/login', { password: 'old long password' })).status, 401, 'the old password is gone');
    const fresh = cookieOf(await app.api('POST', '/api/auth/login', { password: '1357' }));
    assert.equal((await app.api('POST', '/api/auth/off', { current: '1357' }, { cookie: fresh })).status, 200);
  });
});

// What 0.16.1 and earlier stored for a text password: the same scrypt record, without `pin: true`.
function setLegacyPassword(db, password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  const gen = (JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'auth_password'").get()?.value ?? '{"gen":0}').gen ?? 0) + 1;
  db.prepare("INSERT INTO meta (key, value) VALUES ('auth_password', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ salt: salt.toString('hex'), hash: hash.toString('hex'), gen }));
}

describe('the rules inside (with a controllable clock)', () => {
  let db, dir, now, auth;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-auth-'));
    db = openDb(path.join(dir, 'hq.sqlite'));
    now = Date.parse('2026-10-08T12:00:00Z');
    auth = createAuth(db, { now: () => now });
    await auth.setPassword('2580');
  });
  after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const req = (cookie) => ({ headers: { cookie } });
  const cookieValue = () => /^hq_session=[^;]*/.exec(auth.cookie())[0];

  test('a few mistyped PINs never get in the way of the right one', async () => {
    for (let i = 0; i < 9; i++) assert.equal(await auth.check('1111'), false);
    assert.equal(await auth.check('2580'), true, 'nine wrong in a row: the tenth try is still open');
  });

  test('ten wrong PINs in a row lock the login for 30 seconds, even for the right one', async () => {
    for (let i = 0; i < 10; i++) assert.equal(await auth.check('1111'), false);
    await assert.rejects(() => auth.check('2580'), (e) => e.status === 429 && e.code === 'too_many_tries' && e.extra.retryAfter === 30);
    now += 20_000;
    await assert.rejects(() => auth.check('2580'), (e) => e.extra.retryAfter === 10);
    now += 11_000;
    assert.equal(await auth.check('2580'), true, 'after the wait the right PIN works');
    assert.equal(await auth.check('1111'), false);
    assert.equal(await auth.check('2580'), true, 'a success starts the count again');
  });

  test('a login lasts 30 days, then it is gone', () => {
    const c = cookieValue();
    assert.equal(auth.loggedIn(req(c)), true);
    now += 29 * 86_400_000;
    assert.equal(auth.loggedIn(req(c)), true);
    now += 2 * 86_400_000;
    assert.equal(auth.loggedIn(req(c)), false);
  });

  test('the login survives a restart (the signing secret is saved), but not a password change', async () => {
    const c = cookieValue();
    const again = createAuth(db, { now: () => now });
    assert.equal(again.loggedIn(req(c)), true);
    await again.setPassword('3690');
    assert.equal(again.loggedIn(req(c)), false);
  });

  test('a damaged password record keeps the app locked instead of opening it', () => {
    db.prepare("UPDATE meta SET value = 'not json' WHERE key = 'auth_password'").run();
    assert.equal(auth.enabled(), true);
    assert.equal(auth.loggedIn(req(cookieValue())), false);
  });
});
