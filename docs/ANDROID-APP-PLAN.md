# Gordonite for Android: implementation plan (draft, revision 3)

Status: **plan only, nothing built yet.** Revision 1 written 2026-10-13; revisions 2 and 3 the same day, after two outside reviews (section 14).

## 1. Goal

One Android app, installed by hand as an APK, that:

1. When opened, makes sure the WireGuard VPN to home is up, then shows Gordonite.
2. When the user leaves the app, turns the VPN off again, **but only when this app is sure it turned it on and the last edit is safely saved**.

### Non-goals

- No port forwarding, public endpoint, tunnel service or `cloudflared` (forbidden by `AGENTS.md`). All access stays through the home network and WireGuard.
- No Play Store release, no iOS version.
- No embedding of the WireGuard library or key material in this app (the "harder way", deliberately not chosen).
- No offline mode or push notifications in v1.
- Server/client changes only if the save-state hook (section 5.7) needs one.

### Reliability contract (what we promise, honestly)

- **Best-effort automatic disconnect, with manual recovery.** WireGuard's remote-control interface returns no result, so "sent DOWN" never proves "tunnel is down".
- **Fail safe means VPN stays on, not off.** Anything uncertain (unknown ownership, unknown save state, no response from the page, killed process) leaves the tunnel up and tells the user, rather than risk data loss or turning off a VPN that is not ours.
- The app never *automatically* turns off a VPN unless it sent UP in the **same running session** and has seen nothing since to change that (5.1, 5.2).
- If the app is killed or the disconnect did not take effect, the VPN can stay up. That is the one acknowledged failure mode; the recovery card (5.8) is the mitigation.

## 2. Chosen approach

A small native Android app: **a full-screen WebView, a VPN switch, and a small foreground service that holds the connection open while we own it.**

- The VPN is the **official WireGuard Android app**, already installed and holding the tunnel and keys.
- Our app only **asks WireGuard to switch a named tunnel on or off** with its documented broadcast intents.
- Our app contains **no WireGuard key, no server password, no assistant token**.

```
 [ Gordonite app: activity + service ]          [ WireGuard app ]
   start  --SET_TUNNEL_UP (tunnel "<name>")-->    brings tunnel up
   poll  GET <server>/api/health  until it answers as expected
   show WebView(<server URL>), service holds the session
   leave -> wait for "nothing unsaved" -> short fixed stay-connected delay
          --SET_TUNNEL_DOWN (stored name)-->      brings tunnel down
          watch VPN state until it is observed gone
```

## 3. WireGuard remote control: verified facts and what is still unproven

Checked against the upstream source (`ui/src/main/AndroidManifest.xml`, `TunnelManager.kt`, master, 2026-10-13):

- Actions, accepted by an exported receiver `TunnelManager$IntentReceiver`: `com.wireguard.android.action.SET_TUNNEL_UP`, `SET_TUNNEL_DOWN`, `REFRESH_TUNNEL_STATES`.
- Extra `tunnel` (string) = tunnel name exactly as shown in WireGuard. An unknown name or missing extra is silently ignored.
- The receiver is protected by `<applicationId>.permission.CONTROL_TUNNELS` (official build: `com.wireguard.android.permission.CONTROL_TUNNELS`), declared **`protectionLevel="dangerous"`**: the calling app must declare it **and the user must grant it at runtime**. Plan a request flow and a clear denied state.
- `SET_TUNNEL_UP`/`DOWN` are ignored unless WireGuard Settings → **Allow remote control intents** is on. `REFRESH_TUNNEL_STATES` is not gated.
- **There is no control key**: no key or signature check. The permission is the only gate.
- **There is no result or callback**: failures only show a Toast inside WireGuard. So the app cannot tell "wrong tunnel name" from "remote control disabled" from "VPN permission never accepted"; it shows **one troubleshooting message** listing all three, not separate diagnoses.
- The tunnel needs the system VPN permission accepted once; do that manually in WireGuard first.

Still unproven until a test APK runs on the real phone (an `adb shell am broadcast` spike is **not** enough, because adb bypasses the permission model): that *our own APK* can obtain `CONTROL_TUNNELS`, how the prompt looks, that UP and DOWN work from it, and package visibility (add a `<queries>` entry for `com.wireguard.android`).

## 4. Components

New top-level folder `android/` (own Gradle project; confirm `Dockerfile` and `.dockerignore` do not copy it).

