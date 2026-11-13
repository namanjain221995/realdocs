# RealtimeDocs Desktop on Windows

This guide is for the person who uses or sets up the RealtimeDocs desktop companion on a Windows
PC: an employee who reads or edits a shared document in the floating panel, or the owner who builds
and hands out the app. It covers which Windows versions are supported, how to get and start the
app, how to connect it to your RealtimeDocs server, the two ways a document can open (Private
Presenter Mode or a normal window), the panel, the tray menu and shortcuts, private mode and how to
get the panel back, the installer and code signing, the optional diagnostics module,
troubleshooting, and a checklist for testing the app on a real PC.

## Verification status: NOT TESTED on Windows

Read this first. **Nothing in this guide has been run on Windows.**

- The app was built and exercised on a headless Linux server only: Electron running under Xvfb, a
  virtual display without a real window manager, a compositor or a tray. Those runs are Linux smoke
  tests. They say nothing about how the app behaves on Windows.
- The Windows packages (two zips and two installers, one pair for each of x64 and arm64) were
  cross-built on that Linux server and inspected as files. They are unsigned and have never been
  started on a Windows PC. The installers were built there too and have never been executed.
- The optional diagnostics module (a small C++ add-on) was written but has never been compiled
  anywhere. No package contains it.
- Every native behaviour described below is therefore `NOT TESTED` on Windows: the see-through
  window, click-through, the tray icon and its menu, omission from the taskbar, global shortcuts,
  keyboard focus, several monitors and display scaling, the fail-safe when a display disconnects,
  capture exclusion, the credential store, registration of `realtimedocs://` links, the installer,
  packaging on Windows and code signing.
- **That the Windows app exists says nothing about what a meeting participant receives.** The app
  asks Windows to leave its own windows out of screen capture. Windows accepting that request is not
  proof. No meeting application was tested; see [capture-compatibility.md](capture-compatibility.md).

