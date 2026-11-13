# Desktop release guide

How a desktop build gets from `pnpm package` to a person's computer, what the server checks, what the
app does about updates, and how signing and notarisation are meant to be switched on. Written for the
operator who publishes releases.

## Status of each part

| Part                                                                                 | Status                                                                                                                                   |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Release store, manifest, latest / list / update endpoints, Range downloads, counters | IMPLEMENTED AND VERIFIED (unit tests; integration suite against PostgreSQL)                                                              |
| `scripts/publish-release.mjs` (publish, `--rollback`, `--rollout`)                   | IMPLEMENTED AND VERIFIED (unit tests, including real filesystem runs)                                                                    |
| Artifact names `RealtimeDocs-<version>-<windows\|macos\|linux>-<arch>.<ext>`         | IMPLEMENTED AND VERIFIED (packaging scripts, inspection, unit tests)                                                                     |
| Linux arm64 package: build, inspect, packaged-app check under Xvfb                   | IMPLEMENTED AND VERIFIED on Linux arm64 (smoke only: no compositor, no real tray); built and inspected in CI, not started on arm64 there |
| Linux x64 package                                                                    | IMPLEMENTED AND VERIFIED (packaged-app Xvfb check passed in CI)                                                                          |
| Windows x64, macOS arm64 and x64 zips, `.dmg` files                                  | Built on native runners in CI and launch-tested natively there (stayed running 20 s); not manually tested; unsigned                      |
| Windows arm64 zip                                                                    | IMPLEMENTED BUT NOT NATIVE-TESTED (built and inspected, never started on Windows arm64)                                                  |
| Windows installer `.exe` (NSIS), AppImage                                            | NOT PRODUCED in release 0.1.0 (see "Release 0.1.0")                                                                                      |
| Update check, verified download, Settings -> Updates, "update required" state        | IMPLEMENTED AND VERIFIED (unit tests; Linux/Xvfb smoke suite still passes)                                                               |
| Windows Authenticode signing                                                         | CONFIGURED BUT REQUIRES CREDENTIAL (certificate, Windows runner)                                                                         |
| macOS Developer ID signing and notarisation                                          | CONFIGURED BUT REQUIRES CREDENTIAL (Apple Developer account, macOS runner)                                                               |
| In-place update on request ("Update and restart")                                    | IMPLEMENTED; verified end to end on Linux; Windows and macOS not yet run (see "Updates")                                                 |
| `.github/workflows/ci.yml`, `desktop-release.yml`                                    | EXECUTED on GitHub (2026-11-12); `desktop-release.yml` run 43195585865 succeeded                                                         |

Nothing here has been signed or notarised, and nobody has operated the app by hand on Windows or
macOS. The only native evidence on those systems is the launch check in CI (see "Release 0.1.0"). The
server and the web app never claim otherwise: they show the signature status the operator wrote into
`release.json`.

## Artifact names and the matrix

Every published file is named exactly `RealtimeDocs-<version>-<platform>-<arch>.<ext>` with platform
`windows`, `macos` or `linux`, arch `x64`, `arm64` or `universal`, and ext `zip`, `exe`, `dmg`,
`AppImage` or `tar.gz`. The server refuses any other name.

| Platform | Files the pipeline produces                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Windows  | `-windows-x64.zip`, `-windows-arm64.zip`, `-windows-x64.exe`, `-windows-arm64.exe` (NSIS per-user installer; needs `makensis`)       |
| macOS    | `-macos-arm64.zip`, `-macos-x64.zip`; `-macos-universal.zip` and `.dmg` only on a Mac (`@electron/universal` and `hdiutil` need one) |
| Linux    | `-linux-x64.zip`, `-linux-arm64.zip` and the same as `.tar.gz`. **No AppImage:** it needs `appimagetool` and FUSE                    |

The packager's own folders keep their Electron names (`RealtimeDocs-win32-x64`); only the published
archives and installers use the public names.

## Release directory layout

```text
<DOWNLOAD_DIR>/
  channels/stable.json              {"version":"1.2.0","rolloutPercent":25}   (rolloutPercent optional)
  channels/beta.json
  releases/stable/1.2.0/
    release.json                    written by publish-release.mjs, validated by the server
    SHA256SUMS
    RealtimeDocs-1.2.0-windows-x64.zip
    ...
  releases/stable/1.1.0/            previous releases stay on disk; rollback = point back
```

