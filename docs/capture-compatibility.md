# Capture compatibility

This document is for the person who will sit at a Windows PC or a Mac, with a second participant or
a second device, and find out what a meeting participant actually receives when the RealtimeDocs
desktop panel is open. It explains what the desktop app asks the operating system to do, what the
status names mean, how a result expires, and what to rely on instead. It then gives the matrix of
combinations to test, the exact test procedure, and the evidence record to fill in.

## The rule

**A configuration may be marked Verified only after a second participant or a separate receiving
device confirmed the result.** A local screenshot, an operating-system return value, an Electron
boolean or the app's own preview is insufficient proof.

**Nothing in this file was tested from the Linux build host.** Every result cell in the matrices
reads `NOT TESTED`. `NOT TESTED` is never converted to anything else without an evidence record in
the section "Evidence records" at the end of this file.

The Linux build host ran only Linux/Xvfb smoke tests of the desktop app. Those say nothing about
Windows or macOS capture behaviour.

## Contents

- What the desktop app asks the operating system to do
- Where to find things in the app
- The status names
- When a verification expires
- Matrix: Windows
- Matrix: macOS
- Test procedure
- Evidence record template
- Safe Share Guide and the macOS whole-display warning
- What to rely on instead
- What is out of scope
- What this project will not build
- Evidence records

## What the desktop app asks the operating system to do

Private mode is an option of the desktop app. When it is on, the app asks the operating system,
through a documented API, to leave the app's own windows out of screen capture. Electron describes
the call as follows. This is quoted from the documentation that ships with the installed
`electron@45.2.3` package (`electron.d.ts`, `BrowserWindow.setContentProtection`, platforms macOS
and Windows):

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

Microsoft's reference for the Windows function
(<https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity>),
as quoted in the desktop engineer's notes (`docs/notes/desktop.md`), adds a caution that applies to
everything below:

> It is important to note that unlike a security feature or an implementation of Digital Rights
> Management (DRM), there is no guarantee that using SetWindowDisplayAffinity and
> GetWindowDisplayAffinity, and other necessary functions such as DwmIsCompositionEnabled, will
> strictly protect windowed content, for example where someone takes a photograph of the screen.

These quotations describe the mechanism as its vendors document it. They are not test results for
any meeting application.

RealtimeDocs does not inject into, hook, patch or modify any meeting application or recording
pipeline, installs no capture driver and changes no system security setting. It controls its own
windows only.

On Windows 10 version 2004 or later (and on Windows 11) the documented behaviour is that the
window is removed from capture. Before version 2004 the operating system shows a black area
instead, so exclusion is unavailable there. On macOS, applications that capture with
ScreenCaptureKit can still include the window. Which capture interface a given meeting application
uses in a given version has not been checked by this project.

## Where to find things in the app

Several places in the desktop app show or record protection, and they have different jobs. The names
below are the labels in the app.

| Where                                            | What it is for                                                                                                                                                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The status chip in the panel's title strip       | Shows the current request status and, under "OS protection accepted", the verification line. Selecting it opens the explanation, the Safe Share Guide and a link to the Privacy Test Center                       |
| Settings → **Privacy & Capture**                 | The private-mode switch ("Private mode: request capture exclusion for RealtimeDocs windows"), the current status in full, the Safe Share Guide and what to rely on instead. It does **not** hold the test records |
| Settings → **Privacy Test Center**               | The tab where a check is recorded and where records, their expiry and the export are. This is the "Test Center" of this document. It is a different tab from "Privacy & Capture"                                  |
| Settings → **Diagnostics & About**               | Versions of the app and of Electron, the settings folder, the native resize probe, the Windows diagnostics module (present or not) and "Copy report"                                                              |
| The tray menu (Windows) or menu-bar menu (macOS) | "Show", "Hide", "Return to interactive mode", "Click-through Mode", "Reconnect", "Privacy Test Center", "Settings", "Quit". "Privacy Test Center" opens the tab above                                             |

**Private mode is on by default** for a fresh installation, because forgetting to switch it on is the
likeliest mistake. For the control run (Part A of the procedure) you therefore have to switch it off
first. A person who switched it off keeps that choice across updates.

## The status names

The app reports protection in two separate layers. The names below are the exact names the app
uses.

- **The request layer** is decided on the presenting computer, from documented APIs only. It says
  what RealtimeDocs asked the operating system for, and what the operating system answered. It
  never says anything about what another meeting participant receives.
- **The verification layer** is decided only by a second participant or a separate receiving
  device, for one exact configuration. The app cannot decide it by itself.

**"OS protection accepted" never means that a participant cannot see the panel.**

### Request layer

**Unsupported**

- Means: there is no documented way to exclude a window from capture here. This is the case on
  Linux, and in a web browser instead of the desktop app.
- Does not mean: that anything is wrong with the app, or that the document is shared. It says only
  that no request can be made.

**Protection unavailable**

- Means: this is a desktop system that has the control, but exclusion cannot be applied in the
  current situation. An example is Windows earlier than 10 version 2004, where the operating system
  can only replace the window with a black area. Another is a window that is not ready yet.
- Does not mean: that the panel is hidden. On older Windows a black area is shown where the panel
  is, which is not the same as the panel being left out.

