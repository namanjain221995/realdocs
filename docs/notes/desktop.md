# Desktop app notes (`apps/desktop`)

_Status: 2026-11-11, after the resumption pass. Built and exercised on a headless **Linux arm64**
host only. Windows and macOS are the product targets and **nothing in this document is evidence of
behaviour on Windows or macOS**: those builds were cross-built here, are unsigned, and have never
been started._

All commands on the build server need the toolchain prefix `. scripts/dev-env.sh;` (Node 24.22.2,
pnpm 12.18.0). On a Windows or macOS machine install those two versions instead.

## Resumption status (2026-11-11)

"At resumption" is what the code and tests showed when this pass started (typecheck: 3 errors;
`vitest --project desktop`: 20 failed / 549 passed). "Now" is the state at the end of the pass.

| Item                                                         | At resumption        | Now                                                                    | Evidence                                                                                                                                                                                                     |
| ------------------------------------------------------------ | -------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1 real editor in the panel, session, bearer by main         | done                 | done                                                                   | `renderer/panel/DocumentHost.tsx` (`<DocumentEditor variant="panel">`), `useDocumentSession.ts` (`createApiClient({ credentials: 'omit' })`, `createCollabSession`); `main/auth-header.ts`; real-stack specs |
| A2 session state → header (`reportSession`)                  | done                 | done                                                                   | `useSessionReporting`; `ConnectionController.reportSession`                                                                                                                                                  |
| A3 display preferences, `--rd-doc-bg`                        | done                 | done, plus reading density                                             | `LivePanelDocument` `display`; `data-density` + `panel.css`; smoke "reading density …"                                                                                                                       |
| A4 Follow Latest, `onOpenLink` via the validated path        | done                 | done                                                                   | `onOpenLink` → `openExternal` (validated, rate-limited, gated); `test/real/live.spec.ts` Follow Latest                                                                                                       |
| A5 link helpers from `@realtimedocs/contracts`               | done                 | done                                                                   | `navigation-policy.ts`, `server-origin.ts`                                                                                                                                                                   |
| A6 real-stack tests a–i                                      | written, never green | done: 20/20 green                                                      | `test/real/*.spec.ts`, `scripts/real-stack.mjs` (results in §7)                                                                                                                                              |
| A7 attachment download rework                                | done, untested       | done                                                                   | `asset-download.ts`, `AppController.downloadAttachment`; smoke "attachment downloads"; real `files.spec.ts`                                                                                                  |
| A8 rebuild + repackage five targets, inspect, packaged check | not started          | done: 5 targets, 212 inspection checks, 39/39 packaged checks          | §7                                                                                                                                                                                                           |
| B1 panel could confirm a server change                       | partly done          | done                                                                   | no confirm channel; main-process dialog; three-layer panel policy (§3.1); tests in `ipc.test.ts`, smoke `presenter.spec.ts`                                                                                  |
| B2 tray / chip / settings agree                              | partly done          | done                                                                   | one label source (`shared/capture.ts`); `capture.test.ts` "the same label and line on all three surfaces" over every request state, kind and reason                                                          |
| B3 macOS universal without identity                          | done in code         | done in code, never executed                                           | `macSigningPlan`; @electron/packager `universal.js` signs the merged app (`signAppIfSpecified`)                                                                                                              |
| B4 notes drift                                               | not started          | done                                                                   | §4.9                                                                                                                                                                                                         |
| C "Access revoked" wording                                   | partly done          | done                                                                   | `labels.ts`, `DocumentHost.tsx`, `connection-service.ts`                                                                                                                                                     |
| D/4 taskbar and Dock omission (now on by default)            | partly done          | done (native NOT TESTED)                                               | `shared/presence.ts`, platform `applyPresence`; `presenter.test.ts` invariant table                                                                                                                          |
| E private mode default, chip, Safe Share Guide               | partly done          | done (native NOT TESTED)                                               | `shared/preferences.ts` (`capture.chosen`), `PanelHeader.tsx` `PrivacyChip`, `shared/share-guide.ts`, `ShareGuideView.tsx`                                                                                   |
| F surfaces outside the window, `parked`                      | partly done          | done (native NOT TESTED)                                               | `surfaces.ts`, `renderer/panel/surface-guards.ts`, `WindowManager.park`; smoke parked tests                                                                                                                  |
| Spec 2: vocabulary from `privacy/status.ts`                  | not started          | done                                                                   | `computeCaptureStatus` request/verification layers                                                                                                                                                           |
| Spec 2: window order, composition wait                       | not started          | done                                                                   | `WindowManager.awaitComposition`, preload frame answer, native `DwmFlush` path                                                                                                                               |
| Spec 2: tray emergency item, menu                            | not started          | done (owner's final list)                                              | `menu-model.ts` `TRAY_ITEM_LABELS`                                                                                                                                                                           |
| Spec 2: minimal permissions, forbidden words                 | not started          | done                                                                   | `presenter.test.ts`, smoke permissions test, inspection of the Windows manifest                                                                                                                              |
| Test Center wiring, old checks retired                       | not started          | done                                                                   | `PrivacyTestCenterTab.tsx`, `rdDesktop.privacy`, `CH.privacy*` (settings only)                                                                                                                               |
| Windows diagnostics module wiring                            | not started          | done (module never built)                                              | `AppController.loadNativeModule`, `WindowManager.readNativeAffinity`, `package.mjs`/`inspect-package.mjs`                                                                                                    |
| Final spec: normal window / Presenter Mode                   | not started          | done                                                                   | `window.mode`, `WindowManager.switchMode`; smoke "normal window and Private Presenter Mode"                                                                                                                  |
| Final spec: two shortcuts                                    | not started          | done                                                                   | `SHORTCUT_ACTIONS` = toggleVisibility, returnToInteractive                                                                                                                                                   |
| Final spec: Mission Control                                  | not started          | done in code (macOS NOT TESTED)                                        | darwin `panelWindowOptions` / `applyMissionControl`                                                                                                                                                          |
| Final spec: Windows installer                                | not started          | built here for x64 and arm64: built on Linux, unsigned, never executed | `build/windows/installer.nsi`, `scripts/build-installer.mjs`                                                                                                                                                 |

## 1. Commands

| Command                                                                                            | What it does                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @realtimedocs/desktop run dev`                                                      | Development build, start Electron on it, rebuild and restart on changes (own profile in `.stage/dev-profile`).                                                                                                                                                                                                    |
| `pnpm --filter @realtimedocs/desktop run build`                                                    | Development build into `dist/` (`--mode production --out <dir>` for a production build).                                                                                                                                                                                                                          |
| `pnpm exec vitest run --project desktop`                                                           | Unit tests (also `pnpm --filter @realtimedocs/desktop run test`).                                                                                                                                                                                                                                                 |
| `pnpm --filter @realtimedocs/desktop run typecheck`                                                | `tsc` over `src`, `test`, `scripts`.                                                                                                                                                                                                                                                                              |
| `pnpm exec eslint apps/desktop`, `pnpm exec prettier --check apps/desktop`                         | Lint, formatting.                                                                                                                                                                                                                                                                                                 |
| `node apps/desktop/scripts/smoke.mjs [--skip-build] [-- <playwright args>]` (`run test:smoke`)     | Playwright `_electron` smoke tests in the Playwright image under Xvfb. Call the script directly to pass options: pnpm 12 forwards a literal `--`.                                                                                                                                                                 |
| `node apps/desktop/scripts/real-stack.mjs [up\|test] [--skip-build] [-- <args>]` (`run test:real`) | The real stack: PostgreSQL `rd-desk-pg` (54440), the real server bundled from `apps/server/src` (4440), control endpoint (4449), admin created with the server CLI (`bootstrap-admin --generate`, no default password), sample seeded, `test/real/*.spec.ts` under Xvfb. Stops and removes everything at the end. |
| `run test:packaged` (`node scripts/smoke.mjs --packaged`)                                          | Starts the packaged Linux build under Xvfb and checks its hardening from outside (§7.3).                                                                                                                                                                                                                          |
| `run package` / `package:win` / `package:mac` / `package:mac:universal` / `package:linux`          | Package; `-- --platform … --arch … [--out] [--no-archive] [--no-inspect]`.                                                                                                                                                                                                                                        |
| `run package:win:installer` (`node scripts/build-installer.mjs [--arch x64,arm64] [--container]`)  | Per-user NSIS installer for the packaged Windows folders. `--container`: makensis from Debian's `nsis` package in a throw-away `rd-desk-nsis` container (Linux build host).                                                                                                                                       |
| `node scripts/build-native.mjs --arch x64\|arm64`                                                  | Windows only: builds `native/win-display-affinity` (§8.3).                                                                                                                                                                                                                                                        |
| `run inspect-package`                                                                              | Reads every build and archive in `out/` without running it. Exit 1 on any problem.                                                                                                                                                                                                                                |

Environment variables: `RD_DESKTOP_USER_DATA` (development profile; ignored when packaged),
`RD_DESKTOP_TEST_HOOK=1` (development builds only; compiled out of production),
`RD_DESKTOP_TEST_NO_TRAY`, `RD_DESKTOP_TEST_FAIL_SHORTCUTS`, `RD_DESKTOP_TEST_KEYSTORE` (with the
hook only), `RD_SMOKE_NO_SANDBOX=1` (fallback, not used for any result here), `ELECTRON_CACHE`,
`APPLE_*` / `WINDOWS_*` (signing, §8), `WINDOWS_INSTALLER_SIGN_COMMAND` (installer signing, Windows
hosts only).

## 2. Architecture

```
apps/desktop/
  src/main/          main process (one CommonJS bundle)
    controller.ts           state, tray/menus, shortcuts, displays, presence, Test Center, native module, IPC surface
    window-manager.ts       document window (presenter panel or normal window), settings, probe;
                            placement, parked fail-safe, click-through, protection + composition wait
    ipc-handlers.ts / ipc-router.ts   validated IPC; panel policy applied here (shared/panel-requests.ts)
    connection-*.ts, credential-store.ts, auth-header.ts, session-security.ts, navigation-policy.ts
    asset-download.ts, rate-limit.ts, menu-model.ts, platform/{win32,darwin,linux}.ts
    privacy/ (Test Center store and service)   native/ (Windows diagnostics loader)
  src/preload/       preload.ts: the bridge, the user-activation gate, the frame answer
  src/renderer/      panel/, settings/ (+ PrivacyTestCenterTab), privacy/ (Test Center component), shared/
  src/shared/        pure TypeScript: capture.ts, presence.ts, share-guide.ts, surfaces.ts,
                     panel-requests.ts, geometry.ts, preferences.ts, state.ts, privacy/status.ts (lead's contract) …
  build/windows/     installer.nsi        native/win-display-affinity/   N-API source (never built here)
  scripts/           build, dev, package, inspect-package, smoke, real-stack, build-installer, build-native
  test/unit  Vitest   test/smoke  Playwright _electron   test/real  real stack   test/packaged
```

The main process owns all state. Renderers receive one `AppState` snapshot; the panel's copy
(`panelView`) leaves out probe notes, displays and diagnostics. Privacy Test Center records never
travel in the state: only the settings window reads them, through `rdDesktop.privacy`.

## 3. Security model as built

Unchanged from the first pass and still enforced: `contextIsolation`, `sandbox` (+
`app.enableSandbox()`), no Node.js in pages, `webSecurity`, no `<webview>`, DevTools off when
packaged; renderer files only from `app://realtimedocs` with a per-window CSP (panel:
`connect-src` limited to the configured server, `script-src 'self'`, `frame-ancestors 'none'`;
settings and probe `connect-src 'none'`); navigation, redirects and new windows blocked; every
permission request, check, device and display-media request denied; bearer token only in the main
process, attached only to `/api/**` of the configured origin, never after a redirect; main-process
requests refuse redirects; secrets redacted from logs; fuses as listed in §7.2. The CSP, sandbox,
context isolation, origin checks and IPC validation were not loosened in this pass.

### 3.1 What the panel may ask for (finding B1 and its audit)

The defect: the panel window — the one that renders other people's document content — could send
both "open this share link" and "confirm the change of server". Page script in the panel could
therefore switch the app to another server on its own. The fix, in three layers:

1. **No confirmation channel exists.** A change of server is asked in the main process's own
   `dialog.showMessageBox` (full normalised origin of the link and of the current server; default
   and cancel button is Cancel; withdrawn after 3 minutes; a "no" blocks the same origin for 10 s;
   one question at a time). No window can see, answer or dismiss it. The panel can at most cause it
   to be asked, and only while no document is open. Unit tests: "refuses a panel sender on the
   confirm channel: there is no such channel to call", "has no channel through which a window
   could confirm a change of server" (`ipc.test.ts`); "asks before using another server …",
   "lets nothing in the panel replace an open document or the server" (`connection.test.ts`).
2. **User activation (preload, isolated world).** Every panel request that acts — window actions,
   bounds, presets, nudges, resize start, click-through, open share link, close document,
   revalidate, dismiss notice, open external link — is sent only while
   `navigator.userActivation.isActive` is true (a real click or key press in the last few
   seconds). Page script cannot create activation and cannot reach the preload. Otherwise the
   bridge answers `no_user_activation` and sends nothing. Passive requests (state, the editor's
   status report, opacity/text size, the moves of a drag a pointer press started, the badge hover)
   need none. Smoke: "page script without a click or key press can make the panel do nothing that
   acts" (`executeJavaScript(code, false)` in the panel; eight actions refused, nothing changed; a
   real click then works).
3. **The panel's state (main process, `decidePanelRequest`).** Whatever the renderer claims:
   hidden → nothing (a hidden panel cannot reveal itself); click-through → only leaving it;
   collapsed → nothing that lives in the document area (share-link field, notices, links). Unit
   tests over every window action and request in `ipc.test.ts`.

Two panel paths never pass through the preload, so the main process checks them itself: a
`window.open` / `target=_blank` link and following a link to an attachment need operating-system
input (`webContents` `input-event`: key or button) in the last 5 s, plus the interactive check.
With private mode on, a position the panel asks for stays on its own display
(`sanitizeRequestedBounds(…, stayOnDisplayOf)`), and "reset position" from the panel uses the
default spot of its own display.

Channel audit — "could hostile content in the panel gain something the reader did not ask for?":

| Panel channel                                       | Risk                                                     | Answer                                                                                 |
| --------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `state:get`, `state` events                         | read state                                               | panel copy without probe notes, displays, diagnostics; no records, no token            |
| `prefs:update` (appearance, Follow Latest, density) | cosmetic                                                 | allowed without activation; bounded by schema and sanitiser                            |
| `window:action`                                     | reveal, un-collapse, steal focus (settings), switch mode | activation + state policy; reveal refused while hidden                                 |
| `window:set-bounds`, `preset`, `nudge`, `resize-*`  | move the notes onto a shared display                     | activation (start), clamped; with private mode on kept on the current display          |
| `window:click-through`, `…-hover`                   | make the panel unclickable                               | activation; needs a recovery path; leaving always allowed                              |
| `connection:open-share-link`                        | trigger the server question, replace the document        | activation; only while no document is open; server change only via the native dialog   |
| `connection:disconnect`                             | close the document                                       | activation; keeps a signed-in editor's unsent work; never forgets local data           |
| `connection:revalidate`, `dismiss-notice`           | nuisance                                                 | activation; harmless                                                                   |
| `session:report`                                    | lie about status                                         | display only; "access ended" is only believed after the server says so                 |
| `external:open`                                     | open browser tabs                                        | activation, interactive, validated before the rate limit (1 per 700 ms, 12 per minute) |
| `security:policy-violation`                         | flood the log                                            | summary only, capped at 50 per page                                                    |
| `frame:ack`                                         | fake "drawn" early                                       | answered by the preload with a one-time nonce; page script cannot reach it             |
| privacy channels                                    | read/write records                                       | settings window only (`forbidden_window` for panel and probe)                          |

## 4. Behaviour as built

### 4.1 Two ways to show a document

- **Private Presenter Mode** (default): the transparent frameless panel. Created hidden;
  capture exclusion, always-on-top (when pinned), taskbar omission, Mission Control (macOS),
  transparency and the security options are applied before the first show and again whenever the
  window is recreated. Own resize grips, collapse, click-through, hover badge.
- **Normal window**: an ordinary framed window, in the taskbar and the Dock, never on top, never
  click-through, natively resizable; private mode applies to it as the user set it.
- Switching (panel "More" menu, macOS Panel menu, Settings → Behaviour) keeps the open document
  and its credential: no new link, no sign-in, no new exchange. The new window opens its own live
  connection with a fresh 60 s ticket. Refused while changes have not reached the server. Each
  mode keeps its own bounds (`window.bounds` / `documentWindow.bounds`).

### 4.2 Private mode (capture exclusion) and its status

- **On by default** for fresh preferences. `capture.chosen` records that "off" was the user's
  decision; such an "off" survives every later load and migration. A version 1 file could not
  record a decision (its "off" was the default) and is read as on; the Safe Share Guide opens on
  the first start after the update and explains it.
- **Request layer** (labels verbatim from `PROTECTION_STATUS_LABELS`, the lead's contract):
  `unsupported` (Linux, browser), `unavailable` (Windows before 10 2004 / affinity `monitor`: "this
  Windows version replaces the window with a black area"; or a window not yet drawn since the
  request), `off`, `request_failed` (error, read-back disagrees, affinity `none` or a read error),
  `os_accepted`. Today's finer kinds (`macos_screencapturekit`, `windows_build_unknown`, …) are the
  detail text under the label. The same label and line on the chip, the tray tooltip, the macOS
  Panel menu and Settings.
- **`os_accepted` needs one composition.** After a show (or a changed request) the window is
  pending until it was drawn: without the diagnostics module the preload answers after two
  animation frames, plus 100 ms; on Windows with the module, `DwmFlush` and then
  `GetWindowDisplayAffinity`. `isContentProtected()` only feeds this; it is never shown as proof.
- **Verification line** (only under `os_accepted`): "Manual verification required", or "Verified
  for N configurations — see Privacy Test Center" counted from Test Center records of this
  computer with protection on; warnings for expired ones (`PROTECTION_STATUS_LABELS.verification_expired`
  with a count) and for verified tests in which the other participant still saw the panel.
- **macOS:** `MACOS_WHOLE_DISPLAY_WARNING` verbatim on every macOS setup (chip explanation, Safe
  Share Guide, Settings); with one display also "Sharing your entire screen on this Mac will
  include this panel. …".
- Linux: the switch stays usable; the preference still drives neutral titles and the display
  fail-safe.

### 4.3 Taskbar and Dock omission

On by default in Presenter Mode; Settings → Behaviour → "Show in the taskbar" / "Show in the
Dock" opts back in. Windows: `skipTaskbar` only while the tray icon or a global shortcut exists.
macOS: `app.setActivationPolicy('accessory')` only while the menu-bar item exists (without the
Dock it is the only way to Settings and Quit), else `regular`. The application menu stays set so
Command editing shortcuts keep working (NOT TESTED). If the last way back disappears, the app
returns to the taskbar / Dock and says so. A normal window is always listed. Separate from private
mode in the UI and in the wording.

### 4.4 Tray (Windows) / menu-bar (macOS) menu and shortcuts

Exactly: Show, Hide, Return to interactive mode, Click-through Mode, Reconnect, Privacy Test
Center, Settings, Quit. "Return to interactive mode" (contract string) is the emergency item and
is always enabled: it leaves click-through, un-parks, un-collapses, shows, raises and moves the
panel fully on screen. Two configurable global shortcuts: show/hide (`Ctrl+Alt+Shift+D`,
`Cmd+Option+Shift+D`) and the emergency return (`Ctrl+Alt+Shift+T`, `Cmd+Option+Shift+T`); each
reports its own registration failure in Settings. Click-through, hiding and omission each need a
way back (tray or either shortcut; macOS omission: the menu-bar item).

### 4.5 Safe Share Guide

The contract's four steps verbatim and numbered (step 4 opens Settings → Privacy Test Center), then
one paragraph for the platform (Windows: requested / off / black area; macOS: the whole-display
warning, plus the single-display hint; Linux: no documented control), then three notes (own
screenshots, camera, OS-drawn surfaces). Shown in the panel on first start, reopened from the
privacy chip, the panel menu, the macOS Panel menu and Settings → Privacy & Capture.

### 4.6 Surfaces outside the window

With private mode on the native window title and the tray tooltip never name the document
(`RealtimeDocs`, plus status words); the page title is neutral too; the save dialog for an
attachment proposes `attachment.<ext>`. The panel strips every `title` attribute as it appears
(keeping an `aria-label`) and blocks native `<select>` popups; it uses DOM tooltips and menus. The
only OS notification is the parked notice, without document content. Known limits: input-method
candidate windows, drag images, the save and server dialogs themselves are drawn by the OS.

### 4.7 Display removed while private mode is on (`parked`)

`decideDisplayChange`: if the panel would end up on another display — its display was removed,
the OS moved it, or the saved display is missing at start — it is hidden instead (collapsed with a
neutral strip if nothing could bring it back; a normal window is minimised), and "Notes display
disconnected — panel hidden so it is not shared. Click to show." appears as an OS notification
(where supported) and in the tray tooltip. Display events, a document arriving or a notice never
bring it back; only the user does (Show, the emergency item or shortcut, starting the app again,
clicking the notification). Same-display corrections (resolution, scale, renumbered ids) are not
parking.

### 4.8 Privacy Test Center and the diagnostics module

Settings → **Privacy Test Center** (its own tab, named exactly so; step 4 of the guide links to it)
renders the second agent's component. Records are stored by the main process in
`<userData>/privacy` (one validated JSON file each; bad files quarantined), stamped with the
detected OS, Electron and app version; export uses the main process's own save dialog and the page
learns only `{ saved }`. The retired preferences-based "Checks you performed" form and its
channels were removed, not migrated (no real users yet). The Windows module is loaded at start
(hash-checked against `native-manifest.json` inside the asar), used only by the main process,
never exposed over IPC; Diagnostics shows present + first 12 hex digits of its SHA-256, or the
reason, the raw affinity and whether composition is enabled; otherwise "Diagnostics module not
present — status from Electron only".

### 4.9 Corrections to the first-pass notes (B4)

- The first start calls `showPanel({ focus: true })` (a start the user asked for). Remote edits
  never focus, show, raise or un-collapse the panel; `onReveal` (a document opened by the user, a
  rejected link) never un-parks or moves it.
- `revealForRemoteActivity` does not exist (any more).
- `canHide()` = tray or a shortcut or a visible Dock icon (not when the Dock icon is hidden).
- The "Not live yet" label is gone: the header says "Connecting" until the editor reports.
- The server sends `Cross-Origin-Resource-Policy: cross-origin` on asset responses, so images
  load in the panel.

## 5. Default shortcuts

Global (configurable in Settings → Behaviour & Shortcuts; each reports its own registration
failure there):

| Action                                 | Windows (and Linux) | macOS                |
| -------------------------------------- | ------------------- | -------------------- |
| Show or hide the panel                 | `Ctrl+Alt+Shift+D`  | `Cmd+Option+Shift+D` |
| Return to interactive mode (emergency) | `Ctrl+Alt+Shift+T`  | `Cmd+Option+Shift+T` |

Stored as Electron accelerators. Three modifiers so the defaults collide neither with AltGr typing
nor with editing shortcuts; AltGr combinations, `Command` outside macOS, `Super` on Windows, a
missing modifier and reserved system chords are rejected by the recorder. The pin and
click-through shortcuts of the first pass are retired (an old preference file's entries for them
are ignored). Panel keyboard commands while it has focus (not global): `Ctrl+Alt+Shift`
(`Control+Option+Shift` on macOS) + arrows resize, + `1`…`5` presets, + `0` reset position, + `C`
collapse; never during IME composition.

## 6. Documented platform facts

Quoted from the Electron repository at tag `v45.2.3`, from the typings installed with
`electron@45.2.3` (`node_modules/electron/electron.d.ts`, generated from the API documentation),
and from Microsoft's API reference. Read on 2026-11-10/11.

### Minimum operating systems

- `README.md`, "Platform support"
  (<https://github.com/electron/electron/blob/v45.2.3/README.md#platform-support>):
  > macOS (Ventura and up): Electron provides 64-bit Intel and Apple Silicon / ARM binaries for macOS.
  >
  > Windows (Windows 10 and up): Electron provides `x64` (`amd64`) and `arm64` binaries for Windows.
- `docs/breaking-changes.md`, 44.0 (<https://www.electronjs.org/docs/latest/breaking-changes>):

  > Older versions of Electron will continue to run on Monterey, but macOS 13 (Ventura) or later
  > will be required to run Electron v44.0.0 and higher.

  > Electron no longer publishes prebuilt binaries for 32-bit platforms: Windows x86
  > (`win32-ia32`) and Linux ARM (`linux-armv7l`).

  and, 23.0: "Windows 10 or later will be required to run Electron v23.0.0 and higher."

- Observed in the packaged macOS bundles: `LSMinimumSystemVersion` is `13.0`.
- Support window (<https://www.electronjs.org/docs/latest/tutorial/electron-timelines>): "The
  latest three _stable_ major versions are supported by the Electron team." The release schedule
  page (<https://releases.electronjs.org/schedule>) listed 45.0.0 as stable on 2026-10-20 with a
  tentative end of life on 2027-04-27 (Chromium M156, Node.js 24.22.0).

So the supported targets are **Windows 10 or later (x64, arm64)** and **macOS 13 or later (Intel,
Apple Silicon)**. Capture exclusion additionally needs Windows 10 version 2004 (build 19041).

### Transparent windows

`docs/tutorial/custom-window-styles.md`, "Limitations"
(<https://www.electronjs.org/docs/latest/tutorial/custom-window-styles#limitations>):

> - You cannot click through the transparent area.
> - Transparent windows are not resizable. Setting `resizable` to `true` may make a transparent
>   window stop working on some platforms.
> - The CSS `blur()` filter only applies to the window's web contents, so there is no way to apply
>   blur effect to the content below the window (i.e. other applications open on the user's
>   system).
> - The window will not be transparent when DevTools is opened.
> - On _Windows_: Transparent windows can not be maximized using the Windows system menu or by
>   double clicking the title bar.
> - On _macOS_: The native window shadow will not be shown on a transparent window.

`BaseWindowConstructorOptions.transparent`: "Makes the window transparent. Default is `false`. On
Windows, does not work unless the window is frameless."

Consequences in this app: the panel is frameless with `resizable: false` and resizes itself;
whole-window click-through is a separate explicit mode; there is no blur of what is behind the
panel, only alpha, outline and scrim; the probe window exists to test native resizing per machine.

### Content protection (capture exclusion)

`BrowserWindow.setContentProtection(enable)`
(<https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable-macos-windows>),
platforms `darwin`, `win32`:

> Prevents the window contents from being captured by other apps.
>
> On Windows, it calls `SetWindowDisplayAffinity` with `WDA_EXCLUDEFROMCAPTURE`. For Windows 10
> version 2004 and up the window will be removed from capture entirely, older Windows versions
> behave as if `WDA_MONITOR` is applied capturing a black window. The change takes effect with the
> next desktop composition, not when the call returns, so a capture started immediately afterwards
> can still contain the window.
>
> Protection also applies in a Windows remote session. A Remote Desktop client still shows the
> window to the remote user, but remote access software that works by capturing the desktop
> cannot. […]
>
> On macOS, it sets the `NSWindow`'s `sharingType` to `NSWindowSharingNone`. Unfortunately, due to
> an intentional change in macOS, newer Mac applications that use `ScreenCaptureKit` will capture
> your window despite `win.setContentProtection(true)`.

Microsoft, `SetWindowDisplayAffinity`
(<https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity>):

> `WDA_EXCLUDEFROMCAPTURE` 0x00000011 — The window is displayed only on a monitor. Everywhere
> else, the window does not appear at all. […] Introduced in Windows 10 Version 2004.

> […] it works only when the Desktop Window Manager(DWM) is composing the desktop.

> It is important to note that unlike a security feature or an implementation of Digital Rights
> Management (DRM), there is no guarantee that using SetWindowDisplayAffinity and
> GetWindowDisplayAffinity, and other necessary functions such as DwmIsCompositionEnabled, will
> strictly protect windowed content, for example where someone takes a photograph of the screen.

> Starting in Windows 10 Version 2004, WDA_EXCLUDEFROMCAPTURE is a supported value. Setting the
> display affinity to WDA_EXCLUDEFROMCAPTURE on previous version of Windows will behave as if
> WDA_MONITOR is applied.

The window must be "a top-level window" that "must belong to the current process"; the app only
ever calls this on its own windows and never touches another application.

Consequences in this app (contract labels, §4.2): Windows 10 2004+ is "OS protection accepted"
only after the call succeeded, the read-back agrees and the window was drawn once since; older
Windows is "Protection unavailable" (the OS replaces the window with a black area); macOS is
"OS protection accepted" as a best-effort request, always with the whole-display warning; Linux is
"Unsupported".

### Other documented behaviour the code depends on

- `setIgnoreMouseEvents(ignore, { forward })`: `forward` is `@platform darwin,win32`. "On Windows,
  `forward: true` stops working temporarily when the active window is running at a higher
  integrity level (e.g., elevated/Administrator) than your Electron app." Hover recovery is
  therefore not the only way back, and does not exist on Linux.
- `setVisibleOnAllWorkspaces`: "This API does nothing on Windows." On macOS the call switches the
  process between a regular and a UI-element application by default, which "will hide the window
  and dock for a short time every time it is called"; the documented option
  `skipTransformProcessType: true` leaves the process type alone for a window that already runs as
  a UI-element application — used while the app runs with the `accessory` policy.
- `app.setActivationPolicy(policy)` (macOS): "'accessory' - The application doesn't appear in the
  Dock and doesn't have a menu bar, but it may be activated programmatically or by clicking on one
  of its windows."
- `setSkipTaskbar(skip)`: "Makes the window not show in the taskbar." `setHiddenInMissionControl`
  (macOS) and the constructor option `hiddenInMissionControl` exist in the installed typings.
- `showInactive()`: "Shows the window but doesn't focus on it. Not supported on Wayland (Linux)."
- `globalShortcut.register`: "When the accelerator is already taken by other applications, this
  call will silently fail. This behavior is intended by operating systems, since they don't want
  applications to fight for global shortcuts." The app therefore checks the return value and
  `isRegistered` and reports failures.
- `safeStorage` (`docs/breaking-changes.md`, 45.0): "The synchronous `safeStorage` methods are
  deprecated and will be removed in Electron 46". The app uses only the asynchronous methods.
- Sandboxed preload (`docs/tutorial/sandbox.md`): `require` "can only load the `electron` module"
  and "No Node.js built-in modules or Node.js globals such as `Buffer` or `setImmediate` are
  available." (`docs/tutorial/esm.md`): "Sandboxed preload scripts are run as plain JavaScript
  without an ESM context." Hence one bundled CommonJS preload file.
- Fuses (`docs/tutorial/fuses.md`): `nodeCliInspect` — "When disabled, it also ensures that
  `SIGUSR1` signal does not initialize the main process inspector." `onlyLoadAppFromAsar` — by
  default Electron searches `app.asar`, `app`, `default_app.asar`; "When this fuse is enabled,
  Electron will _only_ search for `app.asar`." `cookieEncryption` — "On macOS, this fuse relies on
  the same OS-level access to the Keychain as `safeStorage`, so your app should be code signed for
  it to work correctly."
- ASAR integrity (`docs/tutorial/asar-integrity.md`): supported on "macOS as of
  `electron>=16.0.0`" and "Windows as of `electron>=30.0.0`"; "If no hash is present or if there
  is a mismatch in the hashes, the app will forcefully terminate."
- Deep links (`docs/tutorial/launch-app-from-url-in-another-app.md`): "Register an `open-url`
  listener during initial startup, before waiting for `ready` or other asynchronous
  initialization."
- Code signing (`docs/tutorial/code-signing.md`, "macOS APIs that require code signing"): for
  `safeStorage`, "Without a valid, consistent code signature, macOS may be unable to tell that two
  builds of your unsigned app are "the same app", which can cause the Keychain to prompt the user
  for permission again after every update."
- `@electron/fuses` README, "Apple Silicon": "For `arm64` macOS builds of your app, you will need
  to pass `resetAdHocDarwinSignature: true` to the `flipFuses` method if you are not immediately
  codesigning your app after flipping the fuses. Otherwise, the app will refuse to launch with
  code signature validation errors."

## 7. What was executed on this host, and what was not

Host: Linux arm64, headless, no Windows, no macOS, no `codesign`, `lipo`, `hdiutil`, `iconutil`,
`wine` or Microsoft `signtool`. Electron tests ran in Docker
(`mcr.microsoft.com/playwright:v1.64.1-noble`, `--init`, `--security-opt seccomp=unconfined` so
the Chromium sandbox stays on, Xvfb 1600×900×24, no compositor, no D-Bus, no system tray host).
All results below are from 2026-11-11 and are **Linux/Xvfb evidence only**.

### 7.1 Results

| Step                                                | Result                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @realtimedocs/desktop run typecheck` | exit 0 (0 errors)                                                                                                                                                                                                                                                                                                                                                                                                   |
| `pnpm exec eslint apps/desktop`                     | exit 0, no findings                                                                                                                                                                                                                                                                                                                                                                                                 |
| `pnpm exec prettier --check apps/desktop`           | exit 0                                                                                                                                                                                                                                                                                                                                                                                                              |
| `pnpm exec vitest run --project desktop`            | 17 files, **670 passed**, 0 failed (includes the second agent's 69 Test Center / native-loader tests)                                                                                                                                                                                                                                                                                                               |
| Xvfb smoke suite (`node scripts/smoke.mjs`)         | **64 passed**, 0 failed (55.9 s)                                                                                                                                                                                                                                                                                                                                                                                    |
| Real-stack suite (`node scripts/real-stack.mjs`)    | **20 passed**, 0 failed (58.3 s of tests). The first attempt this pass: 14 passed, 6 failed — five because the runner blocked its own control endpoint (`spawnSync`; fixed: asynchronous `spawn`), one expectation updated for the neutral attachment name. Fresh `rd-desk-pg`, fresh server bundle on 4440, administrator created with `bootstrap-admin --generate`, sample seeded; stopped and removed afterwards |
| `package:linux` (linux-arm64)                       | built on this host (native); zip 121.4 MB                                                                                                                                                                                                                                                                                                                                                                           |
| `package:win` (win32-x64, win32-arm64)              | **cross-built on Linux, unsigned, never executed on Windows**; zips 153.1 MB, 151.2 MB; native module not built                                                                                                                                                                                                                                                                                                     |
| `package:mac` (darwin-x64, darwin-arm64)            | **cross-built on Linux, unsigned, never executed on macOS**; zips 121.3 MB, 117.5 MB                                                                                                                                                                                                                                                                                                                                |
| `package:mac:universal`                             | refused on Linux (exit 1, by design: `lipo` exists only on macOS)                                                                                                                                                                                                                                                                                                                                                   |
| `inspect-package` over all five builds and zips     | **212 checks ok, 0 failed**, 14 notes (exit 0)                                                                                                                                                                                                                                                                                                                                                                      |
| `test:packaged` (packaged Linux build under Xvfb)   | **39/39** checks passed                                                                                                                                                                                                                                                                                                                                                                                             |
| `package:win:installer --container`                 | built: `out/RealtimeDocs-0.1.0-win32-x64-setup.exe` (112.2 MB, PE32+ x64 NSIS installer) and `out/RealtimeDocs-0.1.0-win32-arm64-setup.exe` (104.5 MB, PE32 x86 NSIS installer) with makensis 3.11 from Debian in a throw-away `rd-desk-nsis` container — **built on Linux, unsigned, never executed**                                                                                                              |

The Linux/Xvfb runs cover, among other things: the activation gate against page script, the
state policy (hidden panel cannot reveal itself), the parked fail-safe at start with a missing
display and its recovery by Show and by the emergency item, the Safe Share Guide (first start,
dismissal persisted, reopened from menu, chip and Settings), the "Unsupported" chip and
contract labels, neutral page / native titles and tray tooltip, no `title` / `<select>` in the
panel, the composition wait (frame answer before "drawn"), both document modes with their own
bounds, reading density, permission denial (camera, microphone, screen, notifications,
location), the Privacy Test Center (records stamped by main, refused for the panel, export via the
main dialog), and every earlier smoke check updated to the new behaviour.

What Linux cannot show even where a test passes: capture exclusion (`setContentProtection` is not
implemented on Linux; the status is "Unsupported" there), taskbar / Dock omission and the macOS
activation policy, Mission Control, the tray (no tray host), mouse-event forwarding and hover
recovery, OS notifications, Windows composition and display affinity, per-pixel compositing over
other windows, Retina scaling, IME input, real focus rules, OS key stores, deep-link registration,
signing, notarisation, the installer.

### 7.2 Inspection of the packages

`inspect-package` reads every build and zip without running it (212 checks, 0 failed):

- **Windows** `RealtimeDocs.exe` PE32+ for x64 / arm64; version resource; icon; `app.asar` with the
  expected entries (129), no `node_modules`, no source maps, no test hook; no default app; the
  embedded asar integrity hash equals the `app.asar` header hash; all fuses as listed in
  `scripts/lib/app-config.mjs`; **the application manifest asks for no administrator rights
  (`requestedExecutionLevel asInvoker`)**; **Authenticode: NOT SIGNED**; native module: not built —
  Electron-only status (no `native` directory shipped).
- **macOS** Mach-O for x64 / arm64, bundle id `com.realtimedocs.desktop`, `realtimedocs://`
  registered, `LSMinimumSystemVersion 13.0`, **no usage-description key in any of the 9
  Info.plist files** (5 removed), four helper apps, `Info.plist` asar hash matches, fuses as listed,
  framework symbolic links intact (14 links kept in the zip); **no bundle signature**. The
  cross-built `darwin-arm64` app cannot start as it is (fuses changed the ad-hoc-signed framework;
  no `codesign` here): sign it on a Mac first (§8.2).
- **Linux** ELF for arm64, same asar checks, asar integrity fuse off (Electron has none on Linux).

Packager warnings for macOS targets, both expected: the optional Icon Composer `.icon` file is
absent (the `.icns` is used), and the asar integrity digest inside the framework cannot be embedded
without `codesign` (a build made on a Mac has it).

### 7.3 The packaged Linux build, checked from outside

`test/packaged/check-packaged.mjs` starts `out/RealtimeDocs-linux-arm64/realtimedocs` under its
own Xvfb and observes log lines, processes, ports, files and the framebuffer; every "is ignored"
check has a control against the unmodified Electron binary. Observed: start-up as the app with no load failure, console error or policy violation; one
sandboxed renderer; profile in the OS location; the panel drawn; a second launch hands its link
over and exits 0; "Open in Desktop" against a stand-in server and against the real stack while it
was up; `--inspect` / `--remote-debugging-port`, `SIGUSR1`, `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`
and a planted `app` folder all ignored in the packaged build, each with a passing control.
39/39 passed. Same fuse bytes are set in the Windows and macOS binaries (7.2), which were not run.

### 7.4 NOT TESTED (everything native)

Nothing in this list was run anywhere. It is the native checklist of §9, not a formality.

- Windows: capture exclusion on 10 2004+/11 and the black area before 2004; the diagnostics
  module (never compiled); `skipTaskbar` omission and its recovery; tray behaviour; the
  installer (built here, never executed); SmartScreen; signing.
- macOS: `NSWindowSharingNone` under ScreenCaptureKit; the `accessory` activation policy (no
  Dock icon) and **Command editing shortcuts in accessory mode**; `setHiddenInMissionControl`;
  Spaces and fullscreen with `skipTransformProcessType`; menu-bar item; Keychain; ad-hoc and
  Developer ID signing, notarisation, the universal build, the `.dmg`.
- Both: the parked fail-safe on a real display change; OS notifications for the parked notice
  (Windows toasts need a Start-menu shortcut with the app's AppUserModelID, which the installer
  creates without that ID — see §12); the frame-answer timing against real compositors; normal
  window mode; every screen-share outcome (only the Privacy Test Center, with a second device,
  can say what a participant receives).

## 8. Native build, signing and notarisation

**None of the commands in this section were executed.** On a Mac without
`APPLE_SIGNING_IDENTITY` every finished app, the universal one included, is signed ad hoc
(`macSigningPlan`; @electron/packager's `universal.js` removes `osxSign` from the two halves and
signs the merged app with `signAppIfSpecified`), and `codesign --verify --deep --strict` must pass
or nothing is archived — written from the libraries' sources, never executed. The signing options were written from the
source of `@electron/packager` 20.3.0, `@electron/osx-sign` 2.7.2, `@electron/notarize` 3.1.2 and
`@electron/windows-sign` 2.1.0 as installed. Signing material is only ever read from environment
variables; nothing secret is in the repository.

Common preparation on any native host:

```sh
# Node 24.22.2 and pnpm 12.18.0 (see .node-version and "packageManager" in package.json)
pnpm install --frozen-lockfile
pnpm --filter @realtimedocs/desktop run test
```

### 8.1 Windows (x64 or arm64 host; both architectures can be built on either)

```powershell
# Unsigned, for a first look:
pnpm --filter @realtimedocs/desktop run package:win

# Signed. Either a certificate file …
$env:WINDOWS_CERTIFICATE_FILE = 'C:\path\to\certificate.pfx'
$env:WINDOWS_CERTIFICATE_PASSWORD = '<from your secret store>'
# … or, preferred for certificates on a hardware token, in the certificate store or in a
# cloud signing service, the signtool arguments that select it:
# $env:WINDOWS_SIGN_WITH_PARAMS = '/sha1 <certificate thumbprint>'
# Optional: $env:WINDOWS_TIMESTAMP_SERVER, $env:WINDOWS_SIGNTOOL_PATH, $env:WINDOWS_SIGN_HOOK_MODULE_PATH
pnpm --filter @realtimedocs/desktop run package:win

# Check:
signtool verify /pa /v apps\desktop\out\RealtimeDocs-win32-x64\RealtimeDocs.exe
Get-AuthenticodeSignature apps\desktop\out\RealtimeDocs-win32-arm64\RealtimeDocs.exe
pnpm --filter @realtimedocs/desktop run inspect-package
```

When one of the `WINDOWS_*` signing variables is set, every `.exe` and `.dll` of the package is
signed with SHA-256 and a timestamp (default server `http://timestamp.digicert.com`), and a
signing failure fails the build. With the certificate-file method the library passes the password
to `signtool` as a command-line argument, which other processes of the same user can read while
it runs; use `WINDOWS_SIGN_WITH_PARAMS` on shared build machines. Output:
`apps/desktop/out/RealtimeDocs-win32-<arch>/` and `RealtimeDocs-0.1.0-win32-<arch>.zip` (portable). The
per-user NSIS installer `RealtimeDocs-0.1.0-win32-<arch>-setup.exe` is described in §8.4. The portable
zip registers `realtimedocs://` for the current user when it first starts, so unpack it to its final
location before the first launch. An unsigned build
shows a SmartScreen warning.

### 8.2 macOS (Apple Silicon or Intel host; both architectures can be built on either)

Needs the Xcode command line tools (Xcode 13 or later for `notarytool`) and, for distribution, a
"Developer ID Application" certificate in the keychain.

```sh
# Local build without a Developer ID: the finished app is signed ad hoc (runs on this Mac only).
pnpm --filter @realtimedocs/desktop run package:mac
# The same, spelled out (APPLE_SIGNING_IDENTITY=- is treated exactly like no identity):
APPLE_SIGNING_IDENTITY=- pnpm --filter @realtimedocs/desktop run package:mac

# Distribution build: Developer ID signature, hardened runtime, notarisation, stapling.
export APPLE_SIGNING_IDENTITY="Developer ID Application: <Name> (<TEAMID>)"
# Notary credentials, one of:
#   stored once with:  xcrun notarytool store-credentials "<profile>" --apple-id <id> --team-id <TEAMID>
export APPLE_KEYCHAIN_PROFILE="<profile>"
#   or: export APPLE_ID=… APPLE_APP_SPECIFIC_PASSWORD=… APPLE_TEAM_ID=…
#   or: export APPLE_API_KEY=/path/AuthKey_XXXX.p8 APPLE_API_KEY_ID=… APPLE_API_ISSUER=…
pnpm --filter @realtimedocs/desktop run package:mac            # arm64 and x64
pnpm --filter @realtimedocs/desktop run package:mac:universal  # one app for both

# Check (repeat for each architecture):
APP=apps/desktop/out/RealtimeDocs-darwin-arm64/RealtimeDocs.app
codesign --verify --deep --strict --verbose=2 "$APP"
codesign --display --entitlements :- "$APP"      # expect only com.apple.security.cs.allow-jit
spctl --assess --type execute --verbose=4 "$APP" # expect "accepted, source=Notarized Developer ID"
xcrun stapler validate "$APP"
pnpm --filter @realtimedocs/desktop run inspect-package
```

What the script does on a Mac: fuses are set before signing; every binary is signed with the
hardened runtime and the single entitlement in `resources/entitlements.mac.plist`
(`com.apple.security.cs.allow-jit`; the signing library's defaults, which include camera,
microphone, Bluetooth, USB, location and photos, are never used); a signing failure fails the
build; with notary credentials the app is notarised and stapled; the `.zip` is made with `ditto`
after stapling, and a `.dmg` with `hdiutil`. Without notary credentials the script says
`Notarization SKIPPED`. The `.dmg` container itself is not signed or notarised by the script; to
distribute it:

```sh
DMG=apps/desktop/out/RealtimeDocs-0.1.0-darwin-arm64.dmg
codesign --sign "$APPLE_SIGNING_IDENTITY" --timestamp "$DMG"
xcrun notarytool submit "$DMG" --keychain-profile "$APPLE_KEYCHAIN_PROFILE" --wait
xcrun stapler staple "$DMG"
```

To try one of the zips that were cross-built on Linux (inspection only so far), on a Mac:

```sh
unzip RealtimeDocs-0.1.0-darwin-arm64.zip && cd RealtimeDocs-darwin-arm64
xattr -cr RealtimeDocs.app                       # only if the zip came through a browser
codesign --force --deep --sign - RealtimeDocs.app
open RealtimeDocs.app
```

A build made on the Mac itself is the better test object: it has the asar integrity digest and a
consistent signature. With an unsigned or ad-hoc build, expect a Keychain prompt when a session is
first stored and possibly again after each rebuild (see the code-signing quote in section 6);
a Developer ID build must not prompt.

### 8.3 The Windows diagnostics module (`native/win-display-affinity`)

Written by the second agent, never compiled or run (no Windows toolchain here). On Windows 10/11
with Node 24 and pnpm, Visual Studio Build Tools 2022 ("Desktop development with C++", Windows SDK
10.0.19041 or later), Python 3 and `node-gyp`:

```powershell
pnpm install
cd apps/desktop
node scripts/build-native.mjs --arch x64      # and --arch arm64 on or for ARM
# writes native/dist/win32-<arch>/display_affinity.node and display_affinity.node.sha256
```

**Signing rule:** when the Windows packages are signed, sign `display_affinity.node` with the same
certificate (signtool) **before** packaging: `package.mjs` hashes the file as it is and writes the
hash into `native-manifest.json` inside the asar (covered by asar integrity); the loader refuses a
file whose SHA-256 differs. Then `pnpm --filter @realtimedocs/desktop run package:win` copies it to
`resources/native/win32-<arch>/` (outside the asar) and `inspect-package` checks that its SHA-256
equals the manifest entry. Cross-builds from Linux have no module: no `native` directory ships and
inspection reports "native module: not built — Electron-only status". The verification steps of
`native/win-display-affinity/README.md` (affinity read-back, another process's window refused,
tampered file refused) are the native test plan for it.

### 8.4 The Windows installer

`build/windows/installer.nsi` (NSIS 3): per-user install to `%LOCALAPPDATA%\Programs\RealtimeDocs`
(`RequestExecutionLevel user`, nothing in HKLM or Program Files), Start-menu shortcut, uninstaller
listed for the user, `realtimedocs://` under `HKCU\Software\Classes` with the same command line the
app registers itself (`"…\RealtimeDocs.exe" "--" "%1"`), "Start RealtimeDocs when I sign in" off
unless ticked (HKCU Run). x64 uses the 64-bit NSIS stub; arm64 uses the x86 stub (NSIS has no ARM64
stub; Windows on ARM runs it emulated). On Windows:

```powershell
pnpm --filter @realtimedocs/desktop run package:win
$env:WINDOWS_INSTALLER_SIGN_COMMAND = 'signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /sha1 <thumbprint>'   # optional
pnpm --filter @realtimedocs/desktop run package:win:installer
```

On this host: `node scripts/build-installer.mjs --container` (built: `out/RealtimeDocs-0.1.0-win32-x64-setup.exe` (112.2 MB, PE32+ x64 NSIS installer) and `out/RealtimeDocs-0.1.0-win32-arm64-setup.exe` (104.5 MB, PE32 x86 NSIS installer) with makensis 3.11 from Debian in a throw-away `rd-desk-nsis` container — **built on Linux, unsigned, never executed**).

## 9. Manual native test checklist

Run on Windows 10 (2004 or later) and Windows 11, x64 and arm64, and on macOS 13 or later, Intel
and Apple Silicon. Record OS build, app version and the result of every line. Nothing here has
been done yet. Screen-share outcomes go into the Privacy Test Center (§10).

**Start and identity**

- [ ] First start shows the panel top-right on the primary display and the Safe Share Guide card.
      Tray icon (Windows) or menu-bar item (macOS) is present. No taskbar button (Windows) and no
      Dock icon (macOS) for the panel; Settings → Behaviour "Show in the taskbar / Dock" brings them back.
- [ ] macOS without a Dock icon (accessory): Command+C, V, X, Z, A work in the panel and in
      Settings; Command+, and Command+Q work; the panel is not in Mission Control.
- [ ] Make the tray / menu-bar item unavailable (or take both shortcuts with another app): the app
      returns to the taskbar / Dock by itself and says so.
- [ ] No permission prompt of any kind appears at any time (camera, microphone, screen recording,
      accessibility, Bluetooth, local network). macOS: the app is not listed under Privacy &
      Security → Camera / Microphone / Screen Recording after a full session.
- [ ] macOS signed build: no Keychain prompt. Windows: no SmartScreen warning for the signed build.
- [ ] Starting the app a second time shows the existing panel; no second instance stays running.

**Displays**

- [ ] Retina / HiDPI and 100 %, 125 %, 150 %, 200 % scaling: text is sharp, grips and buttons hit
      where they are drawn, the 44 px collapsed strip is fully visible.
- [ ] Two displays with different scale factors: drag the panel across; resize near the boundary;
      size and position stay as dragged, no jump.
- [ ] Put the panel on the second display, quit, unplug that display, start: the panel appears on
      a remaining display and the notice names the reason.
- [ ] Unplug the display while the app is running; change resolution and arrangement; rotate.
- [ ] Private mode on, panel on a second display, unplug that display: the panel is hidden (not
      moved onto the remaining display), the "Notes display disconnected" notice appears (OS
      notification and tray tooltip), and only Show / the emergency item / starting the app again
      brings it back. The same with private mode off: the panel moves back as before.
- [ ] Sleep and wake, lock and unlock, lid close and open with an external display: panel still
      reachable, pin and private mode still applied (Diagnostics shows the read-back).

**Window behaviour**

- [ ] Transparency: at 10 %, 50 %, 86 % and 100 % alpha over light, dark and busy backgrounds the
      text stays opaque; outline and scrim improve readability; no black or white rectangle
      behind the panel; no shadow artefacts.
- [ ] All eight resize grips with a real mouse and with a trackpad, especially **left and top
      edges** (not covered by automation); the minimum and maximum sizes hold; presets; keyboard
      commands; collapse and expand.
- [ ] Diagnostics → native resize probe: record what happens when a transparent window is resized
      by the OS on this machine.
- [ ] Pin on and off; both levels. macOS: above a fullscreen application, on every Space, in
      Mission Control and Stage Manager, with "visible on all Spaces" and "visible over fullscreen"
      on and off (note whether the Dock icon disappears, as documented). Windows: above a
      fullscreen video, a borderless fullscreen application, virtual desktops, Snap layouts.
- [ ] Hide and show by button, global shortcut and tray. Closing the panel hides it. Quit only
      from the tray or application menu, and it completes within a few seconds.
- [ ] Switch to a normal window and back (panel "More" menu): framed, in the taskbar / Dock, never
      on top, no click-through; the document stays open without a new link; each mode keeps its
      own position.
- [ ] A remote update while another application has focus: the panel appears or updates and
      **typing continues in the other application**.

**Click-through and recovery**

- [ ] Turn on click-through: clicks reach the window underneath; the indicator names the way back.
- [ ] Return by the emergency shortcut (`Ctrl/Cmd+Alt+Shift+T`), by the tray / menu-bar item
      "Return to interactive mode" (also un-collapses, shows, raises, moves fully on screen), by
      starting the app again, and by moving the pointer to the indicator strip.
- [ ] Windows: with an elevated window (Task Manager) in the foreground, hover recovery is
      expected to stop working (documented); the shortcut and the tray must still work.
- [ ] Assign the two shortcuts to another running application first: the app reports each
      conflict on its own, and with no tray available it refuses to enter click-through.
- [ ] Click-through is off again after a restart.

**Tray, Dock, menus, shortcuts**

- [ ] Windows: left click shows the panel, right click opens the menu; icon readable in light and
      dark taskbars and in the overflow area. macOS: template image readable in light and dark
      menu bars and on a notched display; Dock icon click shows the panel; application menu has
      working Undo, Redo, Cut, Copy, Paste, Select All.
- [ ] The two global shortcuts with the default bindings on US, UK, German and an Indic layout;
      AltGr typing is unaffected on Windows; rebinding in Settings; reset to defaults.
- [ ] Tray menu is exactly Show, Hide, Return to interactive mode, Click-through Mode, Reconnect,
      Privacy Test Center, Settings, Quit. The tray tooltip, the panel chip and the Privacy & Capture
      tab show the same status label ("OS protection accepted" etc.) and never the document title
      while private mode is on; the taskbar entry and Alt+Tab show "RealtimeDocs".
- [ ] Windows with the diagnostics module built and packaged: Diagnostics shows it present with its
      SHA-256 prefix and affinity `exclude_from_capture`; the README's checks of the module pass.
- [ ] Installer: install as a standard user (no UAC prompt) to `%LOCALAPPDATA%\Programs\RealtimeDocs`,
      Start-menu entry, `realtimedocs://` opens the app, autostart only when ticked, uninstall
      removes the app folder, shortcut, link handler and Run entry.

**Text input**

- [ ] IME composition (Hindi, Japanese, Chinese): composing text never triggers a window command,
      the candidate window is placed correctly over the transparent panel.
- [ ] Trackpad: two-finger scroll, momentum scrolling, pinch does not zoom the page.
- [ ] Clipboard: copy and paste with keyboard and menu; "Copy report" in Diagnostics; pasting a
      share link; the link field is cleared after a successful open.

**Links and connection**

- [ ] `realtimedocs://` link from a browser with the app running and with it closed (cold start);
      a link for another server is refused with a clear message.
- [ ] Windows: the link still works after the app folder is moved and the app started once.
- [ ] Paste a share link for the configured server and for another server (confirmation required).
- [ ] Credential storage line on the Connection tab says OS encryption (Keychain / DPAPI); the
      session survives a restart; "Disconnect" removes it.
- [ ] Server reachable only by private IP address over HTTPS, and over plain HTTP with the
      development override: note any browser-level local-network prompt or block.

## 10. Verifying what a meeting participant receives

The app can only ask the operating system to leave its own windows out of capture. Whether a
participant receives the panel depends on the OS build, the meeting application, the client and
what is shared; only a second device or participant can tell. Record every check in Settings →
**Privacy Test Center** (it stamps OS, Electron and app version itself; records expire after a
version change or 30 days). The panel then shows "Verified for N configurations — see Privacy Test
Center" under "OS protection accepted"; it never claims one configuration, and a test in which the
participant still saw the panel is shown as a warning. Procedure: share in the mode you use with
private mode off (control: the panel is expected to be visible), turn it on, wait a few seconds,
move/resize/collapse/hide/show the panel, open Settings, stop and restart the share, and record what
the second device showed each time. Repeat after every OS, meeting-app or app update.

| System                                                   | Documented expectation                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Windows 10 2004+ / 11                                    | panel absent from capture; a capture started in the same instant may still contain it |
| Windows 10 before 2004                                   | a black area where the panel is                                                       |
| Windows Remote Desktop client                            | the remote user still sees the panel                                                  |
| macOS, ScreenCaptureKit capture (current meeting apps)   | **panel is captured**                                                                 |
| Photograph of the screen, hardware grabber, phone camera | always shows the panel                                                                |

## 11. Changes outside `apps/desktop` that this pass needs (not made)

1. **`docs/capture-compatibility.md`** (lead): still points at the retired "Checks you performed"
   form; the procedure now lives in Settings → **Privacy Test Center** (a tab of that exact name,
   also step 4 of the Safe Share Guide). The lead said they will fix the doc.
2. **`docs/windows-client.md`, `docs/macos-client.md`** (lead): default global shortcuts are now
   two (`Ctrl/Cmd+Alt+Shift+D` show/hide, `Ctrl/Cmd+Alt+Shift+T` Return to interactive mode); the
   pin and click-through shortcuts are gone; the tray menu is the owner's eight items; taskbar /
   Dock omission is on by default; private mode is on by default.
3. **Server** (no change needed, confirmed by the real-stack run): CORS for `app://realtimedocs`,
   `Cross-Origin-Resource-Policy: cross-origin` on assets, no redirects in the API.

## 12. Known limits and risks

- **No native evidence** for anything in §7.4.
- **Capture exclusion is best effort by design** (Microsoft: not a security feature; Electron:
  ScreenCaptureKit ignores it on macOS). The app never says otherwise; the Test Center is the only
  source of "verified".
- **OS-drawn surfaces** are outside every window: input-method candidate windows, drag images,
  the attachment save dialog (it proposes a neutral name with private mode on, but shows the
  folder), the server-change dialog (origins only), native context menus (none are built).
- **Parked notice delivery:** an OS notification only where `Notification.isSupported()`; on
  Windows a toast may not appear without a Start-menu shortcut carrying the app's AppUserModelID
  (`com.realtimedocs.desktop`); NSIS cannot set that ID without a plug-in. The tray tooltip and the
  tray's "Show" always work.
- **Frame-answer timing:** without the Windows module, "drawn once" is two animation frames in the
  page plus 100 ms. An occluded window that Chromium stops drawing stays "Protection unavailable"
  (not yet drawn) until it is uncovered.
- **The activation gate** runs in the preload's isolated world: it stops page script, not a
  compromised renderer process; the main-process sender, schema and state checks apply regardless.
- **Mode switch** opens a new window and a new live connection (a second or two) and is refused
  while changes are unsaved.
- **Linux is a test platform only:** no capture exclusion, no omission, no hover recovery; tray
  availability cannot be detected; no `.desktop` file or URL-scheme registration is shipped.
- A packaged build ends on `SIGUSR1` (inspector fuse off); no auto-update; icons are generated
  placeholders; stock `NSAllowsArbitraryLoads` kept (Chromium does not use ATS).
- **Minimal permissions rule:** the app requests no screen-recording, microphone, camera,
  accessibility or input-monitoring permission, denies every permission request and needs no
  administrator rights. Any future feature that needs a permission must explain it in the app
  before the operating system's dialog appears, and must be added deliberately (usage-description
  key, entitlement, tests).

## 13. Distribution and updates (phase 5, 2026-11-12)

Labels: IMPLEMENTED AND VERIFIED = run on this host (Linux arm64, headless); IMPLEMENTED BUT NOT
NATIVE-TESTED = built or unit-tested here, never run on that system; CONFIGURED BUT REQUIRES CREDENTIAL.

**Artifact names.** `scripts/package.mjs` and `scripts/build-installer.mjs` write
`RealtimeDocs-<version>-<windows|macos|linux>-<x64|arm64|universal>.<ext>` (`artifactFileName` in
`scripts/lib/app-config.mjs`; the packager's folders keep `win32`/`darwin`). Linux also gets a `.tar.gz`
(inspected by `inspectTarGz`). No AppImage (needs `appimagetool`/FUSE). Old files with the previous names
were removed from `apps/desktop/out/`.

| Artifact (0.1.0)                                                                        | Result on this host                                                                                                      |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `-linux-arm64.tar.gz` (121.5 MB), `-linux-arm64.zip` (121.4 MB)                         | IMPLEMENTED AND VERIFIED: built, structure inspected (archive listing + executable bit); packaged check 39/39 under Xvfb |
| `-windows-x64.zip` (153.1 MB), `-windows-arm64.zip` (151.3 MB)                          | IMPLEMENTED BUT NOT NATIVE-TESTED: cross-built, unsigned, names and structure inspected only                             |
| `-macos-arm64.zip` (117.5 MB), `-macos-x64.zip` (121.3 MB)                              | IMPLEMENTED BUT NOT NATIVE-TESTED: cross-built, unsigned (arm64 cannot start until signed on a Mac)                      |
| `-windows-<arch>.exe` (NSIS), `-macos-<arch>.dmg`, `-macos-universal.*`, `-linux-x64.*` | not built on this host (installer needs Docker/Windows, dmg/universal need a Mac, no x64 Electron in the cache)          |
| Signing / notarisation                                                                  | CONFIGURED BUT REQUIRES CREDENTIAL                                                                                       |

Commands run: `node scripts/package.mjs --platform linux --arch arm64`, `--platform win32 --arch x64,arm64`,
`--platform darwin --arch x64,arm64` (every inspection "structure as expected"); `node scripts/smoke.mjs
--packaged` (39/39 checks passed); `node scripts/smoke.mjs` (64 passed, 56.5 s); `pnpm exec vitest run
--project desktop` (704 passed).

**Update flow.** `src/main/update-service.ts` (Electron-free, injected network/files/shell),
`src/shared/updates.ts` (state, URL allow-list, size/hash verification, channel by version),
`src/renderer/settings/UpdatesTab.tsx`. The state is part of `AppState.updates`; the panel's copy drops
the notes (`panelUpdateView`). Four IPC channels (`rd:updates:check|download|defer|open`), all
settings-window only, strict schemas (`open` takes only `show-in-folder` | `open-installer`, no path);
the panel can only take the user to Settings -> Updates (`open-settings` with tab `updates`). The check
runs 20 s after start, every 6 h, after a server change and on request; the install id is a random UUID
in `<userData>/update-state.json`. `ConnectionService.checkServer` also reports `update_required` when
the app is older than the server's `minimumSupportedClientVersion` (from `GET /api/meta`). When the
server or the update check says an update is required, the panel shows a blocking "Update required"
state (no document open) or a banner (document open), and passes
`upgrade = {label: 'Update RealtimeDocs', hint: 'Install the current version of the desktop app to edit this document.', run}`
to `<DocumentEditor>`.

Not done, by decision: silent self-replacement (needs signed builds; see decisions.md), a tray item "Check
for updates" (the tray labels are the owner's pinned specification; use Settings), resume of an
interrupted download (it restarts), a smoke test that drives the Updates tab (the existing smoke suite
still passes with the new tab; the update logic is covered by unit tests with fake network and a real
temporary directory: hash mismatch, wrong size, oversize body, redirects refused, URL allow-list,
deferral, schedule).