`release.json` fields: `version` (semver), `channel`, `publishedAt`, `notes` (Markdown, at most
20,000 characters), optional `minimumSupportedVersion`, and `artifacts[]` with `platform`, `arch`,
`format`, `fileName`, `sizeBytes`, `sha256`, `minimumOsVersion`, `signatureStatus`
(`signed`, `unsigned`, `notarized`, `dev-signed`).

The server re-checks everything at load and never trusts the file blindly. An artifact is offered
only if its name is exactly the pattern for its fields, it is a regular file (not a link) directly in
that release directory, its size matches, and its SHA-256 (streamed once, cached by path, size and
modification time, off the request path) matches the manifest. A mismatch means the file is not
offered and the administrator page lists it as a problem. Request handlers look files up in the
loaded manifest; no path is ever built from request input. The directory is re-read at most every two
seconds.

The legacy layout (the four flat files `realtimedocs-<windows|macos>-<x64|arm64>.zip` and an optional
`release.json` in the top directory) keeps working and keeps being served, so the live site does not
change until you publish a versioned release. Once a current stable release with verified files
exists, `GET /api/downloads` is fed from it instead.

## Publishing

```sh
node scripts/publish-release.mjs <dir-with-the-built-files> \
  --channel stable --notes-file NOTES.md --target <staging-dir> \
  [--signed-windows] [--notarized-macos] [--minimum-supported 1.0.0] [--rollout 25] [--no-activate]
```

- It accepts only correctly named files (others are listed and ignored), requires one version,
  computes sizes and SHA-256, writes `release.json` and `SHA256SUMS`, copies into a temporary
  directory and renames it into place, so a half-copied release never exists. It refuses to overwrite
  an existing version: releases are immutable.
- **Signing is stated, never inferred.** Without `--signed-windows` every Windows file is recorded as
  `unsigned`; without `--notarized-macos` every macOS file is. Linux files are always `unsigned`.
  Only pass a flag if you verified it (`Get-AuthenticodeSignature`, `codesign`, `stapler validate`).
  The release workflow measures this on the built files.
- The channel pointer is replaced atomically (temporary file, then rename) after the files are in
  place. `--no-activate` publishes the files and leaves the pointer alone.
- `--rollout <percent>` sets a staged rollout on the pointer. On its own (no directory) it changes the
  rollout of the current release.
- `--rollback <version> --channel stable --target <dir>` points the channel back at a release that is
  still on disk. Nothing is deleted. Installs already on the newer version are not downgraded; they
  simply stop being offered anything newer.

Getting the tree into the running server (the server reads the directory on its own, no restart):

```sh
# Not run on this host. Replace the container name for your deployment; the live one is
# realtimedocs-server-1 with the volume realtimedocs_rd_downloads.
docker cp <staging-dir>/. realtimedocs-server-1:/data/downloads/
```

Copy `releases/<channel>/<version>/` first and `channels/<channel>.json` last, so the pointer never
names files that are not there yet. Never `rm` or `--delete` older releases.

### Migrating from the four flat files

1. Build with the new names and publish a versioned release as above.
2. Check `/download` and `/admin/releases` (signed in as an administrator).
3. When satisfied, remove the old flat files and the top-level `release.json` from the volume. Until
   then they are still served and the administrator page lists them.

## Endpoints

All are public and under the API rate limiter. The artifact download has its own limit,
`RATE_DOWNLOAD_PER_IP` (default 60 GET requests per client address per 10 minutes).