**Protection off**

- Means: the person turned private mode off. This is a choice, not a failure.
- Does not mean: that the panel is visible to others. It means only that no request was made, so
  the panel is treated like any other window. This is also the control condition of every test.

**Protection request failed**

- Means: RealtimeDocs asked, and the request raised an error or the value read back did not agree
  with the request.
- Does not mean: that the panel was captured. It means that the app cannot tell the operating
  system state it asked for, so nothing should be assumed.

**OS protection accepted**

- Means: RealtimeDocs asked, the request returned without error, the value read back agrees (on
  Windows, the window's display affinity is `WDA_EXCLUDEFROMCAPTURE`, when the diagnostics module
  is present), and at least one desktop-composition cycle has passed. On macOS this is a
  best-effort request only.
- Does not mean: that a participant cannot see the panel. A meeting application may capture in a
  way that ignores the setting, as ScreenCaptureKit-based applications on macOS can. It also does
  not mean that any meeting application was tested.

### Verification layer

**Manual verification required**

- Means: there is no current record from a second participant or device for this exact
  configuration.
- Does not mean: that the panel is visible or that it is hidden. It means that nobody has
  confirmed either, so the result is unknown.

**Verified for this exact configuration**

- Means: a current record exists for this exact configuration (operating-system build, meeting
  application and version, client, capture mode, monitors, protection on or off), made by a second
  participant or a separate receiving device. The app shows the observed outcome next to the
  status.
- Does not mean: that the panel was left out. Only the outcome "Panel was omitted from the shared
  view" means that. A verified configuration can equally record "Panel appeared normally in the
  shared view". It also says nothing about any other configuration, and it does not stay current
  forever (see the next section).

**Verification expired after version change**

- Means: a record exists, but something it depends on has changed since, or the record is too old.
- Does not mean: that the earlier result was wrong, or that the new result is different. It means
  the old record can no longer be relied on, and the check has to be repeated.

### Observed outcomes

A second participant or device reports one of five outcomes. Use these labels in the result cells
once a row has been tested (the cell vocabulary is `omitted`, `black area`, `partial`, `visible` or
`artifact`), and never a word such as "success".

| Outcome code | Label in the app                            |
| ------------ | ------------------------------------------- |
| omitted      | Panel was omitted from the shared view      |
| black        | Panel appeared as a black area              |
| partial      | Panel was partly visible in the shared view |
| visible      | Panel appeared normally in the shared view  |
| artifact     | Panel produced a visual artifact            |

## When a verification expires

- A verification **expires automatically** when the operating-system build, the Electron version or
  the RealtimeDocs version changes. The app detects these by itself.
- A verification **must be re-checked** when the browser version or the meeting-application version
  changes. The app does not inspect other applications, so it cannot detect these changes. The
  person who tests enters those versions, and a difference from the entry expires the record.
- In any case a verification expires **after 30 days** (`VERIFICATION_MAX_AGE_DAYS`). Browsers and
  meeting applications update silently, and those updates cannot be detected.

A result holds for the exact combination that was tested and for nothing else.

## Matrix: Windows

**Reminder of the rule: a configuration may be marked Verified only after a second participant or
separate receiving device confirmed the result. A local screenshot, an OS return value, an Electron
boolean or the app's own preview is insufficient proof. `NOT TESTED` is never converted to anything
else without an evidence record.**

Record the Windows 11 build (for example from `winver`) in every evidence record, together with the
version of the meeting application and, where a browser is the client, the browser and its version.

Each row is one meeting application, one client, one capture mode and one monitor count. "Protection
on" is the result with private mode on, and "Protection off" is the control with private mode off.
Where a row says "confirm the mode is offered", the author could not confirm that the client offers
that capture mode. If the mode is not offered in the version you test, write that in the evidence
record. Sharing options differ between versions of clients and browsers.

The Amazon Chime rows come with a caveat: AWS announced the end of the Amazon Chime service
(scheduled for 20 February 2026). Confirm that it is still available before testing those rows.

Once a row has been tested, replace `NOT TESTED` with `omitted`, `black area`, `partial`, `visible` or
`artifact`, followed by the record identifier, for example `visible (R-003)`.

