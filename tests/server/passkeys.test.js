// Fingerprint / face unlock (WebAuthn passkeys). The phone is played by a small software authenticator below: a real
// P-256 key, real CBOR, real signatures, so the library's own checks run exactly as they do for a phone.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encodeCBOR } from '@levischuck/tiny-cbor';
import { startServer } from './helpers.js';
import { openDb } from '../../server/db.js';
import { createAuth } from '../../server/auth.js';
import { createPasskeys, relyingParty } from '../../server/passkeys.js';
import { HttpError } from '../../server/errors.js';

const KEY = 'test-only-assistant-key-123456789';
const b64 = (bytes) => Buffer.from(bytes).toString('base64url');
const sha256 = (data) => crypto.createHash('sha256').update(data).digest();
const cookieOf = (r) => /^(hq_session=[^;]*)/.exec(r.headers.get('set-cookie') ?? '')?.[1] ?? null;

/** A phone's fingerprint sensor, in software. `verified: false` plays a sensor that skipped user verification. */
function softAuthenticator() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credId = crypto.randomBytes(16);
  let counter = 0;
  const authData = (rpId, flags, extra = Buffer.alloc(0), count = counter) => {
    const c = Buffer.alloc(4);
    c.writeUInt32BE(count);
    return Buffer.concat([sha256(rpId), Buffer.from([flags]), c, extra]);
  };
  const clientData = (type, challenge, origin) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  return {
    id: b64(credId),
    create(options, { origin, verified = true } = {}) {
      const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
      const len = Buffer.alloc(2);
      len.writeUInt16BE(credId.length);
      const attested = Buffer.concat([Buffer.alloc(16), len, credId, Buffer.from(encodeCBOR(cose))]);
      const data = authData(options.rp.id, 0x41 | (verified ? 0x04 : 0), attested);
      const attestationObject = encodeCBOR(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', data]]));
      return {
        id: b64(credId),
        rawId: b64(credId),
        type: 'public-key',
        authenticatorAttachment: 'platform',
        clientExtensionResults: {},
        response: { clientDataJSON: b64(clientData('webauthn.create', options.challenge, origin)), attestationObject: b64(attestationObject), transports: ['internal'] },
      };
    },
    get(options, { origin, verified = true, count = counter + 1, rpId = options.rpId, id = b64(credId), challenge = options.challenge } = {}) {
      counter = count;
      const data = authData(rpId, 0x01 | (verified ? 0x04 : 0), undefined, count);
      const cd = clientData('webauthn.get', challenge, origin);
      const signature = crypto.sign('sha256', Buffer.concat([data, sha256(cd)]), privateKey);
      return {
        id,
        rawId: id,
        type: 'public-key',
        authenticatorAttachment: 'platform',
        clientExtensionResults: {},
        response: { clientDataJSON: b64(cd), authenticatorData: b64(data), signature: b64(signature) },
      };
    },
  };
}

let app, base, origin;
before(async () => {
  app = await startServer({ ASSISTANT_TOKEN: KEY });
  // Passkeys need a name, not an IP address: talk to the same server as localhost.
  base = app.url.replace('127.0.0.1', 'localhost');
  origin = base;
});
after(async () => app.close());

async function call(method, p, body, headers = {}, root = base) {
  const res = await fetch(root + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* empty */
  }
  return { status: res.status, json, headers: res.headers };
}

async function addPasskey(phone, cookie, label = 'Galaxy S24') {
  const options = (await call('POST', '/api/auth/passkeys/options', {}, { cookie })).json;
  return call('POST', '/api/auth/passkeys', { response: phone.create(options, { origin }), label }, { cookie });
}
async function unlock(phone, opts = {}) {
  const options = await call('POST', '/api/auth/passkey/options', {});
  if (options.status !== 200) return options; // no passkey here any more
  return call('POST', '/api/auth/passkey/login', { response: phone.get(options.json, { origin, ...opts }) });
}

