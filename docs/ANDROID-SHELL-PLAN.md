# Gordonite for Android, option 1: the thin native shell (plan)

Status: **plan only, nothing built.** Written 2026-10-15 against `main` at 0.10.0 (`6542eb5`, schema v9). To be
executed in phases, each one reviewed on the S24 before the next starts.

Related: [ANDROID-APP.md](ANDROID-APP.md) (the installed web app, 0.7.0+), [OFFLINE.md](OFFLINE.md),
[ANDROID-APP-PLAN.md](ANDROID-APP-PLAN.md) (the earlier plan for an app that switches WireGuard on and off). This plan
is the same Android project **without** the WireGuard switching; that can be added later as its own phase (section 12).

## 1. Goal

One Android app, installed by hand as an APK, that:

1. **Is Gordonite**: shows the live app (`https://gordonite.duckdns.org`) full screen, with everything the installed web
   app does today (offline opening, phone copy, share menu, uploads), so it can replace the Chrome-installed icon.
2. **Adds what a web app cannot**:
   * **Widgets** on the home screen: *Habits today* (tick from the home screen) and *Quick jot*.
   * **Quick Settings tiles** in the pull-down shade: *Jot* and *Log skin*.
   * **Reminders** that fire on time from the phone itself, even with WireGuard off: habit reminders, course days
     ("Betaderm: day 3 of 7"), with **Done** / **Snooze** buttons on the notification.
   * **Sending in the background**: what is done from a widget, tile or notification is queued on the phone and sent
     when the server is reachable, without opening the app.

### Not in this plan

* Rewriting screens natively (option 3). Every screen stays the web app.
* WireGuard switching (the earlier plan; section 12).
* Play Store publishing, iOS.
* Background sending of what is typed **inside** the app (see 5.6: possible later, not v1).

## 2. Decisions (recommended; confirm in section 14)

| Decision | Choice | Why |
|---|---|---|
| Framework | **Plain Kotlin + Android Studio project** (no Capacitor, React Native or Flutter) | The screens stay the live web app; only widgets, tiles and reminders are native, and those are Kotlin in every framework anyway. Fewer layers, fewer dependencies to keep up to date. |
| Widgets | **Jetpack Glance** (Compose-style widgets) | Current Google way to build widgets; interactive checkboxes supported on Android 12+ (the S24 runs 14/15). |
| Background work | **WorkManager** | Survives reboots, respects battery rules, retries with backoff. |
| Native storage | **DataStore** (small JSON documents) | Enough for a widget cache and a queue of a few dozen changes; no database needed. |
| Network | `HttpURLConnection` or OkHttp, JSON with `kotlinx.serialization` | Small; no Retrofit needed for ~6 endpoints. |
| Where it lives | `android/` folder in this repo, its own Gradle project | Same repo, same review; excluded from the Docker image. |
| Minimum Android | `minSdk 26` (Android 8), `targetSdk` current stable | The S24 is far above; 26 keeps the door open for another phone. |
| Server address | `https://gordonite.duckdns.org` by default, changeable in the app's settings | One stable HTTPS address (DEPLOYMENT.md, option B1). |
| Signing | Debug key while testing; one **release keystore** created once, kept **outside the repo** | Android only installs an update signed with the same key: losing it means uninstalling and reinstalling. |

## 3. What already exists that this builds on

* **The web app** (0.10.0): service worker and app copy (opens offline), phone copy of notes/tasks/habits
  (`offline-copy.js`), save queue for notes (`sync.js`, IndexedDB), record queues for skin entries and habits
  (`record-queue.js`, localStorage), share page (`#/share`), skin log, habits with skin-log courses, People.
* **Server**: habits API (`/api/habits`, check-ins by day), skin API, the assistant's "append to today's daily note"
  (`AssistantNotes.appendDaily`, used by the MCP bridge), optional login cookie (`hq_session`, 30 days).
* **Toolchain on the PC**: JDK 21 is installed (`C:\Program Files\Eclipse Adoptium\jdk-21.0.6.7-hotspot`), which the
  Android build accepts. **Not installed**: Android Studio / Android SDK (checked 2026-10-15).

## 4. Architecture

```
 ┌───────────── Android app "Gordonite" ─────────────┐
 │ MainActivity ── WebView ── https://gordonite…/    │  ← all screens, exactly the web app
 │      │  NativeBridge (JS ↔ Kotlin, narrow)         │
 │ JotActivity (small dialog: text box + Save)       │  ← from widget, tile, notification
 │ Widgets: HabitsWidget, JotWidget (Glance)         │
 │ Tiles:   JotTile, SkinTile                        │
 │ Reminders: ReminderScheduler + AlarmReceiver      │
 │ OutboxRepository (DataStore) ── SyncWorker ───────┼──→ server /api/… (cookie from the WebView)
 │ CacheRepository  (DataStore) ←─ RefreshWorker ────┼──← server /api/widget/today
 └───────────────────────────────────────────────────┘
```

