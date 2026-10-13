# Gordonite for Android: implementation plan (draft for review)

Status: **plan only, nothing built yet.** Written 2026-10-13 so other reviewers can critique it before any code is written.

## 1. Goal

One Android app, installed by hand as an APK, that:

1. When opened, makes sure the WireGuard VPN to home is up, then shows Gordonite.
2. When the user leaves the app, turns the VPN off again (only if the app turned it on).

The user should never have to open the WireGuard app or flip a switch.

### Non-goals

- No port forwarding, public endpoint, tunnel service or `cloudflared` (forbidden by `AGENTS.md`). All access stays through the home network and WireGuard.
- No Play Store release, no iOS version.
- No embedding of the WireGuard library or key material in this app (that is the "harder way", deliberately not chosen).
- No change to the Gordonite server or web client beyond, at most, docs.
- No offline mode or push notifications in v1.

## 2. Chosen approach ("the easy way")

A small native Android app that is **a full-screen WebView plus a VPN switch**:

- The VPN itself is the **official WireGuard Android app**, already installed and already holding the tunnel and keys.
- Our app only **tells WireGuard to switch a named tunnel on or off**, using WireGuard's documented remote-control broadcast intents.
- Our app contains **no WireGuard key, no server password, no assistant token**.

```
 [ Gordonite Android app ]                     [ WireGuard app ]
   onStart  --SET_TUNNEL_UP (tunnel "home")-->   brings tunnel up
   poll  GET <server>/api/health  until ok
   show WebView(<server URL>)
   onStop (after grace delay)
            --SET_TUNNEL_DOWN-->                 brings tunnel down
```

## 3. How WireGuard remote control works (facts to verify first)

These come from the open-source WireGuard Android app; **verify every item on the real device in Phase 0 before relying on it**:

- In the WireGuard app: Settings → **Allow remote control intents** must be switched on. (There is also an optional key field in that setting; if used, the caller must send it.)
- Broadcast actions (sent to package `com.wireguard.android`):
  - `com.wireguard.android.action.SET_TUNNEL_UP`
  - `com.wireguard.android.action.SET_TUNNEL_DOWN`
  - `com.wireguard.android.action.REFRESH_TUNNEL_STATES`
- Extra: `tunnel` (string) = the tunnel's name exactly as shown in WireGuard.
- Receiver: `com.wireguard.android.model.TunnelManager$IntentReceiver`.
- The calling app declares `<uses-permission android:name="com.wireguard.android.permission.CONTROL_TUNNELS"/>`. Check on the device whether this is granted automatically or needs a prompt.
- The tunnel must have had its **VPN permission granted once** (turning it on manually once inside WireGuard does this).
- WireGuard sends **no "tunnel is up" callback** to callers, so the app must work out readiness itself (see 5.2).

## 4. Components

New top-level folder `android/` (own Gradle project, ignored by the Node build and Docker image; confirm `.dockerignore`/`Dockerfile` do not copy it).

| Piece | Responsibility |
| --- | --- |
| `MainActivity` | Hosts the WebView. Drives the connect and disconnect logic from lifecycle callbacks. |
| `VpnController` | Sends the WireGuard intents; remembers whether *we* turned the tunnel on. |
| `ReachabilityChecker` | Calls `GET <server>/api/health` with a short timeout; used to decide "need VPN?" and "VPN is ready". |
| `SettingsActivity` (simple) | Server URL (default `http://192.168.1.50:8082`), WireGuard tunnel name, grace delay, "Only use VPN when home isn't reachable" toggle. Stored in `SharedPreferences`. |
| Status overlay | "Connecting VPN…", "Can't reach Gordonite", Retry and Settings buttons. |
| Network security config | Allows cleartext HTTP (the server is plain HTTP on the LAN; traffic is inside WireGuard when remote). |

Language: Kotlin. `minSdk` 26 (Android 8), `targetSdk` current stable. No third-party libraries beyond AndroidX (`appcompat`, `webkit`). Aim for well under 1 MB.

## 5. Behaviour in detail

### 5.1 Cold start / returning to the app (`onStart`)

1. Read settings. If the server URL or tunnel name is unset, open Settings.
2. Show the status overlay "Checking connection…".
3. **Probe first**: request `/api/health` with a ~2 s timeout.
   - Reachable (on home Wi-Fi, or the VPN is already up) → load the WebView straight away. **Do not touch the VPN**, and record `weTurnedItOn = false`.
   - Not reachable → continue.
