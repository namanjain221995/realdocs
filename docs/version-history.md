# Version history

Version history answers "who changed this document, when, and what did it look like then?". It is
for workspace administrators (anyone who manages the document). Candidates, interviewers and share
link guests do not see it, and the server refuses their requests.

## Using it

Open a document and choose **Version history** (in the header, or under "More actions" on a narrow
screen). The address is `/d/<document id>/history`.

**Timeline.** Newest first, grouped by calendar day in your own time zone (the zone is named once
under the title). Inside a day, consecutive changes by the same person are folded into a group such
as "Naman Jain — Interviewer · 14 changes · 15:30:02–15:41:55" that you can collapse. Every row shows
the time to the second (hover for the full timestamp with milliseconds), what happened in plain
words, a short summary, who did it and in which role (Candidate, Interviewer, Admin, Editor, Guest).

| Row wording                                                             | Meaning                                                                                |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Typed text, Deleted text, Replaced text                                 | Characters were inserted, removed, or both.                                            |
| Pasted content                                                          | A large or announced insertion (see "Paste labelling").                                |
| Inserted / Removed image, Inserted / Removed attachment, Inserted table | Blocks that were added or removed.                                                     |
| Changed formatting, Changed structure, Edited                           | Marks or attributes changed; paragraphs were split, merged or moved; anything else.    |
| Changed page settings                                                   | For example "margin left 25.4 mm → 30 mm".                                             |
| Checkpoint                                                              | A complete copy of the document stored by the server for speed. Not a person's action. |
| History starts here                                                     | Where recorded history begins (see "Limits").                                          |

Dashed rows between the changes are administrative events of the same document ("Version restored",
"Share link created", "Title changed" …). An event the page does not know is shown as its raw action
name.

**Filters.** By editor name (part of the name), by operation, and by a date range (your calendar
days). Administrative events are not filtered by the server; they are hidden while an editor or
operation filter is on and limited to the date range otherwise. **Load more** fetches older rows. When
the server removes old history, the page says for how many days it keeps it.

**A revision.** Choose a row to see its detail: revision number, who, the session and connection
(shortened, with copy buttons), the time the server received the change and the time it committed it,
and the client's own time marked "reported by the client, not verified". Two views:

- **Changes** compares the text of the document before and after the revision, block by block.
  Inserted lines are green with `+`, removed lines red with `−`, unchanged lines muted; long runs of
  unchanged lines are folded. Very large documents are cut and say so.
- **Preview** shows the document as it was after the revision, read only, with its images.

Actions on a revision:

- **Name this version…** stores the revision as a named version (a snapshot, so it also appears in
  the Snapshots panel).
- **Restore this version…** asks for confirmation, names the revision automatically
  (`Restored from revision 12 (2026-11-12 15:30:02)`), restores it and returns to the document. The
  content as it was just before is kept as an automatic snapshot, so a restore can itself be undone.
  Nothing in the history is deleted. Disabled while the document is archived.
- **Restore as a copy** creates a new document from the revision and links to it.
- **Download** exports the revision as JSON, Markdown or plain text.
- **Export audit trail** (page level) downloads every retained row as CSV or JSON.
- The **version history document** (`doc.txt`, with the images as a zip) is described below.

On a phone the timeline and the revision are separate views with a back button. The page works from
320 px wide and at 200 % zoom, is keyboard operable (Up/Down move between rows, Enter opens one) and
announces loading with a status message.

## The version history document

Besides the timeline, the history of a document can be taken away as one text document, `doc.txt`,
in a fixed layout: numbered versions, each with the editor, the time, the lines that were added and
removed and the whole text at that point. Images that were pasted are named in it by their id and
come with it as files.

```text
DOCUMENT VERSION HISTORY
Document ID: 3b9a6a52-1f0e-4c7d-8a2b-5d6e7f809a1b
Document URL: https://docs.example.com/d/3b9a6a52-1f0e-4c7d-8a2b-5d6e7f809a1b
Title: Aarav_Sharma_Acme_Corp_Round_2_2030-03-14_15-30
Session ID: 7d0f6a5e-3c1b-4a52-9d57-2f4a1c8e9b10
Candidate: Aarav Sharma
Company: Acme Corp
Round: 2 System design
Tracking Started: 2030-03-14 10:00:05 UTC


==================================================
VERSION 1
Started At: 2030-03-14 03:30:05 PM IST
Edited At: 2030-03-14 03:30:21 PM IST
Edited By: Meera Iyer (Interviewer, meera@acme.example)
Action: Typed

ADDED:
- [03:30:21 PM] Design a URL shortener.

REMOVED:
- (nothing removed)

CURRENT SNAPSHOT:
Design a URL shortener.

==================================================
VERSION 2
Edited At: 2030-03-14 03:32:41 PM IST
Edited By: Aarav Sharma (Candidate, aarav@example.com)
Action: Pasted

ADDED:
- [03:32:41 PM] Start with the API: POST /shorten and GET /{code}.
- [03:32:41 PM] [IMAGE 5a4b3c2d-0000-4000-8000-0000000000a1] image pasted (images/5a4b3c2d-0000-4000-8000-0000000000a1.png)

REMOVED:
- (nothing removed)

CURRENT SNAPSHOT:
Design a URL shortener.
Start with the API: POST /shorten and GET /{code}.
[IMAGE 5a4b3c2d-0000-4000-8000-0000000000a1] images/5a4b3c2d-0000-4000-8000-0000000000a1.png

==================================================
CURRENT FINAL CONTENT
Design a URL shortener.
Start with the API: POST /shorten and GET /{code}.
[IMAGE 5a4b3c2d-0000-4000-8000-0000000000a1] images/5a4b3c2d-0000-4000-8000-0000000000a1.png


==================================================
FINALIZED AT: 2030-03-14 10:02:41 UTC
```

