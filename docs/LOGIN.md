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
- **Fingerprint / face unlock (0.16.3):** see the next section.
- **An install with a password from before 0.16.2** keeps it: the login page shows the old text field and Log in button
  until a PIN is set. Settings → PIN then says "old password" and offers **Set a PIN instead** (current password + new PIN).

## Fingerprint / face unlock (passkeys)

Since 0.16.3 a phone (or a PC with Windows Hello) can unlock Gordonite with its own fingerprint or face instead of
typing the PIN. It is a WebAuthn **passkey**: the device keeps a private key behind its fingerprint / face sensor, and
the server keeps only the matching public key. The PIN boxes always stay on the login page as the fallback.

- **Needs the https address.** Browsers only offer WebAuthn in a secure context, and never for an IP address, so it
  works at `https://gordonite.duckdns.org` (and `http://localhost` while developing), **not** at `http://<LAN IP>:8082`.
  There Settings says so instead of showing the button, and the login page shows only the PIN.
- **Add it:** with the PIN on and this device logged in, Settings → PIN → *Fingerprint / face unlock* → (optionally
  change the name) → **Add fingerprint / face unlock on this device**, then touch the sensor or look at the camera.
  Settings lists each saved device with its name and the date it was added; **Remove** takes one away.
- **Logging in:** when this address has a passkey, the login page asks for the fingerprint / face **once by itself**
  (not straight after *Log out on this device*), and offers **Use fingerprint / face** to ask again. If it is cancelled
  or the finger does not match, the page says "Use the PIN"; the boxes are right there.
- **The PIN is the root of trust.** Setting, changing or turning off the PIN removes **every** passkey (add them again
  afterwards). `password-off` on the server removes them too.
- A passkey belongs to the address it was made on. One made at `gordonite.duckdns.org` does nothing at another name; if
  the address ever changes (DEPLOYMENT.md, "Changing the address later"), add the devices again.

How it works:

- Library: **@simplewebauthn/server** (server) and **@simplewebauthn/browser** (bundled into the client). Chosen because
  it is the most widely used WebAuthn library for Node, actively maintained, typed, does the whole check (challenge,
  origin, rpId hash, user-verified flag, signature, sign counter, COSE keys) and needs no native modules. It adds about
  5 MB (mostly the @peculiar ASN.1 packages) to the server image; the browser part is a few KB.
- Code: `server/passkeys.js` (the WebAuthn steps), `server/auth.js` (storage), `server/routes/auth.js`,
  `client/src/passkey.js`, `LoginView.jsx`, `PasswordSettings.jsx`.
- **rpId = the host of the request** (the `Host` header without the port; Nginx Proxy Manager passes it through), never
  a fixed name. The expected origin is `https://<host>`, plus `http://<host>` only for `localhost`. A request to an IP
  address gets `400 passkey_needs_https`.
- Registration asks for a **platform** authenticator (the device's own sensor, not a USB key) with **user verification
  required**, attestation `none`, algorithms ES256 / EdDSA / RS256. All passkeys share one random user handle
  (`auth_passkey_user` in `meta`), so a phone that registers again replaces its own; the existing ones are also sent as
  "exclude", so the same device is not added twice.
- Challenges are random, made on the server, kept in memory for 5 minutes and **used once** (a restart forgets them;
  just try again). Every answer is checked against the challenge, the origin, the rpId, the user-verified flag and the
  stored public key; the sign counter must move forward (a copied key is refused).
- Stored in `meta` as `auth_passkeys` (a JSON list): credential id, public key, sign counter, transports, rpId, name,
  date added. No private key or biometric data ever reaches the server. Not exported or imported (like the PIN), but it
  is inside the database file and its backups.
- A passkey login sets the same `hq_session` cookie as the PIN. Changing or turning off the PIN raises `gen`; since
  0.16.3 `gen` is also remembered while the PIN is off (`auth_gen`), so turning it off and on again cannot bring back an
  old cookie.
- Routes (all under `/api/auth`, JSON only, same-site only): `POST /passkey/options` and `POST /passkey/login` (open,
  like the PIN login); `GET /passkeys`, `POST /passkeys/options`, `POST /passkeys`, `DELETE /passkeys/:id` (need a login
  and a PIN). `GET /api/auth` also answers `passkey`: whether this host has one.
- Tests: `tests/server/passkeys.test.js` (a software authenticator with a real P-256 key, plus the handlers with the
  library stubbed out); `tests/e2e/passkey.test.js` (Chromium's virtual authenticator over the DevTools WebAuthn domain).

### The planned Android shell (ANDROID-SHELL-PLAN.md)

Finding only, nothing built or tried on the S24: a plain Android **WebView does not do WebAuthn** by default
(`navigator.credentials` calls fail there), so in the shell the login page would show only the PIN. Two ways to get
fingerprint unlock there:

1. **Turn WebAuthn on in the WebView** with AndroidX Webkit (`WebSettingsCompat.setWebAuthenticationSupport(...,
   WEB_AUTHENTICATION_SUPPORT_FOR_APP)`, guarded by `WebViewFeature.isFeatureSupported(WEB_AUTHENTICATION)`; needs a
   recent WebView). The app must then be linked to the site with Digital Asset Links: the server would serve
   `/.well-known/assetlinks.json` naming the app's package and signing-key fingerprint. The passkeys then come from
   Android's Credential Manager, and this web code works unchanged.
2. **BiometricPrompt in the shell**: the app asks for the fingerprint when it opens and keeps the login cookie in the
   WebView's `CookieManager`. No server change, but it is an app lock, separate from these passkeys.

Option 2 is simpler; option 1 reuses this feature. Check on the S24 before choosing.

## What it protects

With a PIN set, every request to the app's data is refused with `401 login_required` until the browser has logged in:
notes, tags, tasks, moods, exports, imports, backups, the trash, and the settings. Still open without a login:

- the page itself (the login page needs it; it holds no notes),
- `GET /api/health` (the deploy script and monitors use it),
- `/api/auth*` (the login routes; adding, listing and removing passkeys checks the login itself),
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

- Fingerprint / face unlock needs the https address and a device with a fingerprint or face sensor; at the LAN address it is the PIN only.
- One shared PIN, no accounts and no per-person permissions. A 4-digit PIN is a light lock by design: the VPN is the real one.
- Not a defence against someone who already has your server, your backups or the database file.
- `scripts/import-vault.js` and `scripts/detask-notes.js` call the web API without a login: turn the PIN off while
  they run (or run them against a copy).
- `deploy/casaos-update.sh` makes its pre-update backup over the web route and, if that is refused (PIN on), from inside
  the container with `node server/cli.js backup`; its mood-API check then prints 401, which is expected.
- The 30-second lock can be triggered by anyone who can reach the app, which is a minor annoyance, not a way in.