describe('fingerprint / face unlock', () => {
  const phone = softAuthenticator();
  let cookie;

  test('without a PIN there is nothing to add a passkey to', async () => {
    assert.deepEqual((await call('GET', '/api/auth')).json, { enabled: false, loggedIn: true, pin: false, passkey: false });
    const r = await call('POST', '/api/auth/passkeys/options', {});
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'pin_required');
    assert.equal((await call('POST', '/api/auth/passkey/options', {})).json.error.code, 'auth_off');
  });

  test('adding one needs a logged-in browser', async () => {
    cookie = cookieOf(await call('PUT', '/api/auth/password', { password: '4821' }));
    assert.ok(cookie);
    for (const [method, p] of [['POST', '/api/auth/passkeys/options'], ['POST', '/api/auth/passkeys'], ['GET', '/api/auth/passkeys'], ['DELETE', '/api/auth/passkeys/x']]) {
      const r = await call(method, p, method === 'GET' || method === 'DELETE' ? undefined : {});
      assert.equal(r.status, 401, `${method} ${p}`);
      assert.equal(r.json.error.code, 'login_required');
    }
  });

  test('the registration asks for this device’s own sensor with user verification, for the host the request came to', async () => {
    const options = (await call('POST', '/api/auth/passkeys/options', {}, { cookie })).json;
    assert.equal(options.rp.id, 'localhost');
    assert.equal(options.rp.name, 'Gordonite');
    assert.deepEqual(options.authenticatorSelection, { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required', requireResidentKey: false });
    assert.equal(options.attestation, 'none');
    assert.match(options.challenge, /^[\w-]{20,}$/);
  });

  test('adding a passkey: saved with its name and date; no private key, nothing from the phone but the public key', async () => {
    const r = await addPasskey(phone, cookie);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.added.label, 'Galaxy S24');
    assert.equal(r.json.passkeys.length, 1);
    const [p] = (await call('GET', '/api/auth/passkeys', undefined, { cookie })).json.passkeys;
    assert.deepEqual(Object.keys(p).sort(), ['createdAt', 'id', 'label', 'rpId']);
    assert.equal(p.id, phone.id);
    assert.equal(p.rpId, 'localhost');
    assert.ok(Date.parse(p.createdAt) <= Date.now());
    const stored = JSON.parse(app.db.prepare("SELECT value FROM meta WHERE key = 'auth_passkeys'").get().value);
    assert.deepEqual(Object.keys(stored[0]).sort(), ['counter', 'createdAt', 'id', 'label', 'publicKey', 'rpId', 'transports']);
    assert.deepEqual(stored[0].transports, ['internal']);
  });

  test('a registration answer is good once, and must be for this site and verified', async () => {
    const options = (await call('POST', '/api/auth/passkeys/options', {}, { cookie })).json;
    const other = softAuthenticator();
    const replay = other.create(options, { origin });
    assert.equal((await call('POST', '/api/auth/passkeys', { response: replay }, { cookie })).status, 200);
    const again = await call('POST', '/api/auth/passkeys', { response: replay }, { cookie });
    assert.equal(again.status, 400, 'the challenge was used up');
    assert.equal(again.json.error.code, 'passkey_rejected');

    const opt2 = (await call('POST', '/api/auth/passkeys/options', {}, { cookie })).json;
    const unverified = await call('POST', '/api/auth/passkeys', { response: softAuthenticator().create(opt2, { origin, verified: false }) }, { cookie });
    assert.equal(unverified.status, 400, 'no fingerprint / face: refused');
    const opt3 = (await call('POST', '/api/auth/passkeys/options', {}, { cookie })).json;
    const elsewhere = await call('POST', '/api/auth/passkeys', { response: softAuthenticator().create(opt3, { origin: 'https://evil.example' }) }, { cookie });
    assert.equal(elsewhere.status, 400, 'made on another site: refused');
    const madeUp = await call('POST', '/api/auth/passkeys', { response: softAuthenticator().create({ rp: { id: 'localhost' }, challenge: b64(crypto.randomBytes(32)) }, { origin }) }, { cookie });
    assert.equal(madeUp.status, 400, 'a challenge the server never gave');

    // Leave just the phone.
    const r = await call('DELETE', `/api/auth/passkeys/${encodeURIComponent(other.id)}`, undefined, { cookie });
    assert.deepEqual(r.json.passkeys.map((p) => p.id), [phone.id]);
  });

  test('the login page learns a passkey exists only for the host it was added on; an IP address cannot use one', async () => {
    assert.deepEqual((await call('GET', '/api/auth')).json, { enabled: true, loggedIn: false, pin: true, passkey: true });
    assert.equal((await call('GET', '/api/auth', undefined, {}, app.url)).json.passkey, false, 'http://127.0.0.1 has none');
    const r = await call('POST', '/api/auth/passkey/options', {}, {}, app.url);
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'passkey_needs_https');
  });

  test('unlocking with the fingerprint gives the same login cookie as the PIN', async () => {
    const options = (await call('POST', '/api/auth/passkey/options', {})).json;
    assert.equal(options.rpId, 'localhost');
    assert.equal(options.userVerification, 'required');
    assert.deepEqual(options.allowCredentials.map((c) => c.id), [phone.id]);
    const r = await call('POST', '/api/auth/passkey/login', { response: phone.get(options, { origin }) });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const fresh = cookieOf(r);
    assert.ok(fresh);
    assert.equal((await call('GET', '/api/tags', undefined, { cookie: fresh })).status, 200);
    assert.equal(JSON.parse(app.db.prepare("SELECT value FROM meta WHERE key = 'auth_passkeys'").get().value)[0].counter, 1, 'the sign counter moved on');
  });

  test('an unlock is refused when it is replayed, unverified, from another site, signed wrongly, or goes backwards', async () => {
    const options = (await call('POST', '/api/auth/passkey/options', {})).json;
    const answer = phone.get(options, { origin });
    assert.equal((await call('POST', '/api/auth/passkey/login', { response: answer })).status, 200);
    const replay = await call('POST', '/api/auth/passkey/login', { response: answer });
    assert.equal(replay.status, 401, 'the challenge was used up');
    assert.equal(cookieOf(replay), null);

    const cases = [
      [{ verified: false }, 'no user verification'],
      [{ origin: 'https://evil.example' }, 'another origin'],
      [{ rpId: 'evil.example' }, 'another relying party'],
      [{ count: 1 }, 'a sign counter that went backwards (a cloned key)'],
      [{ challenge: b64(crypto.randomBytes(32)) }, 'a challenge the server never gave'],
    ];
    for (const [opts, why] of cases) {
      const r = await unlock(phone, opts);
      assert.equal(r.status, 401, why);
      assert.equal(r.json.error.code, 'passkey_rejected', why);
      assert.equal(cookieOf(r), null, why);
    }
    const options2 = (await call('POST', '/api/auth/passkey/options', {})).json;
    const forged = phone.get(options2, { origin });
    forged.response.signature = b64(crypto.randomBytes(70));
    assert.equal((await call('POST', '/api/auth/passkey/login', { response: forged })).status, 401, 'a bad signature');
    const stranger = await unlock(softAuthenticator());
    assert.equal(stranger.json.error.code, 'passkey_unknown', 'a key the server never saw');
    assert.equal((await unlock(phone)).status, 200, 'the real phone still gets in');
  });

  test('a removed device cannot unlock any more', async () => {
    const r = await call('DELETE', `/api/auth/passkeys/${encodeURIComponent(phone.id)}`, undefined, { cookie });
    assert.deepEqual(r.json.passkeys, []);
    assert.equal((await call('POST', '/api/auth/passkey/options', {})).json.error.code, 'no_passkey');
    assert.equal((await call('GET', '/api/auth')).json.passkey, false);
    assert.equal((await call('DELETE', `/api/auth/passkeys/${encodeURIComponent(phone.id)}`, undefined, { cookie })).status, 404);
  });

  test('the PIN is the root of trust: changing it or turning it off removes every passkey', async () => {
    assert.equal((await addPasskey(phone, cookie)).status, 200);
    const changed = await call('PUT', '/api/auth/password', { password: '7305', current: '4821' }, { cookie });
    assert.deepEqual(changed.json, { enabled: true, loggedIn: true, pin: true, passkey: false });
    cookie = cookieOf(changed);
    assert.deepEqual((await call('GET', '/api/auth/passkeys', undefined, { cookie })).json.passkeys, []);
    assert.equal((await unlock(phone)).json.error.code, 'no_passkey', 'the phone cannot unlock any more');

    assert.equal((await addPasskey(phone, cookie)).status, 200);
    const off = await call('POST', '/api/auth/off', { current: '7305' }, { cookie });
    assert.equal(off.status, 200);
    assert.equal(app.db.prepare("SELECT value FROM meta WHERE key = 'auth_passkeys'").get(), undefined);
  });

  test('turning the PIN off and on again never brings back a login from before', async () => {
    const first = cookieOf(await call('PUT', '/api/auth/password', { password: '1111' }));
    await call('POST', '/api/auth/off', { current: '1111' }, { cookie: first });
    cookie = cookieOf(await call('PUT', '/api/auth/password', { password: '2222' }));
    assert.equal((await call('GET', '/api/tags', undefined, { cookie: first })).status, 401, 'the old cookie stays dead');
    assert.equal((await call('GET', '/api/tags', undefined, { cookie })).status, 200);
  });

  test('the server-side password-off command also removes the passkeys; the assistant key is untouched throughout', async () => {
    assert.equal((await addPasskey(phone, cookie)).status, 200);
    assert.equal((await call('GET', '/api/assistant/ping', undefined, { authorization: `Bearer ${KEY}` })).status, 200);
    const run = spawnSync(process.execPath, ['server/cli.js', 'password-off'], { env: { ...process.env, DATA_DIR: app.dir }, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /password is off/i);
    assert.equal(app.db.prepare("SELECT value FROM meta WHERE key = 'auth_passkeys'").get(), undefined);
    assert.deepEqual((await call('GET', '/api/auth')).json, { enabled: false, loggedIn: true, pin: false, passkey: false });
    assert.equal((await call('GET', '/api/assistant/ping', undefined, { authorization: `Bearer ${KEY}` })).status, 200);
  });
});