| Row                   | Meeting app and client                                                             | Capture mode                              | Monitors     | Protection on | Protection off |
| --------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------- | ------------ | ------------- | -------------- |
| W-ZOOM-WIN-1M         | Zoom desktop client                                                                | Single window                             | One monitor  | NOT TESTED    | NOT TESTED     |
| W-ZOOM-WIN-2M         | Zoom desktop client                                                                | Single window                             | Two monitors | NOT TESTED    | NOT TESTED     |
| W-ZOOM-APP-1M         | Zoom desktop client                                                                | Application (confirm the mode is offered) | One monitor  | NOT TESTED    | NOT TESTED     |
| W-ZOOM-APP-2M         | Zoom desktop client                                                                | Application (confirm the mode is offered) | Two monitors | NOT TESTED    | NOT TESTED     |
| W-ZOOM-DISP-1M        | Zoom desktop client                                                                | Entire display                            | One monitor  | NOT TESTED    | NOT TESTED     |
| W-ZOOM-DISP-2M        | Zoom desktop client                                                                | Entire display                            | Two monitors | NOT TESTED    | NOT TESTED     |
| W-TEAMS-WIN-1M        | Microsoft Teams desktop client                                                     | Single window                             | One monitor  | NOT TESTED    | NOT TESTED     |
| W-TEAMS-WIN-2M        | Microsoft Teams desktop client                                                     | Single window                             | Two monitors | NOT TESTED    | NOT TESTED     |
| W-TEAMS-APP-1M        | Microsoft Teams desktop client                                                     | Application (confirm the mode is offered) | One monitor  | NOT TESTED    | NOT TESTED     |
| W-TEAMS-APP-2M        | Microsoft Teams desktop client                                                     | Application (confirm the mode is offered) | Two monitors | NOT TESTED    | NOT TESTED     |
| W-TEAMS-DISP-1M       | Microsoft Teams desktop client                                                     | Entire display                            | One monitor  | NOT TESTED    | NOT TESTED     |
| W-TEAMS-DISP-2M       | Microsoft Teams desktop client                                                     | Entire display                            | Two monitors | NOT TESTED    | NOT TESTED     |
| W-MEET-CHROME-TAB-1M  | Google Meet in Chrome                                                              | Browser tab                               | One monitor  | NOT TESTED    | NOT TESTED     |
| W-MEET-CHROME-TAB-2M  | Google Meet in Chrome                                                              | Browser tab                               | Two monitors | NOT TESTED    | NOT TESTED     |
| W-MEET-CHROME-WIN-1M  | Google Meet in Chrome                                                              | Single window                             | One monitor  | NOT TESTED    | NOT TESTED     |
| W-MEET-CHROME-WIN-2M  | Google Meet in Chrome                                                              | Single window                             | Two monitors | NOT TESTED    | NOT TESTED     |
| W-MEET-CHROME-DISP-1M | Google Meet in Chrome                                                              | Entire display                            | One monitor  | NOT TESTED    | NOT TESTED     |
| W-MEET-CHROME-DISP-2M | Google Meet in Chrome                                                              | Entire display                            | Two monitors | NOT TESTED    | NOT TESTED     |
| W-MEET-EDGE-TAB-1M    | Google Meet in Edge                                                                | Browser tab                               | One monitor  | NOT TESTED    | NOT TESTED     |
| W-MEET-EDGE-TAB-2M    | Google Meet in Edge                                                                | Browser tab                               | Two monitors | NOT TESTED    | NOT TESTED     |
| W-MEET-EDGE-WIN-1M    | Google Meet in Edge                                                                | Single window                             | One monitor  | NOT TESTED    | NOT TESTED     |
| W-MEET-EDGE-WIN-2M    | Google Meet in Edge                                                                | Single window                             | Two monitors | NOT TESTED    | NOT TESTED     |
| W-MEET-EDGE-DISP-1M   | Google Meet in Edge                                                                | Entire display                            | One monitor  | NOT TESTED    | NOT TESTED     |
| W-MEET-EDGE-DISP-2M   | Google Meet in Edge                                                                | Entire display                            | Two monitors | NOT TESTED    | NOT TESTED     |
| W-WEBEX-WIN-1M        | Webex desktop client                                                               | Single window                             | One monitor  | NOT TESTED    | NOT TESTED     |
| W-WEBEX-WIN-2M        | Webex desktop client                                                               | Single window                             | Two monitors | NOT TESTED    | NOT TESTED     |
| W-WEBEX-APP-1M        | Webex desktop client                                                               | Application (confirm the mode is offered) | One monitor  | NOT TESTED    | NOT TESTED     |
| W-WEBEX-APP-2M        | Webex desktop client                                                               | Application (confirm the mode is offered) | Two monitors | NOT TESTED    | NOT TESTED     |
| W-WEBEX-DISP-1M       | Webex desktop client                                                               | Entire display                            | One monitor  | NOT TESTED    | NOT TESTED     |
| W-WEBEX-DISP-2M       | Webex desktop client                                                               | Entire display                            | Two monitors | NOT TESTED    | NOT TESTED     |
| W-WEBEX-WEB-TAB-1M    | Webex in a browser (record which browser)                                          | Browser tab                               | One monitor  | NOT TESTED    | NOT TESTED     |
| W-WEBEX-WEB-TAB-2M    | Webex in a browser (record which browser)                                          | Browser tab                               | Two monitors | NOT TESTED    | NOT TESTED     |
| W-WEBEX-WEB-WIN-1M    | Webex in a browser (record which browser)                                          | Single window                             | One monitor  | NOT TESTED    | NOT TESTED     |
| W-WEBEX-WEB-WIN-2M    | Webex in a browser (record which browser)                                          | Single window                             | Two monitors | NOT TESTED    | NOT TESTED     |
| W-WEBEX-WEB-DISP-1M   | Webex in a browser (record which browser)                                          | Entire display                            | One monitor  | NOT TESTED    | NOT TESTED     |
| W-WEBEX-WEB-DISP-2M   | Webex in a browser (record which browser)                                          | Entire display                            | Two monitors | NOT TESTED    | NOT TESTED     |
| W-LARK-WIN-1M         | Lark desktop client                                                                | Single window                             | One monitor  | NOT TESTED    | NOT TESTED     |
| W-LARK-WIN-2M         | Lark desktop client                                                                | Single window                             | Two monitors | NOT TESTED    | NOT TESTED     |
| W-LARK-APP-1M         | Lark desktop client                                                                | Application (confirm the mode is offered) | One monitor  | NOT TESTED    | NOT TESTED     |
| W-LARK-APP-2M         | Lark desktop client                                                                | Application (confirm the mode is offered) | Two monitors | NOT TESTED    | NOT TESTED     |
| W-LARK-DISP-1M        | Lark desktop client                                                                | Entire display                            | One monitor  | NOT TESTED    | NOT TESTED     |
| W-LARK-DISP-2M        | Lark desktop client                                                                | Entire display                            | Two monitors | NOT TESTED    | NOT TESTED     |
| W-LARK-WEB-TAB-1M     | Lark in a browser (record which browser; confirm a browser version exists)         | Browser tab                               | One monitor  | NOT TESTED    | NOT TESTED     |
| W-LARK-WEB-TAB-2M     | Lark in a browser (record which browser; confirm a browser version exists)         | Browser tab                               | Two monitors | NOT TESTED    | NOT TESTED     |
| W-LARK-WEB-WIN-1M     | Lark in a browser (record which browser; confirm a browser version exists)         | Single window                             | One monitor  | NOT TESTED    | NOT TESTED     |
| W-LARK-WEB-WIN-2M     | Lark in a browser (record which browser; confirm a browser version exists)         | Single window                             | Two monitors | NOT TESTED    | NOT TESTED     |
| W-LARK-WEB-DISP-1M    | Lark in a browser (record which browser; confirm a browser version exists)         | Entire display                            | One monitor  | NOT TESTED    | NOT TESTED     |
| W-LARK-WEB-DISP-2M    | Lark in a browser (record which browser; confirm a browser version exists)         | Entire display                            | Two monitors | NOT TESTED    | NOT TESTED     |
| W-CHIME-WIN-1M        | Amazon Chime desktop client                                                        | Single window                             | One monitor  | NOT TESTED    | NOT TESTED     |
| W-CHIME-WIN-2M        | Amazon Chime desktop client                                                        | Single window                             | Two monitors | NOT TESTED    | NOT TESTED     |
| W-CHIME-APP-1M        | Amazon Chime desktop client                                                        | Application (confirm the mode is offered) | One monitor  | NOT TESTED    | NOT TESTED     |
| W-CHIME-APP-2M        | Amazon Chime desktop client                                                        | Application (confirm the mode is offered) | Two monitors | NOT TESTED    | NOT TESTED     |
| W-CHIME-DISP-1M       | Amazon Chime desktop client                                                        | Entire display                            | One monitor  | NOT TESTED    | NOT TESTED     |
| W-CHIME-DISP-2M       | Amazon Chime desktop client                                                        | Entire display                            | Two monitors | NOT TESTED    | NOT TESTED     |
| W-CHIME-WEB-TAB-1M    | Amazon Chime in a browser (record which browser; confirm a browser version exists) | Browser tab                               | One monitor  | NOT TESTED    | NOT TESTED     |
| W-CHIME-WEB-TAB-2M    | Amazon Chime in a browser (record which browser; confirm a browser version exists) | Browser tab                               | Two monitors | NOT TESTED    | NOT TESTED     |
| W-CHIME-WEB-WIN-1M    | Amazon Chime in a browser (record which browser; confirm a browser version exists) | Single window                             | One monitor  | NOT TESTED    | NOT TESTED     |
| W-CHIME-WEB-WIN-2M    | Amazon Chime in a browser (record which browser; confirm a browser version exists) | Single window                             | Two monitors | NOT TESTED    | NOT TESTED     |
| W-CHIME-WEB-DISP-1M   | Amazon Chime in a browser (record which browser; confirm a browser version exists) | Entire display                            | One monitor  | NOT TESTED    | NOT TESTED     |
| W-CHIME-WEB-DISP-2M   | Amazon Chime in a browser (record which browser; confirm a browser version exists) | Entire display                            | Two monitors | NOT TESTED    | NOT TESTED     |

