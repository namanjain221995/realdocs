# Privacy Test Center

The Privacy Test Center is a part of the RealtimeDocs desktop app (Windows and macOS). It is a
place to write down, and later look up, what a second person or a second device actually received
when you shared your screen while the RealtimeDocs panel was open.

Where to find it: **Settings → Privacy Test Center (also step 4 of the Safe Share Guide).** The
wiring of the component into the settings window is being finished in the current pass, so the
tab may not be reachable in every build yet. The component itself is in
`apps/desktop/src/renderer/privacy/PrivacyTestCenter.tsx`.

This page explains the tool. The test matrix, the step-by-step test procedure and the evidence
template are in [capture-compatibility.md](capture-compatibility.md).

## What it is for

RealtimeDocs can ask the operating system to leave its own windows out of screen capture
("private mode"). Whether a given meeting application then leaves the panel out is a different
question, and the app cannot answer it: it cannot see what other participants receive. The Test
Center exists to record that answer, for one exact setup at a time, after a person has checked it
from the other side.

It does not run a test for you, inspect other applications, or send anything anywhere. It stores
what you typed, decides how current each record still is, and exports the records.

## The two layers

The app reports protection in two separate layers.

1. **The request layer** is decided on this computer. It says what RealtimeDocs asked the operating
   system for and what the operating system answered. It uses documented operating-system calls
   only, and it says nothing about what another meeting participant sees.
2. **The verification layer** needs a **second participant or a separate receiving device**. It is
   about one exact configuration: operating-system build, meeting app and version, client, capture
   mode, number of displays, and protection on or off. Only a person can fill it in.

The headline status you see combines the two. If the request layer did not end in "OS protection
accepted", the headline is the request status. Only when the operating system accepted the request
does the verification layer decide the headline.

## Every status

These are the exact names shown in the app.

### Request layer

**Unsupported**

- Means: there is no documented way to exclude a window from capture here, for example on Linux or
  in a browser instead of the desktop app.
- Does not mean: that anything is wrong, or that the document is shared.

**Protection unavailable**

- Means: this is a desktop system that has the control, but exclusion cannot be applied now. An
  example is Windows earlier than 10 version 2004, where the operating system can only show a
  black area instead of the window. Another is a window that is not ready yet.
- Does not mean: that the panel is hidden. A black area where the panel is differs from the panel
  being left out.

**Protection off**

- Means: you turned private mode off. This is a choice, not a failure.
- Does not mean: that anyone can see the panel. It means no request was made, so the panel is
  treated like any other window. It is also the control condition of a test.

**Protection request failed**

- Means: RealtimeDocs asked and the request returned an error, or the value read back did not
  agree with the request.
- Does not mean: that the panel was captured. It means the app cannot tell what state the system is
  in, so nothing should be assumed.

**OS protection accepted**

- Means: RealtimeDocs asked, the request returned without error, the value read back agrees (on
  Windows, when the diagnostics module is present, the window's display affinity is
  `WDA_EXCLUDEFROMCAPTURE`), and at least one desktop-composition cycle has passed. On macOS this
  is a best-effort request only; meeting applications that capture with ScreenCaptureKit can still
  include the window.
- Does not mean: that a participant cannot see the panel, or that any meeting application was
  tested.

### Verification layer

**Manual verification required**

- Means: there is no current record from a second participant or device for this exact
  configuration.
- Does not mean: that the panel is visible or hidden. Nobody has confirmed either.

**Verified for this exact configuration**

- Means: a current record exists for this exact configuration. The app shows the observed outcome
  next to the status.
- Does not mean: that the panel was left out. Only the outcome "Panel was omitted from the shared
  view" means that. A verified result can equally read "Panel appeared normally in the shared
  view". The app shows a verified result where the panel was seen as a warning, because it is a
  confirmed negative. It also says nothing about any other configuration.

**Verification expired after version change**

- Means: a record exists, but something it depends on has changed since, or it is older than 30
  days. The reason is shown with it, and the earlier outcome is shown as history only.
- Does not mean: that the earlier result was wrong. It means it can no longer be relied on, and the
  check has to be repeated.

### What the second participant can report

| Outcome  | Label shown in the app                      |
| -------- | ------------------------------------------- |
| omitted  | Panel was omitted from the shared view      |
| black    | Panel appeared as a black area              |
| partial  | Panel was partly visible in the shared view |
| visible  | Panel appeared normally in the shared view  |
| artifact | Panel produced a visual artifact            |

The form has no default for this choice. You must pick one.

## What counts as a configuration

Two records describe the same configuration only if all of these match: operating system
(Windows or macOS), meeting app, native client or browser (and which browser; letter case is
ignored), capture mode, number of displays, and whether protection was on. The meeting apps in
the form are Zoom, Microsoft Teams, Google Meet, Webex, Lark, Amazon Chime and Other (for Other,
you type the name, and two different names count as different configurations). The capture modes
are Browser tab, Single window, Application and Entire display.

When several records match, the newest one decides the status.

## Record a test, step by step

Do the sharing test first, following the procedure in
[capture-compatibility.md](capture-compatibility.md). Then:

1. Open the Privacy Test Center. The area "This computer now" lists every configuration already
   tested on this computer, each with its status.
2. Under "Record a test", read the part "Detected on this computer". The operating system and
   build, the RealtimeDocs version and the Electron version are filled in by the app and cannot be
   edited.
3. Under "Meeting setup", choose the meeting app, enter its version, choose "Native app" or "In a
   browser" (then also enter the browser and its version), and choose what was shared. Enter the
   number of displays (1 to 16) and, if useful, the arrangement, for example "panel on display 2,
   sharing display 1". Tick "Protection was on in RealtimeDocs during this test" to match what you
   tested.
