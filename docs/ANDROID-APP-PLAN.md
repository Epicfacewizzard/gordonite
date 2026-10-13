# Gordonite for Android: implementation plan (draft, revision 2)

Status: **plan only, nothing built yet.** Revision 1 written 2026-10-13; revision 2 the same day, after a first outside review (see section 14).

## 1. Goal

One Android app, installed by hand as an APK, that:

1. When opened, makes sure the WireGuard VPN to home is up, then shows Gordonite.
2. When the user leaves the app, turns the VPN off again, **but only if this app turned it on**.

### Non-goals

- No port forwarding, public endpoint, tunnel service or `cloudflared` (forbidden by `AGENTS.md`). All access stays through the home network and WireGuard.
- No Play Store release, no iOS version.
- No embedding of the WireGuard library or key material in this app (the "harder way", deliberately not chosen).
- No offline mode or push notifications in v1.
- Server changes only if the save-on-exit check (section 5.6) needs a small hook in the web client.

### Reliability contract (what we promise, honestly)

- **Best-effort automatic disconnect, with manual recovery.** WireGuard's remote-control interface returns no result, so "sent DOWN" never proves "tunnel is down".
- The app will **never knowingly turn off a VPN it did not turn on**.
- If the app is killed or the disconnect did not take effect, the tunnel can stay up; the app shows this on next launch and offers a one-tap "Turn VPN off".

## 2. Chosen approach

A small native Android app that is **a full-screen WebView plus a VPN switch**:

- The VPN is the **official WireGuard Android app**, already installed and holding the tunnel and keys.
- Our app only **asks WireGuard to switch a named tunnel on or off** with its documented broadcast intents.
- Our app contains **no WireGuard key, no server password, no assistant token**.

```
 [ Gordonite Android app ]                     [ WireGuard app ]
   start  --SET_TUNNEL_UP (tunnel "<name>")-->   brings tunnel up
   poll  GET <server>/api/health  until it answers correctly
   show WebView(<server URL>)
   leave (after saves finish)
          --SET_TUNNEL_DOWN (stored name)-->     brings tunnel down
```

## 3. WireGuard remote control: verified facts and what is still unproven

Checked against the upstream source (`ui/src/main/AndroidManifest.xml`, `TunnelManager.kt`, master, 2026-10-13):

- Actions, all accepted by an exported receiver `TunnelManager$IntentReceiver`:
  `com.wireguard.android.action.SET_TUNNEL_UP`, `SET_TUNNEL_DOWN`, `REFRESH_TUNNEL_STATES`.
- Extra `tunnel` (string) = tunnel name exactly as shown in WireGuard. An unknown name or missing extra is silently ignored.
- The receiver is protected by the permission `<applicationId>.permission.CONTROL_TUNNELS` (for the official build: `com.wireguard.android.permission.CONTROL_TUNNELS`), declared with **`protectionLevel="dangerous"`**. So the calling app must declare it **and the user must grant it at runtime**; plan a request flow and a clear "permission denied" state.
- `SET_TUNNEL_UP`/`DOWN` are ignored unless WireGuard Settings → **Allow remote control intents** is on. (`REFRESH_TUNNEL_STATES` is not gated.)
- **There is no control key**: the receiver has no key or signature check. (Revision 1 wrongly mentioned an optional key; removed.) The permission is the only gate.
- There is **no result or callback**: failures only show a Toast inside WireGuard.
- The tunnel needs the system VPN permission accepted once; do that manually inside WireGuard first.

Still unproven until a test APK runs on the real phone (an `adb shell am broadcast` spike is **not** enough, because adb bypasses the permission model): that *our own APK* can obtain `CONTROL_TUNNELS`, how the prompt looks, and that UP and DOWN work from it, including on modern Android package-visibility rules (add a `<queries>` entry for `com.wireguard.android`).

## 4. Components

New top-level folder `android/` (own Gradle project; confirm `Dockerfile` and `.dockerignore` do not copy it).

| Piece | Responsibility |
| --- | --- |
| `MainActivity` | Hosts the WebView; drives connect/leave logic from lifecycle callbacks and the transition rules in 5.4. |
| `VpnController` | Sends the WireGuard intents; owns the persisted **ownership record** (5.1). |
| `VpnStateProbe` | Uses `ConnectivityManager` to ask whether *any* VPN transport is currently active (`NetworkCapabilities.TRANSPORT_VPN`). Needs only the normal `ACCESS_NETWORK_STATE` permission. |
| `ServerProbe` | `GET <server>/api/health`, short timeout, **no redirects**, validates the body (5.3). |
| `SettingsPanel` | Server URL (default `http://192.168.1.50:8082`), tunnel name, grace delay. Shown inside `MainActivity` (a dialog or fragment) so opening it is not "leaving". |
| Status overlay | "Connecting VPN…", "Permission needed", "Can't reach Gordonite", "VPN left on", with **Retry / Open WireGuard / Settings / Turn VPN off**. |
| Network security config | Cleartext HTTP allowed (see section 6). |