The sections below describe how the app is built to behave. The
[manual test checklist](#manual-native-test-checklist) at the end is how that gets verified. Current
project status is in [status.md](status.md), recorded test results in [testing.md](testing.md).

## Supported Windows versions

The app is built on Electron 45.2.3. Electron's README for that release states:

> Windows (Windows 10 and up): Electron provides `x64` (`amd64`) and `arm64` binaries for Windows.

(<https://github.com/electron/electron/blob/v45.2.3/README.md#platform-support>)

| Combination                                      | Status                                                                           |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| Windows 10 or Windows 11, 64-bit Intel/AMD (x64) | Supported by Electron 45. Package exists. `NOT TESTED`                           |
| Windows 10 or Windows 11 on ARM (arm64)          | Supported by Electron 45. Package exists. `NOT TESTED`                           |
| 32-bit Windows                                   | Not supported. Electron stopped publishing 32-bit Windows builds with version 44 |
| Windows 8.1 and earlier                          | Not supported. Electron has required Windows 10 since version 23                 |

Capture exclusion needs more than the app itself does: Windows 10 version 2004 (build 19041) or
later. On an older Windows 10 the app runs, but Windows cannot leave a window out of capture
there: with private mode on, the documented behaviour is a black rectangle where the panel is, and
the app says so.

Whether Electron 45 requires a particular minimum build of Windows 10 beyond "Windows 10" is not
stated in the engineers' notes and must be checked against Electron's and Chromium's current
requirements before you promise support for an old Windows 10 build.

Electron supports its latest three major versions. The release schedule listed version 45 as stable
on 2026-10-20 with a tentative end of support on 2027-04-27. After that the app has to move to a
newer Electron to keep receiving browser-engine fixes. There is no automatic update; a new build is
handed out by hand.

## Get the app

Two forms exist, for each of the two processor types (x64 for ordinary 64-bit Intel and AMD PCs,
arm64 for Windows on ARM). They are built by the packaging commands described below, and sit in
`apps/desktop/out/` on the build server:

| Form                          | File name (x64 and arm64)                                                    | Size as built on Linux  |
| ----------------------------- | ---------------------------------------------------------------------------- | ----------------------- |
| Installer (per-user, NSIS)    | `RealtimeDocs-0.1.0-windows-x64.exe`, `RealtimeDocs-0.1.0-windows-arm64.exe` | 112.2 MiB and 104.5 MiB |
| Portable zip (unpack and run) | `RealtimeDocs-0.1.0-windows-x64.zip`, `RealtimeDocs-0.1.0-windows-arm64.zip` | 153.1 MiB and 151.3 MiB |

These are the public artifact names (`RealtimeDocs-<version>-windows-<arch>.<ext>`, see
[desktop-release.md](desktop-release.md)); the packager's own folders keep the Electron platform name
`win32`. The installers were built earlier under the old name `...-win32-<arch>-setup.exe` and were
not rebuilt under the new one on the host that renamed the scripts (the NSIS step needs Docker or
Windows); the zips were rebuilt and inspected. **Updates:** the app checks the server for new versions
and installs nothing by itself. "Update and restart" downloads the new zip, verifies its SHA-256, unpacks
it next to the app folder and restarts into it; a copy made by the installer, or a folder that also
holds other files, gets "Download only" instead (Settings -> Updates, [desktop-release.md](desktop-release.md#updates-in-the-desktop-app)). The
download page of your server (`/download`) shows the build for your PC with its size, checksum and
signature status, and says "Unsigned build — Windows SmartScreen will warn you before it opens" when
that is the case.

The unpacked folders next to them are `RealtimeDocs-win32-x64` and `RealtimeDocs-win32-arm64`, with
`RealtimeDocs.exe` in them. **All four files were built on the Linux server, are unsigned and were
never executed on Windows.** They are handed out by hand: the product's download page lists a build
only when the operator has copied it to the server, and the live site has none published at the
moment (see [deployment.md](deployment.md#publish-desktop-downloads)).

What "unsigned, built on Linux, never executed on Windows" means in practice:

- **Unsigned.** The executables carry no publisher signature. Windows cannot tell you who made them
  and cannot detect whether they were altered on the way to you. Take them only from the person who
  built them, over a channel you trust. To compare a file with what was built, ask that person for
  its SHA-256 checksum (on the Linux build server:
  `sha256sum apps/desktop/out/RealtimeDocs-0.1.0-windows-x64.exe`) and compute yours in
  PowerShell:

  ```powershell
  Get-FileHash .\RealtimeDocs-0.1.0-windows-x64.exe -Algorithm SHA256
  ```

- **A SmartScreen prompt is to be expected.** Microsoft Defender SmartScreen warns about
  executables it does not recognise, and an unsigned program that was just built is exactly that.
  The prompt is Windows doing its job. Whether to run an unsigned build is a decision for whoever
  is responsible for the PC. Do not turn SmartScreen, antivirus or an application-control policy
  off for this app. If your organisation blocks unsigned software, the answer is a signed build
  (see [Packaging and code signing](#packaging-and-code-signing)), not an exception.
- **Built on Linux.** The packages were assembled on Linux from Electron's official Windows files and
  this app's code. Their file structure was checked there: the executable is a 64-bit Windows
  program for the right processor type, it carries the product name and icon, the application
  archive is present and matches the integrity value embedded in the executable, the hardening
  switches are set, and the application manifest asks for no administrator rights
  (`requestedExecutionLevel asInvoker`). The installers are NSIS installers; the arm64 one is an x86
  installer program, because NSIS has no ARM64 stub, and Windows on ARM runs it emulated.
- **Never executed.** Nobody has started them on Windows. You may be the first. Problems at this
  stage are expected to be found by the checklist at the end of this guide, and should be reported
  rather than worked around.

### Option 1: the installer

The installer installs for the current Windows user only. It asks for no administrator rights and
writes nothing to Program Files or to the machine-wide part of the registry.

- It installs to `%LOCALAPPDATA%\Programs\RealtimeDocs`.
- It creates a Start-menu shortcut and an uninstaller that is listed under the user's installed apps.
- It registers the `realtimedocs://` link type for the current user, with the same command line the
  app registers by itself.
- "Start RealtimeDocs when I sign in" is off unless you tick it.

All of this is how `apps/desktop/build/windows/installer.nsi` is written; none of it was run.

### Option 2: the portable zip

Unpack the zip to the place where it will stay, for example a folder under your user profile, and
start `RealtimeDocs.exe` from there. Unpack before the first start: on first start the app registers
itself as the handler for `realtimedocs://` links for the current Windows user, with the path it was
started from. If you move the folder later, start the app once from the new place.

### Option 3: build it on the Windows PC

Either a 64-bit Intel/AMD PC or an ARM PC can build both architectures. **These commands were not
executed on Windows by this project.**

1. Install Node.js 24.22.2 (the version in `.node-version`).
2. Copy the repository to the PC **without** the `node_modules`, `dist`, `out`, `.stage` and
   `.toolchain` folders. Those hold files that were built or downloaded for the Linux server.
3. In PowerShell, in the repository folder, make the pinned pnpm (12.18.0, named in `package.json`)
   available. Corepack ships with Node.js 24:

   ```powershell
   corepack enable
   ```

4. Install the dependencies exactly as locked, and run the desktop unit tests:

   ```powershell
   pnpm install --frozen-lockfile
   pnpm --filter @realtimedocs/desktop run test
   ```

5. Package for Windows, and optionally build the installers:

   ```powershell
   pnpm --filter @realtimedocs/desktop run package:win
   pnpm --filter @realtimedocs/desktop run package:win:installer
   ```

The results are `apps\desktop\out\RealtimeDocs-win32-x64\RealtimeDocs.exe`, the same for `arm64`,
one zip per architecture next to them and, after the second command, the installers. To check the
packages as files:

```powershell
pnpm --filter @realtimedocs/desktop run inspect-package
```

To run the app straight from the source tree while developing, without packaging:

```powershell
pnpm --filter @realtimedocs/desktop run dev
```

That development build keeps its settings in its own folder (`apps\desktop\.stage\dev-profile`) and
does not touch the settings of a packaged app.

### What the app keeps on the PC

The exact folder is shown under Settings → Diagnostics & About → "Settings folder". It contains:

- `preferences.json`: window position per mode, appearance, shortcuts, the server address, and
  whether private mode is on. No session, no share link, no document content.
- `session.bin`: the session for the last document, encrypted with Windows data protection (DPAPI)
  for your user account. It exists only when that encryption is available.
- `privacy`: the Privacy Test Center records you made on this PC (one small file each). They are not
  sent to the server.
- the document view's own browser storage. For a signed-in editor this includes changes that have
  not reached the server yet. It is cleared when you choose "Close document and forget session"
  (Settings → Connection) or change the server.

To remove the app, use the uninstaller if you used the installer; for the portable zip, quit the app
and delete its folder. The settings folder stays until you delete it too.

## Connect to your server

The app talks to one RealtimeDocs server: the one you enter. A link never changes it without asking
you.

### Set the server address

1. Open Settings: the "More" button (three dots) in the panel, then "Settings…", or the tray
   icon's menu.
2. On the "Connection" tab, enter the address under "Server address" and choose "Save and check".
3. The status line should read "Connected to a RealtimeDocs server". Other outcomes are "Server
   could not be reached", "Not a RealtimeDocs server" and "Versions do not match".

Which address to enter:

- **A deployed server:** its HTTPS address, exactly as you see it in the browser, for example
  `https://docs.example.com`.
- **A server you reach over SSH (development):** `localhost` on the server and `localhost` on your
  PC are two different machines. Open a tunnel from the PC and keep that window open:

  ```powershell
  ssh -L 4310:127.0.0.1:4310 you@server.example.com
  ```

  Then enter `http://127.0.0.1:4310`. Use the same address in your browser. The app never opens
  ports or starts tunnels itself.

The app accepts HTTPS addresses. Plain HTTP is accepted for `localhost` and `127.0.0.1` only. A
switch on the Connection tab, "Development: allow plain HTTP to private-network addresses", off by
default, additionally allows addresses such as `http://192.168.1.20:4310`; the document and your
session then cross that network unencrypted. Leave it off outside a test setup.

### Open a document: "Open in Desktop"

1. Open the document in your browser and choose "Open in Desktop".
2. The browser asks whether it may open RealtimeDocs Desktop. Allow it.
3. The panel shows the document.

Behind this, the server issues a code that works once and for 60 seconds, and the browser hands it
to the app in a `realtimedocs://` link. The app accepts such a link only if it names the server the
app is set to; a link for another server is refused with a message, and nothing is contacted.

If nothing happens, the app is probably not running from the place it was first started from, or
has never been started on this PC. Start `RealtimeDocs.exe` once and try again. If the app reports
that the link belongs to a different server although you entered the right one, the server
announces itself under another address than the one you typed; the Connection tab then offers
"Accept links for …" under "Links and transport".

### Open a document: "Paste share link"

This works without the browser button.

1. Copy the complete share link you were given, including the part after `#`.
2. Paste it into the field in the empty panel ("Paste a share link (https://…/s/…#…)"), or under
   Settings → Connection → "Paste share link", and choose "Open".

If the link belongs to a different server than the one the app is set to, the app asks first
("This link is for a different server") and switches only when you confirm. The question is a
dialog of the operating system's kind that names both servers in full and defaults to "Cancel";
nothing shown inside the panel can answer it, and the panel can start it only while no document is
open. The address in the browser's address bar after you opened a share link is not a share link any
more; paste the original one.

### Close a document

Two different actions exist:

- **"More" → "Close document"** in the panel closes the document. A signed-in editor's unsent
  changes stay on this PC and are sent when that document is opened again; a share-link guest has no
  such copy, so unsent changes are discarded. If changes have not reached the server yet, the app
  warns once before it closes.
- **Settings → Connection → "Close document and forget session"** ends the session on the server and
  deletes it from this PC, together with unsent changes of that document.

Your access is always the access of the browser session or share link you came from: view only or
can edit. Administration (sharing, snapshots, accounts) stays in the browser.

## Connecting to a backend on another machine

The server address field is on Settings → Connection ("Server address", then "Save and check").
The app requires an HTTPS address. Plain HTTP is accepted only for loopback addresses
(`localhost` and `127.0.0.1`), which is how an SSH tunnel to a backend on a remote host appears.
A private-network address over HTTP is refused unless you turn on the development switch on that
tab; a public host over HTTP is never accepted.

`localhost` on your PC is not `localhost` on the server. For a backend on a remote development host, open a
tunnel from the PC with the same port numbers on both sides and keep it open, then enter
`http://127.0.0.1:4310`:

```sh
ssh -N -L 4310:127.0.0.1:4310 -L 4311:127.0.0.1:4311 user@host
```

For a deployed server, enter its HTTPS address exactly as the browser shows it. The server must list the app's origin,
`app://realtimedocs`, in `DESKTOP_ORIGINS` (it does by default). The steps and the reasons are in
[Remote development and local desktop connectivity](deployment.md#remote-development-and-local-desktop-connectivity).

## Two ways to open a document

A document opens either in **Private Presenter Mode** or in a **normal window**.

|                                          | Private Presenter Mode (the default)               | Normal window                              |
| ---------------------------------------- | -------------------------------------------------- | ------------------------------------------ |
| Window                                   | Frameless, see-through panel; own resize grips     | Ordinary framed window, resized by Windows |
| Taskbar                                  | Left out of the taskbar (on by default; see below) | Always has a taskbar button                |
| On top of other windows                  | Yes while pinned (on by default)                   | Never                                      |
| Click-through reading mode               | Available                                          | Never                                      |
| Private mode (capture exclusion request) | Applied as you set it (on by default)              | Applied as you set it                      |

Switch with "More" → "Open in a normal window" or "More" → "Switch to Private Presenter Mode" in the
panel, or under Settings → Behaviour & Shortcuts → "How documents open". Switching keeps the open
document and its session: no new link, no sign-in. The new window opens its own live connection,
which takes a second or two, and the switch is refused while changes have not reached the server.
Each mode remembers its own position and size.

## Use the panel

The panel is a frameless window, 720 × 460 at first, placed at the top right of the main display.
Its background is see-through; text and images are always drawn fully opaque.

**Title strip.** The strip at the top is the drag area: drag it to move the panel. It shows the
document title, the private-mode status chip (see below), the connection state ("Connecting",
"Live", "Reconnecting", "Offline", "Access expired", "Access revoked", "Update required",
"Unavailable"), the save state ("Saved", "Saving…", "Changes pending", "Not saved") and your access
("View only" or "Can edit"). "Saved" appears only after the server has confirmed that the change is
stored. Text in the document below the strip can be selected and scrolled as usual; it does not
move the window. In a normal window the ordinary title bar moves the window.

**Buttons in the strip, left to right:**

| Button                               | What it does                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| "Reconnect now"                      | Shown while reconnecting or offline. Tries again immediately                                                                                |
| "Follow latest changes: on / off"    | Follow Latest, see below                                                                                                                    |
| "Appearance"                         | Background opacity, text size, reading density, text colour, reading width, readability aid                                                 |
| "Click-through reading mode"         | Presenter Mode only. Makes the panel ignore the mouse, see below                                                                            |
| "Pin on top" / "Unpin from top"      | Presenter Mode only. Keeps the panel above other windows. On by default                                                                     |
| "Collapse to title strip" / "Expand" | Presenter Mode only. Shrinks the panel to its 44-pixel title strip and back                                                                 |
| "More"                               | Size presets (Presenter Mode), "Reset position", the mode switch, "Close document", "Safe Share Guide", "Settings…", "Privacy and capture…" |
| "Hide panel"                         | Hides the panel. The app keeps running in the notification area                                                                             |

**Appearance.** These are your own display preferences. They never change the shared document.

- "Background opacity": 10 % to 100 %, 86 % at first. It changes the panel's background only.
- "Text size": 80 % to 180 %.
- "Reading density": "Compact", "Comfortable" (the default) or "Spacious".
- "Text colour": "Light" (light text on a dark panel) or "Dark".
- "Reading width": "Narrow", "Normal", "Wide" or "Full".
- "Readability aid", for low opacity over busy windows: "Off", "Outline" (an outline around each
  letter) or "Scrim" (a soft plate behind each block of text).

**Resize.** In Presenter Mode the window is resized by the app's own grips on all four edges and four
corners, not by Windows, because Electron documents that see-through windows are not resizable by
the system. The size stays between 360 × 180 and 2400 × 1800 and within the display. Presets:
Compact 480 × 300, Standard 720 × 460, Wide 960 × 460, Tall 560 × 720, Large 1040 × 680. A collapsed
panel changes width only.

**Pin.** Settings → Behaviour & Shortcuts has "Keep the panel above other windows" and "Stay above":
"Ordinary windows (below the taskbar)" or "As high as the system allows (above the taskbar)".
Always-on-top is a request to Windows. It is not a promise to stay above every full-screen
application or system surface.

**Hide and show.** The hide button, the show/hide shortcut and the tray menu hide and show the panel.
Closing the panel hides it too; it never quits the app. Quit with "Quit" in the tray menu. The app
refuses to hide the panel when neither the tray icon nor the show/hide shortcut is available to
bring it back.

**No focus stealing.** An edit that arrives from someone else updates the panel and leaves the
keyboard where it is. It never shows, raises or expands the panel by itself either. Only starting
the app, or starting it again while it runs, gives the panel the keyboard focus. When you open a
document yourself, the panel is shown without taking the keyboard.

**Follow Latest.** Off by default. When on, the panel scrolls to new content as it arrives. It
pauses as soon as you scroll back or select text, and a "Jump to latest" control appears when
something new has arrived meanwhile. Your scroll position is yours; other readers are not affected.

### Taskbar omission

In Presenter Mode the panel has no taskbar button. This is **on by default**. Settings → Behaviour &
Shortcuts → "Taskbar and Dock" → "Show in the taskbar" brings the button back. It only changes where
RealtimeDocs is listed on your own PC; it does not change what a screen share or a recording
contains. For that, see private mode.

The rule behind it is the **recovery invariant**: the omission is in effect only while something
other than the taskbar can bring the panel back, that is the tray icon or the global show/hide
shortcut. If both are lost (the shortcut cannot be registered and the tray icon is unavailable), the
app puts the panel back into the taskbar by itself and says so. A normal window is always listed.

### Click-through reading mode

In click-through mode the panel stays visible but ignores the mouse: clicks and scrolling go to
the window underneath. It is separate from transparency, it is available in Presenter Mode only, and
it is never switched on at start-up. A badge at the top of the panel says "Click-through is on."

Every way back to interactive mode:

1. The emergency global shortcut, `Ctrl+Alt+Shift+T` by default.
2. The tray menu item **"Return to interactive mode"**. It is always enabled. It leaves
   click-through, un-parks and un-collapses the panel, shows and raises it, and moves it fully onto a
   display.
3. A left click on the tray icon shows the panel and makes it interactive.
4. The badge in the panel: rest the pointer on it and click "Return to interactive mode". Electron
   documents that this stops working for as long as a window running with administrator rights
   (for example Task Manager) is in the foreground. The other ways still work then.
5. Starting RealtimeDocs again. It does not start a second copy; it brings the panel back,
   interactive.

Hiding the panel also ends click-through. The app refuses to enter click-through when neither the
global shortcut nor the tray icon is available, and leaves it at once if the last of them
disappears.

### The tray icon and its menu

The icon lives in the notification area, possibly behind the "show hidden icons" arrow. A left
click shows the panel. A right click opens the menu, which has exactly these items:

- "Show"
- "Hide"
- "Return to interactive mode"
- "Click-through Mode"
- "Reconnect"
- "Privacy Test Center"
- "Settings"
- "Quit"

"Hide" is enabled only while the panel is visible and can be brought back. "Reconnect" is enabled
only while a document is open. "Click-through Mode" is available in Presenter Mode only. The tray
tooltip shows the app name, where the panel is and the private-mode status in the same words as the
panel's chip; with private mode on it never shows the document title.

## Shortcuts

**Global shortcuts** work while another application has the keyboard. There are two:

| Action                                 | Default            |
| -------------------------------------- | ------------------ |
| Show or hide the panel                 | `Ctrl+Alt+Shift+D` |
| Return to interactive mode (emergency) | `Ctrl+Alt+Shift+T` |

Three modifier keys are used on purpose: on many keyboard layouts AltGr is the same as Ctrl+Alt, so
a two-modifier shortcut would collide with typing. The pin and click-through shortcuts of earlier
builds no longer exist.

**To change one:** Settings → Behaviour & Shortcuts → "Global shortcuts", click the key display of
the action, and press the new combination (Esc cancels). A letter or digit needs Ctrl plus at least
one more modifier; a function key needs Ctrl or Alt. AltGr and Windows-key combinations are
refused, as are a few combinations reserved by Windows. "Reset" restores one default, "Reset all to
defaults" both.

**When a shortcut cannot be registered.** Windows gives a global shortcut to one application only.
If another application already owns the combination, the registration fails silently on the
Windows side; the app notices and tells you, for each of the two shortcuts on its own:

- Settings shows the shortcut as "In use by another application", with a warning and a "Retry"
  button;
- if you were changing a shortcut, the message is "Another application already uses that
  combination. Your previous shortcut was kept.", and the old one keeps working.

Choose another combination, or close the other application and press "Retry". While neither a
shortcut nor the tray icon is available, the panel cannot be hidden, cannot enter click-through and
returns to the taskbar.

**Panel commands** work only while the panel has the keyboard focus, and are fixed:

| Keys                        | Action                                             |
| --------------------------- | -------------------------------------------------- |
| `Ctrl+Alt+Shift+Arrow keys` | Resize the panel in steps of 24 pixels             |
| `Ctrl+Alt+Shift+1` … `5`    | Size presets: compact, standard, wide, tall, large |
| `Ctrl+Alt+Shift+0`          | Reset the panel position                           |
| `Ctrl+Alt+Shift+C`          | Collapse or expand the panel                       |

Editing uses the usual Windows shortcuts: Ctrl+C, V, X, Z and A. Key presses made while an input
method is composing text are never treated as commands.

## Private mode, the status chip and the Safe Share Guide

Private mode asks Windows to leave RealtimeDocs' own windows out of screen capture. **It is on by
default** for a fresh installation, because forgetting to switch it on is the likeliest way notes
end up in a shared screen. If you switch it off yourself, that choice is kept. Switch it under
Settings → Privacy & Capture ("Private mode: request capture exclusion for RealtimeDocs windows").
The panel's status chip and the tray tooltip show the current state.
With private mode on, the panel is also missing from your own screenshots and recordings.

**It is a request, not a result.** A successful request does not show what a meeting participant
receives. No meeting application has been tested with it. Read
[capture-compatibility.md](capture-compatibility.md) before you use it for anything that matters;
that document also has the procedure for testing your own setup with a second device.

**Window order.** Each RealtimeDocs window is created hidden, configured, asked for the protection,
and only then shown. The status "OS protection accepted" is reported only after the window has been
drawn once since the request, because Windows applies the change with the next desktop composition.

**The status chip** in the panel's title strip shows the same words as the tray tooltip and
Settings → Privacy & Capture. The request layer says what RealtimeDocs asked Windows and what Windows
answered:

| Label                     | Meaning on Windows                                                                                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protection off            | Private mode is off. No request is made. The panel can appear in screen shares and recordings like any window                                                                           |
| Protection unavailable    | Windows older than 10 version 2004: the window is replaced by a black area, so viewers see a black rectangle where the panel is. Or the window has not been drawn yet since the request |
| Protection request failed | Windows refused the request, or the value read back does not agree. Treat the panel as visible                                                                                          |
| OS protection accepted    | Windows 10 version 2004 or later accepted the request and the window has been drawn since. This is a request to the operating system, not proof of what a participant receives          |
| Unsupported               | Not on Windows (Linux, or a browser)                                                                                                                                                    |

Below "OS protection accepted" a second line shows the verification layer: "Manual verification
required" until you recorded a check for your exact setup, then "Verified for N configurations — see
Privacy Test Center", and a warning when a record has expired ("Verification expired after version
change") or when the other participant still saw the panel. A configuration counts as verified only
if a second participant or a separate device reported what they received.

**The Privacy Test Center** is a tab of the Settings window (Settings → "Privacy Test Center"; also
a tray menu item and step 4 of the Safe Share Guide). It records a check: the meeting application and
its version, the client, what was shared, the monitors, whether protection was on, and what the
second participant saw. It stamps the Windows version, the Electron version and the app version by
itself, and the record expires when any of those change, when you enter a different browser or
meeting-application version, and after 30 days. Records stay on this PC. The procedure is in
[capture-compatibility.md](capture-compatibility.md) and
[privacy-test-center.md](privacy-test-center.md). "Privacy & Capture" is a different tab: it holds the
private-mode switch, the current status, the Safe Share Guide and what to rely on instead.

**The Safe Share Guide** opens on the first start and from the status chip, the "More" menu and
Settings → Privacy & Capture. Its four steps:

1. Share a specific browser tab, presentation window, or application instead of your entire screen.
2. Keep RealtimeDocs outside the source you selected.
3. Confirm what others see from a second device or with another participant.
4. Record the result in the Privacy Test Center.

Private mode covers RealtimeDocs windows only: a browser tab with the same document, an exported
file, a photograph of the screen, or things Windows draws itself (an input-method candidate window,
the picture that follows the pointer while you drag) are outside it.

**Neutral titles.** With private mode on, the window title, the taskbar entry, Alt+Tab, the tray
tooltip and the page title say "RealtimeDocs" and never the document's title. The save dialog for an
attachment proposes `attachment.` followed by the file's extension.

**Permissions.** The app asks for no screen-recording, microphone, camera, accessibility or
input-monitoring permission and needs no administrator rights for normal use. Every permission
request from a page is denied. If a future feature needs a permission, the app has to explain it
before Windows asks.

## Several monitors and display scaling

- A new panel appears at the top right of the main display.
- The app remembers the position and display of each mode. A remembered position is used only if at
  least half of the panel and 120 pixels of its title strip are on a display that is connected
  now. Otherwise the panel is moved back onto a display, and Settings → Behaviour & Shortcuts says
  that this happened.
- The check runs at start-up, when the panel is shown, when a display is added, removed or changed
  (resolution, scaling, arrangement), and when the PC wakes or is unlocked. Pin and private mode
  are applied again at the same moments.
- "Reset window position" (Settings → Behaviour & Shortcuts, or "Reset position" in the "More" menu)
  always brings the panel back to its default place.
- Windows virtual desktops: Electron documents that its "visible on all workspaces" call does
  nothing on Windows, so the app has no setting for it.

**Fail-safe when a display disconnects.** With private mode on, the panel is not moved onto another
display when the one it was on goes away, because that display may be the one being shared. It is
**hidden** instead (a normal window is minimised; if nothing could bring a hidden panel back, it is
collapsed to a neutral strip). The notice "Notes display disconnected — panel hidden so it is not
shared. Click to show." appears as a Windows notification where one can be shown, and in the tray
tooltip. Display events, a document arriving or a notice never bring the panel back; only you do:
"Show" in the tray menu, "Return to interactive mode" or its shortcut, starting the app again, or
clicking the notification. A change of resolution or scaling on the same display is not treated this
way. With private mode off, the panel moves back onto a remaining display as before. Windows may not
show the notification without a Start-menu shortcut that carries the app's identity, which the
installer cannot set; the tray tooltip and the tray's "Show" always work.

How the panel behaves when dragged between monitors with different scaling, and whether grips and
buttons hit exactly where they are drawn at 125 %, 150 % and 200 %, is `NOT TESTED`.

## Packaging and code signing

What exists:

- `pnpm --filter @realtimedocs/desktop run package:win` builds unpacked app folders and zip
  archives for x64 and arm64.
- `pnpm --filter @realtimedocs/desktop run package:win:installer` builds the per-user NSIS installer
  for each packaged Windows folder (`node scripts/build-installer.mjs [--arch x64,arm64]
[--container]` directly; `--container` runs `makensis` from Debian's `nsis` package in a
  throw-away container, which is how the installers on the Linux server were built).
- There is no automatic update.
- Packaged builds have the hardening switches ("fuses") set, an integrity check of the application
  archive, and developer tools turned off. See [security.md](security.md#desktop-app).
- `pnpm --filter @realtimedocs/desktop run inspect-package` verifies those properties in the
  finished package without running it, and reports whether the executable is signed.

Signing needs a Windows machine and a code-signing certificate. It was never executed by this
project. Signing material is read from environment variables only; nothing secret is in the
repository. On a Windows build machine, set the variables and run the same packaging command:

```powershell
# Either a certificate file and its password, taken from your secret store ...
$env:WINDOWS_CERTIFICATE_FILE = 'C:\path\to\certificate.pfx'
$env:WINDOWS_CERTIFICATE_PASSWORD = '<from your secret store>'
# ... or, for a certificate in the certificate store, on a hardware token or in a signing
# service, the signtool arguments that select it:
# $env:WINDOWS_SIGN_WITH_PARAMS = '/sha1 <certificate thumbprint>'

pnpm --filter @realtimedocs/desktop run package:win
```

Optional variables: `WINDOWS_TIMESTAMP_SERVER`, `WINDOWS_SIGNTOOL_PATH`,
`WINDOWS_SIGN_HOOK_MODULE_PATH`.

When one of the signing variables is set, every `.exe` and `.dll` of the package is signed with
SHA-256 and a timestamp, and a signing failure fails the build. With the certificate-file method,
the signing library passes the password to `signtool` on its command line, where other processes of
the same user can read it while it runs; on a shared build machine use `WINDOWS_SIGN_WITH_PARAMS`
instead. Check the result:

```powershell
signtool verify /pa /v apps\desktop\out\RealtimeDocs-win32-x64\RealtimeDocs.exe
Get-AuthenticodeSignature apps\desktop\out\RealtimeDocs-win32-arm64\RealtimeDocs.exe
pnpm --filter @realtimedocs/desktop run inspect-package
```

**Signing the installer.** The installer is a separate file. Set `WINDOWS_INSTALLER_SIGN_COMMAND`
(for example `signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /sha1
<thumbprint>`) before `package:win:installer`; this works on Windows hosts only.

A signed build is what makes the publisher visible to Windows and to the people who run the app.
Whether a particular certificate is enough for SmartScreen not to warn is decided by Microsoft, not
by this project, and was not tested.

### The optional diagnostics module

`apps/desktop/native/win-display-affinity` is a small C++ Node-API module. It lets the app read back
from Windows what display affinity its own window has, wait for one desktop composition, and so
report "OS protection accepted" with more evidence than Electron's own boolean. It is **optional**:
without it the app uses Electron's API only, and Settings → Diagnostics & About says "Diagnostics
module not present — status from Electron only". It exports four functions
(`getDisplayAffinity`, `setDisplayAffinity`, `isCompositionEnabled`, `flushComposition`); before
touching a window it checks that the handle is a top-level window of the app's own process, so a
window of another application is refused. It does not hook, inject, hide or change anything else,
and it cannot tell what a participant receives.

**It has never been compiled or run, and none of the packages contains it.** To build it you need
Windows 10 or 11, Node.js 24, pnpm, Visual Studio Build Tools 2022 ("Desktop development with C++")
with Windows SDK 10.0.19041 or later, Python 3 and `node-gyp`:

```powershell
pnpm install
cd apps/desktop
node scripts/build-native.mjs --arch x64      # and --arch arm64 on or for ARM
# writes native/dist/win32-<arch>/display_affinity.node and display_affinity.node.sha256
```

**Sign it before it is hashed.** When you sign the Windows packages, sign `display_affinity.node`
with the same certificate (`signtool`) **before** packaging. The packaging step hashes the file as
it is and writes the hash into `native-manifest.json` inside the application archive (covered by the
archive integrity check); the app refuses to load a file whose SHA-256 differs. Then run
`package:win`, which copies the module to `resources\native\win32-<arch>\`, and
`inspect-package`, which checks that its hash equals the manifest entry. The module's own
verification steps are in `apps/desktop/native/win-display-affinity/README.md`. Reading `0x11`
from Windows is an operating-system return value, not a verification.

## Troubleshooting

| What you see                                                 | What to check                                                                                                                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Windows warns that the app is unrecognised                   | Expected for an unsigned build. See "Get the app". Do not turn the protection off                                                                                                                |
| "Server could not be reached"                                | The address, your network, and for a tunnel whether the `ssh` window is still open. `localhost` means this PC                                                                                    |
| "Not a RealtimeDocs server"                                  | The address points at something else, for example the wrong port                                                                                                                                 |
| "Versions do not match", or "Update required" in the panel   | The app is too old for the server or the document. Get the current build                                                                                                                         |
| The address is refused as plain HTTP                         | Use the HTTPS address, or a tunnel to `127.0.0.1`. The development switch is for test networks only                                                                                              |
| "Open in Desktop" does nothing                               | Start the app once from its final folder (or install it), so that it registers the link handler, and allow the browser to open it. Or use "Paste share link"                                     |
| The link "belongs to a different server"                     | Enter the address exactly as the browser shows it, or tick "Accept links for …" on the Connection tab if it is offered                                                                           |
| "That does not look like a RealtimeDocs share link"          | Paste the complete original link, including the part after `#`                                                                                                                                   |
| The question "This link is for a different server" went away | The question is withdrawn after three minutes, and answering "Cancel" blocks that server for ten seconds. Wait a moment and paste the link again                                                 |
| Several links were ignored                                   | More than five "Open in Desktop" links within ten seconds are dropped. Wait and try once                                                                                                         |
| "Access expired" or "Access revoked"                         | The link or session ended, or an administrator removed the access. Ask for a new link or open the document from the browser again                                                                |
| The session is "In memory only"                              | Windows data protection was not available to the app. The session ends when the app quits; nothing was written to disk                                                                           |
| A shortcut does nothing                                      | Settings → Behaviour & Shortcuts shows whether it is registered. See "When a shortcut cannot be registered"                                                                                      |
| The panel is not on any screen, or has disappeared           | Tray menu → "Show", or "Return to interactive mode", or the emergency shortcut. If the display it was on was disconnected, it was hidden on purpose (see "Fail-safe when a display disconnects") |
| The panel does not react to the mouse                        | Click-through is on. See "Every way back to interactive mode"                                                                                                                                    |
| Clicking the badge does not end click-through                | A window with administrator rights is in the foreground. Use the shortcut or the tray icon                                                                                                       |
| The panel cannot be hidden or put into click-through         | Neither the tray icon nor a shortcut is available to bring it back. Fix the shortcut registration first                                                                                          |
| The panel suddenly has a taskbar button                      | The tray icon and the show/hide shortcut were both unavailable, so the omission was switched off. See "Taskbar omission"                                                                         |
| The panel shows "Protection unavailable"                     | Windows older than 10 version 2004, or the window has not been drawn since the request (an occluded window that is not being drawn stays so until it is uncovered)                               |
| Settings says the preferences were repaired                  | The preferences file was damaged or outdated and was repaired. Check that the settings are what you expect                                                                                       |

For a report to whoever supports you: Settings → Diagnostics & About → "Copy report". It contains
versions, window and display geometry and registration results, and no session, share link or
document text.

## Manual native test checklist

Run this on Windows 10 (version 2004 or later) and on Windows 11, on x64 and, if you have one, on
an ARM PC. Write down the Windows build (`winver`), the app version and the result of every line.
**None of these lines has been checked yet.** Screen-share outcomes go into the Privacy Test Center.

**Start and identity**

- [ ] The app starts from the unpacked folder. Note any Windows prompt word for word.
- [ ] First start shows the panel at the top right of the main display with the Safe Share Guide. A
      tray icon is present. The panel has no taskbar button; Settings → Behaviour & Shortcuts →
      "Show in the taskbar" brings it back.
- [ ] Make the tray icon unavailable and take the show/hide shortcut with another application: the
      app returns to the taskbar by itself and says so.
- [ ] No permission prompt of any kind appears at any time (camera, microphone, screen recording,
      accessibility, Bluetooth, local network), and no UAC prompt appears at any time for normal use.
- [ ] Starting the app a second time shows the existing panel; no second copy stays running.
- [ ] For a signed build: Windows shows the publisher and no warning.
- [ ] Installer: install as a standard user (no UAC prompt) to `%LOCALAPPDATA%\Programs\RealtimeDocs`;
      the Start-menu entry exists; `realtimedocs://` opens the app; autostart is on only when ticked;
      uninstall removes the app folder, shortcut, link handler and autostart entry. Repeat for the
      arm64 installer on an ARM PC.

**Displays**

- [ ] At 100 %, 125 %, 150 % and 200 % scaling: text is sharp, grips and buttons react where they
      are drawn, the 44-pixel collapsed strip is fully visible.
- [ ] Two displays with different scaling: drag the panel across and resize it near the boundary.
      Size and position stay as dragged, without a jump.
- [ ] Put the panel on the second display, quit, unplug that display, start: the panel appears on
      a remaining display (private mode off) or is hidden with the "Notes display disconnected"
      notice (private mode on), and only "Show", "Return to interactive mode" or starting the app
      again brings it back.
- [ ] Private mode on, panel on a second display, unplug that display while the app runs: the panel
      is hidden, not moved onto the remaining display; the notice appears as a notification and in
      the tray tooltip. Change resolution and arrangement; rotate a display.
- [ ] Sleep and wake, lock and unlock: the panel is still reachable, pin and private mode are
      still applied (Diagnostics shows the value read back).

**Window behaviour**

- [ ] Window order: with private mode on, start screen sharing first, then start the app and open a
      document: the panel never flashes into the shared view while it appears.
- [ ] Transparency: at 10 %, 50 %, 86 % and 100 % opacity over light, dark and busy backgrounds
      the text stays opaque; "Outline" and "Scrim" improve readability; no black or white rectangle
      behind the panel; no shadow artefacts. Reading density "Compact", "Comfortable" and
      "Spacious" change the spacing.
- [ ] All eight resize grips with a mouse and with a touchpad, **especially the left and top
      edges**, which the automated tests could not drive with a real pointer. Minimum and maximum
      size hold. Presets, keyboard commands, collapse and expand work.
- [ ] Settings → Diagnostics & About → "Open probe window": record what happens when Windows
      resizes a see-through window on this PC.
- [ ] Pin on and off, both "Stay above" levels: above a full-screen video, above a borderless
      full-screen application, with virtual desktops, with Snap layouts.
- [ ] Hide and show with the button, the global shortcut and the tray. Closing the panel hides it.
      Quit only from the tray menu, and it completes within a few seconds.
- [ ] Switch to a normal window and back ("More" menu): the normal window is framed, has a taskbar
      button, is never on top and never click-through; the document stays open without a new link;
      each mode keeps its own position; the switch is refused while changes are unsaved.
- [ ] While you type in another application, someone else edits the document: the panel updates
      and **your typing continues in the other application**.
- [ ] Open a document with "Open in Desktop" while another application has the focus: the panel
      appears without taking the keyboard.

**Click-through and recovery**

- [ ] Turn click-through on: clicks reach the window underneath; the badge names the way back.
- [ ] Return with the emergency shortcut (`Ctrl+Alt+Shift+T`), with the tray item "Return to
      interactive mode" (it also un-collapses, shows, raises and moves the panel fully onto a
      display), with a left click on the tray icon, by starting the app again, and by resting the
      pointer on the badge.
- [ ] With an elevated window (Task Manager) in the foreground, the badge is expected to stop
      reacting; the shortcut and the tray must still work.
- [ ] Give both shortcuts to another running application first: the app reports each conflict on
      its own, and with no tray available it refuses to enter click-through.
- [ ] Click-through is off again after a restart.

**Tray and shortcuts**

- [ ] Left click on the tray icon shows the panel; right click opens the menu. The icon is readable
      on light and dark taskbars and in the overflow area.
- [ ] The tray menu is exactly Show, Hide, Return to interactive mode, Click-through Mode,
      Reconnect, Privacy Test Center, Settings, Quit.
- [ ] The two global shortcuts with their defaults on a US, a UK, a German and an Indic keyboard
      layout. Typing with AltGr is unaffected. Change a shortcut in Settings; reset to defaults.
- [ ] The tray tooltip, the status chip and the Privacy & Capture tab show the same status label
      ("OS protection accepted" and so on) and never the document title while private mode is on;
      the taskbar entry (when shown) and Alt+Tab say "RealtimeDocs".
- [ ] The Safe Share Guide opens on first start and from the chip, the "More" menu and Settings.
- [ ] The Privacy Test Center tab opens from the tray menu; a record can be saved only with a remote
      observation; records survive a restart.
- [ ] With the diagnostics module built and packaged: Diagnostics shows it present with its SHA-256
      prefix and affinity `exclude_from_capture`; the checks in the module's README pass. Without
      it, Diagnostics says "Diagnostics module not present — status from Electron only".

**Text input**

- [ ] Input methods (Hindi, Japanese, Chinese): composing text never triggers a panel command, and
      the candidate window is placed correctly over the see-through panel.
- [ ] Touchpad: two-finger scrolling works; pinching does not zoom the page.
- [ ] Clipboard: copy and paste with the keyboard in the document (text, and an image if you can
      edit); "Copy report" in Diagnostics; pasting a share link. The link field is empty again
      after a successful open.

**Links and connection**

- [ ] A `realtimedocs://` link from the browser with the app running, and with it closed.
- [ ] A link for another server is refused with a clear message.
- [ ] Move the portable folder, start the app once, and try "Open in Desktop" again.
- [ ] Paste a share link for the configured server, and one for another server (the app must ask
      before switching, in a Windows dialog that names both servers and defaults to Cancel).
- [ ] The Connection tab says the session is "Encrypted by the operating system"; the session
      survives a restart; "Close document and forget session" removes it.
- [ ] A server that is reachable by private IP address only, over HTTPS, and over plain HTTP with
      the development switch: note any block or prompt.
- [ ] Revoke the share link in the browser while the panel shows the document: the panel reports
      that access ended and shows no further updates.

**Live document**

- [ ] The sample document looks the same in the panel as in the browser: headings, the table, the
      image, the code block, the link, the diagram, the callout, Hindi text and emoji.
- [ ] Two people edit at once, one in the browser and one in the panel: both see each other's
      changes, and "Saved" appears on both sides.
- [ ] Follow Latest: it scrolls to new content, pauses when you scroll back or select text, and
      "Jump to latest" appears.
- [ ] Disconnect the network and reconnect: the state goes to "Reconnecting" or "Offline" and back
      to "Live".

## Manual capture checks

Checking what a meeting participant sees with private mode on is a separate procedure with its own
record sheet: [capture-compatibility.md](capture-compatibility.md). Record each check in the Privacy
Test Center ([privacy-test-center.md](privacy-test-center.md)). A screenshot taken on this PC is not
evidence of what participants receive.