**Windows 10 (version 2004 or later).** Use the same procedure and record the build. Windows 10
version 2004 is the first version for which Electron documents that the window is removed from
capture. **Earlier Windows:** exclusion is unavailable, and the operating system shows a black area
instead. The app reports "Protection unavailable" there.

## Matrix: macOS

**Reminder of the rule: a configuration may be marked Verified only after a second participant or
separate receiving device confirmed the result. A local screenshot, an OS return value, an Electron
boolean or the app's own preview is insufficient proof. `NOT TESTED` is never converted to anything
else without an evidence record.**

Record the macOS version (from "About This Mac") in every evidence record, together with the
version of the meeting application and, where a browser is the client, the browser and its version.
Electron states that applications that use ScreenCaptureKit can capture the window despite the
request, so the expected result on a Mac is that the panel can be seen. The records are there to
show what really happens.

The rows follow the same conventions as the Windows matrix, including "confirm the mode is
offered".

The same Amazon Chime caveat applies: confirm that the service is still available before testing.

| Row                   | Meeting app and client                                                             | Capture mode                              | Monitors     | Protection on | Protection off |
| --------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------- | ------------ | ------------- | -------------- |
| M-ZOOM-WIN-1M         | Zoom desktop client                                                                | Single window                             | One monitor  | NOT TESTED    | NOT TESTED     |
| M-ZOOM-WIN-2M         | Zoom desktop client                                                                | Single window                             | Two monitors | NOT TESTED    | NOT TESTED     |
| M-ZOOM-APP-1M         | Zoom desktop client                                                                | Application (confirm the mode is offered) | One monitor  | NOT TESTED    | NOT TESTED     |
| M-ZOOM-APP-2M         | Zoom desktop client                                                                | Application (confirm the mode is offered) | Two monitors | NOT TESTED    | NOT TESTED     |
| M-ZOOM-DISP-1M        | Zoom desktop client                                                                | Entire display                            | One monitor  | NOT TESTED    | NOT TESTED     |
| M-ZOOM-DISP-2M        | Zoom desktop client                                                                | Entire display                            | Two monitors | NOT TESTED    | NOT TESTED     |
| M-TEAMS-WIN-1M        | Microsoft Teams desktop client                                                     | Single window                             | One monitor  | NOT TESTED    | NOT TESTED     |
| M-TEAMS-WIN-2M        | Microsoft Teams desktop client                                                     | Single window                             | Two monitors | NOT TESTED    | NOT TESTED     |
| M-TEAMS-APP-1M        | Microsoft Teams desktop client                                                     | Application (confirm the mode is offered) | One monitor  | NOT TESTED    | NOT TESTED     |
| M-TEAMS-APP-2M        | Microsoft Teams desktop client                                                     | Application (confirm the mode is offered) | Two monitors | NOT TESTED    | NOT TESTED     |
| M-TEAMS-DISP-1M       | Microsoft Teams desktop client                                                     | Entire display                            | One monitor  | NOT TESTED    | NOT TESTED     |
| M-TEAMS-DISP-2M       | Microsoft Teams desktop client                                                     | Entire display                            | Two monitors | NOT TESTED    | NOT TESTED     |
| M-MEET-CHROME-TAB-1M  | Google Meet in Chrome                                                              | Browser tab                               | One monitor  | NOT TESTED    | NOT TESTED     |
| M-MEET-CHROME-TAB-2M  | Google Meet in Chrome                                                              | Browser tab                               | Two monitors | NOT TESTED    | NOT TESTED     |
| M-MEET-CHROME-WIN-1M  | Google Meet in Chrome                                                              | Single window                             | One monitor  | NOT TESTED    | NOT TESTED     |
| M-MEET-CHROME-WIN-2M  | Google Meet in Chrome                                                              | Single window                             | Two monitors | NOT TESTED    | NOT TESTED     |
| M-MEET-CHROME-DISP-1M | Google Meet in Chrome                                                              | Entire display                            | One monitor  | NOT TESTED    | NOT TESTED     |
| M-MEET-CHROME-DISP-2M | Google Meet in Chrome                                                              | Entire display                            | Two monitors | NOT TESTED    | NOT TESTED     |
| M-MEET-SAFARI-TAB-1M  | Google Meet in Safari                                                              | Browser tab                               | One monitor  | NOT TESTED    | NOT TESTED     |
| M-MEET-SAFARI-TAB-2M  | Google Meet in Safari                                                              | Browser tab                               | Two monitors | NOT TESTED    | NOT TESTED     |
| M-MEET-SAFARI-WIN-1M  | Google Meet in Safari                                                              | Single window                             | One monitor  | NOT TESTED    | NOT TESTED     |
| M-MEET-SAFARI-WIN-2M  | Google Meet in Safari                                                              | Single window                             | Two monitors | NOT TESTED    | NOT TESTED     |
| M-MEET-SAFARI-DISP-1M | Google Meet in Safari                                                              | Entire display                            | One monitor  | NOT TESTED    | NOT TESTED     |
| M-MEET-SAFARI-DISP-2M | Google Meet in Safari                                                              | Entire display                            | Two monitors | NOT TESTED    | NOT TESTED     |
| M-WEBEX-WIN-1M        | Webex desktop client                                                               | Single window                             | One monitor  | NOT TESTED    | NOT TESTED     |
| M-WEBEX-WIN-2M        | Webex desktop client                                                               | Single window                             | Two monitors | NOT TESTED    | NOT TESTED     |
| M-WEBEX-APP-1M        | Webex desktop client                                                               | Application (confirm the mode is offered) | One monitor  | NOT TESTED    | NOT TESTED     |
| M-WEBEX-APP-2M        | Webex desktop client                                                               | Application (confirm the mode is offered) | Two monitors | NOT TESTED    | NOT TESTED     |
| M-WEBEX-DISP-1M       | Webex desktop client                                                               | Entire display                            | One monitor  | NOT TESTED    | NOT TESTED     |
| M-WEBEX-DISP-2M       | Webex desktop client                                                               | Entire display                            | Two monitors | NOT TESTED    | NOT TESTED     |
| M-LARK-WIN-1M         | Lark desktop client                                                                | Single window                             | One monitor  | NOT TESTED    | NOT TESTED     |
| M-LARK-WIN-2M         | Lark desktop client                                                                | Single window                             | Two monitors | NOT TESTED    | NOT TESTED     |
| M-LARK-APP-1M         | Lark desktop client                                                                | Application (confirm the mode is offered) | One monitor  | NOT TESTED    | NOT TESTED     |
| M-LARK-APP-2M         | Lark desktop client                                                                | Application (confirm the mode is offered) | Two monitors | NOT TESTED    | NOT TESTED     |
| M-LARK-DISP-1M        | Lark desktop client                                                                | Entire display                            | One monitor  | NOT TESTED    | NOT TESTED     |
| M-LARK-DISP-2M        | Lark desktop client                                                                | Entire display                            | Two monitors | NOT TESTED    | NOT TESTED     |
| M-LARK-WEB-TAB-1M     | Lark in a browser (record which browser; confirm a browser version exists)         | Browser tab                               | One monitor  | NOT TESTED    | NOT TESTED     |
| M-LARK-WEB-TAB-2M     | Lark in a browser (record which browser; confirm a browser version exists)         | Browser tab                               | Two monitors | NOT TESTED    | NOT TESTED     |
| M-LARK-WEB-WIN-1M     | Lark in a browser (record which browser; confirm a browser version exists)         | Single window                             | One monitor  | NOT TESTED    | NOT TESTED     |
| M-LARK-WEB-WIN-2M     | Lark in a browser (record which browser; confirm a browser version exists)         | Single window                             | Two monitors | NOT TESTED    | NOT TESTED     |
| M-LARK-WEB-DISP-1M    | Lark in a browser (record which browser; confirm a browser version exists)         | Entire display                            | One monitor  | NOT TESTED    | NOT TESTED     |
| M-LARK-WEB-DISP-2M    | Lark in a browser (record which browser; confirm a browser version exists)         | Entire display                            | Two monitors | NOT TESTED    | NOT TESTED     |
| M-CHIME-WIN-1M        | Amazon Chime desktop client                                                        | Single window                             | One monitor  | NOT TESTED    | NOT TESTED     |
| M-CHIME-WIN-2M        | Amazon Chime desktop client                                                        | Single window                             | Two monitors | NOT TESTED    | NOT TESTED     |
| M-CHIME-APP-1M        | Amazon Chime desktop client                                                        | Application (confirm the mode is offered) | One monitor  | NOT TESTED    | NOT TESTED     |
| M-CHIME-APP-2M        | Amazon Chime desktop client                                                        | Application (confirm the mode is offered) | Two monitors | NOT TESTED    | NOT TESTED     |
| M-CHIME-DISP-1M       | Amazon Chime desktop client                                                        | Entire display                            | One monitor  | NOT TESTED    | NOT TESTED     |
| M-CHIME-DISP-2M       | Amazon Chime desktop client                                                        | Entire display                            | Two monitors | NOT TESTED    | NOT TESTED     |
| M-CHIME-WEB-TAB-1M    | Amazon Chime in a browser (record which browser; confirm a browser version exists) | Browser tab                               | One monitor  | NOT TESTED    | NOT TESTED     |
| M-CHIME-WEB-TAB-2M    | Amazon Chime in a browser (record which browser; confirm a browser version exists) | Browser tab                               | Two monitors | NOT TESTED    | NOT TESTED     |
| M-CHIME-WEB-WIN-1M    | Amazon Chime in a browser (record which browser; confirm a browser version exists) | Single window                             | One monitor  | NOT TESTED    | NOT TESTED     |
| M-CHIME-WEB-WIN-2M    | Amazon Chime in a browser (record which browser; confirm a browser version exists) | Single window                             | Two monitors | NOT TESTED    | NOT TESTED     |
| M-CHIME-WEB-DISP-1M   | Amazon Chime in a browser (record which browser; confirm a browser version exists) | Entire display                            | One monitor  | NOT TESTED    | NOT TESTED     |
| M-CHIME-WEB-DISP-2M   | Amazon Chime in a browser (record which browser; confirm a browser version exists) | Entire display                            | Two monitors | NOT TESTED    | NOT TESTED     |