Kotlin, `minSdk` 26, `targetSdk` current stable, AndroidX `appcompat` and `webkit` only.

## 5. Behaviour

### 5.1 Ownership record (the core rule)

Persisted in `SharedPreferences`, never held only in memory:

```
owned: Boolean          // true only when WE sent UP and the tunnel was not already on
ownedTunnel: String?    // the tunnel name at the moment we sent UP
ownedSince: Long
```

Rules:

- Ownership is **set when we send UP** and is **only cleared when we send DOWN, or when the VPN transport is observed to be gone** (user turned it off themselves).
- **Returning to the app never clears or recomputes it.** A successful health check on return does not mean "we didn't turn it on".
- Cleanup always targets **`ownedTunnel`**, never the current Settings value, so editing Settings mid-session cannot make us turn off the wrong tunnel.
- Ownership survives process death, so a later launch can offer recovery.

### 5.2 Start, or return to the app (`onStart`)

Decide in this order (VPN state first, because "server unreachable" does not mean "VPN off"):

1. Settings missing → open Settings.
2. `VpnStateProbe`: **a VPN transport is already active**
   - We already own it (`owned == true`) → keep ownership, go to step 4.
   - We do not own it → it is the user's (or another app's). **Do not touch it, do not claim it.** Go to step 4.
3. No VPN active:
   - `ServerProbe` OK (home Wi-Fi, direct) → load the page; **no VPN involved**; `owned` stays false.
   - Not reachable → check we hold `CONTROL_TUNNELS` (request it if not; on denial show "Permission needed"); send `SET_TUNNEL_UP`; set `owned = true`, `ownedTunnel = <name>`.
4. Poll `ServerProbe` every ~500 ms, up to ~15 s, then load the WebView. On timeout: overlay "Can't reach Gordonite" with Retry / Open WireGuard / Settings. **Ownership stays as recorded**, so leaving still cleans up.

If `owned == true` but `VpnStateProbe` shows no VPN at all (user turned it off, or it never came up): clear ownership and continue from step 3.

### 5.3 Is it really our server?

A private IP does not prove identity (another Wi-Fi can reuse `192.168.1.50`). `ServerProbe` accepts a response only if:

- HTTP 200, **no redirect followed**, content-type JSON; and
- the body parses and has `ok: true` and a `version` string matching the Gordonite format (the health route returns `{ ok: true, version }`).

Anything else counts as "not our server" and is never loaded into the WebView.

### 5.4 What counts as "leaving"

The app is **leaving** only when `MainActivity` stops *and* no internal transition is in flight. These are **not** leaving:

| Transition | Handling |
| --- | --- |
| Rotation or resize | `configChanges` handled; also check `isChangingConfigurations`. |
| Our own Settings | Rendered inside `MainActivity` (no separate activity). |
| System file chooser, camera, permission dialog, WireGuard permission prompt | Set a `keepAlive` flag before launching, clear on result or after a timeout. |
| Link to another site or app | Open in the system browser **and** treat as leaving (it is a real exit). |
| Short interruption (notification shade, phone call) | `onStop` is not always called; when it is, the grace period (5.5) covers it. |

Screen lock: counts as leaving, but with the grace period. Confirm in testing that this is acceptable on mobile data.

### 5.5 Disconnect

Candidates (the reliability caveats are real; this must be tested on the phone):

- **(a) Immediate** `SET_TUNNEL_DOWN` in `onStop` when leaving. Simplest. Cannot finish in-flight saves (see 5.6).
- **(b) Short grace period** held by a short-lived foreground service. Reliable timing, but shows a notification and needs foreground-service type/permission and start-from-background rules (Android 12+ restrictions).
- **(c) Grace period via `AlarmManager`** to a receiver that sends DOWN. No notification; inexact alarms can be delayed by Doze; exact alarms need special access.

Plan: build **(a)**, gated by the save check in 5.6, and treat (b) or (c) as upgrades only if device testing shows (a) is too aggressive. On return during any grace period, cancel the pending disconnect. After sending DOWN, re-check `VpnStateProbe` a few seconds later; if a VPN transport is still present, mark "VPN may still be on" and show the recovery notice on next launch.