**Header.** The session lines appear only when the document belongs to an interview session.
"Tracking Started" is the server time of the first recorded history row, in UTC.

**What a version is.** One stretch of work by one editor. A new version starts when the editor
changes, when the same editor pauses for longer than `gapSeconds` (default 15), when the version
would cover more than `maxSpanSeconds` (default 60), and before and after every paste: a paste (of
text or of an image) is always a version of its own. A stretch that adds or removes no line and no
image (formatting, caret movement, blank lines) is not a version; the numbers have no gaps. The
content that already existed when recording began is version 1 by "System" with the action
`Initial`; a restored version is a version by "System" with the action `Restored`.

**Lines.** A line is one block of the document: a paragraph or heading (a line break inside it
starts another line), a list item with its marker, a table row with its cells joined by tabs, a
line of a code block. "ADDED" lists the lines of this version that the previous one did not have,
in document order; "REMOVED" lists the lines of the previous version that are gone. A line that was
edited therefore appears under both (old text removed, new text added). Blank lines are not listed.
"CURRENT SNAPSHOT" is the whole text; empty paragraphs at its very beginning and end are dropped.

**Times.** All times are the server's. "Edited At" is the last change of the version and "Started
At" its first (printed when they are more than a second apart), in the time zone given by
`timezone`: the interview session's zone by default, UTC for other documents. `IST` is printed for
`Asia/Kolkata`. Every added and removed line carries, in square brackets, the time of the very
change that added or removed it, to the second, in the same zone. "FINALIZED AT" is the time the
interview session was completed or cancelled when it was, otherwise the time of the last recorded
change; it is never the time of the request, so the same history always gives the same document.

**Who.** "Edited By" is `Name (Role, e-mail)`: the role is Candidate, Interviewer, Admin, Member or
Guest; the address is the account's, or the interview participant's as the session names it. A guest
on an ordinary share link has no address: `Guest Amber Lynx (Guest)`. Names, roles and addresses come
from the server's records of the authenticated connection, never from what a browser claims. The
document therefore contains e-mail addresses; it is available only to people who manage the document
and to API keys with the scope `documents:history:read`.

**Action.** `Typed`, `Pasted`, `Deleted`, `Formatted`, `Restored`, `Initial`, or `Mixed` when a
version contains more than one kind (formatting next to another kind does not count). The word comes
from the classification stored with each history row (see "Paste labelling").

**Images and files.** An image is the line `[IMAGE <id>] images/<file name>`; the id is the id of the
uploaded file and the file name is `<id>.<extension>` from its stored content type. The version in
which the id first appears lists `[IMAGE <id>] image pasted (images/<file name>)` under ADDED; when it
disappears, `[IMAGE <id>] image removed` under REMOVED. An attached file is `[FILE <id>] <name>`, with
`file attached` and `file removed`; attachments are not exported as images. An image stays
downloadable after it was removed from the document, as long as the history that shows it is kept.

**Endpoints.** For people who manage the document (a browser session):