Two rules keep this simple:

1. **The server stays the single source of truth.** Native code never decides what a note looks like or which habits
   are due; it asks the server (new endpoint `/api/widget/today`, section 6) and shows the answer.
2. **Everything native that writes goes through one outbox** (a queue like the web app's): tick a habit, jot a line,
   snooze. The outbox is sent by `SyncWorker` whenever a network is available; a failure keeps the item and retries.

## 5. The app shell (MainActivity + WebView)

### 5.1 Loading
* Full-screen WebView on the server address; JavaScript, DOM storage and the service worker on (Android's WebView is
  Chromium, so the service worker, IndexedDB, phone copy and offline opening work as in Chrome).
* Storage lives in the app's private data: Android never evicts it (better than a Chrome-installed web app).
* Status bar and navigation bar colours follow the app's light/dark theme; algorithmic darkening off (the app has its
  own dark theme).
* Keyboard: `adjustResize`, so the note editor's toolbar stays above the keyboard (same check as the web app's
  `interactive-widget`). **Test the editor with Samsung Keyboard and Gboard in phase 1**: it is the same Chromium
  editor, so the S24 device checklist applies unchanged.

### 5.2 Navigation and links
* Back button: WebView history; at the start page, leave the app.
* Links off the Gordonite address (a pasted web link in a note) open in the default browser.
* Opening a stored file (PDF, image) works in the WebView; **downloads** (exports, "Download everything", a file's
  download button) are handed to Android's DownloadManager **with the login cookie**, so they land in Downloads.

### 5.3 Uploads and camera
* The paperclip, the Files page and pasted images use `onShowFileChooser`: opens Android's picker (photos, files) and
  offers the camera. Multiple files allowed.

### 5.4 Sharing into Gordonite
The Chrome-installed app gets shares through its service worker (0.7.0). A native app gets them as Android intents:
* `ACTION_SEND` / `ACTION_SEND_MULTIPLE` for text, links, images, PDFs, any file.
* The shell keeps the share (text and files copied into its cache folder) and opens `#/share/native` in the WebView.
* **Small web-app change**: the share page asks the bridge `GordoniteNative.takeShare()` for the share (text fields,
  and files as `{ name, type, base64 }`, files up to 25 MB each) and then does exactly what it does today (upload files,
  make the note, delete the share). Same note result, same offline behaviour.

### 5.5 The bridge (`window.GordoniteNative`)
Exposed **only** to pages from the configured server address. Narrow on purpose:

| Method | Direction | Use |
|---|---|---|
| `takeShare()` | web ← native | the pending share (5.4) |
| `isNative()` | web ← native | lets the web app hide "Install app" hints and show native-only settings |
| `widgetsChanged()` | web → native | after a tick, a habit edit or a skin entry in the app: refresh widgets now |
| `openNotificationSettings()` | web → native | from Settings → Reminders (phase 4) |

### 5.6 What "background sending" covers in v1
* **Covered**: everything done from widgets, tiles and notifications (native outbox, WorkManager).
* **Not covered in v1**: edits typed **inside** the app while offline still need the app opened once after the server
  is back (as today). Android's WebView does not offer the web Background Sync API.
  *Later option*: the web app's queues hand unsent items to native through the bridge, and `SyncWorker` sends them.
  That touches the save engine (`sync.js`), so it is its own change with its own tests, after v1 has proven itself.

### 5.7 Moving from the Chrome-installed app
The WebView's storage is **separate** from Chrome's. Before switching:
1. In the Chrome-installed app, check the status dot is green (nothing waiting) and no skin entry, habit tick or share
   says "waiting".
2. Install the native app, open it once with WireGuard on.
3. Remove the Chrome-installed icon. (Keeping both works, but each has its own offline copy and queues.)

## 6. Server changes (small; one release, e.g. 0.11.0)

All under the existing rules: JSON bodies, same-origin checks (native requests send no `Sec-Fetch-Site`, which the
server already accepts), the login cookie when a password is set.

| Endpoint | What | Notes |
|---|---|---|
| `GET /api/widget/today` | Everything a widget needs, already worked out: `{ date, dailyTag, habits: [{ id, name, detail, done, course: { product, until } \| null }], tasks: { overdue, dueToday }, reminders: [...] }` | Uses `shared/habits.js` so "due today" means the same as in the app. Small, cacheable. |
| `POST /api/jot` | `{ text, opId }` → appends a paragraph to today's daily entry of the Dashboard's tag, creating the entry if needed | Reuses `AssistantNotes.appendDaily`. **Idempotent by `opId`** (a retried jot is not added twice): store recent opIds. |
| Habit **reminder time** | `remindAt: "21:30"` (optional) on a habit; schema **v10** (one column) | Set in the habit editor (web). Courses remind only on course days. |
| `GET /api/health` | add `minShell: 1` | The app warns "please update the Gordonite app" if the server needs a newer shell. |

