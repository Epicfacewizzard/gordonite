// An optional 4-digit PIN for the web app (see docs/LOGIN.md). OFF until the owner turns it on in Settings.
//
// - New locks are always a 4-digit PIN (`pin: true` in the record). A longer password set before 0.16.2 keeps working
//   until a PIN replaces it; the login page then shows the old text field instead of the PIN boxes.
// - The PIN (or old password) is kept only as a salted scrypt hash in the `meta` table (never in plain text, never exported).
// - A signed cookie (`hq_session`, HttpOnly, 30 days) says "this browser has logged in". It carries the password
//   generation, so changing the password logs every other browser out. The signing secret is stored in `meta` too,
//   so a restart (or an update) does not log anyone out.
// - Wrong guesses slow down gently: 10 in a row lock the login for 30 seconds, so retyping a mistyped PIN is never
//   blocked, but trying all 10 000 PINs takes hours.
// - Passkeys (fingerprint / face unlock, see server/passkeys.js) are a second way in, kept in `meta` as `auth_passkeys`.
//   The PIN is the root of trust: setting, changing or turning off the PIN removes every passkey.
// - The assistant's key (ASSISTANT_TOKEN) is a separate door and is not affected.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from './errors.js';

const scrypt = promisify(crypto.scrypt);

export const SESSION_COOKIE = 'hq_session';
const PIN_RE = /^\d{4}$/;
const MAX_PASSWORD = 200;
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const FAILS_BEFORE_LOCK = 10;
const LOCK_SECONDS = 30;

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
  // The login generation outlives the PIN record (`auth_gen`), so turning the PIN off and on again never brings back
  // a cookie from before.
  const lastGen = () => Math.max(record()?.gen ?? 0, Number(getMeta('auth_gen')) || 0);
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
    /** Is a PIN (or an old password) set? */
    enabled: () => record() !== null,
    /** Is what is set a 4-digit PIN? False for a password set before PINs, so the login page shows a text field. */
    isPin: () => record()?.pin === true,

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

    /** Set or change the PIN (exactly 4 digits). Every browser logged in with the old one has to log in again. */
    async setPassword(pin) {
      if (typeof pin !== 'string' || !PIN_RE.test(pin)) throw new HttpError(400, 'bad_pin', 'Use exactly 4 digits.');
      const salt = crypto.randomBytes(16);
      const hash = await scrypt(pin, salt, 32);
      const gen = lastGen() + 1;
      delMeta('auth_passkeys');
      setMeta('auth_password', JSON.stringify({ salt: salt.toString('hex'), hash: hash.toString('hex'), gen, pin: true }));
      secret();
    },

    /** Is this the PIN (or old password)? Counts wrong guesses and locks for a short while after too many. */
    async check(password) {
      const t = now();
      if (t < lockedUntil) {
        const wait = Math.ceil((lockedUntil - t) / 1000);
        throw new HttpError(429, 'too_many_tries', `Too many wrong tries. Try again in ${wait} seconds.`, { retryAfter: wait });
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

    /** Turn the PIN off and remove every passkey; true if a PIN was set. The signing secret and the generation stay,
     *  so a later PIN works the same way and no cookie from before comes back. */
    turnOff() {
      const gen = lastGen();
      delMeta('auth_passkeys');
      if (gen) setMeta('auth_gen', String(gen));
      return delMeta('auth_password').changes > 0;
    },

    /** The saved passkeys: [{ id, publicKey, counter, transports, rpId, label, createdAt }], keys in base64url. */
    passkeys() {
      try {
        const list = JSON.parse(getMeta('auth_passkeys') ?? '[]');
        return Array.isArray(list) ? list : [];
      } catch {
        return [];
      }
    },
    /** A random handle shared by this install's passkeys (hex), made once. */
    passkeyUserId() {
      let hex = getMeta('auth_passkey_user');
      if (!hex) {
        hex = crypto.randomBytes(16).toString('hex');
        setMeta('auth_passkey_user', hex);
      }
      return hex;
    },
    savePasskeys: (list) => (list.length ? setMeta('auth_passkeys', JSON.stringify(list)) : delMeta('auth_passkeys')),
  };
  return api;
}