## Test procedure

There is one procedure per platform. The steps are the same on both. The differences are where to
find the version numbers, and where each meeting application keeps its share options. One run
through the procedure fills the "Protection off" and "Protection on" cells of one row.

### What you need

- **The presenting computer**: the Windows PC (Windows 11, or Windows 10 version 2004 or later) or
  the Mac under test, with RealtimeDocs Desktop installed.
- **A second participant, or a second device**: a computer, tablet or phone that joins the same
  meeting under another account, ideally used by another person. The observer must be able to take
  a screenshot or photograph **on their own device**.
- **Identifiable content**: the seeded sample document, "Welcome to RealtimeDocs — sample launch
  notes", whose first heading reads "Launch notes: RealtimeDocs demo". The server operator creates
  it with the `seed-sample` command. Have a second, equally recognisable document ready for the
  document switch.
- **Ordinary content to share**: a window that is meant to be seen, for example a presentation or
  a text editor with a sentence that the observer can read back.

### Where to find the share options, by meeting application

- **Zoom desktop**: the green "Share Screen" button in the meeting toolbar opens a chooser with
  tabs or thumbnails for screens and windows. Confirm whether an application or window group is
  offered.
- **Microsoft Teams desktop**: the "Share" button in the meeting toolbar opens a tray with screen
  and window choices. Confirm whether an application mode is offered.