4. Send `SET_TUNNEL_UP`, record `weTurnedItOn = true`.
5. Poll `/api/health` every ~500 ms, up to ~15 s. When it answers, load the WebView. On timeout show "Can't reach Gordonite" with **Retry**, **Open WireGuard** and **Settings**.

### 5.2 Why polling and not a callback

WireGuard gives no result, and `REFRESH_TUNNEL_STATES` only asks WireGuard to update its own UI. Reachability of the real server is also the thing that actually matters, so it is the right readiness signal.

### 5.3 Leaving (`onStop`)

1. If `weTurnedItOn` is false → do nothing.
2. Otherwise wait a **grace delay** (default 20 s, configurable, 0 = immediate), then send `SET_TUNNEL_DOWN` and clear the flag.
3. If the user returns before the delay ends, **cancel** the pending disconnect (so quickly switching apps does not bounce the VPN).

**Open design problem (needs critique):** once the activity is stopped, Android may freeze the process, so a `Handler.postDelayed` can fire late or never. Candidate solutions:
- (a) Disconnect immediately in `onStop`, no grace delay. Simplest, most reliable, slightly annoying when switching apps.
- (b) Start a short-lived **foreground service** for the grace period (reliable, but shows a notification and needs foreground-service permission/type on newer Android).
- (c) `AlarmManager` exact/inexact alarm to a `BroadcastReceiver` that sends `SET_TUNNEL_DOWN` (works without a notification; inexact alarms can be delayed by Doze).
Recommendation to evaluate: **(a) for v1**, with (c) as an option if immediate disconnect proves irritating.

### 5.4 Other leave and exit paths

- Back button at the WebView root → `finish()` → `onStop` path above.
- Swipe away from recents → `onStop`/`onDestroy` normally run first; if the process is killed outright the VPN may stay up (accepted limitation, see section 9). Mitigations: a persistent "Disconnect VPN" action, and on next launch if `weTurnedItOn` was persisted as true, send DOWN when the user chooses.
- Screen off / lock → counts as leaving (`onStop`); on unlock the app reconnects via 5.1. Confirm this is wanted.
- Rotation/resize: handle `configChanges` so it does not trigger stop/start.

### 5.5 WebView configuration

- JavaScript and DOM storage on (the web client needs both).
- Cookies persisted (the optional login password from 0.4.0 uses a 30-day cookie).
- Block navigation away from the configured origin (open other links in the system browser).
- File uploads/downloads: check whether the web client uses them; if so add a file chooser and download handler.
- No remote debugging in release builds. Safe-browsing and mixed-content defaults left on.
- Keyboard and safe-area insets so the on-screen keyboard does not cover the editor (test the note editor specifically).
- Pull-to-refresh optional; "Reload" in an overflow menu is enough for v1.

## 6. Security and privacy

- **Secrets:** the APK holds none. The WireGuard private key stays in the WireGuard app. The assistant token is never used by this app. Docs must not contain keys, tokens or passwords (`AGENTS.md`).
- **Cleartext HTTP** is acceptable only because the target is a LAN address reached directly at home or through the WireGuard tunnel. Constrain via `network_security_config.xml` to cleartext for private ranges where practical; since the host is configurable, document the limit rather than pretend it is airtight.
- **Intent trust:** WireGuard's remote-control setting means any app holding `CONTROL_TUNNELS` could switch tunnels. That is a user-level tradeoff of the setting; record it in the doc. Prefer using the optional key if WireGuard supports it for this flow.
- **Signing:** build with a release keystore kept **outside the repo** (never committed). Debug-signed APK is fine for the first device tests.
- **Backup:** set `android:allowBackup="false"`.
- **Logging:** never log URLs with credentials, cookies or note content.

## 7. Toolchain and build

This Windows machine currently has **no JDK, Android SDK or Gradle** (checked 2026-10-13). Needed:

- JDK 17, Android command-line tools (or Android Studio), platform and build-tools for the chosen `compileSdk`, Gradle via the wrapper checked into `android/`.
- Build: `./gradlew assembleRelease` → `android/app/build/outputs/apk/release/*.apk`.
- Add `scripts/build-android.ps1` that checks prerequisites and prints the APK path, in the style of the existing deploy scripts.
- Decision for reviewers: do the toolchain install and builds happen on this PC, or does the user build in Android Studio from the committed project?

