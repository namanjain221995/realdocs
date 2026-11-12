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

On a phone the timeline and the revision are separate views with a back button. The page works from
320 px wide and at 200 % zoom, is keyboard operable (Up/Down move between rows, Enter opens one) and
announces loading with a status message.

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