- **Google Meet in Chrome, Edge or Safari**: "Present now" in the meeting toolbar, then the browser
  asks for a tab, a window or the entire screen. Chrome and Edge show these as three choices.
  Safari's chooser differs and varies by version, so write down what it offers.
- **Webex desktop**: the "Share" button in the meeting controls opens a list of screens and
  applications. Confirm which modes are offered.
- **Webex in a browser**: the "Share" button, then the browser's own picker for a tab, a window or
  the entire screen.
- **Lark desktop**: the share button in the meeting toolbar. Which modes it offers (screen, window,
  application) was not confirmed; write down what your version shows. Where Lark offers meetings in
  a browser, the browser's own picker applies.
- **Amazon Chime desktop**: the screen-share control in the meeting toolbar. Which modes it offers
  was not confirmed; write down what your version shows. Where a browser variant exists, the
  browser's own picker applies.

**Amazon Chime availability.** AWS announced the end of the Amazon Chime service, scheduled for 20
February 2026. Confirm that Amazon Chime is still available to you before you spend time on its
rows; if it is not, write that down and leave the rows at `NOT TESTED`.

If your version of a client places these differently, write down where you found them. That
information helps the next tester.

### Before you start

1. Write down the versions first. Operating-system version and build: run `winver` on Windows, or
   open "About This Mac" on macOS. RealtimeDocs version and Electron version: Settings →
   Diagnostics & About in RealtimeDocs Desktop. Meeting-application version, and for a browser
   client the browser name and version.