| Endpoint                                                                         | Purpose                                                                                                                                                                  |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/v1/desktop/releases/latest?platform=&arch=&channel=`                   | The file for a computer. Falls back to request headers only when `platform` is absent, and then says so in `detected`. 404 `RELEASE_NOT_AVAILABLE` when nothing matches. |
| `GET /api/v1/desktop/releases?channel=`                                          | Releases (newest first) with notes and verified artifacts.                                                                                                               |
| `GET /api/v1/desktop/releases/:version?channel=`                                 | One release.                                                                                                                                                             |
| `GET /api/v1/desktop/update?platform=&arch=&channel=&currentVersion=&installId=` | The update manifest for the app (`updateAvailable`, `required`, `sha256`, ...). Optional `schemaVersion`, `protocolVersion`.                                             |
| `GET`, `HEAD /download/releases/:channel/:version/:fileName`                     | The file: attachment, `nosniff`, immutable cache (names are versioned), `ETag` = the SHA-256, **Range requests (resumable)**.                                            |
| `GET /api/admin/releases`                                                        | Administrators: releases, checksums, signature status as stated, download counts, problems.                                                                              |
| `GET /api/meta`                                                                  | Additive fields `minimumSupportedClientVersion`, `recommendedClientVersion`, `documentSchemaVersion`, `updateUrl`.                                                       |

`downloadUrl` values are paths on the same server, not absolute URLs: a client resolves them against
the address it already uses (the desktop app additionally refuses any URL that is not on its
configured server).

Format preference per platform: Windows `.exe` only when it is stated `signed`, otherwise `.zip`;
macOS `.dmg` only when `notarized`, otherwise `.zip`; Linux AppImage, then `.zip`, then `.tar.gz`.
Windows on Arm may be offered the x64 build; macOS may be offered a `universal` build; nothing else
falls back across architectures.

### Staged rollout and required updates

`rolloutPercent` applies to the update check only (the download page always shows the current
release). An install is placed by a stable hash of its random `installId` and the version: the same
install always gets the same answer, and raising the percentage only adds installs. An install
without an id is outside any partial rollout. An update is `required` when the app's version is below
the release's `minimumSupportedVersion`, or the app's document schema or collaboration protocol is
incompatible with the server; a required update is never held back by a rollout.

### Download counters

`release_download_counts (day, channel, version, platform, arch, format, count)` is incremented once
per full or first-range `GET`. No address, no user agent, no identifier is stored.

## Updates in the desktop app

On start (after 20 seconds), every 6 hours and from Settings -> Updates, the app calls the update
endpoint of its configured server with platform, architecture, channel, current version, document
schema and protocol versions, and a random install id (a UUID in `update-state.json`, used only for
the rollout hash). Settings -> Updates shows the version, the notes (as plain text), size, SHA-256 and
the signature status in plain words.

Nothing is downloaded or installed until the person asks. Every download comes only from the
configured server origin: no redirect is followed, the URL must be the release path announced for that
version and file name, the file name must match the strict pattern, and the size is capped at what was
announced. The file is written as `<name>.part` in the Downloads folder and renamed only after size and
SHA-256 match; otherwise it is deleted.

### Update and restart

"Update and restart" (Settings -> Updates; the tray menu shows "Update to version …" while one is on
offer and leads there) is one click that does the rest. It replaced the earlier rule that the app never
installs anything; see [decisions.md](decisions.md), "In-place update on request". The steps, each shown
by name while it runs (the download with a real percentage and byte count, the others with a moving
indicator that stands still when the system asks for reduced motion):

1. **Downloading** and **Verifying**: as above; size and SHA-256 must match the manifest.
2. **Unpacking**: the archive's listing is checked first (one top-level folder with the expected name,
   the application in it, no absolute path, no `..`, no link in a Windows archive), then it is unpacked
   into a new folder with a random name next to the installation: `%SystemRoot%\System32\tar.exe` on
   Windows, `/usr/bin/ditto` on macOS, `unzip`, `bsdtar` or `tar` on Linux.
3. **Installing**: the unpacked tree is walked (only files, folders and links that stay inside it), the
   executable must exist and be built for this processor, and the version inside `app.asar` must be the
   announced one. On Windows and Linux the installed folder must hold nothing but the app, because the
   whole folder is replaced. Then a small helper script is written to a private temporary folder and
   started detached: PowerShell on Windows (never elevated), `/bin/sh` on macOS and Linux. It contains
   only quoted absolute paths that the app computed from its own location, and the process id.
4. **Restarting**: only after the helper has reported that it runs does the app quit, the ordinary way
   (preferences are saved; recovery drafts are already on disk). The helper waits for the process to end,
   renames the installation aside, renames the new version into place, starts it, waits six seconds,
   and only then deletes the previous version. If a rename fails or the new version does not stay up,
   it moves the previous version back, starts it and records the step that failed.

After the restart the app compares its own version with the one it was to become: "Updated to
<version>" is shown once in the panel and in Settings, or "The update was not installed" with the
reason and the statement that the previous version was kept. The profile folder is never touched.

**When the app does not replace itself** it says why and offers the manual way ("Download only", then
"Show in folder" / "Open download"): a copy started from the source tree; macOS App Translocation (the
app was opened straight from the downloaded folder; move it to Applications); a folder the account
cannot change (a read-only volume, a system location); a copy installed by the Windows installer; an
AppImage; a server that offers an installer rather than an archive; an installed folder that also holds
other files; a Linux computer without `unzip`, `bsdtar` or a `.tar.gz` package. It never asks for
administrator rights.

**What an update is trusted on.** The builds are not code-signed, so the operating system does not
vouch for a new version. The app trusts the server it is configured for, over that server's HTTPS
connection, and the SHA-256 that server announces; it also refuses a version that is not newer than
the running one and a build for another platform. Whoever controls that server (or its release
directory) can therefore ship code to every desktop that clicks "Update and restart". Because the app
fetches the file itself, macOS does not apply its first-open check to the new version. Signed and
notarised builds would add a second, independent check; the place for it is the "Installing" step.

**How it was checked.** `apps/desktop/scripts/update-check.mjs` installs a packaged build into a scratch
folder, starts it, serves a newer build from a local HTTP server and runs the app's own update service,
installer and helper against it; it passes on Linux (tar.gz, under Xvfb). The workflow
`.github/workflows/desktop-update-check.yml` runs the same script on Windows, macOS and Linux runners.
The script ends the old process itself: a packaged build cannot be driven from outside, so the click,
the IPC call and the app's own quit are covered by unit tests and an Xvfb smoke test instead.

"Remind me later" is allowed unless the update is required. When it is required, the panel shows an
"Update required" state with the way to Settings -> Updates, and the editor's unsupported-content
notice offers the same "Update RealtimeDocs" action.

## Setting up signing

### Windows (Authenticode)

You need a code-signing certificate (an OV/EV certificate in a `.pfx`, or a cloud service such as
Azure Trusted Signing) and a Windows machine. Set, before `package.mjs`:

- `WINDOWS_CERTIFICATE_FILE` and `WINDOWS_CERTIFICATE_PASSWORD`, or `WINDOWS_SIGN_WITH_PARAMS`
  (signtool arguments, for a certificate store, token or the Azure dlib), or `WINDOWS_SIGN_HOOK_MODULE_PATH`;
- `WINDOWS_INSTALLER_SIGN_COMMAND` (a full `signtool sign ...` command) for the NSIS installer and
  uninstaller.

The optional native diagnostics module must be signed before packaging, because its hash is embedded.
Verify with `Get-AuthenticodeSignature` on `RealtimeDocs.exe` and on the installer; only then pass
`--signed-windows`. Details: [windows-client.md](windows-client.md).

### macOS (Developer ID and notarisation)

You need an Apple Developer Program membership, a "Developer ID Application" certificate exported as
`.p12`, and a Mac. Set `APPLE_SIGNING_IDENTITY` and one notarisation credential set
(`APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`, or the API-key or keychain-profile
variants described at the top of `apps/desktop/scripts/package.mjs`). The packaging script signs with
the hardened runtime, submits to Apple's `notarytool` through `@electron/notarize`, and staples.
Verify with `codesign --verify --deep --strict`, `spctl -a -vv` and `xcrun stapler validate`; only then
pass `--notarized-macos`. An ad-hoc signature (`-`) is not notarisation. Details:
[macos-client.md](macos-client.md).

### CI

`.github/workflows/desktop-release.yml` (manual dispatch with `channel`, `rollout_percent`,
`activate`, `notes`; or a `desktop-v<version>` tag whose version must equal
`apps/desktop/package.json`) builds on `windows-latest`, `macos-15` (arm64), `macos-15-intel` (x64) and
`ubuntu-latest` (the earlier labels `macos-14` and `macos-13` are no longer offered by GitHub), runs the
desktop unit tests, the Linux packaged-app check and, on each OS, `apps/desktop/scripts/launch-check.mjs`
(it starts the packaged executable on its own OS and requires it to stay running for 20 seconds), imports signing
material only if the secrets listed in the file's header exist, **measures** the resulting signature
status on the built files, creates checksums and a CycloneDX SBOM (`pnpm sbom`), and a final
`publish-manifest` job (which `needs:` every build) runs `publish-release.mjs` with flags decided from
the measured status and uploads the release tree as a workflow artifact, and to an S3-compatible
bucket only if bucket credentials exist (new version first, pointer last, never `--delete`). It does
not create GitHub releases or tags. Status: executed on 2026-11-12; run 43195585865 succeeded on all
four runners. The Windows installer step is `continue-on-error`, because `makensis` was not on the
path after `choco install nsis`; a path fix was added, but in the successful run the installers were
still not produced, so no `.exe` is published.

## Release 0.1.0

Release 0.1.0 (channel `stable`, 2026-11-12) is the first published desktop release. Every file is
unsigned and none is notarised, because no signing credentials exist. The files are
`RealtimeDocs-0.1.0-windows-x64.zip`, `-windows-arm64.zip`, `-macos-arm64.zip`, `-macos-arm64.dmg`,
`-macos-x64.zip`, `-macos-x64.dmg`, `-linux-x64.zip`, `-linux-x64.tar.gz`, `-linux-arm64.zip` and
`-linux-arm64.tar.gz`. There is no Windows `.exe` installer and no AppImage.

How it got there. Three earlier runs of the release workflow failed, and each failure led to a fix:
`apps/desktop/build/` (icons, installer script) was untracked because the `build/` ignore rule hid it;
the `macos-14` and `macos-13` runner labels are no longer offered; the zip that a Mac makes with
`ditto` has the bundle as its top entry, so the archive inspection was adjusted; `makensis` was not on
the path after `choco install nsis`, so a path fix was added and the installer step became
`continue-on-error`; and a desktop unit test raced its own cleanup on macOS, which was fixed. Run
43195585865 then succeeded on `windows-latest`, `macos-15` (arm64), `macos-15-intel` (x64) and
`ubuntu-latest`.

Native evidence. The new script `apps/desktop/scripts/launch-check.mjs` started the packaged
executable on its own OS and it stayed running for 20 seconds for Windows x64, macOS arm64 and macOS
x64 (all in CI). Linux x64 passed the packaged-app Xvfb check in CI. Windows arm64 and Linux arm64
were built and inspected but never started on their own architecture in CI (Linux arm64 passes the
local Xvfb checks on this host). Nobody operated the app by hand on Windows or macOS, capture
exclusion was not measured, and no meeting application was tested. The honest label for the Windows
x64 and macOS zips is therefore: launch-tested natively in CI, not manually tested.

Download preference for Linux is now AppImage, then `.zip`, then `.tar.gz`
(`packages/contracts/src/releases.ts`).

Publishing. The release was copied into the live server's `rd_downloads` volume with `docker cp`
(release directory first, channel pointer last). The lead also created GitHub release v0.1.0 at
`https://github.com/namanjain221995/realdocs/releases/tag/v0.1.0` with the ten packages, `SHA256SUMS` and
the SBOM (12 files). The public URLs have the form
`https://realdocs.techsarasolutions.com/download/releases/stable/0.1.0/<fileName>`.