| Piece | Responsibility |
| --- | --- |
| `MainActivity` | Hosts the WebView; reports visibility to the service; shows the status overlay. |
| `ConnectionService` (foreground service; not an Android `VpnService`, WireGuard owns the VPN) | Lives for as long as we own the tunnel. Holds the process alive, owns the ownership record and all disconnect logic, shows an ongoing notification with a **Turn VPN off** action. |
| `VpnController` | Sends the WireGuard intents. |
| `VpnObserver` | `ConnectivityManager` network callback for `TRANSPORT_VPN` (normal `ACCESS_NETWORK_STATE` only): tells us when any VPN appears or disappears. |
| `ServerProbe` | `GET <server>/api/health`, short timeout, **no redirects**, validates the "expected server response" (5.4). |
| `SaveStateBridge` | `addJavascriptInterface` bridge the web client **pushes** its unsaved-edit state to (5.7). |
| `SettingsPanel` | Server URL (default `http://192.168.1.50:8082`) and tunnel name. Shown inside `MainActivity` so opening it is not "leaving". |
| Status overlay / recovery card | "Connecting VPN…", "Permission needed", "Can't reach Gordonite", "VPN left on", with **Retry / Open WireGuard / Settings / Turn VPN off**. |
| Network security config | Cleartext HTTP allowed (section 6). |

Kotlin, `minSdk` 26, `targetSdk` current stable, AndroidX `appcompat` and `webkit` only. The foreground service needs a declared type (`specialUse` with a subtype is the likely fit for a sideloaded app; verify in Phase 0a) and, on Android 13+, the notification permission (the service still runs if it is declined, the notification is just hidden; the recovery card in the activity still works).

## 5. Behaviour

### 5.1 Ownership record: states, not a boolean

Persisted, and owned by `ConnectionService`:

```
state:        NONE | OWNED | DISCONNECT_PENDING | UNCERTAIN
tunnel:       String?   // name captured when we sent UP; never re-read from Settings
sessionEpoch: Long      // random id of the process instance that sent UP
bootCount:    Int       // Settings.Global.BOOT_COUNT when UP was sent
```

- `NONE → OWNED`: only when we send UP **and** no VPN transport was active beforehand (5.2).
- `OWNED → NONE`: `VpnObserver` reports the VPN gone **without us sending DOWN** (the user turned it off). Ownership ends then; a *later* manual re-enable is never ours.
- `OWNED → DISCONNECT_PENDING`: we send DOWN. The record, including `tunnel`, **stays** until the VPN is *observed* gone, then → `NONE`.
- `DISCONNECT_PENDING` with the VPN still present after ~15 s: stay in this state, show "VPN may still be on" with **Turn VPN off** (re-sends DOWN to the stored name; idempotent).
- **Any record found at launch with a different `sessionEpoch` or `bootCount`** (process was killed, phone rebooted, app reinstalled) → **`UNCERTAIN`**. In `UNCERTAIN` the app **never sends DOWN automatically**. It shows the recovery card: "Gordonite may have switched on '<tunnel>' earlier. [Turn it off] [Leave it, it's mine/not mine]". Reason: a manually enabled tunnel could be indistinguishable from the one we started.
- Returning to the app, or a successful health check, **never** clears or recomputes ownership.
- Cleanup always uses `tunnel` from the record, never the current Settings value.

### 5.2 Start, or return to the app (`onStart`)

Order matters, because "server unreachable" does not mean "VPN off":

1. Increment **`generation`** (5.6). Cancel everything pending from the previous generation, including any disconnect timer and any save-wait.
2. Settings missing → open Settings.
3. State is `UNCERTAIN` or `DISCONNECT_PENDING` → show the recovery card, **then continue**; the user can still use the app.
4. `VpnObserver`: **a VPN is already active**
   - state `OWNED` → keep it, go to step 6.
   - otherwise → it is not ours; **do not touch it, do not claim it**. Go to step 6.
5. No VPN active:
   - `ServerProbe` OK (home Wi-Fi, direct) → load; no VPN involved; state stays `NONE`.
   - not reachable → ensure `CONTROL_TUNNELS` is granted (request it; on denial show "Permission needed"); start `ConnectionService`; send `SET_TUNNEL_UP`; state `OWNED`.
6. Poll `ServerProbe` every ~500 ms for up to ~15 s, then load the WebView. On timeout: overlay "Can't reach Gordonite" with Retry / Open WireGuard / Settings. State stays as recorded, so leaving still cleans up.

