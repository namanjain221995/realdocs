# win-display-affinity

A small Windows diagnostics module for the RealtimeDocs desktop app. It lets the app read back,
from the operating system, what display affinity its OWN window has, so the Privacy Test Center
can report honestly whether the OS accepted the request to exclude the window from capture.

**Status: written but never compiled or run.** It was authored on a headless Linux arm64 host
with no Windows toolchain. A syntax-only `g++ -fsyntax-only` pass against hand-written stand-ins
for `windows.h` and `dwmapi.h` (not the real headers) found no syntax errors; that proves nothing
about the real Windows build. Do the steps under "Build and test on Windows" before shipping it.

## Exports (exactly four, nothing else)

| Function                          | Returns                                 | Win32 call                                                         |
| --------------------------------- | --------------------------------------- | ------------------------------------------------------------------ |
| `getDisplayAffinity(hwnd)`        | `{ ok, affinity?, error?, win32Code? }` | `GetWindowDisplayAffinity`                                         |
| `setDisplayAffinity(hwnd, value)` | `{ ok, error?, win32Code? }`            | `SetWindowDisplayAffinity`; only `0`, `1` and `0x11` are accepted  |
| `isCompositionEnabled()`          | `{ ok, enabled?, error?, win32Code? }`  | `DwmIsCompositionEnabled`                                          |
| `flushComposition()`              | `{ ok, error?, win32Code? }`            | `DwmFlush` (addition to the original brief: waits one composition) |

`hwnd` is the `Buffer` from `BrowserWindow.getNativeWindowHandle()`. `error` is either a stable
name from this module's own checks (`invalid_argument`, `invalid_handle_size`, `invalid_affinity`,
`not_a_window`, `not_own_window`, `not_top_level`) or `win32_error`, in which case `win32Code` is
`GetLastError()` (or the failing `HRESULT` for the two DWM calls).

## Safety checks, inside the addon, before any call that takes a window

1. the buffer length equals `sizeof(HWND)`;
2. `IsWindow(hwnd)`;
3. `GetWindowThreadProcessId(hwnd)` belongs to `GetCurrentProcessId()`: only the app's own windows;
   a window of any other process is refused untouched;
4. `GetAncestor(hwnd, GA_ROOT) == hwnd`: top-level windows only.

The affinity value is validated before the window is even looked at.

## What this module does NOT do

It does not hook or inject into anything, intercept or patch capture APIs, touch other processes
or other applications' windows, install drivers, change security settings, or hide any process.
It calls four documented functions, on the application's own top-level windows, and reports the
answer. It cannot tell what another meeting participant receives: that needs a second device or
participant, which is what the Privacy Test Center records.

## Build and test on Windows

Requirements: Windows 10/11, Node 24 with the pinned pnpm, Visual Studio Build Tools 2022
("Desktop development with C++" and a Windows SDK), Python 3, and `node-gyp`
(`npm i -g node-gyp`, or the copy bundled with npm via `npm_config_node_gyp`).

```
pnpm install
cd apps/desktop
node scripts/build-native.mjs --arch x64      # and --arch arm64 on or for ARM
```

This runs node-gyp with `--runtime=electron --target=45.2.3 --dist-url=https://electronjs.org/headers`
and writes `native/dist/win32-<arch>/display_affinity.node` plus `display_affinity.node.sha256`.
The build uses `/W4 /WX /guard:cf`; fix any warning it reports.

Then verify on that machine:

1. `pnpm --filter @realtimedocs/desktop run package:win`. `collectNativeArtifacts` copies the `.node`
   file to `resources/native/win32-<arch>/` (outside the asar) and `native-manifest.json` with its
   SHA-256 goes inside the asar. `inspect-package` must still pass.
2. Start the packaged app, turn private mode on, open Diagnostics: the module must be reported as
   present, the window's affinity as `exclude_from_capture` (0x11), composition as enabled.
3. Turn protection off: affinity `none` (0). Try a Windows build before 10 version 2004: setting
   `0x11` should fail with a `win32_error`, and the app must report protection as unavailable.
4. Hand the module a window of another process (for example `FindWindow("Shell_TrayWnd")`) from a
   scratch script run inside Electron's main process: it must answer `not_own_window` and change nothing.
5. Pass a 4-byte buffer, an unknown value such as `2`, a non-buffer: each must return `ok: false`.
6. Edit one byte of the `.node` file: the app must refuse to load it and show
   "Diagnostics module not present — status from Electron only".
7. Repeat the whole Privacy Test Center procedure with a second device. The module reading
   `0x11` is an OS return value, not a verification.

## Lead review notes (2026-11-11)

- **Windows SDK:** use Windows SDK 10.0.19041 or later. `WDA_EXCLUDEFROMCAPTURE` first appears in those
  headers; `src/addon.cc` defines the documented value (`0x11`) itself when an older SDK lacks it, and
  `binding.gyp` pins `_WIN32_WINNT` / `WINVER` to `0x0A00` so the display-affinity functions are declared.
- **Sign the module with the app.** The `.node` file lives outside the asar, so asar integrity does not
  cover it; the loader's SHA-256 check (expected hash inside the asar) guards against a mismatched or
  half-replaced file. Anyone who can write to the installation directory can also replace the executable
  itself, so the real protection is code signing: when the Windows packages are signed, sign
  `display_affinity.node` with the same certificate (signtool) before its hash is computed and written
  into `native-manifest.json`.
- **What the review checked:** exactly four exports; the affinity value is validated before any window is
  looked at; every window argument must be a top-level window of this process (Windows itself also refuses
  `SetWindowDisplayAffinity` on another process's window, so this is defence in depth); no hooks, injection,
  other processes, drivers or security settings. `DwmIsCompositionEnabled` and `DwmFlush` failures are
  HRESULTs reported in the `win32Code` field.
- **Not built, not run:** nothing in this directory has been compiled or executed on Windows yet.