4. Under "Results", describe what you saw on this computer.
5. Choose what the second participant or device received, and who confirmed it ("Second
   participant" or "Second device"). Both are required.
6. Optionally add the observer's note, where the evidence is kept (for example the file name of a
   photo taken on the second device), and the behaviour during startup, document switch, resize,
   hide/show and protection toggle.
7. Choose "Save test result".

"Verify again" next to an existing record copies its meeting setup into a new form. The remote
observation is not copied: a new test needs its own.

### What the form refuses

The form will not save, and says why, if:

- the meeting app is "Other" and no name is given;
- the meeting app version is empty;
- the client is a browser and the browser name or version is empty;
- the number of displays is not a whole number from 1 to 16;
- "What you saw on this computer" is empty;
- the second participant's or device's result is not chosen;
- "Observed by" is not chosen.

Texts also have length limits (short fields 120 characters, local result 500, notes and transition
descriptions 1000). The main process checks every record again before writing it.

### What does not count as verification

None of these is accepted in place of a second participant or device, and none has a field in the
form:

- **A local screenshot.** Your own screen shows what your computer displays, not what the meeting
  application sends.
- **An operating-system return value.** It says the system accepted a request. It does not say what
  a capture program then does. The Windows documentation itself says there is no guarantee that the
  setting strictly protects the content.
- **An Electron boolean.** The same, one layer higher.
- **The app's own preview.** It is drawn by the app on your computer.

## When a verification expires

A record stops being "Verified for this exact configuration" and becomes "Verification expired
after version change" when any of these is true. The app checks them in this order and shows the
first that applies.

| Reason shown                                                                | How it is detected                                                   |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| The operating system build changed since this test.                         | Automatically                                                        |
| The Electron version changed since this test.                               | Automatically                                                        |
| RealtimeDocs was updated since this test.                                   | Automatically                                                        |
| The meeting app version changed since this test.                            | Only if you enter the current version; the app cannot inspect others |
| The browser version changed since this test.                                | Only if you enter the current version; the app cannot inspect others |
| This test is older than 30 days; browsers and meeting apps update silently. | By the date of the record                                            |

The 30 days are `VERIFICATION_MAX_AGE_DAYS`. A record exactly 30 days old is still current. The
reason is that browsers and meeting applications update in the background, and the app has no way
to notice.

## Where records live

Each record is one small JSON file in a folder on the computer where you ran the app. Nothing is
sent to the RealtimeDocs server or anywhere else. Per the code comments, the folder is `privacy`
inside the app's user-data folder; the exact path depends on the wiring being finished in the
current pass and is not confirmed here.

How the store behaves (`apps/desktop/src/main/privacy/record-store.ts`):

- Every record is checked against the schema when written and when read.
- Writes are atomic: the file is written to a temporary name in the same folder, flushed, then
  renamed. A half-written temporary file is deleted next time the list is read, because it never
  became a record.
- A file that cannot be parsed, fails the schema, is larger than 64 KiB, or whose name does not
  match the record's id is moved to a `quarantine` folder inside the records folder and reported.
  It is never silently dropped or partly trusted.
- Deleting a record in the app removes its file. This cannot be undone.

Records are not part of the server backup described in [backup-and-restore.md](backup-and-restore.md),
because they never reach the server. Export them if you want a copy.

## Export

In "Recorded tests", choose "Export as Markdown" or "Export as JSON".

- **Markdown** (`realtimedocs-privacy-records.md`): a summary table followed by one section per
  record, newest first, headed by a notice that RealtimeDocs cannot see what other participants
  receive and that each result was entered by a person.
- **JSON** (`realtimedocs-privacy-records.json`): the records in the format
  `realtimedocs-privacy-records`, version 1, newest first.

The export is not written into the repository by itself. To use it in the project, copy the
relevant rows into the evidence section of [capture-compatibility.md](capture-compatibility.md)
as that file describes, give each the next free record identifier, and replace the matching
`NOT TESTED` cells of the matrix. How the save location is chosen is part of the wiring still being
finished and is not described here.

## Windows diagnostics module

On Windows the app can use a small optional native module, `win-display-affinity`
(`apps/desktop/native/win-display-affinity/README.md`), to read back from the operating system
what display affinity its own window has. That is what lets the app say "OS protection accepted"
on a firmer basis than "the call did not raise an error".

- It is optional. Without it, the app shows "Diagnostics module not present — status from Electron
  only", and the status comes from Electron's API alone.
- It works on the app's own top-level windows only. It refuses a window of any other process, and
  it does not hook, inject into or patch anything.
- It has exactly four functions: read the display affinity, set it (only the values 0, 1 and
  0x11), check whether desktop composition is on, and wait for one composition.
- It is not built on the Linux build host, and it has not been compiled or run on Windows. Its
  README lists the steps to build and check it on a Windows machine.
- Even when it reads the excluded value, that is an operating-system return value. It is not a
  verification.

## The Safe Share Guide

The Safe Share Guide has four steps. The last one points here.

1. Share a specific browser tab, presentation window, or application instead of your entire screen.
2. Keep RealtimeDocs outside the source you selected.
3. Confirm what others see from a second device or with another participant.
4. Record the result in the Privacy Test Center.

On macOS the app also shows this warning whenever an entire-display share could include the panel:
"Whole-display capture may include RealtimeDocs on this macOS and meeting-app configuration. Share
a selected application, window, or browser tab and verify using another participant."

## Limits

- Nothing here has been tested on Windows or macOS by this project. No record ships with the app.
- A record describes the one configuration it names, on the day it was made.
- The Test Center cannot prove that the person who entered a result checked it properly. It makes
  the entry deliberate and hard to skip; it cannot do more.