2. Write down the monitor setup: how many displays, which one the panel is on, and which one is
   shared. Decide whether this run uses one monitor or two. With two monitors, test sharing the
   display that has the panel, and sharing the display that does not.
3. Join the meeting on the presenting computer and on the observing device or account.
4. Open the sample document in the panel and check on your own screen that it is the sample.
5. Read the status chip in the panel's title strip, or open Settings → Privacy & Capture, and write
   down the status name and, if shown, the verification line under it.

### Part A: protection off (the control)

6. Switch private mode off (it is on by default) in Settings → Privacy & Capture. The status name
   is "Protection off".
7. Start sharing in the capture mode of the row:
   - **Browser tab**: choose the tab that holds your ordinary content.
   - **Single window**: choose the window that holds your ordinary content.
   - **Application**: choose the application that holds your ordinary content, if the client
     offers this mode.
   - **Entire display**: choose the display you decided on in step 2.

   Place the panel so that it overlaps the shared tab or window, or sits on the shared display.

8. The observer looks at the shared picture **on their own device** and says whether the ordinary
   content is visible and readable. The observer then says what appears where the panel is: the
   panel, a black area, part of the panel, something else or nothing. The observer takes a
   screenshot or photograph on their device. The panel is expected to be visible here, and this is
   the control.
9. Stop sharing.

### Part B: protection on