Verification of the public downloads. Every file was downloaded from its public URL: HTTP 200,
`application/zip` for the zips, `Content-Disposition: attachment`, size and SHA-256 equal to
`SHA256SUMS`, `unzip -t` clean, and a Range request answered 206. SHA-256 of the zips:

| File                                   | SHA-256                                                            |
| -------------------------------------- | ------------------------------------------------------------------ |
| `RealtimeDocs-0.1.0-windows-x64.zip`   | `21a958b70262140fbfd0c92d8c88fb572434c1f8f27a3f4eb12a317a008482eb` |
| `RealtimeDocs-0.1.0-windows-arm64.zip` | `18e6a27ecca175eb0ba698ca326f956b12f3466e3840237d08b7228314a0b770` |
| `RealtimeDocs-0.1.0-macos-arm64.zip`   | `862c4c7b3706c0a8da68fe9c7223a8333c234743f8b66d094a9d04921d275b4d` |
| `RealtimeDocs-0.1.0-linux-x64.zip`     | `d6019b97c237a05dec0c293f58b5cbcae77c7fd5ae5f1d0688baeab29306036c` |
| `RealtimeDocs-0.1.0-linux-arm64.zip`   | `776d684c410a21a67aba8a81ffc0012f0abfb05e9435217085c254d35137f550` |