### 5.3 What counts as "leaving"

Leaving = `MainActivity` stops **and** no internal transition is in flight.

| Transition | Handling |
| --- | --- |
| Rotation or resize | `configChanges` handled; check `isChangingConfigurations`. |
| Our own Settings | Rendered inside `MainActivity` (no separate activity). |
| System file chooser, camera, permission dialogs, WireGuard permission prompt | Set `keepAlive` before launching; clear on result or after a timeout. |
| Link to another site or app | Opens in the system browser and **counts as leaving**. |
| Notification shade, short interruption | `onStop` may not fire at all; if it does, the stay-connected delay (5.5) covers it. |
| Screen lock | Counts as leaving (with the delay). Confirm in testing that this is acceptable on mobile data. |

### 5.4 "Expected server response" (compatibility, not identity)

`ServerProbe` accepts a response only if: HTTP 200, **no redirect followed**, JSON content type, body parses with `ok: true` and a `version` string.

This rejects accidental collisions (another device on the same address). It **does not prove identity**: another Gordonite or an impersonator can return the same body. Real identity needs trusted HTTPS, which is out of scope for v1. Note: when going **through WireGuard**, the far end is cryptographically authenticated by the tunnel's keys; on the direct home LAN there is no such guarantee, and traffic is cleartext HTTP, exactly as in the browser today.

### 5.5 Disconnect: execution model (decided)

**Decision:** while we own the tunnel, `ConnectionService` runs as a **foreground service**, started from the foreground activity at the moment we send UP (an allowed start). That keeps the process alive after the activity stops, so the cleanup work (waiting, timers, observing VPN state) actually executes. It also gives a visible ongoing notification with a manual **Turn VPN off**.

Flow, all inside the service, never in `onStop`:

1. Activity reports "leaving" → service records `leftAt` and starts a **fixed 15 s stay-connected delay** (a constant in v1, no setting). This avoids bouncing the VPN when switching apps briefly.
2. When the delay ends, if `generation` is unchanged **and** state is `OWNED` **and** the save state (5.7) is "nothing unsaved": send DOWN, state → `DISCONNECT_PENDING`, watch `VpnObserver` until gone (→ `NONE`) or ~15 s (→ "may still be on").
3. If the save state is "unsaved" or "unknown": **do not disconnect**. Keep the notification as "Open Gordonite to finish saving", stay `OWNED`, and let the next leave attempt try again.
4. Stop the service only when state is `NONE`.

If the foreground service cannot be started or is killed (OEM task killers, user force-stop), cleanup does not run; the contract above covers it (`UNCERTAIN` on next launch, manual card).

### 5.6 Stale work and generations

- A single integer `generation` increments on every `onStart` (and on every new "leaving").
- Every asynchronous task (stay-connected timer, save wait, post-DOWN observation) captures the generation at creation and **re-checks it immediately before acting**; a mismatch means abandon silently. DOWN is sent from exactly one code path that performs this check.
- Cancel the corresponding coroutine `Job`s on `onStart` as well; the generation check is the safety net, cancellation is the first line.
- Result: a save-check that completes after the user came back can never disconnect a resumed session.

### 5.7 Don't lose the last edit: the save-state hook

Dropping the VPN while edits are not yet **acknowledged by the server** could lose text. Definition of "unsaved": **any edit not yet acknowledged by the server**, across the whole client: note text still in a debounce timer, edits queued locally, requests in flight, items waiting for retry, and **task changes** (ticks, dismissals, due dates, creations), not just notes.

Model: **push, not pull.** The web client calls the native bridge every time its unsaved count changes (`GordoniteNative.setUnsaved(count)`) and sends a heartbeat. Native therefore always holds the latest value and never has to run JavaScript at leave time (which may be throttled once the page is hidden).

Rules:
- `count == 0` and heartbeat recent → "nothing unsaved".
- `count > 0`, **hook missing** (older client), **errors**, **no heartbeat**, or the page was never loaded → **unknown/unsaved: keep the VPN up** (5.5 step 3). Automatic disconnect therefore *requires* the hook; without it the app only offers the manual **Turn VPN off**.
- **Durable local recovery is a precondition:** unsent edits must survive the app being killed mid-save and be flushed on next load. Phase 0b must verify the client does this; if not, fixing it is part of this project (a client change: version bump and release note).