10. Turn private mode on in Settings → Privacy & Capture (the switch "Private mode: request capture
    exclusion for RealtimeDocs windows"). **Wait about five seconds.** On Windows
    the change takes effect with the next desktop composition, not when the call returns, so a
    capture started immediately afterwards can still contain the window. Write down the status
    name that the app now shows.
11. Start sharing again in the same capture mode, with the panel in the same place. The observer
    confirms that the ordinary content is visible, says what appears where the panel is, and takes
    a screenshot or photograph on their device.
12. With the share still running, do each of the following. After each, the observer says what they
    saw during the action and after it. Write it down for the matching line of the record.
    - **Startup.** Choose "Quit" in the tray or menu-bar menu and start RealtimeDocs Desktop again.
      Watch for a moment in which the panel shows up for the observer while it appears.
    - **Document switch.** Open the second document in the panel, then switch back to the sample.
    - **Resize.** Drag an edge of the panel, choose a size preset, collapse it to its title strip
      and expand it again.
    - **Hide and show.** Hide the panel and show it again, once with the keyboard shortcut and once
      with the tray or menu-bar menu.
    - **Protection toggle.** Turn private mode off, wait about five seconds and let the observer
      look. Turn it on again, wait about five seconds and let the observer look again.
13. Open the settings window while sharing and ask the observer whether it appears. It is also a
    window of the app.
14. Stop sharing, then start sharing again with private mode already on, and repeat step 11. A
    capture started after the request can behave differently from one started before it.
15. If the panel becomes visible at any point and you want to stop it appearing, use the tray or
    menu-bar action "Return to interactive mode", or stop sharing.

### Single and multiple monitors

16. Repeat Parts A and B for the other monitor count. A row exists for one monitor and for two
    monitors. For two monitors, write the arrangement in the record, for example "panel on display
    2, sharing display 1".

### Recording the result

17. In RealtimeDocs Desktop, open Settings → **Privacy Test Center** (the tab of that name, which is
    not the "Privacy & Capture" tab; also reachable from the tray or menu-bar menu, from the status
    chip's explanation and from step 4 of the Safe Share Guide) and record the check: the meeting application and its version, the client
    (native, or browser with its name and version), what was shared, the monitor count and
    arrangement, whether private mode was on, what you saw locally, and what the second participant
    or device saw. The form cannot be saved without that remote observation. The operating-system
    version, the RealtimeDocs version and the Electron version are saved with the record
    automatically. The record is stored on that computer only. It is not sent to the server and it
    does not update this file; use the Test Center's Markdown export to copy it here.
18. In this file, fill in one evidence record for Part A and one for Part B, using the template
    below, and add both to the section "Evidence records" at the end. Give each the next free
    identifier.
19. Replace the two `NOT TESTED` cells of the row with `omitted`, `black area`, `partial`, `visible` or
    `artifact`, followed by the record identifier.
20. If the observer saw the panel, or part of it, with private mode on, treat the mode as not
    working for that configuration and use the options under "What to rely on instead".

## Evidence record template

Copy the block and give the record the next free identifier. The lines match the fields of the
app's verification record. Write "not applicable" where a line does not apply, and do not leave
lines out.

| Field                       | Value                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| Record identifier           | R-\_\_\_                                                                                  |
| Matrix row                  | for example W-ZOOM-WIN-2M                                                                 |
| Date (testedAt)             |                                                                                           |
| App version (appVersion)    |                                                                                           |
| Electron version            |                                                                                           |
| Platform                    | win32 or darwin                                                                           |
| OS version                  | for Windows the build                                                                     |
| Meeting app                 | Zoom, Microsoft Teams, Google Meet, Webex, Lark, Amazon Chime or Other                    |
| Meeting app name            | only if Other                                                                             |
| Meeting app version         |                                                                                           |
| Client                      | native, or browser with browser name and browser version                                  |
| Capture mode                | Browser tab, Single window, Application or Entire display                                 |
| Monitors: count             |                                                                                           |
| Monitors: arrangement       | for example "panel on display 2, sharing display 1"                                       |
| Protection                  | on or off                                                                                 |
| Local result                | what the presenter saw on their own screen                                                |
| Remote: observed by         | second participant or second device                                                       |
| Remote: outcome             | omitted, black area, partial, visible or artifact                                         |
| Remote: note                | whether ordinary shared content was visible; partial content or other artifact, described |
| Evidence location           | what it is, who made it on which device, where it is kept                                 |
| Behaviour during startup    |                                                                                           |
| Behaviour during doc switch |                                                                                           |
| Behaviour during resize     |                                                                                           |
| Behaviour during hide/show  |                                                                                           |
| Behaviour during toggling   |                                                                                           |

For a record of Part A, the five behaviour lines read "not applicable".

## Safe Share Guide and the macOS whole-display warning

The app's Safe Share Guide has these steps, in this order:

1. Share a specific browser tab, presentation window, or application instead of your entire screen.
2. Keep RealtimeDocs outside the source you selected.
3. Confirm what others see from a second device or with another participant.
4. Record the result in the Privacy Test Center.

On macOS the app shows this warning whenever an entire-display share could include the panel:

> Whole-display capture may include RealtimeDocs on this macOS and meeting-app configuration. Share
> a selected application, window, or browser tab and verify using another participant.

## What to rely on instead

These do not depend on private mode.

1. **Share a selected tab, window or application** instead of the entire display, and keep the
   panel outside what you selected. Whether a window that overlaps the shared one reaches
   participants depends on how the meeting application captures. The rows of the matrices exist to
   find that out.
2. **Keep the notes on a display or device that is not shared.** A separate device, such as a
   laptop or tablet next to the presenting computer, is the most robust choice, because the meeting
   application on the presenting computer has no access to it. A second monitor that is not shared
   is the next best.
3. **Verify with another participant.** Join the meeting from a second device, or ask a
   participant what they see, before you rely on anything. Your own screen does not show what
   others receive.

## What is out of scope

The request covers RealtimeDocs' own desktop windows and nothing else. These are outside it:

- an exported file, a printed page or a PDF;
- the same document open in a browser tab, in any browser;
- a photograph or video of the screen, for example from a phone camera, and a hardware capture
  device on the display cable;
- remote-desktop viewers: per Electron's text above, a Remote Desktop client still shows the window
  to the remote user in a Windows remote session;
- **the browser version of RealtimeDocs**, which has no capture exclusion at all, because a web
  page cannot ask the operating system for it. If it is inside what you share, it is shared.

Recording tools (a meeting's own recording, or a separate screen recorder) are further capture
methods that are not rows of the matrices. If you use one, test it with the same procedure and keep
a record.

## What this project will not build

RealtimeDocs asks the operating system to leave its own windows out of capture and helps you check
what a participant receives. It is not a tool for evading monitoring. These are not built and will
not be built: concealing the app's process or hiding it from Task Manager or Activity Monitor;
defeating proctoring software, lockdown browsers or tab-switch detection; evading interview or exam
monitoring; injecting into, hooking or patching a meeting client or a capture interface; evading
security tools; stealth or kernel drivers; broad administrator rights; and any "verified" or
compatibility result that a second participant or device did not observe. The same list is in
[security.md](security.md).

## Evidence records

None yet.