### 5.6 Don't lose the last edit

Dropping the VPN while a save is pending could lose the most recent text. Before sending DOWN:

1. Ask the page (`evaluateJavascript`) whether it has unsaved/unsent changes.
2. If yes, wait for it to drain, up to a cap (say 10 s), then proceed.
3. If the cap is hit, **do not drop silently**: leave the VPN up and show the "VPN left on" notice.

**Phase 0 investigation:** read how the web client saves and queues edits (it already keeps typing on-device and sends it later in some cases), and whether it exposes a "pending" signal. If not, add a tiny read-only hook to the client (this is a code change, so version bump and release note). Mandatory test: *edit a note, immediately press Home or lock the phone, reopen, verify the text is saved.*

### 5.7 Other exit paths

- Back at WebView root → `finish()` → leaving path above.
- Swipe from recents → `onStop` normally fires first; a hard process kill leaves the tunnel up and `owned` persisted, so next launch shows "VPN left on" with **Turn VPN off**.
- Phone reboot: WireGuard state after reboot is WireGuard's concern; our persisted record is reconciled by `VpnStateProbe` on launch.

### 5.8 WebView

- JavaScript and DOM storage on; cookies persisted (the optional login password uses a 30-day cookie).
- Block navigation off the configured origin.
- Upload/download handlers only if the client uses them.
- No remote debugging in release builds.
- Keyboard and insets so the editor is not covered (test the note editor specifically).

## 6. Security and privacy

- **No secrets in the APK or repo.** WireGuard key stays in WireGuard; no assistant token; docs never contain keys, tokens or passwords (`AGENTS.md`).
- **Cleartext HTTP, stated accurately:** WireGuard encrypts traffic **only when going through the tunnel**. At home the phone talks to the server directly over the LAN in cleartext HTTP, exactly as the browser does today. Use `network_security_config.xml` to limit cleartext where practical; the host is user-configurable, so document the limit rather than claim more.
- **Server identity:** validated response (5.3) and no redirects.
- **Permission scope:** `CONTROL_TUNNELS` lets this app switch *any* WireGuard tunnel on or off. Document it, and note that with "Allow remote control intents" on, any other app granted that permission can do the same.
- **Signing:** release keystore kept **outside the repo**, never committed. Debug-signed APK is fine for first tests.
- `android:allowBackup="false"`. Never log URLs with credentials, cookies or note content.

## 7. Toolchain and build

This Windows machine has **no JDK, Android SDK or Gradle** (checked 2026-10-13). Needed: JDK 17, Android command-line tools (or Android Studio), platform and build-tools, and the Gradle wrapper committed in `android/`.

- `./gradlew assembleRelease` → `android/app/build/outputs/apk/release/*.apk`.
- `scripts/build-android.ps1` checks prerequisites and prints the APK path, in the style of the existing deploy scripts.
- Decision: build on this PC (toolchain install) or in the user's Android Studio from the committed project.
- The local checkout is **behind `origin/main`**; start the work from an updated `main`.

## 8. Phases

| Phase | Work | Done when |
| --- | --- | --- |
| 0a. Permission/control spike | A **tiny test APK** (not adb) that declares `CONTROL_TUNNELS`, requests it, sends UP and DOWN for the real tunnel, and logs `VpnStateProbe` before and after. | Written result: prompt behaviour, denial behaviour, UP/DOWN reliability, VPN-transport detection. **Go/no-go for the whole project.** |
| 0b. Save-on-exit investigation | Read the client's save path; decide if a "pending changes" hook is needed. | Short note and, if needed, a minimal client hook plan. |
| 1. Skeleton | Gradle project, WebView, in-activity Settings, cleartext config. | APK installs and shows Gordonite on home Wi-Fi. |
| 2. Ownership and connect | Ownership record, `VpnStateProbe`, `ServerProbe`, permission flow, overlay. | On mobile data, opening brings the tunnel up and the page loads; with the user's own VPN already on, nothing is touched. |
| 3. Leave and recover | Transition rules (5.4), save check (5.6), disconnect, post-DOWN verification, "VPN left on" recovery. | Test matrix in section 10 passes. |
| 4. Polish | Insets/keyboard, links, uploads if needed, icon. | Note editing and Tasks work comfortably. |
| 5. Docs and release | `docs/ANDROID-APP.md`, README link, release notes, version bump (section 11). | A fresh reader can install from the doc alone. |

## 9. Known limitations and risks