For the macOS x64 files and the other formats, use the `SHA256SUMS` file in the release.

Browser download tests on the live landing page (Playwright with emulated user agents): Windows Chrome
and Firefox were offered `windows-x64.zip`; macOS Safari (WebKit) was offered `macos-arm64.zip`; Linux
Firefox was offered `linux-x64.zip`; choosing macOS manually and then the Intel build worked; an
iPhone got the statement that no download is available for this device and no download link. All
checksums matched.

## Rollback and incidents

1. Roll back: `node scripts/publish-release.mjs --rollback <good-version> --channel stable --target <dir>`
   (then `docker cp` the `channels/` file). The download page, `latest` and `/api/meta` follow within
   seconds; apps that already updated are not downgraded.
2. A bad file: remove or replace nothing; publish a fixed version and move the pointer. If a file must
   be withdrawn at once, point the channel to a previous version; a hash mismatch also withdraws a
   file automatically.
3. Raise `minimumSupportedVersion` in a new release to force old apps to update.

## Release 0.1.1 (2026-11-13)

Built by workflow run 43297554555 from commit `59bb292` on the same four runners as 0.1.0, unsigned and
not notarised. Published to the live server (release directory first, channel pointer last) and as GitHub
release `v0.1.1`. Release 0.1.0 stays on disk; `scripts/publish-release.mjs --rollback 0.1.0` points the
channel back.