The client work (hook plus durability audit) is the main unknown size in this plan and may need to ship first, as its own change.

### 5.8 Other exits and the recovery card

- Back at WebView root → `finish()` → leaving path.
- Swipe from recents / process death: the service and its notification disappear; next launch finds a stale record → `UNCERTAIN` → recovery card.
- Reboot: `bootCount` differs → `UNCERTAIN`.
- Recovery card actions are always explicit; nothing is turned off without the user's tap when ownership is uncertain.

### 5.9 WebView

- JavaScript and DOM storage on; cookies persisted (login password cookie lasts 30 days).
- Block navigation off the configured origin.
- Upload/download handlers only if the client uses them.
- No remote debugging in release builds.
- Keyboard and insets so the editor is not covered (test the note editor specifically).
- The bridge object is exposed **only to the configured origin**, and only the narrow `setUnsaved`/heartbeat methods exist.

## 6. Security and privacy

- **No secrets in the APK or repo.** WireGuard key stays in WireGuard; no assistant token; docs never contain keys, tokens or passwords (`AGENTS.md`).
- **Cleartext HTTP, stated accurately:** WireGuard encrypts only traffic that goes through the tunnel; at home the phone talks to the server directly over the LAN in cleartext, as the browser does today. Use `network_security_config.xml` to limit cleartext where practical; the host is user-configurable, so document the limit rather than claim more.
- **Server check** is compatibility only (5.4); no identity claim.
- **Permission scope:** `CONTROL_TUNNELS` lets this app switch *any* WireGuard tunnel on or off, and with "Allow remote control intents" on, any other app granted that permission can too. Document it.
- **JavaScript bridge:** minimal surface, origin-restricted (5.9).
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
| 0a. Control spike | A **tiny test APK** (not adb) that declares `CONTROL_TUNNELS`, requests it, starts a foreground service, sends UP and DOWN for the real tunnel, and logs `VpnObserver` transitions. Also check: foreground-service type works while sideloaded, process survives after the activity stops and the screen locks. | Written result and **go/no-go** for the whole project. |
| 0b. Client audit | Read the client's save path: debounce, local queue, retry, task changes, durability across app kill. Decide the hook and any fixes. | Short note listing exactly what is unacknowledged-state in the client and the planned hook; may spawn a separate client change. |
| 1. Skeleton | Gradle project, WebView, in-activity Settings, cleartext config. | APK installs and shows Gordonite on home Wi-Fi. |
| 2. Ownership and connect | State machine (5.1), observer, probe, permission flow, overlay, foreground service. | On mobile data, opening brings the tunnel up and the page loads; with the user's own VPN already on, nothing is touched. |
| 3. Leave and recover | Leaving rules (5.3), generation guards (5.6), save-state gating (5.7), disconnect and verification, recovery card. | Test matrix (section 10) passes. |
| 4. Polish | Insets/keyboard, links, uploads if needed, icon. | Note editing and Tasks work comfortably. |
| 5. Docs and release | `docs/ANDROID-APP.md`, README link, release notes, version bump (section 11). | A fresh reader can install from the doc alone. |

## 9. Known limitations and risks

- Only one Android VPN can be active; ours displaces another and vice versa.
- A hard process kill leaves the tunnel up; recovery is manual (by design, not a bug).
- DOWN is fire-and-forget; verification is observation of the VPN transport, best-effort.
- "VPN transport active" cannot say *which* VPN; the app treats any active VPN it did not start as not its own and leaves it alone.
- Automatic disconnect depends on the web client's save-state hook; without it, only manual disconnect.
- A foreground service adds a visible notification and Android version-specific rules; OEM battery managers may kill it.
- WireGuard behaviour could change in an update (long-standing interface, low risk); re-verify after updates.
- Sideloaded APK: Play Protect may warn; updates need the same signing key.
- If Gordonite's login password is on, the WebView holds the cookie; clearing app data logs out.

## 10. Testing

Manual device matrix:

