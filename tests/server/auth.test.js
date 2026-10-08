import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

describe('the optional password', () => {
  test('there is no login until a password is set: everything is open, and the app says so', async () => {
    assert.deepEqual((await app.api('GET', '/api/auth')).json, { enabled: false, loggedIn: true });
    assert.equal((await app.api('GET', '/api/tags')).status, 200);
    assert.equal((await app.api('POST', '/api/auth/login', { password: 'whatever' })).json.error.code, 'auth_off');
  });

  test('a weak password is refused and nothing changes', async () => {
    const r = await app.api('PUT', '/api/auth/password', { password: 'abc' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'weak_password');
    assert.equal((await app.api('GET', '/api/auth')).json.enabled, false);
  });

  let cookie;
  test('setting a password locks the data but not the page, the health check or the assistant key', async () => {
    save(app, uuid(), docOf(para('private words')));
    const r = await app.api('PUT', '/api/auth/password', { password: 'correct horse' });
    assert.equal(r.status, 200);
    cookie = cookieOf(r);
    assert.ok(cookie, 'the browser that set it stays logged in');
    assert.match(r.headers.get('set-cookie'), /HttpOnly/);
    assert.match(r.headers.get('set-cookie'), /SameSite=Lax/);

    for (const p of ['/api/tags', '/api/config', '/api/tasks', '/api/notes', '/api/export/json', '/api/backups', '/api/moods', '/api/trash']) {
      const denied = await app.api('GET', p);
      assert.equal(denied.status, 401, `${p} needs a login`);
      assert.equal(denied.json.error.code, 'login_required');
    }
    assert.equal((await app.api('PUT', '/api/notes/some-note-id-1', {})).status, 401, 'writes too');
    assert.equal((await app.api('GET', '/api/health')).status, 200, 'the health check is open');
    assert.deepEqual((await app.api('GET', '/api/auth')).json, { enabled: true, loggedIn: false });
    assert.equal((await app.api('GET', '/api/assistant/ping', undefined, { authorization: `Bearer ${KEY}` })).status, 200, 'the assistant has its own key');
    assert.equal((await app.api('GET', '/api/assistant/ping')).status, 401);
    assert.equal((await app.api('GET', '/api/tags', undefined, { cookie })).status, 200, 'with the cookie it works');
    assert.deepEqual((await app.api('GET', '/api/auth', undefined, { cookie })).json, { enabled: true, loggedIn: true });
  });

  test('the password is never stored or exported in plain text, and an import cannot remove it', async () => {
    const stored = app.db.prepare("SELECT value FROM meta WHERE key = 'auth_password'").get().value;
    assert.doesNotMatch(stored, /correct horse/);
    assert.match(stored, /"salt":"[0-9a-f]{32}"/);
    const exported = await app.api('GET', '/api/export/json', undefined, { cookie });
    assert.equal(exported.status, 200);
    assert.doesNotMatch(exported.text, /auth_password|auth_secret|"salt"|scrypt/);
    const imported = await app.api('POST', '/api/import?mode=replace', exported.json, { cookie });
    assert.equal(imported.status, 200);
    assert.equal((await app.api('GET', '/api/auth')).json.enabled, true, 'a replace-import leaves the password alone');
  });

  test('logging in: a wrong password is refused, the right one gives a cookie', async () => {
    const wrong = await app.api('POST', '/api/auth/login', { password: 'nope nope' });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.json.error.code, 'wrong_password');
    assert.equal(cookieOf(wrong), null);
    const right = await app.api('POST', '/api/auth/login', { password: 'correct horse' });
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

  test('changing the password needs the current one, logs other browsers out, and keeps this one in', async () => {
    assert.equal((await app.api('PUT', '/api/auth/password', { password: 'second pass', current: 'wrong' }, { cookie })).status, 401);
    assert.equal((await app.api('PUT', '/api/auth/password', { password: 'second pass', current: 'correct horse' })).status, 401, 'and a login');
    const changed = await app.api('PUT', '/api/auth/password', { password: 'second pass', current: 'correct horse' }, { cookie });
    assert.equal(changed.status, 200);
    const newCookie = cookieOf(changed);
    assert.equal((await app.api('GET', '/api/tags', undefined, { cookie })).status, 401, 'the old login is gone');
    assert.equal((await app.api('GET', '/api/tags', undefined, { cookie: newCookie })).status, 200);
    assert.equal((await app.api('POST', '/api/auth/login', { password: 'correct horse' })).status, 401);
    assert.equal((await app.api('POST', '/api/auth/login', { password: 'second pass' })).status, 200);
    cookie = newCookie;
  });

  test('turning it off needs the current password; afterwards the app is open again', async () => {
    assert.equal((await app.api('POST', '/api/auth/off', { current: 'wrong' }, { cookie })).status, 401);
    assert.equal((await app.api('POST', '/api/auth/off', { current: 'second pass' })).status, 401, 'and a login');
    const off = await app.api('POST', '/api/auth/off', { current: 'second pass' }, { cookie });
    assert.deepEqual(off.json, { enabled: false, loggedIn: true });
    assert.equal((await app.api('GET', '/api/tags')).status, 200);
  });

  test('forgot it: the server-side command turns it off and the app opens again', async () => {
    await app.api('PUT', '/api/auth/password', { password: 'forgotten one' });
    assert.equal((await app.api('GET', '/api/tags')).status, 401);
    const run = spawnSync(process.execPath, ['server/cli.js', 'password-off'], { env: { ...process.env, DATA_DIR: app.dir }, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /password is off/i);
    assert.equal((await app.api('GET', '/api/tags')).status, 200);
    assert.equal(spawnSync(process.execPath, ['server/cli.js', 'password-off'], { env: { ...process.env, DATA_DIR: app.dir }, encoding: 'utf8' }).stdout.includes('No password was set'), true);
  });

  test('a login still needs a JSON request, like every other change', async () => {
    await app.api('PUT', '/api/auth/password', { password: 'json needed' });
    const res = await fetch(`${app.url}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'password=json needed' });
    assert.equal(res.status, 415);
    await app.api('POST', '/api/auth/off', { current: 'json needed' }, { cookie: cookieOf(await app.api('POST', '/api/auth/login', { password: 'json needed' })) });
  });
});

describe('the rules inside (with a controllable clock)', () => {
  let db, dir, now, auth;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-auth-'));
    db = openDb(path.join(dir, 'hq.sqlite'));
    now = Date.parse('2026-10-08T12:00:00Z');
    auth = createAuth(db, { now: () => now });
    await auth.setPassword('open sesame');
  });
  after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const req = (cookie) => ({ headers: { cookie } });
  const cookieValue = () => /^hq_session=[^;]*/.exec(auth.cookie())[0];

  test('five wrong passwords in a row lock the login for a minute, even for the right one', async () => {
    for (let i = 0; i < 5; i++) assert.equal(await auth.check('wrong'), false);
    await assert.rejects(() => auth.check('open sesame'), (e) => e.status === 429 && e.code === 'too_many_tries' && e.extra.retryAfter === 60);
    now += 30_000;
    await assert.rejects(() => auth.check('open sesame'), (e) => e.extra.retryAfter === 30);
    now += 31_000;
    assert.equal(await auth.check('open sesame'), true, 'after the minute the right password works');
    assert.equal(await auth.check('wrong'), false);
    assert.equal(await auth.check('open sesame'), true, 'a success starts the count again');
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
    await again.setPassword('a different one');
    assert.equal(again.loggedIn(req(c)), false);
  });

  test('a damaged password record keeps the app locked instead of opening it', () => {
    db.prepare("UPDATE meta SET value = 'not json' WHERE key = 'auth_password'").run();
    assert.equal(auth.enabled(), true);
    assert.equal(auth.loggedIn(req(cookieValue())), false);
  });
});
