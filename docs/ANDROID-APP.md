# Gordonite as an app on Android

Since 0.7.0 Gordonite can be installed from Chrome as an app: its own icon and window, opening with no connection,
and listed in Android's **Share** menu. It is still the same web app; there is no separate Android build.

## What it needs

**HTTPS.** Chrome offers the service worker (what makes all of this work) only on HTTPS or localhost. Over
`http://192.168.1.50:8082` the app keeps working exactly as before, without these extras. The owner's HTTPS address
is `https://gordonite.duckdns.org`, reachable only on the home network or through WireGuard (set up in
[DEPLOYMENT.md](DEPLOYMENT.md#b1-free-duckdns-name-option-b-without-buying-a-domain)).

## Installing on the phone

1. Make sure everything is saved in the app you use now (the status dot is green).
2. In Chrome, with WireGuard on, open `https://gordonite.duckdns.org` once and wait for it to load.
3. Chrome's menu (⋮) → **Add to home screen** → **Install**. (If it only offers *Create shortcut*, reload once
   and try again: the app has to have loaded fully once.)
4. Remove the old home-screen icon for `http://192.168.1.50:8082`. Each address keeps its own unsent edits, so do
   this only after step 1.

Long-pressing the icon offers **New note** and **Tasks**.

## Opening with no connection

The service worker (`client/sw.js`) keeps a copy of the app's own files: the page, the script, the styles, the
icons. Opening the app asks the server first; if it has not answered in 3 seconds (WireGuard off, no signal) the
copy is used. What you then see is what the app already shows offline: notes with unsent edits on the phone, and
the status dot saying the server cannot be reached. Lists and older notes still come from the server (full offline
browsing is still out of scope).

The list of files is written into the service worker at build time (`client/sw-build.js`), so each deployment is
a new service worker. The phone installs it in the background the next time the app is opened online; the
version after that opening is the new one. Settings shows which version is running.

`/api/` is never touched by the service worker: saving, files and lists always go to the server, as before.

## Sharing to Gordonite

In any app, **Share** → **Gordonite** (installed app only). What you share becomes a **new free note** with no tag,
opened on its own page so you can name it, tag it and keep writing:

| Shared | In the note |
|---|---|
| A web page from Chrome | the page's title as the note's name, the address as the text |
| Text | the text, line by line |
| Photos, PDFs, other files (several at once) | uploaded, and placed in the note as files |

How it is kept safe: the service worker stores the share in the phone's browser storage first (the IndexedDB
database `gordonite-share`). The share page (`#/share/<id>`, `client/src/views/Share.jsx`) uploads the files, makes
the note (held on the phone like typed text) and only then deletes the stored share.

* **Text and links with no connection** become the note straight away; it is sent when the server is reachable,
  like any note written offline.
* **Files with no connection** cannot be uploaded, so the share waits: the page says so and has *Try again* (it
  also tries again by itself when the phone comes back online) and *Discard*. If you leave, the Dashboard shows
  "Something you shared is waiting to become a note" with *Add now*.
* A share that reaches the server without the service worker (the app was never opened on that address) is
  answered with the share page, which says to open Gordonite once and share again. Nothing is stored.

## Tests

`tests/e2e/share.test.js` (installed app: share a page and a file; reload with no connection, a file share that
waits and is added later; a text share made offline), `tests/client/share.test.js` (how a share becomes a note,
the list of files kept), `tests/server/share-target.test.js` (a share that reaches the server). The other browser
tests run with the service worker blocked, as before (`newPhone` in `tests/e2e/harness.js`, `serviceWorker: true`
to allow it).

## Not done / not checked

* **Not yet tried on the real S24.** See the "Installed app" section of [DEVICE-CHECKLIST.md](DEVICE-CHECKLIST.md).
* No home-screen widget, quick-settings tile or notifications: those would need a native shell.
* A separate native app that switches WireGuard on and off by itself is planned (not built) in
  [ANDROID-APP-PLAN.md](ANDROID-APP-PLAN.md). That plan was written before this release and points its WebView at
  `http://192.168.1.50:8082`; pointed at the HTTPS address instead, the WebView would get this service worker
  (offline start) too. Sharing from other apps would need its own handling there.
* Notes saved while offline are sent only while the app is open (no background sync).