## 8. Phases

| Phase | Work | Done when |
| --- | --- | --- |
| 0. Spike | On the phone, confirm the intents work using Tasker/ADB (`adb shell am broadcast ...`) with the real tunnel name; record exact behaviour, prompts and delays. | A written note of what works; go/no-go. |
| 1. Skeleton | Gradle project, WebView loading the URL, Settings screen, cleartext config. | APK installs and shows Gordonite on home Wi-Fi. |
| 2. VPN control | `VpnController`, probe-then-up flow, polling, error overlay. | From mobile data, opening the app brings the tunnel up and the page loads. |
| 3. Disconnect | `onStop` logic, cancel on return, persisted flag, manual "Disconnect". | Leaving the app drops the tunnel; returning within grace keeps it. |
| 4. Polish | Keyboard/insets, links, uploads/downloads if needed, icon, back-button behaviour. | Note editing and Tasks work comfortably. |
| 5. Docs and release | `docs/ANDROID-APP.md` (install, WireGuard setting, tunnel name, troubleshooting, recovery), README link, release-notes entry, version decision (below). | A fresh reader can install from the doc alone. |

## 9. Known limitations and risks

- Only one Android VPN can be active; turning ours on will displace any other VPN (and vice versa).
- If the app process is killed hard, the tunnel can stay up until the user turns it off in WireGuard.
- Readiness is inferred from `/api/health`; if the server is down the app cannot distinguish "VPN failed" from "server down" and says "can't reach Gordonite".
- Remote-control intents depend on WireGuard's current behaviour; a WireGuard update could change it (low risk; the interface is long-standing).
- Android battery optimisation or OEM task-killers may delay or skip the disconnect.
- WireGuard's own VPN permission dialog must have been accepted once manually.
- Sideloaded APK: Play Protect may warn, and each update is a manual install over the old one (same signing key required).
- Gordonite's own login password (if enabled) still applies; the WebView holds the cookie.

## 10. Testing

Manual device matrix (no automated Android tests in v1):

1. Home Wi-Fi, VPN off: opens, no VPN toggle, loads.
2. Mobile data, VPN off: tunnel comes up, page loads within ~15 s.
3. Mobile data, VPN already on (user turned it on): app does not turn it off on exit.
4. Leave app → tunnel drops (after grace delay); return inside delay → tunnel stays.
5. Server down: clear error, Retry works, no VPN left on after leaving.
6. Wrong tunnel name / remote-control setting off: clear message, not a hang.
7. Rotate, lock/unlock, swipe from recents, reboot with app installed.
8. Edit a note and tick a task; confirm saves persist (WebView storage, cookies).
9. Login password on: logs in once, stays logged in across launches.

Server side is untouched, so the existing Node tests are unaffected; run them once to confirm nothing else moved.

## 11. Documentation and release bookkeeping (per `AGENTS.md`)

- New `docs/ANDROID-APP.md` (setup, recovery) and an entry in `docs/RELEASE-NOTES.md`.
- No secrets, tokens, keys or personal note content in any doc or the repo.
- **Version question for reviewers:** `AGENTS.md` says every code change raises `APP_VERSION`. The Android app is separate code, so either (1) give it its own `versionName` and still bump the server/app version once (suggested: **0.5.0**, a new capability) so Settings shows a build that "has" the Android app, or (2) version the Android app independently and leave the server version alone. Needs a decision.

## 12. Open questions for the user

1. Tunnel name in WireGuard (will be entered in the app's Settings, not committed)?
2. Immediate disconnect on leaving, or a grace delay (and how long)?
3. Should locking the screen count as leaving?
4. Is the WebView wrapper enough, or is a PWA home-screen install sufficient (it cannot control the VPN, so likely not)?
5. Where is it built: this PC (needs toolchain install) or the user's Android Studio?
6. Does the user's phone run a stock or a heavily customised Android (affects background/battery behaviour)?

## 13. Suggested review prompts

- Is the probe-first logic safe (could it ever leave the VPN on, or turn off a VPN the user wanted)?
- Is the `onStop` disconnect design reliable on Android 13–15 under Doze and battery optimisation?
- Are the WireGuard intent names, extras and permission requirement still current? Cite the upstream source.
- Is cleartext HTTP handled in the least-permissive way that still works?
- What is missing from the testing and the failure handling?
- Is the scope for v1 minimal enough, and is anything here over-engineered?