- Only one Android VPN can be active; ours displaces another and vice versa.
- If the app process is killed hard, the tunnel can stay up until turned off (recovery notice and manual button mitigate this).
- DOWN is fire-and-forget; verification is via `VpnStateProbe` and is best-effort.
- "VPN transport active" cannot say *which* VPN; the app treats any active VPN it did not start as not its own and leaves it alone.
- WireGuard behaviour could change in an update (the interface is long-standing, low risk); re-verify on updates.
- OEM battery managers may delay or skip background work.
- Sideloaded APK: Play Protect may warn; updates need the same signing key.
- If Gordonite's login password is on, the WebView holds the cookie; clearing app data logs out.

## 10. Testing

Manual device matrix:

1. Home Wi-Fi, VPN off: loads direct, no VPN toggle, `owned` false.
2. Mobile data, VPN off: UP sent, page loads within ~15 s, `owned` true.
3. **User turned WireGuard on themselves, server up:** app loads, never sends DOWN, `owned` false.
4. **User turned WireGuard on themselves, server down:** app shows "can't reach", never claims or turns off the user's VPN.
5. Leave → tunnel drops; **return within grace, then leave again → still drops** (ownership preserved).
6. Change the tunnel name in Settings while owning → DOWN still targets the stored name.
7. **Edit a note, press Home / lock immediately, reopen:** the last edit is saved.
8. Open our Settings, the file chooser, a permission prompt: tunnel stays up.
9. Permission denied for `CONTROL_TUNNELS`; "Allow remote control intents" off; wrong tunnel name: each gives a clear message, not a hang.
10. Server down on mobile data: error shown, nothing left on after leaving.
11. Different network with a different device on the same IP: response rejected, not loaded.
12. Rotate, swipe from recents, force-stop, reboot: "VPN left on" recovery appears when needed.
13. Login password on: logs in once, stays logged in across launches.

Server side is unchanged unless 5.6 needs a client hook; run the existing Node tests once to confirm nothing moved.

## 11. Documentation and versioning (per `AGENTS.md`)

- New `docs/ANDROID-APP.md` (install, WireGuard setting, tunnel name, permission, recovery) and a `docs/RELEASE-NOTES.md` entry. No secrets or personal note content anywhere.
- The Android project has its **own `versionName`/`versionCode`**.
- `AGENTS.md` also requires raising the application version (`APP_VERSION` in `server/app.js`, `package.json`, `package-lock.json`) with every code change. `origin/main` is currently **0.6.0**, so this work would raise it to the next version at build time (suggested 0.7.0 as a new capability). Re-check the current value when the work starts; this checkout is behind.

## 12. Open questions for the user

1. WireGuard tunnel name (entered in the app's Settings, not committed)?
2. Disconnect immediately once saves finish, or with a grace delay (how long)?
3. Should locking the screen count as leaving?
4. Build on this PC (toolchain install) or in Android Studio?
5. Stock or heavily customised Android (affects background/battery behaviour)?
6. Is it acceptable that the app will not manage a VPN you turned on yourself?

## 13. Suggested review prompts

- Can the ownership rules in 5.1 and 5.2 ever leave a user's own VPN turned off, or ours left on without a recovery path?
- Is `TRANSPORT_VPN` visible and reliable for a non-VPN app on Android 13–15?
- Is the save check (5.6) sufficient, and what does the client actually expose?
- Are the transition rules (5.4) complete?
- Are the cleartext and identity-validation choices the least permissive that still work?
- Is anything here over-engineered for v1?

## 14. Review log

**Revision 2 (2026-10-13)**, from the first outside review. Verified against upstream WireGuard source before changing:

| Review point | Change |
| --- | --- |
| "Unreachable" is not "VPN off" | Ownership now starts from `VpnStateProbe` (any VPN transport active), not server reachability (5.2). A VPN the user turned on is never claimed or turned off. |
| Returning loses ownership | Ownership is a persisted record that returning never clears (5.1); cleanup uses the stored tunnel name. |
| Disconnect could interrupt saving | New save-on-exit check and mandatory test (5.6, test 7); Phase 0b. |
| `onStop` too broad | Explicit transition table (5.4); Settings moved inside the activity. |
| Two WireGuard assumptions wrong | `CONTROL_TUNNELS` is `dangerous` (runtime prompt, denial handling); **no control key exists**; go/no-go spike is now a test APK, not adb (sections 3, 8). |
| Disconnect reliability | Reliability contract stated; DOWN verified after the fact; manual recovery (section 1, 5.5, 5.7). |
| IP does not prove identity | Validated response, no redirects, accurate cleartext wording (5.3, 6). |
| Version decision | Android has its own version; app version bump is mandatory under `AGENTS.md` and is now 0.6.0-based (section 11). |
