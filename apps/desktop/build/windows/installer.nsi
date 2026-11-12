; RealtimeDocs Desktop — per-user Windows installer (NSIS 3).
;
; Installs for the current user only: no administrator rights, nothing under
; Program Files or HKLM. What it does:
;   - copies the packaged app (out\RealtimeDocs-win32-<arch>) to
;     %LOCALAPPDATA%\Programs\RealtimeDocs
;   - a Start-menu shortcut
;   - an uninstaller, listed under "Installed apps" for this user
;   - registers realtimedocs:// under HKCU\Software\Classes (the app also does
;     this itself at first start)
;   - starts with Windows ONLY if the user ticks that option (off by default)
;
; Build (on Windows, or anywhere makensis 3.08+ is installed):
;   pnpm --filter @realtimedocs/desktop run package:win:installer
; which runs, per architecture:
;   makensis -DARCH=x64 -DVERSION=0.1.0 -DSOURCE_DIR=<out\RealtimeDocs-win32-x64>
;            -DOUT_FILE=<out\RealtimeDocs-0.1.0-win32-x64-setup.exe> build\windows\installer.nsi
;
; Signing (placeholders, environment only; nothing secret is in this file):
;   -DSIGN_COMMAND="signtool sign /fd SHA256 /tr <timestamp URL> /td SHA256 /sha1 <thumbprint>"
;   signs the installer and the uninstaller it writes ("%1" is the file).
;   The app's own files are signed by `package:win` before they get here.

Unicode true
ManifestDPIAware true
RequestExecutionLevel user
SetCompressor /SOLID lzma

!ifndef ARCH
  !error "Pass -DARCH=x64 or -DARCH=arm64"
!endif
!ifndef VERSION
  !error "Pass -DVERSION=<app version>"
!endif
!ifndef SOURCE_DIR
  !error "Pass -DSOURCE_DIR=<packaged app folder>"
!endif
!ifndef OUT_FILE
  !define OUT_FILE "RealtimeDocs-${VERSION}-win32-${ARCH}-setup.exe"
!endif

!define APP_NAME "RealtimeDocs"
!define APP_EXE "RealtimeDocs.exe"
!define PUBLISHER "RealtimeDocs"
!define URL_SCHEME "realtimedocs"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\RealtimeDocs"
!define RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define UNINSTALLER "Uninstall RealtimeDocs.exe"

; x64: a 64-bit installer. arm64: the 32-bit x86 installer, which Windows 10
; and 11 on ARM run through their built-in emulation (NSIS has no ARM64 stub);
; it only copies files and writes per-user registry keys that are not
; redirected for 32-bit programs.
!if "${ARCH}" == "x64"
  Target amd64-unicode
!else
  Target x86-unicode
!endif

!ifdef SIGN_COMMAND
  !finalize '${SIGN_COMMAND} "%1"'
  !uninstfinalize '${SIGN_COMMAND} "%1"'
!endif

Name "${APP_NAME}"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\${APP_NAME}"
InstallDirRegKey HKCU "${UNINSTALL_KEY}" "InstallLocation"
BrandingText "${APP_NAME} ${VERSION} (${ARCH})"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "FileDescription" "${APP_NAME} Desktop installer"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "CompanyName" "${PUBLISHER}"
VIAddVersionKey "LegalCopyright" "${PUBLISHER}"

!include "MUI2.nsh"

; Compile-time paths use "/": makensis accepts it on every host, "\" only on Windows.
; The build script passes the icon as an absolute path (-DICON_FILE=…).
!ifndef ICON_FILE
  !define ICON_FILE "${__FILEDIR__}/../icons/icon.ico"
!endif
!define MUI_ICON "${ICON_FILE}"
!define MUI_UNICON "${ICON_FILE}"
!define MUI_COMPONENTSPAGE_NODESC
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Start ${APP_NAME}"

!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "${APP_NAME}" SectionApp
  SectionIn RO
  SetOutPath "$INSTDIR"
  File /r "${SOURCE_DIR}/*.*"
  WriteUninstaller "$INSTDIR\${UNINSTALLER}"

  CreateShortCut "$SMPROGRAMS\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0

  ; realtimedocs:// for this user. "--" ends the options, so nothing in a link
  ; can be read as a command-line switch. The same command line as the app
  ; writes itself (Electron's setAsDefaultProtocolClient with the argument "--").
  WriteRegStr HKCU "Software\Classes\${URL_SCHEME}" "" "URL:${APP_NAME}"
  WriteRegStr HKCU "Software\Classes\${URL_SCHEME}" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\${URL_SCHEME}\DefaultIcon" "" "$\"$INSTDIR\${APP_EXE}$\",0"
  WriteRegStr HKCU "Software\Classes\${URL_SCHEME}\shell\open\command" "" "$\"$INSTDIR\${APP_EXE}$\" $\"--$\" $\"%1$\""

  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$\"$INSTDIR\${APP_EXE}$\",0"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" "$\"$INSTDIR\${UNINSTALLER}$\""
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" "$\"$INSTDIR\${UNINSTALLER}$\" /S"
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

; Off unless the user ticks it.
Section /o "Start ${APP_NAME} when I sign in" SectionAutostart
  WriteRegStr HKCU "${RUN_KEY}" "${APP_NAME}" "$\"$INSTDIR\${APP_EXE}$\""
SectionEnd

Section "Uninstall"
  DeleteRegValue HKCU "${RUN_KEY}" "${APP_NAME}"
  ; Only remove the link handler if it is still ours.
  ReadRegStr $0 HKCU "Software\Classes\${URL_SCHEME}\shell\open\command" ""
  StrCmp $0 "$\"$INSTDIR\${APP_EXE}$\" $\"--$\" $\"%1$\"" 0 +2
    DeleteRegKey HKCU "Software\Classes\${URL_SCHEME}"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  Delete "$SMPROGRAMS\${APP_NAME}.lnk"
  ; The app folder only. Preferences and the stored session live in the
  ; user's profile (%APPDATA%\RealtimeDocs) and are the user's to delete.
  RMDir /r "$INSTDIR"
SectionEnd
