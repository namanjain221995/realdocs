# RealtimeDocs Desktop on Linux

This guide is for the person who installs the RealtimeDocs desktop companion on a Linux computer
and for the operator who publishes it. It covers what runs, how to download and start the app, how
to check it, how updates work, and what Linux can and cannot do about screen capture.

## Verification status

- **IMPLEMENTED AND VERIFIED on Linux arm64 (Ubuntu 24.04, headless):** the package builds, its
  structure is inspected, and the packaged app starts under Xvfb and passes the 39 hardening
  checks of `test:packaged` (see [testing.md](testing.md) and [notes/desktop.md](notes/desktop.md)).
  Xvfb has no compositor, no tray host and no real display capture, so this is a **smoke test**.
- **IMPLEMENTED BUT NOT NATIVE-TESTED:** everything that needs a real desktop session: the
  see-through panel under GNOME, KDE, Sway or others, the tray icon, global shortcuts, Wayland
  versus X11 behaviour, the secret store (Secret Service, KWallet), `realtimedocs://` links, and
  the Linux x64 package (no x64 machine was available).
- **No AppImage is published.** Building one needs `appimagetool` and a FUSE-capable runner, which
  the pipeline does not install. The Linux artifacts are `.tar.gz` (and `.zip`).

## Supported systems

Electron 45 runs on a 64-bit Linux with glibc 2.31 or newer (Ubuntu 20.04 or later, Debian 11 or
later, Fedora current) on x64 and arm64. Release notes name the minimum for each file; the download
page shows it. A desktop session (X11 or Wayland) is required.

## Download and check

Open `/download` on your RealtimeDocs server (or the Download section of its front page). It
suggests the build for your computer and lists every file with its size and SHA-256 checksum.

```sh
sha256sum RealtimeDocs-<version>-linux-x64.tar.gz     # compare with the page
mkdir -p ~/Applications && tar -xzf RealtimeDocs-<version>-linux-x64.tar.gz -C ~/Applications
~/Applications/RealtimeDocs-linux-x64/realtimedocs
```

Linux packages are not code-signed. There is no SmartScreen or Gatekeeper equivalent; the checksum
above is your integrity check. Chromium's sandbox needs unprivileged user namespaces. On a system
that disables them (some hardened Ubuntu configurations), the app refuses to start rather than run
unsandboxed; enabling `kernel.unprivileged_userns_clone` or the AppArmor profile for the app is the
fix, and it is your decision, not something the app does for you.

## Updates

The app asks your server about new versions at start and every 6 hours, and from Settings ->
Updates. It never installs or replaces itself. "Download update" saves the new archive to your
Downloads folder, checks its size and SHA-256 against what the server announced and only then
offers "Show in folder". You extract it yourself. If the server marks an update as required (your
version is below its minimum), the panel says so and points to Settings -> Updates; unsaved work
stays on your computer.

## Capture exclusion on Linux

The app asks to keep its windows out of screen capture where the platform offers a request for
that. On Linux, whether that request exists and is honoured depends on the display server and the
compositor (X11 has no such request; Wayland compositors differ), and it **may be unavailable**.
The app shows what it could and could not do (Settings -> Privacy & Capture) and never claims more.
This is a privacy feature for your own windows. It does not hide the app from anyone, from any
process list or from any monitoring system, and it must not be used to bypass a policy.

## Troubleshooting

- Nothing happens when started from a terminal: run it from a terminal and read the output; a
  sandbox error means the user-namespace point above.
- No tray icon: many GNOME setups need an AppIndicator extension. The panel still works; the
  keyboard shortcuts are the way back from click-through mode.
- "Update required": open Settings -> Updates, download, verify, extract, start the new version.

For the operator: publishing, rollback and CI are described in [desktop-release.md](desktop-release.md).
