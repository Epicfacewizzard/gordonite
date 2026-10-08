// An optional password for the web app (see docs/LOGIN.md). OFF until the owner turns it on in Settings.
//
// - The password is kept only as a salted scrypt hash in the `meta` table (never in plain text, never exported).
// - A signed cookie (`hq_session`, HttpOnly, 30 days) says "this browser has logged in". It carries the password
//   generation, so changing the password logs every other browser out. The signing secret is stored in `meta` too,
//   so a restart (or an update) does not log anyone out.
// - Wrong passwords slow down: 5 in a row locks the login for a minute.
// - The assistant's key (ASSISTANT_TOKEN) is a separate door and is not affected.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from './store.js';

const scrypt = promisify(crypto.scrypt);

export const SESSION_COOKIE = 'hq_session';
export const MIN_PASSWORD = 6;
const MAX_PASSWORD = 200;
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const FAILS_BEFORE_LOCK = 5;
const LOCK_SECONDS = 60;

export function createAuth(db, { now = () => Date.now() } = {}) {
  const getMeta = (key) => db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
  const setMeta = (key, value) => db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  const delMeta = (key) => db.prepare('DELETE FROM meta WHERE key = ?').run(key);

  // One counter for the whole app: behind Docker every request looks like it comes from the same address anyway.
  let fails = 0;
  let lockedUntil = 0;

  const record = () => {
    const raw = getMeta('auth_password');
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return { broken: true }; // a damaged record keeps the app locked rather than quietly opening it
    }
  };
  const secret = () => {
    let hex = getMeta('auth_secret');
    if (!hex) {
      hex = crypto.randomBytes(32).toString('hex');
      setMeta('auth_secret', hex);
    }
    return Buffer.from(hex, 'hex');
  };
  const sign = (payload) => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  const cookieAttrs = (maxAge) => `Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`;

  const api = {
    /** Is a password set? */
    enabled: () => record() !== null,

    /** The Set-Cookie value that marks a browser as logged in. */
    cookie() {
      const gen = record()?.gen ?? 0;
      const payload = `${Math.floor(now() / 1000) + SESSION_SECONDS}.${gen}`;
      return `${SESSION_COOKIE}=${payload}.${sign(payload)}; ${cookieAttrs(SESSION_SECONDS)}`;
    },
    clearCookie: () => `${SESSION_COOKIE}=; ${cookieAttrs(0)}`,

    /** Does this request carry a valid, current login cookie? */
    loggedIn(req) {
      const rec = record();
      if (rec === null) return true; // no password set: nothing to log in to
      if (rec.broken) return false;
      const raw = /(?:^|;\s*)hq_session=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
      const parts = raw?.split('.') ?? [];
      if (parts.length !== 3) return false;
      const [exp, gen, sig] = parts;
      const want = Buffer.from(sign(`${exp}.${gen}`));
      const got = Buffer.from(sig);
      if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return false;
      return Number(exp) * 1000 > now() && Number(gen) === rec.gen;
    },

    /** Set or change the password. Every browser logged in with the old one has to log in again. */
    async setPassword(password) {
      if (typeof password !== 'string' || password.length < MIN_PASSWORD) throw new HttpError(400, 'weak_password', `Use at least ${MIN_PASSWORD} characters.`);
      if (password.length > MAX_PASSWORD) throw new HttpError(400, 'weak_password', `Use at most ${MAX_PASSWORD} characters.`);
      const salt = crypto.randomBytes(16);
      const hash = await scrypt(password, salt, 32);
      const gen = (record()?.gen ?? 0) + 1;
      setMeta('auth_password', JSON.stringify({ salt: salt.toString('hex'), hash: hash.toString('hex'), gen }));
      secret();
    },

    /** Is this the password? Counts wrong guesses and locks for a minute after too many. */
    async check(password) {
      const t = now();
      if (t < lockedUntil) {
        const wait = Math.ceil((lockedUntil - t) / 1000);
        throw new HttpError(429, 'too_many_tries', `Too many wrong passwords. Try again in ${wait} seconds.`, { retryAfter: wait });
      }
      const rec = record();
      let ok = false;
      if (rec && !rec.broken && typeof password === 'string' && password.length <= MAX_PASSWORD) {
        const hash = await scrypt(password, Buffer.from(rec.salt, 'hex'), 32);
        const stored = Buffer.from(rec.hash, 'hex');
        ok = stored.length === hash.length && crypto.timingSafeEqual(stored, hash);
      }
      if (ok) {
        fails = 0;
        return true;
      }
      fails += 1;
      if (fails >= FAILS_BEFORE_LOCK) {
        fails = 0;
        lockedUntil = t + LOCK_SECONDS * 1000;
      }
      return false;
    },

    /** Turn the password off (the signing secret stays so a later password works the same way). */
    turnOff: () => delMeta('auth_password'),
  };
  return api;
}
