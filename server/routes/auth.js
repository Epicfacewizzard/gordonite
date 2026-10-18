// The optional PIN, and fingerprint / face unlock next to it (see docs/LOGIN.md). The PIN routes and fields keep their
// older "password" names.
import { sendJson } from '../http.js';
import { HttpError } from '../errors.js';
import { createPasskeys } from '../passkeys.js';

export function registerAuthRoutes({ route, auth, log, passkeys = createPasskeys(auth) }) {
  const state = (req) => ({ enabled: auth.enabled(), loggedIn: auth.loggedIn(req), pin: auth.isPin(), passkey: passkeys.availableFor(req) });
  const off = { enabled: false, loggedIn: true, pin: false, passkey: false };

  // ----- the optional PIN (see docs/LOGIN.md). These routes work without a login; everything else needs one when a PIN is set. -----
  route('GET', '/api/auth', async ({ req, res }) => sendJson(res, 200, state(req)));
  route('POST', '/api/auth/login', async ({ res, body }) => {
    if (!auth.enabled()) throw new HttpError(400, 'auth_off', 'No PIN is set');
    if (!(await auth.check(body.password))) throw new HttpError(401, 'wrong_password', 'That PIN is not right');
    res.setHeader('set-cookie', auth.cookie());
    sendJson(res, 200, { ok: true });
  });
  route('POST', '/api/auth/logout', async ({ res }) => {
    res.setHeader('set-cookie', auth.clearCookie());
    sendJson(res, 200, { ok: true });
  });
  // Set the first PIN (nothing needed), or change it (log in and give the current one). The browser that did it stays
  // logged in. Either way every passkey is removed: they hang off the PIN.
  route('PUT', '/api/auth/password', async ({ req, res, body }) => {
    if (auth.enabled()) {
      if (!auth.loggedIn(req)) throw new HttpError(401, 'login_required', 'Log in to continue');
      if (!(await auth.check(body.current))) throw new HttpError(401, 'wrong_password', 'The current PIN is not right');
    }
    await auth.setPassword(body.password);
    res.setHeader('set-cookie', auth.cookie());
    sendJson(res, 200, { enabled: true, loggedIn: true, pin: true, passkey: false });
  });
  route('POST', '/api/auth/off', async ({ req, res, body }) => {
    if (!auth.enabled()) return sendJson(res, 200, off);
    if (!auth.loggedIn(req)) throw new HttpError(401, 'login_required', 'Log in to continue');
    if (!(await auth.check(body.current))) throw new HttpError(401, 'wrong_password', 'The current PIN is not right');
    auth.turnOff();
    res.setHeader('set-cookie', auth.clearCookie());
    sendJson(res, 200, off);
  });

  // ----- fingerprint / face unlock (WebAuthn passkeys, server/passkeys.js) -----
  // Logging in with one: open, like the PIN login.
  route('POST', '/api/auth/passkey/options', async ({ req, res }) => sendJson(res, 200, await passkeys.loginOptions(req)));
  route('POST', '/api/auth/passkey/login', async ({ req, res, body }) => {
    await passkeys.login(req, body);
    res.setHeader('set-cookie', auth.cookie());
    sendJson(res, 200, { ok: true });
  });
  // Adding, listing and removing them: a logged-in browser on an install with a PIN.
  route('GET', '/api/auth/passkeys', async ({ req, res }) => sendJson(res, 200, { passkeys: passkeys.list(req) }));
  route('POST', '/api/auth/passkeys/options', async ({ req, res }) => sendJson(res, 200, await passkeys.registrationOptions(req)));
  route('POST', '/api/auth/passkeys', async ({ req, res, body }) => {
    const added = await passkeys.register(req, body);
    log.log(`[auth] passkey added: ${added.label} (${added.rpId})`);
    sendJson(res, 200, { added, passkeys: passkeys.list(req) });
  });
  route('DELETE', '/api/auth/passkeys/:id', async ({ req, res, params }) => {
    passkeys.remove(req, params.id);
    sendJson(res, 200, { passkeys: passkeys.list(req) });
  });
}
