# Optional login password

A small lock for the web app, in case someone else on your network (or someone borrowing your phone) opens it.
It is **off by default**: nothing changes until you turn it on. It is a second lock, not a replacement for the VPN, which
stays the main protection (see `AGENTS.md`: the app is never put on the open internet).

## Using it

- **Turn on:** Settings → Password → type a new password (at least 6 characters) twice → Turn on password.
  The browser you did it on stays logged in; every other browser sees a login page.
- **Logging in:** the login page asks for the password. A browser then stays logged in for **30 days**.
- **Log out:** Settings → Password → Log out on this device.
- **Change it:** Settings → Password → Change the password (needs the current one). Every other browser has to log in again.
- **Turn off:** Settings → Password → Turn the password off (needs the current one).
- **Forgot it:** on the server, `sudo docker exec gordonite node server/cli.js password-off` (the same command with
  `node server/cli.js password-off` where the app runs without Docker). The app opens without a login again; set a new
  password in Settings.

## What it protects

With a password set, every request to the app's data is refused with `401 login_required` until the browser has logged in:
notes, tags, tasks, moods, exports, imports, backups, the trash, and the settings. Still open without a login:

- the page itself (the login page needs it; it holds no notes),
- `GET /api/health` (the deploy script and monitors use it),
- `/api/auth*` (the login routes),
- `/api/assistant/*`, which keeps its own key (`ASSISTANT_TOKEN`) and is not affected either way.

## How it works (for whoever maintains it)

- Code: `server/auth.js`; routes and the gate in `server/app.js`; the page in `client/src/views/LoginView.jsx`; Settings in
  `client/src/views/PasswordSettings.jsx`; the gate in `client/src/app.jsx`.
- The password is stored only as a salted **scrypt** hash in the `meta` table (`auth_password`), together with a counter
  (`gen`) that goes up whenever the password changes. Nothing is stored in plain text.
- A logged-in browser holds a cookie `hq_session` = `expiry.gen.signature` (HMAC-SHA256 with a random secret kept in
  `meta` as `auth_secret`), `HttpOnly; SameSite=Lax`. Changing the password raises `gen`, which logs the other browsers out.
  The secret is saved, so restarting or updating the app does not log anyone out.
- Five wrong passwords in a row lock the login for 60 seconds for everyone (one counter for the whole app, because behind
  Docker all requests look like they come from the same address). A change of password or turning it off also needs the
  current password, and counts against the same limit.
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

- One shared password, no accounts and no per-person permissions.
- Not a defence against someone who already has your server, your backups or the database file.
- `scripts/import-vault.js` and `scripts/detask-notes.js` call the web API without a login: turn the password off while
  they run (or run them against a copy).
- `deploy/casaos-update.sh` makes its pre-update backup over the web route and, if that is refused (password on), from inside
  the container with `node server/cli.js backup`; its mood-API check then prints 401, which is expected.
- The 60-second lock can be triggered by anyone who can reach the app, which is a minor annoyance, not a way in.