describe('the passkey handlers with the WebAuthn checks stubbed out', () => {
  let db, dir, auth;
  const req = (cookie, host = 'gordonite.duckdns.org') => ({ headers: { host, cookie } });
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-passkey-'));
    db = openDb(path.join(dir, 'hq.sqlite'));
    auth = createAuth(db);
    await auth.setPassword('2580');
  });
  after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const loggedIn = () => req(/^hq_session=[^;]*/.exec(auth.cookie())[0]);

  test('the relying party is the request’s host; https is expected, plain http only for localhost', () => {
    assert.deepEqual(relyingParty({ headers: { host: 'gordonite.duckdns.org' } }), { rpId: 'gordonite.duckdns.org', origins: ['https://gordonite.duckdns.org'] });
    assert.deepEqual(relyingParty({ headers: { host: 'localhost:5173' } }), { rpId: 'localhost', origins: ['https://localhost:5173', 'http://localhost:5173'] });
    for (const host of ['192.168.1.50:8082', '[::1]:8080', '', undefined]) assert.throws(() => relyingParty({ headers: { host } }), (e) => e instanceof HttpError && e.code === 'passkey_needs_https', String(host));
  });

  test('what the library is asked to check, and what is kept from its answer', async () => {
    const seen = [];
    const passkeys = createPasskeys(auth, {
      verifyRegistration: async (opts) => {
        seen.push(opts);
        assert.equal(await opts.expectedChallenge(options.challenge), true, 'the challenge it was given');
        return { verified: true, registrationInfo: { credential: { id: 'cred-1', publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal', 'hybrid'] } } };
      },
      verifyAuthentication: async (opts) => {
        seen.push(opts);
        assert.equal(await opts.expectedChallenge(login.challenge), true);
        return { verified: true, authenticationInfo: { newCounter: 7 } };
      },
    });
    const options = await passkeys.registrationOptions(loggedIn());
    const added = await passkeys.register(loggedIn(), { response: { id: 'cred-1' }, label: `  ${'x'.repeat(80)}  ` });
    assert.equal(added.label, 'x'.repeat(60), 'names are trimmed and kept short');
    assert.equal(seen[0].expectedRPID, 'gordonite.duckdns.org');
    assert.deepEqual(seen[0].expectedOrigin, ['https://gordonite.duckdns.org']);
    assert.equal(seen[0].requireUserVerification, true);
    assert.equal(auth.passkeys()[0].publicKey, 'AQID');

    const login = await passkeys.loginOptions(req());
    assert.equal(await passkeys.login(req(), { response: { id: 'cred-1' } }), true);
    assert.equal(seen[1].requireUserVerification, true);
    assert.deepEqual([...seen[1].credential.publicKey], [1, 2, 3]);
    assert.equal(auth.passkeys()[0].counter, 7);
    await assert.rejects(() => passkeys.login(req(undefined, 'other.example'), { response: { id: 'cred-1' } }), (e) => e.code === 'passkey_unknown', 'a passkey belongs to its own host');
  });

  test('a failed or throwing check adds nothing and logs nobody in', async () => {
    const passkeys = createPasskeys(auth, {
      verifyRegistration: async () => ({ verified: false }),
      verifyAuthentication: async () => {
        throw new Error('Unexpected authentication response origin');
      },
    });
    const before = auth.passkeys().length;
    await passkeys.registrationOptions(loggedIn());
    await assert.rejects(() => passkeys.register(loggedIn(), { response: { id: 'cred-2' } }), (e) => e.status === 400 && e.code === 'passkey_rejected');
    assert.equal(auth.passkeys().length, before);
    await passkeys.loginOptions(req());
    await assert.rejects(() => passkeys.login(req(), { response: { id: 'cred-1' } }), (e) => e.status === 401 && /origin/.test(e.message));
  });

  test('a challenge runs out after 5 minutes', async () => {
    let now = Date.now();
    const passkeys = createPasskeys(auth, { now: () => now, verifyAuthentication: async (opts) => ({ verified: await opts.expectedChallenge(challenge), authenticationInfo: { newCounter: 8 } }) });
    const { challenge } = await passkeys.loginOptions(req());
    now += 5 * 60_000 + 1;
    await assert.rejects(() => passkeys.login(req(), { response: { id: 'cred-1' } }), (e) => e.code === 'passkey_rejected');
  });
});
