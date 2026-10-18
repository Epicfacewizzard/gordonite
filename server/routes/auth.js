// The optional PIN (see docs/LOGIN.md). The routes and fields keep their older "password" names.
import { sendJson } from '../http.js';
import { HttpError } from '../errors.js';

export function registerAuthRoutes({ route, auth, log }) {
  // ----- the optional PIN (see docs/LOGIN.md). These routes work without a login; everything else needs one when a PIN is set. -----
  route('GET', '/api/auth', async ({ req, res }) => sendJson(res, 200, { enabled: auth.enabled(), loggedIn: auth.loggedIn(req), pin: auth.isPin() }));
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
  // Set the first PIN (nothing needed), or change it (log in and give the current one). The browser that did it stays logged in.
  route('PUT', '/api/auth/password', async ({ req, res, body }) => {
    if (auth.enabled()) {
      if (!auth.loggedIn(req)) throw new HttpError(401, 'login_required', 'Log in to continue');
      if (!(await auth.check(body.current))) throw new HttpError(401, 'wrong_password', 'The current PIN is not right');
    }
    await auth.setPassword(body.password);
    res.setHeader('set-cookie', auth.cookie());
    sendJson(res, 200, { enabled: true, loggedIn: true, pin: true });
  });
  route('POST', '/api/auth/off', async ({ req, res, body }) => {
    if (!auth.enabled()) return sendJson(res, 200, { enabled: false, loggedIn: true, pin: false });
    if (!auth.loggedIn(req)) throw new HttpError(401, 'login_required', 'Log in to continue');
    if (!(await auth.check(body.current))) throw new HttpError(401, 'wrong_password', 'The current PIN is not right');
    auth.turnOff();
    res.setHeader('set-cookie', auth.clearCookie());
    sendJson(res, 200, { enabled: false, loggedIn: true, pin: false });
  });
}