| Request                                                          | Answer                                                                                                                                                           |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/documents/:documentId/version-history`                 | `doc.txt` (`text/plain`, attachment). `?format=json` answers the same content as data. Also `timezone`, `gapSeconds` (1 to 3600), `maxSpanSeconds` (5 to 86400). |
| `GET /api/documents/:documentId/version-history/images`          | `{ images: [{ id, fileName, mime, sizeBytes, sha256, firstVersion, lastVersion, url }] }`. `lastVersion` is `null` while the image is still in the document.     |
| `GET /api/documents/:documentId/version-history/images/:imageId` | The image file. `404` for an id that never was an image of this document (an attachment, another document's file, a file that was uploaded but never placed).    |
| `GET /api/documents/:documentId/version-history/archive`         | A zip: `docs/doc.txt`, `images/<file name>` for every image that ever appeared, `manifest.json` (the JSON form without the snapshots).                           |

For API keys with `documents:history:read`, the same four exist under
`/api/v1/documents/{documentId}/version-history…` and under
`/api/v1/interview-sessions/{sessionId}/version-history…` (see
[session-integration.md](session-integration.md)). Every export of the document or the archive is
written to the audit trail as `history.exported`.

The JSON form: `document {id, title, url}`, `session {id, candidate, company, round {number, name}}`
or `null`, `trackingStartedAt`, `finalizedAt`, `timezone`, `versions[]`, `finalContent`, `images[]`,
`truncated`. A version: `version`, `startedAt`, `startedAtText`, `editedAt`, `editedAtText`,
`editedBy`, `editor {name, role, email, kind}`, `action`, `added[]` and `removed[]` (plain strings
without the time), `addedDetail[]` and `removedDetail[]` (`{text, at, atText}`), `snapshot`,
`images[]` (ids present).

**Limits.** The history is replayed once per request, oldest row first. More than 200,000 recorded
rows are refused (`payload_too_large`). The list of versions is cut after 2,000 versions or 32 MiB of
snapshot text; the document then says so and `truncated` is true, while the final content stays
complete. Exact per-line times are taken for the first 256 MiB of text looked at; in a history larger
than that, later lines carry their version's time. History that was removed by retention, or made
before the server recorded history, is not in the document.

## How it works

**An attributed, append-only log.** The collaboration server knows which authenticated connection sent
every change. For each committed batch it writes one row per person to the table `doc_history`
(migration `0003_history.sql`), in the same SQL statement that appends the batch to `doc_updates` and
advances the document's counters. A change is therefore either durable and attributed, or neither;
the two cannot disagree. Rows are only ever inserted (and, by retention, deleted from the old end).
Each row holds the Yjs update bytes, the actor, timestamps, and a summary of counts and kinds.
Summaries never contain document text; text appears only in a revision's diff and content, which are
requested explicitly and audited.

**Revisions.** The revision number is `hseq`, monotonic per document across restores. A revision is
rebuilt from the newest checkpoint at or before it plus the rows after it.

**Checkpoints.** A complete state is stored at the start of a generation (the `baseline`) and then
whenever compaction runs and at least `HISTORY_CHECKPOINT_EVERY` rows were written since the last one.
They bound the work of rebuilding any revision and are the only places retention cuts at.

**Server time versus client time.** `server_received_at` is when the server received the change and
`server_committed_at` when the database committed it; both are server clocks, and the timeline is
ordered and grouped by the server's time. `client_occurred_at` is the time the client claims, sent
along with a hint; it is displayed as unverified information and never used for ordering.

**Paste labelling.** Editors send a short "hint" message just before a paste. If the next change of
that connection arrives within 5 seconds, the row is labelled Pasted content and the page says it was
"announced by the editor as a paste". A change that adds about 200 or more characters in a single
transaction is also labelled Pasted content ("inferred from the size of the change"), because that was
not typed. The hint comes from the browser and is not trusted for anything but this wording: it never
changes what is stored in the document, only how the row is described, and read-only connections
cannot send one.

**Restore.** Restoring a revision stores it as a named snapshot and restores that snapshot with the
existing snapshot mechanism. That starts a new generation of the document from the snapshot; the
current content is first kept as an automatic snapshot, connected editors are reconnected, and every
earlier history row remains. History is never rewritten.

**Attachments.** Images and files added by a revision stay available as long as any retained row or
checkpoint refers to them, so old revisions keep showing their images. The asset sweep treats every
asset referenced by `doc_history.attachment_ids` as in use.

## Settings

| Variable                   | Default | Meaning                                                                                                                                                                                                                                                     |
| -------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HISTORY_ENABLED`          | `true`  | Record history. With `false` nothing new is recorded (existing rows stay and remain readable).                                                                                                                                                              |
| `HISTORY_CHECKPOINT_EVERY` | `500`   | History rows after which a compaction also stores a checkpoint. Smaller means faster revision views and more storage.                                                                                                                                       |
| `HISTORY_RETENTION_DAYS`   | `0`     | Days of history to keep; `0` keeps everything. The cleanup job removes rows only in front of the newest checkpoint that is already older than the limit, so every row that remains can still be rebuilt. Actual retention can therefore be a little longer. |

## Limits

- History starts when the server is upgraded. For a document that existed before, the first recorded
  change is preceded by a "History starts here" row holding the content at that moment; nothing
  earlier can be shown.
- Character counts are approximate. When blocks are split or merged the editor reports the text as
  removed and inserted again, so a small edit can look larger than it was.
- The text comparison shows text only. Formatting, page settings and image changes appear in the row's
  summary, not in the diff.
- Changes made offline appear when they reach the server, with the server's time at that moment. The
  time the client reports is shown as unverified and does not move the row.
- A change by a person who later loses access, or whose account is deleted, keeps the name it had when
  it was made; history does not depend on accounts or links still existing.
- A document's history is removed when the document is permanently deleted.