Changes: the pinned panel defaults to the `screen-saver` window level and is visible on every workspace
and on full-screen applications (preference files written before version 3 take these defaults once); on
Windows the pin is applied again when the panel loses focus and every 1.5 seconds; the panel shows the
document ruler with the shared left and right margins; the "Follow latest changes" button left the panel
header (the setting stays in Settings, Behaviour).

Checked: desktop unit tests (706), Xvfb smoke (64), the real-stack suite (21, including margin
synchronisation in both directions) on Linux; the launch check on Windows x64, macOS arm64 and macOS x64
in CI; every published zip downloaded from the public address with matching SHA-256 and a clean
`unzip -t`. **Not checked:** whether the panel really stays in front of a full-screen browser or meeting
window on Windows and on macOS. That behaviour cannot be observed on this host or in the launch check and
needs a person at each kind of computer.

## Release 0.1.2 (2026-11-13)

Built by workflow run 43316396227 from commit `501258e`, unsigned and not notarised. Published with
`scripts/publish-release.mjs --minimum-supported 0.1.2` (the files of the run, checksums identical to the
run's `SHA256SUMS`), so the update check tells 0.1.0 and 0.1.1 that the update is required. It was
published to the live server before the server itself was upgraded to document schema 3.

Changes: paragraphs and headings carry a left, right and first-line indent (millimetres); the ruler
shows three markers for the paragraph of the caret or every selected block, next to the two page-margin
handles, in the web editor and in the desktop panel. Document schema version 3: an older client would
erase the new attributes from paragraphs it edits, so it is disconnected (close code 4426) from a
document at a newer schema and told to update.

Checked on native runners in CI: the launch check on Windows x64, macOS arm64 and macOS x64; the pinned
panel was topmost and in front of a full-screen Microsoft Edge window on Windows in three readings
(`apps/desktop/scripts/fullscreen-check.mjs`); on macOS arm64 and x64 the panel was at window level 1000
and on screen while Safari was in native full screen (`fullscreen-check-mac.mjs`). Checked on Linux: unit
tests (1,941), server integration (226), acceptance (42 + 12), web mocked (949, 2 skipped), web real
stack (69 + 18), editor browser checks in three engines, desktop smoke (64) and real stack (22).

**Not checked:** meeting applications, capture exclusion, a full-screen browser extension, a pointer drag
of an indent marker inside the desktop panel (keyboard there; pointer in the web checks), Windows arm64.
**Open:** the editor check `follow-latest-manual` failed once in 30 isolated Chromium runs on this code
and passed 10 of 10 on the previous commit; too few runs to tell a rare flake from a regression.