1. Home Wi-Fi, VPN off: loads direct, no VPN touched, state `NONE`.
2. Mobile data, VPN off: UP sent, page loads within ~15 s, state `OWNED`, service notification visible.
3. **User enabled WireGuard themselves, server up:** app loads, never sends DOWN.
4. **User enabled WireGuard themselves, server down:** "can't reach"; never claims or turns off the user's VPN.
5. Leave → after the delay the tunnel drops; **return, then leave again → still drops** (ownership preserved).
6. **Return during the delay, keep editing** → no disconnect (stale callbacks cannot fire).
7. Change the tunnel name in Settings while owning → DOWN still targets the stored name.
8. **Edit a note and tick a task, press Home / lock immediately, reopen:** both changes saved; VPN stays up until the unsaved count reaches 0, then drops.
9. Hook missing or page not loaded → VPN stays up and says why.
10. Open our Settings, the file chooser, a permission prompt: tunnel stays up.
11. **Kill the app while owning; turn WireGuard off and on manually; reopen:** state `UNCERTAIN`, recovery card, **no automatic DOWN**.
12. **DOWN fails** (e.g. remote control switched off mid-session): record kept, "VPN may still be on", manual retry works.
13. `CONTROL_TUNNELS` denied, remote control off, wrong tunnel name: one clear troubleshooting message, not a hang.
14. Server down on mobile data: error shown, nothing left on after leaving.
15. Different device on the same IP: unexpected response rejected, not loaded.
16. Rotate, lock/unlock, swipe from recents, force-stop, reboot.
17. Login password on: logs in once, stays logged in across launches.

Server side is unchanged unless 5.7 needs a client hook; then run the existing Node and browser tests.

## 11. Documentation and versioning (per `AGENTS.md`)

- New `docs/ANDROID-APP.md` (install, WireGuard setting, tunnel name, permission, recovery card, troubleshooting message) and a `docs/RELEASE-NOTES.md` entry. No secrets or personal note content anywhere.
- The Android project has its **own `versionName`/`versionCode`**.
- `AGENTS.md` also requires raising the application version (`APP_VERSION` in `server/app.js`, `package.json`, `package-lock.json`) with every code change. `origin/main` is **0.6.0**, so this work raises it at build time (suggested 0.7.0 as a new capability); re-check when the work starts. A separate client-side hook change would be its own version bump.

## 12. Open questions for the user

1. WireGuard tunnel name (entered in the app's Settings, not committed)?
2. Is a fixed 15 s stay-connected delay fine, or prefer none?
3. Should locking the screen count as leaving?
4. Build on this PC (toolchain install) or in Android Studio?
5. Stock or heavily customised Android (battery/background behaviour)?
6. Acceptable that the app never manages a VPN you turned on yourself, and that a killed app leaves the VPN on until you tap the recovery card?
7. Is a permanent notification while connected acceptable?

## 13. Suggested review prompts

- Can the state machine (5.1) ever turn off a VPN the user enabled, or leave ours on with no recovery path?
- Is a foreground service started from `onStart` allowed and reliable on Android 13–15 for a sideloaded app, and is `specialUse` the right type?
- Is `TRANSPORT_VPN` observation reliable for a non-VPN app?
- Does the push model for the save state cover every unacknowledged edit, including tasks and retry queues?
- Is anything here over-engineered for v1?

## 14. Review log

**Revision 3 (2026-10-13)**, second outside review:

| Review point | Change |
| --- | --- |
| Persisted ownership does not identify the current VPN | `UNCERTAIN` state; `sessionEpoch` and `bootCount`; no automatic DOWN after process death or reboot; user observed turning VPN off ends ownership (5.1). |
| Clearing on DOWN breaks recovery | `DISCONNECT_PENDING` keeps record and tunnel name until the VPN is observed gone; manual retry (5.1). |
| Background execution undecided | Decided: foreground service held while we own the tunnel; all cleanup runs there, none in `onStop` (5.5); accepted failure mode stated (section 1). |
| Save hook underspecified | Precise "unacknowledged by server" definition including tasks, push model, fail-safe on unknown, durability as precondition (5.7). |
| Health check is not identity | Renamed "expected server response"; identity needs trusted HTTPS; tunnel authenticates the far end only when going through WireGuard (5.4). |
| Stale async work | `generation` guard and job cancellation; single DOWN code path (5.6, test 6). |
| Grace-period inconsistency | Fixed 15 s stay-connected delay in the service, no setting; tests and questions updated. |
| Wrong tunnel vs remote control off | One combined troubleshooting message (section 3, test 13). |

**Revision 2 (2026-10-13)**, first outside review: ownership from observed VPN state rather than server reachability; persisted ownership and stored tunnel name; save-on-exit check; transition table for "leaving"; `CONTROL_TUNNELS` is `dangerous`, no control key exists, test APK instead of adb for the go/no-go; reliability contract; validated server response; version rule based on 0.6.0.
