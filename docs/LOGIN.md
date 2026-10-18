# Optional login PIN

A small lock for the web app, in case someone else on your network (or someone borrowing your phone) opens it.
It is **off by default**: nothing changes until you turn it on. It is a second lock, not a replacement for the VPN, which
stays the main protection (see `AGENTS.md`: the app is never put on the open internet).

## Using it

Since 0.16.2 the lock is a **4-digit PIN** (it used to be a password of at least 6 characters). A short PIN is enough
because the app is only reachable on the home network or over WireGuard.

- **Turn on:** Settings → PIN → type a 4-digit PIN twice → Turn on PIN.
  The browser you did it on stays logged in; every other browser sees the PIN boxes.
- **Logging in:** type the 4 digits (phones show the number pad). It goes in by itself after the 4th digit, with no button.
  A wrong PIN shakes the boxes, clears them and waits for the next try. A browser then stays logged in for **30 days**.
- **Log out:** Settings → PIN → Log out on this device.
- **Change it:** Settings → PIN → Change the PIN (needs the current one). Every other browser has to log in again.
- **Turn off:** Settings → PIN → Turn the PIN off (needs the current one).
- **Forgot it:** on the server, `sudo docker exec gordonite node server/cli.js password-off` (the same command with
  `node server/cli.js password-off` where the app runs without Docker). The app opens without a login again; set a new
  PIN in Settings.
- **An install with a password from before 0.16.2** keeps it: the login page shows the old text field and Log in button
  until a PIN is set. Settings → PIN then says "old password" and offers **Set a PIN instead** (current password + new PIN).

## What it protects

With a PIN set, every request to the app's data is refused with `401 login_required` until the browser has logged in:
notes, tags, tasks, moods, exports, imports, backups, the trash, and the settings. Still open without a login:

- the page itself (the login page needs it; it holds no notes),
- `GET /api/health` (the deploy script and monitors use it),
- `/api/auth*` (the login routes),
- `/api/assistant/*`, which keeps its own key (`ASSISTANT_TOKEN`) and is not affected either way.

## How it works (for whoever maintains it)

- Code: `server/auth.js`; routes and the gate in `server/app.js`; the page in `client/src/views/LoginView.jsx`; Settings in
  `client/src/views/PasswordSettings.jsx`; the gate in `client/src/app.jsx`.
- The PIN is stored only as a salted **scrypt** hash in the `meta` table (`auth_password`), together with a counter
  (`gen`) that goes up whenever it changes, and `pin: true`. A record without `pin` is an old password: it still
  checks the same way, and `GET /api/auth` answers `pin: false` so the login page shows the text field. Nothing is stored
  in plain text. New PINs must be exactly 4 digits (`400 bad_pin` otherwise). The routes and JSON fields keep their
  older names (`/api/auth/password`, `password`, `current`, `password-off`).
- A logged-in browser holds a cookie `hq_session` = `expiry.gen.signature` (HMAC-SHA256 with a random secret kept in
  `meta` as `auth_secret`), `HttpOnly; SameSite=Lax`. Changing the password raises `gen`, which logs the other browsers out.
  The secret is saved, so restarting or updating the app does not log anyone out.
- Ten wrong tries in a row lock the login for 30 seconds for everyone (one counter for the whole app, because behind
  Docker all requests look like they come from the same address). Retyping a mistyped PIN a few times is never blocked;
  trying all 10 000 PINs would take hours. The login page shows the wait when it happens. Changing the PIN or turning it
  off also needs the current one, and counts against the same limit.
- The JSON export and import only copy a fixed list of settings, so the password record is never exported and a replace-import
  cannot remove or overwrite it. It **is** inside the database file, so database backups contain the hash: treat backups as private.
- The cookie has no `Secure` flag because the app is normally used over plain `http://` on the home network or VPN.
  If you put HTTPS in front of it (see `docs/DEPLOYMENT.md`), add `Secure` in `cookieAttrs` in `server/auth.js`.
- Changing state still needs a JSON request and is refused cross-site (unchanged), which together with `SameSite=Lax`
  covers cross-site request forgery.

## Phones and unsent text

Text typed on a device that is not logged in (or whose login ran out) stays in that browser's own storage; the login page
shows none of it. Logging in reloads the app, which sends what was waiting. Nothing is dropped.

## Limits

- One shared PIN, no accounts and no per-person permissions. A 4-digit PIN is a light lock by design: the VPN is the real one.
- Not a defence against someone who already has your server, your backups or the database file.
- `scripts/import-vault.js` and `scripts/detask-notes.js` call the web API without a login: turn the PIN off while
  they run (or run them against a copy).
- `deploy/casaos-update.sh` makes its pre-update backup over the web route and, if that is refused (PIN on), from inside
  the container with `node server/cli.js backup`; its mood-API check then prints 401, which is expected.
- The 30-second lock can be triggered by anyone who can reach the app, which is a minor annoyance, not a way in.