Tests: server tests for each endpoint (`tests/server/widget.test.js`), including jot idempotency, a jot into an
existing and a missing daily entry, a jot while the note has a newer revision (it appends to the server's version;
the phone's open editor then shows the usual conflict panel, see 11).

## 7. Widgets

### 7.1 Habits today (2×2 and 4×2)
* Header "Habits · 2 of 4"; one row per habit due today: checkbox, name, and for a course "Betaderm · until Oct 21".
* **Tap the checkbox** → shown ticked at once (optimistic) → outbox item `check(habitId, date, done)` → `SyncWorker`.
* **Tap the title** → opens the app at `#/habits`.
* **Freshness**: `RefreshWorker` every 30 minutes (Android's practical minimum for periodic work is 15), when the app
  goes to the background, after a tick, after midnight (new day), and when `widgetsChanged()` is called.
* **No connection**: shows the last answer with a small "as of 14:05", ticks still work (queued).
* Empty: "Nothing due today".

### 7.2 Quick jot (1×1 button, or 4×1 bar)
* Tap → `JotActivity`: a small dialog with a text box, keyboard up, **Save**.
* Save → outbox item `jot(text, opId, createdAt)` → `SyncWorker` → `POST /api/jot`. Closed at once; a toast says
  "Saved" or "Will be added when Gordonite is reachable".
* Optional later: choose a tag or "new note" instead of today's entry.

### 7.3 Later candidates (not v1)
* **Skin "Same as last time"** button: needs the skin line written **by the server** (today the app writes the note
  line itself, `skin-log.js`). Moving that to the server is its own change.
* **Tasks due today** list with tick.

## 8. Quick Settings tiles
* **Jot**: opens `JotActivity` over whatever is on screen.
* **Log skin**: opens the app at `#/skin`.
Added by the user once: pull down the shade → edit (pencil) → drag the tiles in.

## 9. Reminders and notifications

* **Permission**: Android 13+ asks for notifications once (first time reminders are turned on). Exact-time alarms on
  Android 14 need "Alarms & reminders" allowed (the app explains and opens the setting).
* **Scheduling**: after each refresh, `ReminderScheduler` sets one exact alarm per habit reminder for the next due day
  (`AlarmManager.setExactAndAllowWhileIdle`); rescheduled after reboot (`BOOT_COMPLETED`) and on time-zone change.
  Because the alarms are on the phone, **they fire with WireGuard off**.
* **The notification**: "Betaderm · course day 3 of 7 · legs and arms" with buttons **Done** (outbox tick, notification
  goes) and **Snooze 30 min**. Tapping it opens `#/habits`.
* A habit already ticked that day (seen at the last refresh) is not reminded.
* **Samsung battery settings**: set Gordonite to **Unrestricted** (Settings → Apps → Gordonite → Battery), or One UI may
  delay background work. The app shows this tip once.
* Optional later: a morning summary ("3 tasks due, 2 habits").

## 10. Security and privacy
* No secrets in the APK or the repo: no password, no assistant token, no keystore (`AGENTS.md`).
* Native requests reuse the WebView's login cookie (`CookieManager`) when a password is set; nothing else is stored.
* The bridge is limited to the configured address and the four methods in 5.5.
* HTTPS only to the server; the Let's Encrypt certificate is trusted by Android as is.
* `android:allowBackup="false"` (no Google cloud backup of cached notes); widget cache holds habit names and counts
  only, no note text. The jot text is kept only until it is sent.
* Notifications show habit names on the lock screen; a setting can hide the details ("Gordonite reminder").

## 11. Risks and how each is handled

| Risk | Handling |
|---|---|
| Quick jot appends to today's note while it is open in the app on the phone | The server appends to its version; the app's editor sees a newer revision when it next saves and shows the conflict panel (keep both). Mitigation: the app reloads today's note when it comes back to the screen (already done on reconnect). |
| Samsung kills background work | Unrestricted battery tip; WorkManager retries; widgets show "as of" times so stale data is visible. |
| Widget shows old data while offline | "as of" time; ticks still queue. |
| Server and app versions drift | `minShell` in `/api/health`; the app's own `versionName`; the web app keeps working in Chrome regardless. |
| Lost signing key | Keep the keystore and its password in your password manager and a private backup (not in OneDrive's shared folders, not in the repo). |
| Editor typing in WebView differs from Chrome | Same Chromium engine; phase 1 runs the S24 typing checklist in the app. |
| Play Protect warning on install | Expected for a sideloaded app; "Install anyway". |

## 12. Phases

Estimates are working sessions with me, plus your time on the phone. Each phase ends with a short S24 test.

| # | Phase | Who does what | Done when | Size |
|---|---|---|---|---|
| **0** | **Setup** | **You**: install Android Studio (≈ 3–4 GB download; accept the SDK licences in its setup), turn on Developer options → USB debugging on the S24 (or Wireless debugging), plug in once and allow the PC. **Me**: create `android/` (Gradle wrapper, app skeleton, `.dockerignore`), `scripts/build-android.ps1` (checks prerequisites, builds, installs with `adb`). | A "Gordonite" icon on the S24 opens the live app | ½ day |
| **1** | **Shell parity** | **Me**: WebView settings, back button, external links, downloads with cookie, file chooser + camera, share intents + `#/share/native` (small web change), bridge (`isNative`, `takeShare`), app settings screen (server address). **You**: run the S24 checklist in the app (typing, offline, share, upload). | The app can replace the Chrome icon | 1 day |
| **2** | **Server widget API + Quick jot** | **Me**: `/api/widget/today`, `/api/jot` (+ tests, release), outbox + `SyncWorker`, `JotActivity`, Jot widget, Jot tile. **You**: jot offline on mobile data, turn WireGuard on, see it in today's note. | Jots arrive once, even after retries and offline | 1 day |
| **3** | **Habits widget + Log skin tile** | **Me**: `RefreshWorker`, cache, Glance habits widget with ticking, `widgetsChanged()` from the web app, Log skin tile. **You**: tick from the home screen online and offline; check the app agrees. | Widget and app always agree within a refresh | 1 day |
| **4** | **Reminders** | **Me**: `remindAt` (schema v10, habit editor field), scheduler, alarm receiver, notification with Done / Snooze, reboot handling, permission flow, battery tip. **You**: set a reminder 2 minutes ahead with WireGuard off; press Done; check it ticks once online. | A reminder fires on time offline and Done ticks the habit | 1–1½ days |
| **5** | **Release** | **Me**: release keystore instructions (you create and keep it), `docs/ANDROID-NATIVE.md` (install, update, widgets, tiles, reminders, troubleshooting), release notes, device checklist section. **You**: install the release build, remove the Chrome icon (5.7). | Daily use on the S24 | ½ day |
| 6 | *(later, optional)* | Background sending of in-app edits (5.6); skin "Same as last time" widget (7.3); WireGuard switching ([ANDROID-APP-PLAN.md](ANDROID-APP-PLAN.md)). | | each ½–2 days |

**Total for v1 (phases 0–5): about 5 working sessions.** The slow part is the round trips to the phone, not the code.

### Testing without the phone in the loop every time
* **Android emulator** on the PC (comes with Android Studio): on the home network it reaches the server like any
  device, so most of phases 1–3 can be checked by me before you install. Needs Windows' virtualization feature
  ("Windows Hypervisor Platform") switched on; if it is off, that is your call to turn on, or we test on the S24 only.
* **Unit tests** (JVM, run by Gradle): outbox ordering and retries, jot idempotency ids, widget model from a sample
  `/api/widget/today`, reminder times across midnight and time-zone changes.
* **Server tests** (Node, as now) for the new endpoints; the existing unit and browser suites for the small web changes.

## 13. Versioning and docs (per `AGENTS.md`)
* The Android app has its own `versionName` / `versionCode` (starting 1.0.0 / 1), shown in its settings.
* Server and web changes (phase 1 share bridge, phase 2 endpoints, phase 4 schema v10) raise `APP_VERSION` and get
  release notes, as usual.
* New `docs/ANDROID-NATIVE.md`; `README.md` link; device checklist section; handover row.

## 14. Decisions for you before we start

1. **Widgets for v1**: Habits today + Quick jot (recommended)? Anything else first?
2. **Quick jot goes to**: today's daily entry of the Dashboard's tag (recommended), or a separate "Inbox" note?
3. **Reminders**: per-habit times (recommended), plus a morning summary or not?
4. **Lock screen**: show habit names in reminders, or hide details?
5. **Emulator**: OK to turn on Windows Hypervisor Platform for the Android emulator (a Windows feature; you switch it
   on, it needs a restart), or test on the S24 only?
6. **Name and icon**: "Gordonite" with the current logo (recommended)?
7. **Keystore**: where you will keep the release key and its password (your password manager is the obvious place).

## 15. Before the first session (checklist for you)
- [ ] Android Studio installed from developer.android.com (default options; let it download the SDK).
- [ ] S24: Settings → About phone → Software information → tap **Build number** 7 times → Developer options →
      **USB debugging** on.
- [ ] A USB-C cable that does data (not charge-only), or Wireless debugging set up.
- [ ] Answers to section 14.
