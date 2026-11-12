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
| Silent in-place self-update                                                          | NOT IMPLEMENTED, by decision (see "Updates")                                                                                             |
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

"Download update" is the only thing that downloads, and only from the configured server origin:
no redirect is followed, the URL must be the release path announced for that version and file name,
the file name must match the strict pattern, and the size is capped at what was announced. The file is
written as `<name>.part` in the Downloads folder and renamed only after size and SHA-256 match;
otherwise it is deleted. Then "Show in folder" and "Open installer" (or "Open download" for
archives) appear; they act only on that verified file, after a click.

**Decision: no silent self-replacement.** Replacing the running app without the user would require
code-signed builds (Windows Authenticode, Apple notarisation) so that the replacement can be verified
by the operating system, plus an installer flow that survives unsaved work. Neither exists yet, and an
unsigned auto-updater is exactly the mechanism a hostile server or a tampered mirror would want. So the
app never quits, installs or restarts by itself; unsaved changes are not touched (recovery drafts
already persist). When signed builds exist, the hook is this: the release manifest already carries
`signatureStatus` per file, and `UpdateService.reveal('open-installer')` is the one place that would
hand the verified file to an installer.

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
