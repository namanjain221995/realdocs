# RealtimeDocs Desktop on macOS

This guide is for the person who uses or sets up the RealtimeDocs desktop companion on a Mac: an
employee who reads or edits a shared document in the floating panel, or the owner who builds, signs
and hands out the app. It covers supported macOS versions and processor types, how to get a build
that macOS will start, signing and notarization, connecting to your server, the two ways a document
can open (Private Presenter Mode or a normal window), the panel, the menu-bar item and shortcuts,
Spaces, Mission Control and displays, permissions, the Keychain, capture limits, Safari as a browser
client, troubleshooting, and a checklist for testing on a real Mac.

## Verification status: NOT TESTED on macOS

Read this first. **Nothing in this guide has been run on macOS.**

- The app was built and exercised on a headless Linux server only: Electron running under Xvfb, a
  virtual display without a real window manager, a compositor, a Dock or a menu bar. Those runs are
  Linux smoke tests. They say nothing about how the app behaves on a Mac.
- The macOS packages were cross-built on that Linux server and inspected as files. They are
  unsigned and have never been started on a Mac. The Apple Silicon package cannot start as it is
  (see [Get the app](#get-the-app)). The `.dmg` and the universal build need a Mac and were not made.
- Every native behaviour described below is therefore `NOT TESTED` on macOS: the see-through
  window, click-through, the menu-bar item, the missing Dock icon, the application menu, Command
  shortcuts without a Dock icon, global shortcuts, keyboard focus, Spaces, fullscreen and Mission
  Control, several displays and Retina scaling, the fail-safe when a display disconnects, capture
  exclusion, the Keychain, registration of `realtimedocs://` links, building on a Mac, signing and
  notarization.
- **That the Mac app exists says nothing about screen capture.** On macOS the capture-exclusion
  request is best effort only: Electron documents an intentional change in macOS after which
  ScreenCaptureKit-based capture ignores it. See
  [Capture limits on macOS](#capture-limits-on-macos).

The sections below describe how the app is built to behave. The
[manual test checklist](#manual-native-test-checklist) at the end is how that gets verified. Current
project status is in [status.md](status.md), recorded test results in [testing.md](testing.md).

## Supported macOS versions and processors

The app is built on Electron 45.2.3. Electron's README for that release states:

> macOS (Ventura and up): Electron provides 64-bit Intel and Apple Silicon / ARM binaries for macOS.

(<https://github.com/electron/electron/blob/v45.2.3/README.md#platform-support>)

and its list of breaking changes, for version 44
(<https://www.electronjs.org/docs/latest/breaking-changes>):

> Older versions of Electron will continue to run on Monterey, but macOS 13 (Ventura) or later
> will be required to run Electron v44.0.0 and higher.

| Combination                                             | Status                                                                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| macOS 13 (Ventura) or later on Apple Silicon (`arm64`)  | Supported by Electron 45. Package configuration exists. `NOT TESTED`                                             |
| macOS 13 (Ventura) or later on Intel (`x64`)            | Supported by Electron 45. Package configuration exists. `NOT TESTED`                                             |
| One universal app for both processors                   | Configuration exists. It can be built on a Mac only and has not been built                                       |
| macOS 12 (Monterey) and earlier, on either processor    | **Not supported.** Electron 44 and later do not run there. The packaged app declares 13.0 as its minimum version |
| The Intel build on an Apple Silicon Mac through Rosetta | Not examined. Use the Apple Silicon build                                                                        |

Which later macOS versions behave correctly is exactly what the checklist is for; "13 or later" is
Electron's statement, not a result of this project.

Electron supports its latest three major versions. The release schedule listed version 45 as stable
on 2026-10-20 with a tentative end of support on 2027-04-27. There is no automatic update; a new
build is handed out by hand.

## Get the app

The app is `RealtimeDocs.app`, with the bundle identifier `com.realtimedocs.desktop`. It is
delivered as a `.zip` or, when built on a Mac, also as a `.dmg`. Drag it to the Applications folder
and open it once, so that macOS knows it handles `realtimedocs://` links. A Mac build is not an
installer: there is nothing to run with administrator rights, and the app asks for none.

| Form                        | File name                                                           | Where it comes from                                                               |
| --------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Zip, Apple Silicon          | `RealtimeDocs-0.1.0-darwin-arm64.zip` (117.5 MiB as built on Linux) | cross-built on the Linux server; unsigned; **cannot start until signed on a Mac** |
| Zip, Intel                  | `RealtimeDocs-0.1.0-darwin-x64.zip` (121.3 MiB as built on Linux)   | cross-built on the Linux server; unsigned; never started                          |
| Disk image (`.dmg`)         | `RealtimeDocs-0.1.0-darwin-<arch>.dmg`                              | made only on a Mac (`hdiutil`); not built yet                                     |
| One app for both processors | the universal build                                                 | made only on a Mac (`lipo`); not built yet                                        |

**Never disable Gatekeeper or System Integrity Protection for this app, and do not strip download
marks from it to get it past macOS.** If macOS refuses a build, the build is the thing to fix.

### Why the zips from the Linux server cannot simply be opened

The packaging command on the build server puts the two zips in `apps/desktop/out/`. They were
inspected as files, not run.

- **Apple Silicon (`arm64`).** Electron's Apple Silicon files come with an ad-hoc signature, that
  is, a signature without an identity. Packaging sets hardening switches inside Electron's
  framework file, which changes that file and so invalidates its signature, and Apple Silicon does
  not run code whose signature is invalid. On a Mac the packaging script signs again afterwards. On
  Linux there is no `codesign` tool, so the cross-built app is left with the invalid signature and
  an Apple Silicon Mac refuses to start it. The packaging script prints this while it runs. This is
  not something to work around: the app has to be signed on a Mac.
- **Intel (`x64`).** The cross-built Intel app carries no signature at all. Whether an Intel Mac
  starts it as it is was not tried.
- **The universal build** refuses to run on Linux by design, because merging the two apps needs
  Apple's `lipo` tool.
- **Both.** A build made on Linux lacks one of the two integrity values that a build made on a Mac
  has: it checks its application archive against the value in `Info.plist`, but the additional
  digest inside the framework file is missing, because embedding it also needs `codesign`. The
  generated application icon has not been validated with Apple's tools either.

A build made on the Mac itself is the better thing to test and the only thing to distribute.

### Build it on the Mac

Either an Apple Silicon or an Intel Mac can build both processor types. **None of the commands in
this section and the next two were executed by this project.**

You need the Xcode command line tools (Xcode 13 or later for `notarytool`), Node.js 24.22.2 (the
version in `.node-version`) and pnpm 12.18.0 (named in `package.json`; `corepack enable` makes it
available, Corepack ships with Node.js 24). Copy the repository to the Mac **without** the
`node_modules`, `dist`, `out`, `.stage` and `.toolchain` folders; those hold files built or
downloaded for the Linux server. Then, in Terminal, in the repository folder:

```sh
pnpm install --frozen-lockfile
pnpm --filter @realtimedocs/desktop run test
```

Build for local use, without a Developer ID:

```sh
pnpm --filter @realtimedocs/desktop run package:mac
```

This produces `apps/desktop/out/RealtimeDocs-darwin-arm64/RealtimeDocs.app` and the same for `x64`,
with a `.zip` and a `.dmg` each. Without a signing identity the script adds no Developer ID
signature; it restores the ad-hoc signature of the Apple Silicon app so that it can start. In the
script's own words, such a build "can run on this Mac and Gatekeeper rejects it elsewhere", which is
correct.

To run the app straight from the source tree while developing, without packaging:

```sh
pnpm --filter @realtimedocs/desktop run dev
```

### Ad-hoc signing

To have the whole bundle signed again ad hoc, so that `codesign --verify` passes, set the signing
identity to a single hyphen:

```sh
APPLE_SIGNING_IDENTITY=- pnpm --filter @realtimedocs/desktop run package:mac
```

An ad-hoc signed app runs on the Mac that built it and cannot be distributed.

The engineers' notes also describe signing one of the Linux-built zips on a Mac, to look at it
before a native build exists:

```sh
unzip RealtimeDocs-0.1.0-darwin-arm64.zip && cd RealtimeDocs-darwin-arm64
codesign --force --deep --sign - RealtimeDocs.app
open RealtimeDocs.app
```

The notes add a further step for an archive that arrived through a web browser, which removes the
download mark from the bundle. This guide leaves that step out on purpose: the mark is what makes
Gatekeeper examine a downloaded app, and removing it is a way around that examination. If macOS
refuses the signed Linux-built app, build on the Mac instead.

### Developer ID signing and notarization

This is the only form meant for other people's Macs. It needs an Apple Developer account and a
"Developer ID Application" certificate in the keychain of the build Mac.

Store the notarization credentials once, under a profile name of your choice:

```sh
xcrun notarytool store-credentials "<profile>" --apple-id <id> --team-id <TEAMID>
```

Then build, sign, notarize and staple:

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: <Name> (<TEAMID>)"
export APPLE_KEYCHAIN_PROFILE="<profile>"
pnpm --filter @realtimedocs/desktop run package:mac
```

For one app that runs on both processor types:

```sh
pnpm --filter @realtimedocs/desktop run package:mac:universal
```

Check each result:

```sh
APP=apps/desktop/out/RealtimeDocs-darwin-arm64/RealtimeDocs.app
codesign --verify --deep --strict --verbose=2 "$APP"
codesign --display --entitlements :- "$APP"
spctl --assess --type execute --verbose=4 "$APP"
xcrun stapler validate "$APP"
pnpm --filter @realtimedocs/desktop run inspect-package
```

The entitlements listing should show `com.apple.security.cs.allow-jit` and nothing else, and
`spctl` should answer "accepted" with the source "Notarized Developer ID".

The script does not sign or notarize the `.dmg` container itself. To distribute the disk image:

```sh
DMG=apps/desktop/out/RealtimeDocs-0.1.0-darwin-arm64.dmg
codesign --sign "$APPLE_SIGNING_IDENTITY" --timestamp "$DMG"
xcrun notarytool submit "$DMG" --keychain-profile "$APPLE_KEYCHAIN_PROFILE" --wait
xcrun stapler staple "$DMG"
```

### What the packaging script does, and what needs a Mac

| Step                                                   | On the Linux build server                                      | On a Mac                                                                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `RealtimeDocs.app` for `arm64` and `x64`               | Built, unsigned, not runnable as described above               | Built                                                                                                            |
| Hardening switches, removal of unused permission texts | Done                                                           | Done, before signing                                                                                             |
| Signature                                              | None possible                                                  | Ad hoc only by default; Developer ID with the hardened runtime when `APPLE_SIGNING_IDENTITY` names a certificate |
| Notarization and stapling                              | Not possible                                                   | Done when notarization credentials are in the environment; otherwise the script prints "Notarization SKIPPED"    |
| `.zip`                                                 | Made with `zip`, keeping the bundle's symbolic links           | Made with Apple's `ditto`, after stapling                                                                        |
| `.dmg`                                                 | Skipped: the tool (`hdiutil`) exists on macOS only             | Made with `hdiutil`, containing the app and a link to Applications                                               |
| Universal app                                          | Refused with an explanation: merging needs Apple's `lipo` tool | Built from the two single-processor builds                                                                       |

Two details that come from reading the script, not from running it:

- A signing failure fails the build; the script never leaves a half-signed app.
- For the universal app, set `APPLE_SIGNING_IDENTITY` (to `-` for a local build). The script
  restores the ad-hoc signature only for a single-processor Apple Silicon build that is not signed
  otherwise; for the universal app it relies on the signing step that follows the merge.

### Signing configuration

Everything is read from environment variables. Nothing secret is in the repository, and nothing
secret should be written into a script that is.

| Variable                                                           | Purpose                                                                                        |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `APPLE_SIGNING_IDENTITY`                                           | `"Developer ID Application: <Name> (<TEAMID>)"` for distribution, or `-` for ad-hoc signing    |
| `APPLE_KEYCHAIN_PROFILE`, optionally `APPLE_KEYCHAIN`              | Notarization with credentials stored by `notarytool store-credentials`                         |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`         | Notarization with an Apple ID and an app-specific password                                     |
| `APPLE_API_KEY`, `APPLE_API_KEY_ID`, optionally `APPLE_API_ISSUER` | Notarization with an App Store Connect API key (`APPLE_API_KEY` is the path of the `.p8` file) |

Use one of the three notarization sets. The app is signed with the hardened runtime and a single
entitlement, `com.apple.security.cs.allow-jit`, which the JavaScript engine needs. The signing
tool's own default entitlements, which include camera, microphone, Bluetooth, USB, location and
photos, are not used.

## Connect to your server

The app talks to one RealtimeDocs server: the one you enter. A link never changes it without asking
you.

### Set the server address

1. Open Settings with Command+, (or "Settings…" in the RealtimeDocs menu, "Settings" in the
   menu-bar item's menu, or the "More" button in the panel).
2. On the "Connection" tab, enter the address under "Server address" and choose "Save and check".
3. The status line should read "Connected to a RealtimeDocs server". Other outcomes are "Server
   could not be reached", "Not a RealtimeDocs server" and "Versions do not match".

Which address to enter:

- **A deployed server:** its HTTPS address, exactly as you see it in the browser, for example
  `https://docs.example.com`.
- **A server you reach over SSH (development):** `localhost` on the server and `localhost` on your
  Mac are two different machines. Open a tunnel from the Mac and keep that Terminal window open:

  ```sh
  ssh -L 4310:127.0.0.1:4310 you@server.example.com
  ```

  Then enter `http://127.0.0.1:4310`. Use the same address in your browser. The app never opens
  ports or starts tunnels itself.

The app accepts HTTPS addresses. Plain HTTP is accepted for `localhost` and `127.0.0.1` only. A
switch on the Connection tab, "Development: allow plain HTTP to private-network addresses", off by
default, additionally allows addresses such as `http://192.168.1.20:4310`; the document and your
session then cross that network unencrypted. Leave it off outside a test setup.

### Open a document

- **"Open in Desktop".** Open the document in your browser and choose "Open in Desktop". The
  browser asks whether it may open RealtimeDocs; allow it. The server issues a code that works once
  and for 60 seconds, and the browser hands it to the app in a `realtimedocs://` link. The app
  accepts the link only if it names the server the app is set to.
- **"Paste share link".** Copy the complete share link you were given, including the part after
  `#`, paste it into the field in the empty panel or under Settings → Connection → "Paste share
  link", and choose "Open". If the link belongs to a different server, the app asks before it
  switches, in a dialog that names both servers in full and defaults to "Cancel"; nothing shown in
  the panel can answer it. The address in the browser's address bar after you opened a share link is not a share
  link any more; paste the original one.
- **Close.** "More" → "Close document" in the panel closes the document; a signed-in editor's unsent
  changes stay on this Mac and are sent when the document is opened again, while a share-link
  guest's unsent changes are discarded (the app warns once first if changes have not reached the
  server). Settings → Connection → "Close document and forget session" ends the session on the
  server and deletes it from this Mac, together with unsent changes.

Your access is the access of the browser session or share link you came from: view only or can
edit. Administration stays in the browser.

## Connecting to a backend on another machine

The server address field is on Settings → Connection ("Server address", then "Save and check").
The app requires an HTTPS address. Plain HTTP is accepted only for loopback addresses
(`localhost` and `127.0.0.1`), which is how an SSH tunnel to a backend on a remote host appears.
A private-network address over HTTP is refused unless you turn on the development switch on that
tab; a public host over HTTP is never accepted.

`localhost` on your Mac is not `localhost` on the server. For a backend on a remote development host, open a
tunnel from the Mac with the same port numbers on both sides and keep it open, then enter
`http://127.0.0.1:4310`:

```sh
ssh -N -L 4310:127.0.0.1:4310 -L 4311:127.0.0.1:4311 user@host
```

For a deployed server, enter its HTTPS address exactly as the browser shows it. The server must list the app's origin,
`app://realtimedocs`, in `DESKTOP_ORIGINS` (it does by default). The steps and the reasons are in
[Remote development and local desktop connectivity](deployment.md#remote-development-and-local-desktop-connectivity).

## Two ways to open a document

A document opens either in **Private Presenter Mode** or in a **normal window**.

|                                          | Private Presenter Mode (the default)                                        | Normal window                            |
| ---------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------- |
| Window                                   | Frameless, see-through panel; own resize grips; left out of Mission Control | Ordinary framed window, resized by macOS |
| Dock                                     | No Dock icon while the menu-bar item exists (on by default; see below)      | Always in the Dock                       |
| On top of other windows                  | Yes while pinned (on by default)                                            | Never                                    |
| Click-through reading mode               | Available                                                                   | Never                                    |
| Private mode (capture exclusion request) | Applied as you set it (on by default)                                       | Applied as you set it                    |

Switch with "More" → "Open in a normal window" or "More" → "Switch to Private Presenter Mode" in the
panel, "Open in a Normal Window" or "Switch to Private Presenter Mode" in the Panel menu, or
Settings → Behaviour & Shortcuts → "How documents open". Switching keeps the open document and its
session: no new link, no sign-in. The new window opens its own live connection, which takes a second
or two, and the switch is refused while changes have not reached the server. Each mode remembers its
own position and size.

## Use the panel

The panel is a frameless window without a shadow, 720 × 460 at first, placed at the top right of
the main display. Its background is see-through; text and images are always drawn fully opaque.

- **Title strip.** Drag it to move the panel. It shows the document title, the private-mode status
  chip (see "Capture limits on macOS"), the connection state ("Connecting", "Live", "Reconnecting",
  "Offline", "Access expired", "Access revoked", "Update required", "Unavailable"), the save state
  ("Saved", "Saving…", "Changes pending", "Not saved") and your access ("View only" or "Can edit").
  "Saved" appears only after the server has confirmed that the change is stored. In a normal window
  the ordinary title bar moves the window.
- **Buttons in the strip:** "Reconnect now" (while reconnecting or offline), "Follow latest
  changes", "Appearance", "Click-through reading mode", "Pin on top", "Collapse to title strip",
  "More" and "Hide panel". Click-through, pin and collapse exist in Presenter Mode only. The first click on the panel while
  another application is active already reaches these buttons. "More" holds the size presets
  (Presenter Mode), "Reset position", the mode switch, "Close document", "Safe Share Guide",
  "Settings…" and "Privacy and capture…".
- **Appearance.** "Background opacity" from 10 % to 100 % (86 % at first; it changes the
  background only), "Text size" from 80 % to 180 %, "Reading density" ("Compact", "Comfortable",
  "Spacious"), "Text colour" ("Light" or "Dark"), "Reading width" ("Narrow", "Normal", "Wide",
  "Full") and "Readability aid" ("Off", "Outline", "Scrim"). These are your own preferences and never
  change the shared document.
- **Resize.** In Presenter Mode the app's own grips on all four edges and corners resize the panel,
  between 360 × 180 and 2400 × 1800, because Electron documents that see-through windows are not
  resizable by the system. Presets (also in the Panel menu under "Size"): Compact 480 × 300,
  Standard 720 × 460, Wide 960 × 460, Tall 560 × 720, Large 1040 × 680. Collapsing leaves a
  44-point title strip.
- **Pin.** On by default. Settings → Behaviour & Shortcuts → "Stay above" chooses between
  "Ordinary windows (below the Dock)" and "As high as the system allows (above the Dock)".
- **No focus stealing.** An edit from someone else updates the panel and leaves the keyboard where
  it is; it never shows, raises or expands the panel either. When you open a document yourself, the
  panel is shown without activating it.
- **Follow Latest.** Off by default. When on, the panel scrolls to new content as it arrives,
  pauses when you scroll back or select text, and offers "Jump to latest". Your scroll position is
  yours alone.

### No Dock icon in Presenter Mode

In Presenter Mode RealtimeDocs runs with macOS's `accessory` activation policy: **no Dock icon**, and
no visible menu bar of its own. This is **on by default**. Settings → Behaviour & Shortcuts →
"Taskbar and Dock" → "Show in the Dock" brings the Dock icon back. It only changes where
RealtimeDocs is listed on your own Mac; it does not change what a screen share or a recording
contains. For that, see private mode.

The rule behind it is the **recovery invariant**: without a Dock icon the menu-bar item is the only
way to Settings and Quit, so the Dock icon is left out only while the menu-bar item exists. If it
cannot be created, the app returns to the Dock by itself and says so. A normal window is always in
the Dock. The application menu stays installed even without a Dock icon so that Command+C, V, X, Z
and A keep working in the panel and in Settings; that this works in accessory mode is `NOT TESTED`.

### Click-through reading mode

In click-through mode the panel stays visible but ignores the pointer: clicks and scrolling go to
the window underneath. It is available in Presenter Mode only and is never switched on at start-up.
Every way back to interactive mode:

1. The emergency global shortcut, `Cmd+Option+Shift+T` by default.
2. The menu-bar item: **"Return to interactive mode"**. It is always enabled. It leaves
   click-through, un-parks and un-collapses the panel, shows and raises it, and moves it fully onto a
   display.
3. The Panel menu: "Return to interactive mode" (shown with its shortcut).
4. The Dock icon, when it is shown: clicking it shows the panel, interactive.
5. The badge at the top of the panel: rest the pointer on it and click "Return to interactive
   mode".
6. Opening RealtimeDocs again, for example from Launchpad or Spotlight.

Hiding the panel also ends click-through. The app refuses to enter click-through when neither the
global shortcut nor the menu-bar item is available.

## Shortcuts and menus

### Global shortcuts

They work while another application has the keyboard. There are two:

| Action                                 | Default              |
| -------------------------------------- | -------------------- |
| Show or hide the panel                 | `Cmd+Option+Shift+D` |
| Return to interactive mode (emergency) | `Cmd+Option+Shift+T` |

The pin and click-through shortcuts of earlier builds no longer exist.

To change one: Settings → Behaviour & Shortcuts → "Global shortcuts", click the key display and
press the new combination (Esc cancels). A letter or digit needs Command or Control plus at least
one more modifier. Combinations that macOS reserves, such as the screenshot shortcuts
`Cmd+Shift+3`, `4` and `5`, are refused.

If another application already owns a combination, macOS does not register it. The app notices and
shows that shortcut as "In use by another application" in Settings, with a "Retry" button. Each of
the two shortcuts reports its own failure. When you were changing a shortcut, the old one is kept
and keeps working.

### Panel commands and editing

These work only while the panel has the keyboard focus:

| Keys                              | Action                                             |
| --------------------------------- | -------------------------------------------------- |
| `Control+Option+Shift+Arrow keys` | Resize the panel in steps of 24 points             |
| `Control+Option+Shift+1` … `5`    | Size presets: compact, standard, wide, tall, large |
| `Control+Option+Shift+0`          | Reset the panel position                           |
| `Control+Option+Shift+C`          | Collapse or expand the panel                       |

Editing uses the Command key as everywhere on a Mac: Command+C, V, X, Z and A. They are provided
by the standard roles of the Edit menu, so they work in the panel and in the settings window.

### The application menu

| Menu         | Items                                                                                                                                                                                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RealtimeDocs | About RealtimeDocs, Settings… (Command+,), Services, Hide RealtimeDocs, Hide Others, Show All, Quit RealtimeDocs (Command+Q)                                                                                                                                                                                 |
| Edit         | Undo, Redo, Cut, Copy, Paste, Paste and Match Style, Delete, Select All, Speech                                                                                                                                                                                                                              |
| Panel        | Hide Panel or Show Panel, Return to interactive mode, Click-Through Mode, Pin on Top, Collapse to Title Strip or Expand, Size, Reset Position, Open in a Normal Window or Switch to Private Presenter Mode, Private Mode (Request Capture Exclusion) and its status, Safe Share Guide…, Privacy Test Center… |
| Window       | Close Window (Command+W), Bring All to Front                                                                                                                                                                                                                                                                 |

### The menu-bar item, the Dock, closing and quitting

- **The menu-bar item** is the recovery path when the panel is hidden or in click-through mode.
  Clicking it opens a menu with exactly these items: "Show", "Hide", "Return to interactive mode",
  "Click-through Mode", "Reconnect", "Privacy Test Center", "Settings" and "Quit". "Hide" is
  enabled only while the panel is visible and can be brought back, "Reconnect" only while a
  document is open. Its icon changes while click-through is on. Its tooltip shows the status words,
  and with private mode on never the document's title.
- **The Dock icon**, when it is shown. Clicking it shows the panel, interactive and focused, also
  when it was hidden.
- **Closing is not quitting.** Command+W, or "Close Window", hides the panel (or closes the
  settings window when that is in front). The app keeps running in the menu bar and stays
  connected.
- **Quitting** is Command+Q, or "Quit RealtimeDocs" in the RealtimeDocs menu or "Quit" in the
  menu-bar item's menu. The app is built to finish quitting within a few seconds even if something
  hangs.

## Spaces, Mission Control, fullscreen and displays

- **Mission Control.** In Presenter Mode the panel is hidden from Mission Control
  (`hiddenInMissionControl`); a normal window is not. That this works as documented is `NOT TESTED`.
- **Spaces and fullscreen applications.** By default the panel stays on the Space it is on.
  Settings → Behaviour & Shortcuts → "Show on every Space and above fullscreen apps" (Presenter Mode
  only) makes it follow you between desktops and stay above fullscreen applications. Electron
  documents that the underlying call changes the kind of application RealtimeDocs is for macOS,
  which hides the window and the Dock icon for a moment each time it is used; while the app runs
  without a Dock icon, the app tells Electron to leave the process type alone. The app's own hint
  says: "Not every fullscreen application can be covered."
- **Always-on-top cannot be promised over every system surface.** Pinning is a request to the
  window system. Whether the panel stays above a particular fullscreen application, Mission
  Control, Stage Manager, the lock screen or a system dialog is decided by macOS, and none of it
  has been tested. Keep a way back at hand: the menu-bar item and the global shortcuts do not
  depend on the panel being visible.
- **Several displays.** The app remembers the position and display of each mode. A remembered
  position is used only if at least half of the panel and 120 points of its title strip are on a
  display that is connected now; otherwise the panel is moved back onto a display and Settings says
  so.
- **Fail-safe when a display disconnects.** With private mode on, the panel is not moved onto another
  display when the one it was on goes away, because that display may be the one being shared. It is
  **hidden** instead (a normal window is minimised; if nothing could bring a hidden panel back, it is
  collapsed to a neutral strip). "Notes display disconnected — panel hidden so it is not shared.
  Click to show." appears as a macOS notification where one can be shown, and in the menu-bar tooltip.
  Display events, a document arriving or a notice never bring the panel back; only you do: "Show" in
  the menu-bar menu, "Return to interactive mode" or its shortcut, starting the app again, or
  clicking the notification. A change of resolution or scale on the same display is not treated this
  way. With private mode off, the panel moves back onto a remaining display.
- **Sleep and wake.** The position is checked again at start-up, when the panel is shown, when a
  display is added, removed or changed, and when the Mac wakes or is unlocked. Pin and private mode
  are applied again at the same moments, and the live connection reconnects at once after waking.
- **Retina.** The menu-bar icon ships in normal and double resolution. How the panel behaves when
  dragged between a Retina and a non-Retina display is `NOT TESTED`.
- **Reset.** "Reset Position" in the Panel menu or the "More" menu, or "Reset window position" in
  Settings, always brings the panel back to its default place.

## Permissions

The app requests none, and needs no administrator rights for normal use. It does not ask for screen
recording, camera, microphone, accessibility, input monitoring, location, Bluetooth or the photo
library. If a later feature needs one, the app has to explain it before macOS asks.

- Inside the app, every permission request from a page is denied before it could reach macOS.
- Electron's stock application declares texts for camera, microphone, Bluetooth and audio capture.
  The packaging script removes them; inspection of the cross-built bundles found none left in any
  of their nine `Info.plist` files.
- The app is signed with the hardened runtime and a single entitlement,
  `com.apple.security.cs.allow-jit` (see "Get the app").
- Showing live notes needs none of these. If a later feature needs one, the text has to be added
  deliberately, because macOS ends a process that touches such a resource without one.

Whether macOS shows any prompt in practice, for example about the local network when the server is
on a private address, is a line of the checklist and has not been observed.

## Keychain and stored sessions

The session for the last document is a token for that one document. It stays in the app's main
process; the document view cannot read it. To survive a restart it is stored as one file,
encrypted through the macOS Keychain. The Connection tab says where the session is kept:
"Encrypted by the operating system" or "In memory only".

With an unsigned or ad-hoc signed build, expect a Keychain prompt when a session is first stored,
and possibly again after every rebuild. Electron's code-signing guide explains why:

> Without a valid, consistent code signature, macOS may be unable to tell that two builds of your
> unsigned app are "the same app", which can cause the Keychain to prompt the user for permission
> again after every update.

The app also has Electron's cookie encryption switched on, which relies on the same Keychain
access, so an unsigned test build may prompt for that reason too.

If the Keychain is not available, or the prompt is declined, nothing is written to disk: the
session is kept in memory, ends when the app quits, and the Connection tab says so. A Developer ID
signed build is expected not to prompt; that is a checklist line, not an observed fact.

## Capture limits on macOS

Private mode asks macOS not to share RealtimeDocs' windows, and it is **on by default**; you can
switch it off in Settings → Privacy & Capture. **On macOS this request is best effort only.**
Electron's documentation says:

> On macOS, it sets the `NSWindow`'s `sharingType` to `NSWindowSharingNone`. Unfortunately, due to
> an intentional change in macOS, newer Mac applications that use `ScreenCaptureKit` will capture
> your window despite `win.setContentProtection(true)`.

The app therefore shows, on every macOS setup, this warning in the status chip's explanation, in
the Safe Share Guide and in Settings:

> Whole-display capture may include RealtimeDocs on this macOS and meeting-app configuration. Share
> a selected application, window, or browser tab and verify using another participant.

With only one display connected, it adds: "Sharing your entire screen on this Mac will include this
panel. Put it on a second display or an iPad (Sidecar) and share only your main display, or open
your notes on your phone."

**The status chip** in the panel's title strip, the menu-bar tooltip, the Panel menu and Settings →
Privacy & Capture show the same words. On a Mac the request layer reads "Protection off" (private
mode is off), "Protection request failed", or "OS protection accepted". On macOS "OS protection
accepted" is only a best-effort request that macOS took, reported once the window was drawn. It does
not mean that a participant cannot see the panel. Below it the verification line reads "Manual
verification required" until you recorded a check for your exact setup with a second participant or
device, then "Verified for N configurations — see Privacy Test Center", or "Verification expired after
version change" when a record has expired. Linux and the browser read "Unsupported".

**Assume that people in a meeting, and any recording, can see the panel on a Mac** unless a record
for your exact setup, made with a second participant or device, shows otherwise. If the notes must
stay out of a meeting, share a single window that the panel does not overlap, or keep the notes on a
display or a device that is not shared, and have someone confirm what they see.

**The Safe Share Guide** opens on the first start and from the status chip, the "More" menu, the
Panel menu ("Safe Share Guide…") and Settings → Privacy & Capture. Its four steps:

1. Share a specific browser tab, presentation window, or application instead of your entire screen.
2. Keep RealtimeDocs outside the source you selected.
3. Confirm what others see from a second device or with another participant.
4. Record the result in the Privacy Test Center.

**The Privacy Test Center** is a tab of the Settings window (Settings → "Privacy Test Center"; also
a menu-bar menu item, "Privacy Test Center…" in the Panel menu and step 4 of the guide). It records a
check: meeting application and version, client, what was shared, monitors, whether protection was on,
and what the second participant saw. It stamps the macOS, Electron and app versions by itself, and
the record expires when any of those change, when you enter a different browser or meeting-application
version, and after 30 days. Records stay on this Mac. "Privacy & Capture" is a different tab: it
holds the private-mode switch, the current status, the Safe Share Guide and what to rely on instead.
The procedure is in [capture-compatibility.md](capture-compatibility.md) and
[privacy-test-center.md](privacy-test-center.md). No meeting application has been tested.

**Neutral titles.** With private mode on, the window title, the menu-bar tooltip and the page title
say "RealtimeDocs" and never the document's title. The panel strips `title` attributes and does not
use native pop-up menus, so no tooltip or menu drawn by macOS shows document text. Input-method
candidate windows and the picture that follows the pointer while you drag something are drawn by
macOS and are outside what private mode covers. The save dialog for an attachment proposes
`attachment.` followed by the file's extension.

All other features of the panel do not depend on any of this.

## Safari and other browsers on the Mac

The web app is used in a browser; the desktop app is optional. What was and was not checked:

| Checked                                                                                                                                                                               | Not checked                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| The web app's screens (against a simulated server) and the editor (against a test server), in Playwright's builds of Chromium, Firefox and WebKit, in a container on the Linux server | Safari on macOS or iOS, in any version |
|                                                                                                                                                                                       | Chrome, Edge or Firefox on macOS       |
|                                                                                                                                                                                       | Any touch device                       |

**Playwright's WebKit build on Linux is not Safari.** It shares the rendering engine's source, not
Apple's application, its clipboard and file handling, its privacy features or its release
schedule. A check that ran there shows nothing about a particular Safari release.

Specifically unverified in Safari: copying and pasting, including formatted paste from other
applications and pasted screenshots; image upload by drag and drop and by file picker; typing with
an input method; the fallback that keeps the reading position stable in Safari versions without
built-in scroll anchoring (implemented, and measured only with the built-in feature switched off
artificially in other engines); the choice between Command and Control in shortcut hints; the
"Open in Desktop" hand-over from Safari to the app; and the print view. Results that exist are in
[testing.md](testing.md).

## Troubleshooting

| What you see                                                 | What to check                                                                                                                                                                                        |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS refuses to start the app from the Linux-built zip      | Expected on Apple Silicon: its signature is invalid. Build on the Mac, or sign as described. Do not turn macOS protections off                                                                       |
| Gatekeeper rejects an app that someone else built            | Expected for an ad-hoc signed build. Only a Developer ID signed and notarized build is meant for other Macs                                                                                          |
| A Keychain prompt appears                                    | Expected for unsigned and ad-hoc signed builds. See "Keychain and stored sessions"                                                                                                                   |
| The session is "In memory only"                              | The Keychain was unavailable or the prompt was declined. The session ends when the app quits                                                                                                         |
| "Server could not be reached"                                | The address, your network, and for a tunnel whether the `ssh` window is still open. `localhost` means this Mac                                                                                       |
| "Not a RealtimeDocs server"                                  | The address points at something else, for example the wrong port                                                                                                                                     |
| "Versions do not match", or "Update required" in the panel   | The app is too old for the server or the document. Get the current build                                                                                                                             |
| "Open in Desktop" does nothing                               | Open the app once from the Applications folder so that macOS knows the link type, and allow the browser to open it. Or use "Paste share link"                                                        |
| The link "belongs to a different server"                     | Enter the address exactly as the browser shows it, or tick "Accept links for …" on the Connection tab if it is offered                                                                               |
| The question "This link is for a different server" went away | The question is withdrawn after three minutes, and answering "Cancel" blocks that server for ten seconds. Wait a moment and paste the link again                                                     |
| "That does not look like a RealtimeDocs share link"          | Paste the complete original link, including the part after `#`                                                                                                                                       |
| "Access expired" or "Access revoked"                         | The link or session ended, or an administrator removed the access                                                                                                                                    |
| A global shortcut does nothing                               | Settings → Behaviour & Shortcuts shows whether it is registered. Another application may own it                                                                                                      |
| The panel is not on any screen, or has disappeared           | Menu-bar item → "Show", or "Return to interactive mode", or the emergency shortcut. If the display it was on was disconnected, it was hidden on purpose (see "Fail-safe when a display disconnects") |
| The panel does not react to the pointer                      | Click-through is on. Use the shortcut, the menu-bar item or the Dock icon                                                                                                                            |
| There is no Dock icon                                        | Expected in Presenter Mode. "Show in the Dock" in Settings brings it back; the menu-bar item and the shortcuts keep working                                                                          |
| The Dock icon came back by itself                            | The menu-bar item could not be created, so the Dock-icon omission was switched off. See "No Dock icon in Presenter Mode"                                                                             |
| The Dock icon or the menu bar disappears for a moment        | "Show on every Space and above fullscreen apps" is being switched; Electron documents that macOS hides the window and the Dock icon briefly then                                                     |
| The panel does not appear over a fullscreen application      | Not every fullscreen application can be covered. Try "Show on every Space and above fullscreen apps" and the higher "Stay above" level                                                               |
| The universal build fails on the Linux server                | Expected. It can be built on a Mac only                                                                                                                                                              |

For a report to whoever supports you: Settings → Diagnostics & About → "Copy report". It contains
versions, window and display geometry and registration results, and no session, share link or
document text.

## Manual native test checklist

Run this on macOS 13 or later, on an Apple Silicon Mac and on an Intel Mac. Write down the macOS
version and build, the processor type, the app version, how the build was signed, and the result
of every line. **None of these lines has been checked yet.** Screen-share outcomes go into the
Privacy Test Center.

**Build and start**

- [ ] `pnpm --filter @realtimedocs/desktop run package:mac` completes on the Mac. Note every
      warning.
- [ ] The locally built app starts. Note any macOS prompt word for word.
- [ ] The cross-built Apple Silicon zip, signed ad hoc on the Mac (`codesign --force --deep --sign -`),
      starts; unsigned, it does not.
- [ ] A Developer ID signed and notarized build: `codesign --verify`, `spctl --assess` and
      `xcrun stapler validate` succeed, and the app opens on a second Mac without a warning. The
      entitlements listing shows only `com.apple.security.cs.allow-jit`.
- [ ] The `.dmg` (and its own signature and notarization) and the universal build complete and start
      on both processor types.
- [ ] First start shows the panel at the top right of the main display with the Safe Share Guide. A
      menu-bar item is present and there is **no Dock icon**; Settings → Behaviour & Shortcuts →
      "Show in the Dock" brings it back.
- [ ] With no Dock icon: Command+C, V, X, Z and A work in the panel and in Settings; Command+, and
      Command+Q work; the panel is not shown in Mission Control.
- [ ] Make the menu-bar item unavailable: the app returns to the Dock by itself and says so.
- [ ] No permission prompt of any kind appears at any time (camera, microphone, screen recording,
      accessibility, input monitoring, Bluetooth, local network). After a full session the app is not
      listed under Privacy & Security → Camera, Microphone or Screen Recording.
- [ ] Signed build: no Keychain prompt. Unsigned build: note when a prompt appears.
- [ ] Opening the app a second time shows the existing panel; no second copy stays running.

**Displays**

- [ ] Retina and non-Retina displays: text is sharp, grips and buttons react where they are drawn,
      the 44-point collapsed strip is fully visible.
- [ ] Two displays with different scale factors: drag the panel across and resize it near the
      boundary. Size and position stay as dragged, without a jump.
- [ ] Put the panel on the second display, quit, unplug that display, start: the panel appears on
      a remaining display (private mode off) or is hidden with the "Notes display disconnected"
      notice (private mode on), and only "Show", "Return to interactive mode" or starting the app
      again brings it back.
- [ ] Private mode on, panel on a second display, unplug that display while the app runs: the panel
      is hidden, not moved onto the remaining display; the notice appears as a notification and in
      the menu-bar tooltip. Change resolution and arrangement; rotate a display.
- [ ] Sleep and wake, lock and unlock, lid closed and opened with an external display: the panel
      is still reachable, pin and private mode are still applied (Diagnostics shows the value read
      back), and the document reconnects.

**Window behaviour**

- [ ] Window order: with private mode on, start screen sharing first, then start the app and open a
      document: the panel never flashes into the shared view while it appears.
- [ ] Transparency: at 10 %, 50 %, 86 % and 100 % opacity over light, dark and busy backgrounds
      the text stays opaque; "Outline" and "Scrim" improve readability; no black or white rectangle
      behind the panel; no shadow artefacts. Reading density "Compact", "Comfortable" and
      "Spacious" change the spacing.
- [ ] All eight resize grips with a mouse and with the trackpad, **especially the left and top
      edges**, which the automated tests could not drive with a real pointer. Minimum and maximum
      size hold. Presets, keyboard commands, collapse and expand work.
- [ ] Settings → Diagnostics & About → "Open probe window": record what happens when macOS resizes
      a see-through window on this Mac.
- [ ] Pin on and off, both "Stay above" levels: above a fullscreen application, on every Space, in
      Mission Control and Stage Manager (the Presenter Mode panel should not appear in Mission
      Control), with "Show on every Space and above fullscreen apps" on and off. Note whether the
      Dock icon or menu bar disappears for a moment, as documented.
- [ ] Hide and show with the button, the global shortcut and the menu-bar item. Command+W hides the
      panel. Command+Q quits, and it completes within a few seconds.
- [ ] Switch to a normal window and back: the normal window is framed, in the Dock, never on top and
      never click-through; the document stays open without a new link; each mode keeps its own
      position; the switch is refused while changes are unsaved.
- [ ] While you type in another application, someone else edits the document: the panel updates
      and **your typing continues in the other application**.
- [ ] Open a document with "Open in Desktop" while another application has the focus: the panel
      appears without taking the keyboard.

**Click-through and recovery**

- [ ] Turn click-through on: clicks reach the window underneath; the badge names the way back.
- [ ] Return with the emergency shortcut (`Cmd+Option+Shift+T`), the menu-bar item "Return to
      interactive mode" (it also un-collapses, shows, raises and moves the panel fully onto a
      display), the Panel menu, the Dock icon (when shown), by opening the app again, and by resting
      the pointer on the badge.
- [ ] Give both shortcuts to another running application first: the app reports each conflict on
      its own.
- [ ] Click-through is off again after a restart.

**Menu bar, Dock, menus, shortcuts**

- [ ] The menu-bar icon is readable in light and dark menu bars and on a display with a notch.
- [ ] The menu-bar menu is exactly Show, Hide, Return to interactive mode, Click-through Mode,
      Reconnect, Privacy Test Center, Settings, Quit.
- [ ] With the Dock icon shown, clicking it shows the panel.
- [ ] The Edit menu's Undo, Redo, Cut, Copy, Paste and Select All work in the panel and in
      Settings, with their Command shortcuts.
- [ ] The two global shortcuts with their defaults on a US, a UK, a German and an Indic keyboard
      layout. Change a shortcut in Settings; reset to defaults.
- [ ] The status chip, the menu-bar tooltip, the Panel menu and the Privacy & Capture tab show the
      same status label, never the document title while private mode is on, and the whole-display
      warning is shown on every macOS setup.
- [ ] The Safe Share Guide opens on first start and from the chip, the menus and Settings.
- [ ] The Privacy Test Center tab opens from the menu-bar menu; a record can be saved only with a
      remote observation; records survive a restart.

**Text input**

- [ ] Input methods (Hindi, Japanese, Chinese): composing text never triggers a panel command, and
      the candidate window is placed correctly over the see-through panel.
- [ ] Trackpad: two-finger scrolling with momentum works; pinching does not zoom the page.
- [ ] Clipboard: copy and paste with the keyboard and with the Edit menu (text, and an image if you
      can edit); "Copy report" in Diagnostics; pasting a share link. The link field is empty again
      after a successful open.

**Links and connection**

- [ ] A `realtimedocs://` link from Safari and from Chrome, with the app running and with it
      closed.
- [ ] A link for another server is refused with a clear message.
- [ ] Paste a share link for the configured server, and one for another server (the app must ask
      before switching, in a dialog that names both servers and defaults to Cancel).
- [ ] The Connection tab says the session is "Encrypted by the operating system"; the session
      survives a restart; "Close document and forget session" removes it.
- [ ] A server that is reachable by private IP address only, over HTTPS, and over plain HTTP with
      the development switch: note any block or prompt.
- [ ] Revoke the share link in the browser while the panel shows the document: the panel reports
      that access ended and shows no further updates.

**Live document**

- [ ] The sample document looks the same in the panel as in the browser: headings, the table, the
      image, the code block, the link, the diagram, the callout, Hindi text and emoji.
- [ ] A Windows PC and a Mac open the same document in their panels: an edit on one appears on the
      other, and "Saved" appears on both sides.
- [ ] Follow Latest: it scrolls to new content, pauses when you scroll back or select text, and
      "Jump to latest" appears.
- [ ] Disconnect the network and reconnect: the state goes to "Reconnecting" or "Offline" and back
      to "Live".

**Safari as a browser client**

- [ ] In current Safari: sign in, open the sample document, type, paste formatted text from
      another application, paste a screenshot, drop an image, upload an image with the file picker.
- [ ] In Safari: open a share link in a private window; the document appears and the secret part
      leaves the address bar.
- [ ] The same in Chrome on the Mac.

## Manual capture checks

Checking what a meeting participant sees is a separate procedure with its own record sheet:
[capture-compatibility.md](capture-compatibility.md). Record each check in the Privacy Test Center
([privacy-test-center.md](privacy-test-center.md)). A screenshot taken on this Mac is not evidence
of what participants receive, and on macOS the expectation is that the panel can be captured.
