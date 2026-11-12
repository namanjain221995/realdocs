# Editor package (`packages/editor`): implementation notes

Written by the editor agent on 2026-11-11. Covers everything in `packages/editor` except
`src/schema/**` (lead) and `src/export/**` (server agent). The public API is the one in
`docs/notes/editor-api.md`; this file says what is behind it, how it was verified, and what was not.

## 1. What exists

| Area                  | Files                                                                                                                        | What it does                                                                                                                                                                                                                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Collaboration session | `src/collab/session.ts`, `status.ts`, `backoff.ts`, `presence.ts`                                                            | `createCollabSession`: one ticket, one provider and one WebSocket per connection attempt; own reconnect loop; durable-acknowledgement protocol (`hello` / `mark` / `saved` / `resync` / `save-error`); `access`, `generation`, `persistence` messages; terminal states; presence. `deriveStatus` is a pure function, tested without a network. |
| Local recovery store  | `src/collab/localStore.ts`, `persistence.ts`, `ids.ts`                                                                       | IndexedDB (`idb`), one database per account, partitions by `(documentId, generation)`, compaction, dirty flag, recovery drafts, `clearLocalDataForAccount`. Guests and readers write nothing. Memory fallback when IndexedDB is unavailable.                                                                                                   |
| Editor extensions     | `src/editor/extensions.ts`, `blockFormat.ts`, `collabPlugins.ts`, `highlight.ts`, `findReplace.ts`, `mermaid.ts`, `attrs.ts` | Built with `createSchemaExtensions({ overrides, starterKit })`: schema nodes are extended (node views, commands, plugins), never redefined.                                                                                                                                                                                                    |
| Node views            | `src/editor/nodeViews/*`                                                                                                     | Image (upload states, resize, alignment, alt text, caption), attachment (download chip), diagram (source + safe preview), code block (language menu, copy).                                                                                                                                                                                    |
| Clipboard             | `src/clipboard/*`                                                                                                            | Sanitize (DOMPurify) → normalize (allow-list rebuild) → paste report. Drag and drop, file paste, link clicks.                                                                                                                                                                                                                                  |
| Uploads               | `src/uploads/*`                                                                                                              | `UploadManager` state machine, `insertFiles` / `removeUploadNode` commands, completion by `uploadId`.                                                                                                                                                                                                                                          |
| React                 | `src/react/*`                                                                                                                | `DocumentEditor`, `StaticDocument`, `SessionStatusIndicator`, `ParticipantStack`, `SessionBanners`, toolbar, find bar, link editor, Follow Latest, scroll anchoring.                                                                                                                                                                           |
| Styles                | `src/styles.css`                                                                                                             | Only `--rd-*` tokens. Host knobs: `--rd-doc-bg`, `--rd-doc-scale`, `--rd-doc-width`. Print rules, reduced motion, rules for narrow screens.                                                                                                                                                                                                    |
| Tests                 | `test/*`                                                                                                                     | Vitest project `editor`; `fixture-server.ts` is a real Hocuspocus 4.8.0 server with a fake database.                                                                                                                                                                                                                                           |
| Browser harness       | `demo/*`                                                                                                                     | Vite page (4420) + fixture server (4421) + Playwright script `demo/e2e.mjs`. Not part of the product.                                                                                                                                                                                                                                          |

Additions to the API of `editor-api.md` (no renames, nothing removed): optional `documentTitle` and
`timing` in `CollabSessionOptions`; exports `hasUnsavedChanges`, `installBeforeUnloadGuard`,
`useSessionSelector`, `configureLocalStore`, `DEFAULT_DISPLAY`, `openExternalLink`, `validateDocJSON`,
`processPastedHtml`, the paste limits and report types, `UPLOAD_CONCURRENCY`, `describeUploadError`,
`formatBytes`, `sanitizeLinkHref`, `DocJSON`, `DEFAULT_SESSION_TIMING`, `RECONNECT_BACKOFF`,
`backoffDelay`, `isTerminalState`, `formatShortcut`, `isMacPlatform`.

## 2. Commands

Every command needs the pinned toolchain first: `. scripts/dev-env.sh` (run from the repository root).

```sh
pnpm --filter @realtimedocs/editor run typecheck
pnpm exec eslint packages/editor
pnpm exec prettier --check packages/editor
pnpm exec vitest run --project editor

# Browser harness (loopback only, strict ports 4420 and 4421)
pnpm --filter @realtimedocs/editor run demo:server    # fixture server, 127.0.0.1:4421
pnpm --filter @realtimedocs/editor run demo           # Vite dev server, 127.0.0.1:4420
# or the production build, which is what the browser checks use:
pnpm --filter @realtimedocs/editor run demo:build
pnpm --filter @realtimedocs/editor run demo:preview   # 127.0.0.1:4420

# Real-browser checks (fixture server and preview must be running)
docker run --rm --name rd-ed-e2e --network host --user 1000:1000 -e HOME=/tmp \
  -e BROWSER=chromium -v "$PWD":/work -w /work \
  mcr.microsoft.com/playwright:v1.64.1-noble node packages/editor/demo/e2e.mjs
# BROWSER=chromium|firefox|webkit, ONLY=name,name runs a subset.
```

The harness page takes URL parameters (`scene`, `kind=sample|long|empty`, `panes=editor,editor2,viewer`,
`variant=panel`, `theme`, `tone`, `scale`, `width`, `follow=1`, `guest=1`, `static=1`); they are listed
at the top of `demo/main.tsx`. `demo/index.html` carries the production policy as a `<meta>` tag
(`script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:`); `demo/nocsp.html`
is the same page without any policy.

## 3. Verification results (2026-11-11, this host: Linux aarch64)

| Gate                                               | Result                                                                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @realtimedocs/editor run typecheck` | passes                                                                                                                |
| `pnpm exec eslint packages/editor`                 | passes, no warnings                                                                                                   |
| `pnpm exec prettier --check packages/editor`       | **fails on two files that are not mine**: `src/schema/nodes.ts`, `src/schema/sample.ts` (lead). All other files pass. |
| `pnpm exec vitest run --project editor`            | 211 tests in 9 files pass; eight runs in a row without a failure                                                      |
| Browser checks, Chromium 156.0.8078.4              | 34 passed, 0 failed, 0 skipped                                                                                        |
| Browser checks, Firefox 157.0                      | 32 passed, 0 failed, 2 skipped                                                                                        |
| Browser checks, WebKit 27.2 (Playwright build)     | 32 passed, 0 failed, 2 skipped                                                                                        |

The two skipped checks drive an IME through the Chrome DevTools Protocol, which only Chromium has.
`apps/web` and `apps/desktop` type-check against this package (`tsc --noEmit` in each, exit 0; run at
the end of this work, while those apps were still being built by their own agents).

Unit tests by file: `schema.test.ts` 19 (lead's, unchanged), `session.test.ts` 30, `status.test.ts` 15,
`local-store.test.ts` 9, `clipboard.test.ts` 48, `uploads.test.ts` 18, `find-replace.test.ts` 22,
`links.test.ts` 40, `hostile-attrs.test.ts` 10.

Spot check of the new tests by mutation: 13 single-line faults were introduced one at a time into the
upload extension, upload manager, find/replace, link click handler, `openExternalLink`, block format
rendering and table serialization; the tests failed for 12. The survivor removed the "do not write
while read-only" check from the upload completion; `ReadOnlyGuard` blocks the same transaction a
second time, so the behaviour did not change. The browser check `hostile-attributes` was validated the
same way (it fails when the guards in `blockFormat.ts` and `ImageView.tsx` are removed).

What the session tests cover against the fixture server (real Hocuspocus, real WebSocket, fake
database that can hold, delay or fail commits): ticket per attempt; convergence of two editors;
`Saved` only after the commit; deletion-only edits; commit failure and recovery; `whenSaved`;
`resync`; offline edits and the reconnect proof; transient ticket failures; viewer cannot write;
revocation, expiry, trashed document, outdated client; live role change with and without pending
work; generation change with a draft and without merging; a client that was offline during a restore;
local persistence across a reload; isolation between accounts and clearing on logout; guests write
nothing; IndexedDB unavailable; presence from server-attested identities only; degraded persistence;
`destroy`.

Screenshots of every browser check are in `packages/editor/demo/screenshots/` (`<browser>-<name>.png`,
about 12 MB), with a machine-readable summary per browser in `results-<browser>.jsonl`. Every Chromium
screenshot was looked at at least once during the work, most of them again after the last change; of
the Firefox and WebKit ones a sample was (first load, diagram, 360 px, image tools). Defects found
that way and fixed are listed in section 12.

## 4. Limits and timing values

| Value                                                                                                                                | Where                                                    | Why                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Formatted paste: 2,000,000 characters of HTML                                                                                        | `MAX_PASTE_HTML_LENGTH`                                  | Parsing and normalizing is synchronous in the paste handler. Larger payloads fall back to the plain-text flavour, with a note. |
| Plain-text paste: 1,000,000 characters                                                                                               | `MAX_PASTE_TEXT_LENGTH`                                  | A larger paste is refused with a note instead of freezing the tab and flooding the room.                                       |
| Embedded images per paste: 30                                                                                                        | `MAX_PASTE_IMAGES`                                       | Each becomes an upload; the rest are dropped with a note.                                                                      |
| Concurrent uploads: 3 per editor                                                                                                     | `UPLOAD_CONCURRENCY`                                     | Keeps a paste of many images from starving typing and the WebSocket; the rest wait in order.                                   |
| File type and size                                                                                                                   | `api.meta()` limits, contract defaults until it answered | Checked before the upload starts so the user is told at once; the server stays the authority.                                  |
| Upload completion during IME composition: retried every 120 ms                                                                       | `COMPOSITION_RETRY_MS`                                   | No document change is dispatched while a composition is open.                                                                  |
| Remote placeholder called "interrupted" after 90 s                                                                                   | `REMOTE_UPLOAD_STALE_MS`                                 | Another client's upload that never completes must not look alive forever; editors get a Remove action.                         |
| Syntax highlighting: 120 ms debounce, then an idle callback; blocks over 60,000 characters are not highlighted; cache of 200 results | `HIGHLIGHT_DEBOUNCE_MS`, `HIGHLIGHT_MAX_LENGTH`          | Off the typing path; a pause in typing is enough to start.                                                                     |
| Mermaid: 350 ms debounce, serialized queue, cache of 60 renders, source limit from `api.meta()` (default 20,000)                     | `DIAGRAM_DEBOUNCE_MS`, `mermaid.ts`                      | A render parses and lays out the whole diagram in the DOM (cost not measured); a node's first render is not debounced.         |
| Find: recompute 150 ms after the last change; at most 2,000 matches                                                                  | `FIND_DEBOUNCE_MS`, `FIND_MAX_MATCHES`                   | While typing, existing highlights are only mapped.                                                                             |
| Toolbar state: at most once per animation frame                                                                                      | `toolbarState.ts`                                        | No React render per keystroke.                                                                                                 |
| "Saved" shown after the state held for 400 ms                                                                                        | `SAVED_SETTLE_MS`                                        | Stops the indicator flickering Saving/Saved on every keystroke; "Saving", errors and offline are shown at once.                |
| `mark` coalescing 5 ms; acknowledgement watchdog 4 s; connect timeout 15 s; at most 5 resyncs per connection                         | `DEFAULT_SESSION_TIMING`                                 | One marker per burst of typing; a lost acknowledgement is asked for again.                                                     |
| Reconnect backoff: 400 ms × 2^n, capped at 30 s, ±50 % jitter                                                                        | `RECONNECT_BACKOFF`                                      | `retryNow()` skips the wait.                                                                                                   |
| Presence: at most one message per 80 ms                                                                                              | `presenceIntervalMs`                                     | Server limit is 60 ms (`PRESENCE_MIN_INTERVAL_MS`) plus a margin.                                                              |
| Local store compaction after 200 rows or 512 KiB                                                                                     | `COMPACT_AFTER_ROWS`, `COMPACT_AFTER_BYTES`              | Bounds replay time after a reload.                                                                                             |
| Paste report visible for 15 s                                                                                                        | `PASTE_REPORT_VISIBLE_MS`                                | Dismissible earlier.                                                                                                           |
| Follow Latest: a scroll counts as the reader's within 300 ms of wheel, touch, a scroll key or a scrollbar press                      | `USER_INTENT_WINDOW_MS`                                  | Bare scroll events (the feature's own scrolling, scroll anchoring) never pause it.                                             |
| Manual scroll anchoring: 60 ms grace after the user's own edit; anchor re-chosen 150 ms after the last scroll event                  | `followLatest.ts`                                        | Only used where CSS scroll anchoring is missing.                                                                               |
| Diagrams never scale below 60 % of their natural size                                                                                | `styles.css`                                             | Below that labels are unreadable; the diagram scrolls inside its own block instead.                                            |
| Copied tables: at most 200 columns serialized                                                                                        | `MAX_RENDERED_COLUMNS`                                   | Bound on a value that comes from the shared document.                                                                          |

## 5. Clipboard

Pipeline (`src/clipboard/process.ts`): detect the source application → DOMPurify with an allow-list
into an inert document → source-specific preparation → a normalizer that rebuilds the output from
resolved state (bold, italic, underline, strike, code, colour, size, highlight, link; alignment,
indentation, line spacing), so no attribute of the source markup is copied verbatim → paste report.
Nothing in the pipeline touches the network. If `DOMPurify.isSupported` is false, HTML is refused and
the text flavour is pasted.

| Source                                                                    | Kept                                                                                                                                                                                     | Simplified or dropped (named in the paste report)                                                                                                                                               |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google Docs                                                               | headings, paragraphs, alignment, indentation, line spacing, bold/italic/underline/strike, text colour, highlight, font size, links, nested bullet and numbered lists, checklists, tables | fonts; comments and their anchors; page layout; images hosted by Google become labelled links (never fetched); the default ink colour and the dominant font size are treated as "no formatting" |
| Microsoft Word                                                            | headings, inline formatting, lists rebuilt from `mso-list` paragraphs (per list id and level, without the marker glyphs), tables, empty paragraphs                                       | fonts; comments; tracked changes (deleted text is left out, inserted text kept); page and section breaks; `file://` and `v:imagedata` images ("could not be read from the clipboard")           |
| Google Sheets, Excel                                                      | the range as a table with its displayed values; hidden rows are skipped (Excel)                                                                                                          | cell colours, borders, sizes; formulas (displayed values are pasted)                                                                                                                            |
| Code editors (one monospace, `white-space: pre` block, as VS Code writes) | a code block with the text                                                                                                                                                               | the editor's colours (the document highlights the block itself)                                                                                                                                 |
| Web pages                                                                 | block structure, lists, tables, links with safe addresses, inline formatting                                                                                                             | scripts, frames, objects, media, forms, styles, unsafe links (turned into text), remote images (labelled links)                                                                                 |
| RealtimeDocs itself                                                       | everything; asset ids are kept only when the copy came from the same document                                                                                                            | assets of another document, and upload placeholders of another session, are dropped with a note                                                                                                 |
| Files (paste, drop, picker)                                               | images and allowed attachment types go to the upload pipeline                                                                                                                            | unsupported types and oversized files are named in a message                                                                                                                                    |
| `data:` images inside HTML                                                | uploaded through `api.uploadAsset`, placeholder in document order                                                                                                                        | rejected by type or size, or beyond 30 per paste                                                                                                                                                |

Known gaps:

- **The fixtures are hand-written.** `test/fixtures/clipboard.ts` reproduces the dialects from their
  documented markup (`docs-internal-guid`, `mso-list`, `google-sheets-html-origin`, …). Nothing was
  captured from a live Google Docs, Word, Sheets or Excel session on this host, so details of real
  clipboards may differ. Capturing real samples on a desktop machine and adding them as fixtures is
  the most valuable next step for this area.
- Word: no dedicated handling and no fixture for footnotes and endnotes, text boxes, equations,
  SmartArt, charts and multi-column sections. What the sanitizer and the generic rules make of them
  is what gets pasted.
- Google Docs: suggestions (its tracked changes) are not recognised; drawings and charts are expected
  to arrive as images hosted by Google and would then become links.
- Spreadsheets: merged cells keep their spans (clamped); number formats are whatever the application
  wrote as text.
- PowerPoint, Outlook, Notion, Confluence and Slack have no dedicated handling; they go through the
  generic web path.
- Rich paste from a clipboard that only offers RTF (no HTML flavour) arrives as plain text.

## 6. Uploads

Bytes only travel through `api.uploadAsset` (HTTP). The document holds a placeholder node with a
stable `uploadId` and, after completion, the asset id; never `data:` or `blob:` URLs (asserted in the
browser checks). Order is fixed when the placeholders are inserted, so uploads may finish in any
order. A finished upload updates the node with its `uploadId` wherever it is, with
`addToHistory: false`. No such node (undone, deleted, cut): nothing is inserted. The node comes back
(redo, undo of a delete): it is completed then. Cancel removes the node without an undo step. Progress
is the browser's byte count and lives in a per-upload store, never in the document. Placeholders of
other clients show "Uploading on another device…" and, after 90 s, "Upload interrupted", with Remove
for editors.

## 7. Mermaid and the Content Security Policy

- Loaded lazily (dynamic `import('mermaid')`) and initialised with

  ```js
  { startOnLoad: false, securityLevel: 'strict', htmlLabels: false, flowchart: { htmlLabels: false },
    maxTextSize, maxEdges: 500, suppressErrorRendering: true }
  ```

  `secure` additionally lists `htmlLabels`, `fontFamily` and `themeCSS`, so a diagram's own
  `%%{init}%%` directive or front matter cannot change them.

- The SVG Mermaid returns goes through DOMPurify (SVG profile; `foreignObject`, `script`, `image`,
  `a`, `use`, `animate`, `set` and `href` forbidden) and is displayed only as
  `<img src="data:image/svg+xml…">`. An SVG image cannot run script or load anything.
- Syntax errors are shown as text under the last good preview; a failing diagram never affects the
  rest of the editor.

Observed in real browsers with the policy `script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:` and no `unsafe-eval`:

- Ordinary diagrams render with **0 policy violations** in Chromium, Firefox and WebKit. The preview
  is a 855 px wide `data:image/svg+xml` image for the sample diagram; no live `<svg>` stays in the page.
- Diagrams that try to add CSS with remote URLs, HTML labels or `securityLevel: loose` through a
  directive, through front matter or through a node style: nothing of it reaches the output, no
  request leaves the page, no `style-src` or `img-src` report is raised (checked with and without the
  policy).
- **Chromium only:** when a sanitizer parses hostile markup that contains inline event handlers
  (`<img onerror=…>`), Chromium raises a `script-src-attr` report and logs "Executing inline event
  handler violates…" although the markup is parsed in an inert document and nothing executes. Counted:
  30 reports for the 22-payload paste corpus, 2 for the hostile diagram. Firefox and WebKit raise
  none. The same payloads on the page **without any policy** execute nothing either (`window.__pwned`
  stays unset, no dialog, no console error, no foreign request), so the sanitizers do not depend on
  the policy. If the server collects CSP reports, expect these when users paste hostile content.
- zod 4 probes `new Function` when the first schema is constructed, which raises a `script-src`
  report under the policy. `src/contract-additions.ts` calls `config({ jitless: true })` and is the
  first import of `src/index.ts`. See section 13 for why this belongs in the contracts package.

Residual risk: Mermaid lays the diagram out in the live page before the result is sanitized. With
`securityLevel: 'strict'` and the locked configuration no way was found to make that step load a
remote resource, and the policy would block it; but that step is Mermaid's code, not ours.

## 8. Attribute values written by another client (finding)

A collaborator's client can write any JSON value into any node or mark attribute through Yjs; the
parse rules of this editor are not involved, and ProseMirror does not validate attributes of nodes
that arrive this way. Everything that turns an attribute into a URL, a style or a layout decision
therefore reads it through `src/editor/attrs.ts`:

- Asset and upload ids must be lower-case UUIDs before they reach `api.assetUrl` (otherwise an id
  such as `../../../…` would make every reader's browser request an arbitrary same-origin path).
- Image width, natural size, alignment; attachment size; code language names; table column widths.
- **Line spacing and indentation.** The schema's `BlockFormat` writes the raw `lineHeight` attribute
  into a `style` attribute. Test value:

  ```text
  1; position: fixed; inset: 0; z-index: 99999; background-image: url(http://127.0.0.1:4421/rd-leak-attr.png)
  ```

  With the editor's guard removed, Chromium (page without a policy) showed the paragraph as
  `position: fixed` with the remote URL as its computed background image. The check stopped at the
  first pane it inspects; every other client renders the node through the same code, so this is a
  full-window overlay for everyone who opens the document. Whether the image request left the
  browser was not recorded; under the product policy `img-src` would block it, the overlay it would
  not. The editor's override (`src/editor/blockFormat.ts`) only renders the values the schema lists;
  the browser check `hostile-attributes` and `test/hostile-attrs.test.ts` cover it.

**For the lead and the server agent:** the unchecked rendering is still in
`packages/editor/src/schema/nodes.ts` (`BlockFormat.lineHeight.renderHTML`), which the server-side
schema and the exporters use. Suggested fix there: render only values contained in `LINE_HEIGHTS`,
clamp `indent` to `0…MAX_INDENT`. Tiptap's own colour, font-size, highlight and alignment attributes
already refuse values containing `;`, `{` or `}`; Tiptap's stock table serializer does not validate
`colwidth` (the editor's table override does, for copy).

Not addressed: a hostile `colspan` or `rowspan` (for example 10⁹) makes prosemirror-tables loop; a
document can also simply be made enormous. An editor of a document can deny service to its readers.

## 9. Collaboration session

- A fresh ticket, `HocuspocusProvider` and `HocuspocusProviderWebsocket` per connection attempt
  (`maxAttempts: 1`); retries, backoff and jitter are this module's. Presence uses the same socket
  with the session's own Awareness (the provider is created with `awareness: null`, because
  `provider.destroy()` would destroy an Awareness it was given).
- Local change counter `n` (incremented per local Yjs transaction); `mark` only after the `hello` of
  the connection; `Saved` only when `saved.n` covers the latest local change.
- **Refused updates.** Hocuspocus answers an update it refused (read-only connection, server not
  accepting edits) with `SyncStatus(false)`. The session then stops sending markers, reports `pending`
  and proves its state again with the next `hello`; a `saved` for a marker from before the refusal is
  ignored. The real server (`apps/server/src/collab/server.ts`) keeps an equivalent `refused` flag.
  The rule itself is not written down in `packages/contracts/src/collab.ts`.
- Generation change or loss of edit access with unsent work: the work is captured synchronously as a
  recovery draft (ProseMirror JSON), a fresh `Y.Doc` and Awareness replace the old ones, listeners of
  `onDocumentReplaced` fire, the old partition is purged. Old and new state are never merged.
- Notices that describe the current state (`role_changed`, `restored`, `persistence_*`) replace an
  older notice of the same kind; `draft_saved` notices accumulate.
- Not run against the real server by this agent: every session test uses `test/fixture-server.ts`.

## 10. Follow Latest and reading position

Follow Latest is off by default. When on, the latest remote change is scrolled into view smoothly
(instantly with reduced motion) without touching focus or selection. It pauses when the reader scrolls
(wheel, touch, scroll keys, scrollbar) or selects text, and shows "Jump to latest" once something new
arrived while paused.

A remote edit above the viewport does not move the reader. Where the browser has CSS scroll anchoring
(`overflow-anchor`: all three tested engines) that is the browser's work. Where it does not (older
Safari), `useScrollAnchor` holds the first visible block in place across every layout change, using a
`ResizeObserver` on the document and the scroll offset. Measured with five blocks inserted and two
removed above the viewport: at most 0.3 px movement with native anchoring; with native anchoring
switched off (`overflow-anchor: none` everywhere and `CSS.supports` patched) at most 0.3 px in
Chromium and Firefox and 1.1 px in WebKit. The fallback was not run in a Safari version that really
lacks the feature.

## 11. Performance

Off the typing path: syntax highlighting (lazy `lowlight`, idle callback, decorations mapped while
typing), Mermaid (lazy, debounced, queued, cached), paste normalization (runs once per paste), find
(mapped while typing, recomputed after the debounce), upload progress (per-upload store), toolbar
state (animation-frame throttle), status indicator (settled store).

No full React re-render per keystroke, measured: the harness wraps each `DocumentEditor` and each
status indicator in `<Profiler>` (the demo bundle aliases `react-dom/client` to the profiling build)
and counts commits while Playwright types 60 characters into a 60-block document with an editor and a
viewer open. Result in all three browsers: **0 commits in the typing editor, 0 in the receiving
viewer, 2 in the status indicator** (Saved → Saving → Saved). Input handler time per event in the same
run (Event Timing API, `durationThreshold: 0`), over the last three complete runs: Chromium p50
0.1 ms, p95 1.2–2.0 ms, max 1.5–3.0 ms (103–179 events per run); WebKit p50 0.0 ms, p95 3.0 ms, max
4–12 ms (82–89 events per run); Firefox reports no entries below its 16 ms floor, and none appeared.
These are numbers from a headless browser in a container on this host, with a 60-block document;
they say nothing about very large documents.

Bundle (demo build, uncompressed): the main chunk is 1.15 MiB and contains React, the UI kit, Tiptap,
ProseMirror, Yjs, DOMPurify, zod and the harness. The first diagram loads Mermaid's core as 16 chunks
(0.60 MiB together); each diagram type then loads its own chunk, and the large optional ones (ELK
layout 1.46 MiB, Cytoscape 0.42 MiB, KaTeX 0.25 MiB) are separate files that the build does not
preload. `lowlight` with its grammars is a lazy 0.16 MiB chunk. The whole build is 6.2 MiB of
JavaScript in 91 files. Which optional Mermaid chunks a given diagram really fetches was not traced.
No size budget was set or enforced.

## 12. Browser differences and defects found by looking

| Topic                                                                                        | Chromium 156                                                                                                                                                   | Firefox 157                                                                                                           | WebKit 27.2 (Playwright, Linux)                                                            |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Real copy and paste (`Ctrl+C` / `Ctrl+V` events, heading + list + link; Copy button → paste) | works                                                                                                                                                          | works                                                                                                                 | works                                                                                      |
| Synthetic `ClipboardEvent` carrying data (used by the other paste checks)                    | works                                                                                                                                                          | not possible: the script uses `view.pasteHTML` / `pasteText` / `insertFiles`, the same pipeline without the DOM event | works                                                                                      |
| Reading the clipboard back (`navigator.clipboard.readText`)                                  | verified equal to the code block                                                                                                                               | no permission API in Playwright; verified indirectly by pasting                                                       | same as Firefox                                                                            |
| Synthetic file drop                                                                          | works                                                                                                                                                          | works                                                                                                                 | works                                                                                      |
| IME composition (CDP)                                                                        | upload completion waits for the end of the composition; remote edits in another paragraph and in the same paragraph do not end it; text intact in both editors | not testable                                                                                                          | not testable                                                                               |
| CSS scroll anchoring                                                                         | native                                                                                                                                                         | native                                                                                                                | native                                                                                     |
| Inline-handler reports while sanitizing                                                      | 30 (corpus), 2 (diagram)                                                                                                                                       | 0                                                                                                                     | 0                                                                                          |
| Offline (`context.setOffline`)                                                               | `offline` + `pending`, then `live` + `saved`                                                                                                                   | same                                                                                                                  | same                                                                                       |
| Shortcut modifier                                                                            | Ctrl                                                                                                                                                           | Ctrl                                                                                                                  | Ctrl: this build's user agent says "Macintosh" but `navigator.platform` is `Linux aarch64` |
| Event Timing entries                                                                         | yes                                                                                                                                                            | none below 16 ms                                                                                                      | yes                                                                                        |

`isMacPlatform()` uses exactly the test ProseMirror's keymap uses (`navigator.platform`), so a hint
always names the key that works. Real Safari on macOS and iOS was not available.

Defects found by reading the screenshots or by the checks, all fixed: Mermaid edge labels looked
struck through (half-transparent label background once labels are SVG text); the diagram preview grew
with a long error line; upload placeholder buttons broke the card layout; a wide diagram became
unreadable at 360 px; "Edit source" left the focus on the button; two contradicting role notices
stayed side by side; shortcut hints disagreed with the working key in WebKit; find matches inside a
collapsed diagram source were counted but invisible; the first manual scroll anchoring (one
correction per remote transaction) drifted by 27 px in Firefox and 153 px in WebKit, because part of
the layout change arrives after the document transaction (in Firefox 16 px with it and 26 px
afterwards, presumably the collaborator's caret moving); the hostile attribute rendering of section 8.

Mistakes of the check script that looked like product bugs (kept here so nobody repeats them): typing
right after `commands.focus()` or after a toolbar click (the focus returns in the next animation
frame); comparing a paragraph's `textContent` in a pane that shows a collaborator's caret label;
`span[style*="color"]` also matches the caret selection.

## 13. For other owners

- **Contracts:** `config({ jitless: true })` from `zod` should be the first statement of
  `@realtimedocs/contracts` in browsers. Today it lives in `packages/editor/src/contract-additions.ts`
  and only helps if the editor package is imported before anything constructs a schema; an app that
  imports the contracts first gets one `script-src` report at start-up (nothing breaks).
- **Contracts:** document in `collab.ts` that a `mark` after a refused update must not be answered
  with `saved` (both sides already behave that way).
- **Schema (lead):** section 8; and `prettier --check` fails on `src/schema/nodes.ts` and
  `src/schema/sample.ts`.
- **Hosts (web, desktop):** `--rd-doc-bg` sets the document background (the desktop panel wants its
  own). The editor never navigates on a link click: after `sanitizeLinkHref` it calls `onOpenLink`,
  and opens a new tab without an opener only if the host did not handle the link.
- `packages/editor/package.json` still lists `@tiptap/extension-code-block-lowlight`,
  `@tiptap/extension-collaboration-caret` and `highlight.js` (direct), which this package does not
  import; they were there before and were left alone.

## 14. Not tested

- Real Google Docs, Word, Sheets and Excel clipboards (section 5); RTF-only clipboards.
- Safari on macOS and iOS, Chrome on Android, any touch device: Playwright's WebKit build on Linux is
  the only WebKit that ran. Touch scrolling as a Follow Latest pause signal is implemented but was
  only exercised with the mouse wheel.
- IME composition in Firefox and WebKit; real Hindi, Japanese or Chinese input methods (Chromium's
  CDP `Input.imeSetComposition` is a simulation). Typed and inserted Devanagari, ZWJ emoji and mixed
  text are identical in both panes in all three browsers.
- The session against the real server (`apps/server`); against a reverse proxy; with TLS.
- Documents larger than the 60-block performance scene; many simultaneous editors (two were used).
- Screen readers. Keyboard access to the toolbar (Alt+F10, arrow keys), the find bar and the link
  editor was checked. Scrollable table, code and diagram blocks have no `tabindex` of their own: a
  keyboard-only reader depends on the browser making scroll containers focusable.
- Printing to a real printer or PDF; the print rules were checked with `emulateMedia('print')`.
- `demo/` under the Vite dev server with the policy (the checks use the production build).

## 15. Things that cost time (for whoever maintains this)

- **DOMPurify does nothing under happy-dom** (it reports `isSupported` and returns the input with
  scripts and handlers intact). Clipboard and editor tests therefore run under jsdom
  (`// @vitest-environment jsdom`).
- A core Tiptap `Editor` cannot mount React node views; `test/editor-helpers.ts` replaces them with
  each node's `renderHTML`. In Tiptap 3 `.extend()` copies the parent's config, so extending an
  extension whose `addProseMirrorPlugins` calls `this.parent?.()` registers those plugins twice unless
  the copy's `parent` is reset (as `configure()` does).
- `idb` needs the global `IDBRequest`: tests import `fake-indexeddb/auto` and pass a fresh
  `IDBFactory` per test.
- `StarterKit`'s trailing-node plugin writes to the document on every client, readers included; it is
  disabled, and a paragraph is added on demand instead.
- Writing `\uXXXX` escapes for invisible characters into source through tooling sometimes produced
  the literal character; ESLint's `no-irregular-whitespace` catches it.

## 16. Lead addendum: callouts and schema version 2 (2026-11-11)

- New block node `callout` (`packages/editor/src/schema/nodes.ts`): attribute `variant` ∈ `info | tip |
success | warning | danger` (anything else renders as `info`); content is paragraphs, headings, lists and
  code blocks only; rendered as `<div data-type="callout" data-variant="…" role="note">`.
- `DOCUMENT_SCHEMA_VERSION` is now 2. A version-2 client's collaboration ticket raises a document to 2, and
  version-1 clients then receive `update_required` instead of opening it and dropping the unknown node.
- Exporters: Markdown writes a GitHub-style alert (`> [!NOTE]`, `TIP`, `IMPORTANT` for success, `WARNING`,
  `CAUTION` for danger); plain text writes a `[Note]`-style label line before the content.
- Paste: the editor's own dialect keeps callouts (variant validated); other divs are unchanged.
- Styles: `.rd-doc div[data-type='callout']` with the UI kit's info/success/warning/danger tokens; kept
  together when printed.
- Sample document: the "Tip" note is now a callout.
- Tests: `test/schema.test.ts` (callout block: rendering, hostile variants, allowed content, sample
  round trip) and `test/export-callout.test.ts`. Editor and contracts: 262 tests pass.
- Toolbar control (added later, see section 17).

## 17. Callout toolbar, copy link, audit (2026-11-11)

- **Callout control** (`src/react/EditorToolbar.tsx`, commands in `src/react/calloutCommands.ts`): an Info
  button in the "Lists and blocks" group opening a DOM menu from `@realtimedocs/ui` (`DropdownMenu`, never a
  native `<select>`; arrow keys, Enter, Escape; it sits in the toolbar's roving tab stop, reached with Alt+F10
  and arrow keys). Outside a callout it lists Note, Tip, Success, Warning, Danger and wraps the current
  block(s) with `toggleWrap('callout', { variant })` (disabled where the content cannot be wrapped, for
  example a table selection). Inside a callout the same menu ticks the current variant, changes it with
  `updateAttributes`, and offers "Remove callout" (replaces the box with its blocks; one undo step; own
  command, because `lift` would lift a list item out of a list inside the box). The button is `pressed` while the
  cursor is inside one. `ToolbarState` gained `callout` (validated against `CALLOUT_VARIANTS`) and
  `canCallout`. Viewers and read-only sessions have no toolbar, so no control.
- **Label inside the box**: `::before` in `styles.css` with the text per `data-variant` (Note, Tip, Success,
  Warning, Danger); nothing is written to a `style` attribute.
- **Copy link**: the link popover of an existing link has a "Copy link" button (`copyText`, only the
  sanitized address; disabled for an unsafe value; shows "Copied").
- **Tests**: `test/callout-toolbar.test.ts` (13, jsdom: state, wrap of one and several blocks, lists,
  refused content, variant change, removal incl. list in a callout, undo/redo, read-only). Browser checks in
  `demo/e2e.mjs`: `callout-toolbar`, `copy-link`, `copy-code`, `upload-cancel` (queued and active uploads
  cancelled, placeholders vanish in both panes, nothing arrives later, undo leaves nothing).
- **Observed** (final runs): Chromium 156 38 passed, 0 failed, 0 skipped; Firefox 157 36 passed, 0 failed, 2 skipped
  (the two CDP IME checks); WebKit 27.2 36 passed, 0 failed, 2 skipped. Four new checks in each. Editor project: 236 tests in 11 files pass (callout file: 13). Typecheck, ESLint,
  Prettier (whole package, now clean), web and desktop typecheck all pass.
- **Note for hosts**: `Select` in `@realtimedocs/ui` is a native `<select>`. The older toolbar controls
  Block type and Font size, and the code block's language menu, still use it; the desktop panel would show the
  platform picker for them. Not changed here.
- Undo manager merges edits closer than 500 ms into one step (Yjs default); the browser check waits 700 ms
  between callout steps for that reason.

Audit against the owner's list:

| Item                                                                       | Status                                                                                                            |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| bold, italic, underline, strikethrough, text colour, highlight, font size  | present (toolbar, shortcuts, paste)                                                                               |
| alignment, indentation, line spacing                                       | present (toolbar, `blockFormat.ts`)                                                                               |
| ordered, bullet, check lists; block quotes; horizontal rules               | present (toolbar)                                                                                                 |
| callouts                                                                   | added (toolbar menu, variants, label, remove)                                                                     |
| safe hyperlinks, editing                                                   | present (`LinkPopover`, `sanitizeLinkHref`)                                                                       |
| copy link                                                                  | added for editors (popover button). Readers: a click opens the link; no popover, only the browser's own link menu |
| tables with header rows, row/column operations, scrolling inside the block | present (Table menu; `styles.css` scroll rule)                                                                    |
| code blocks: language, highlighting, whitespace, Copy                      | present (`CodeBlockView`; Copy also for readers)                                                                  |
| images: paste, screenshots, drop, file picker                              | present (`uploads/extension.ts`, toolbar input)                                                                   |
| upload placeholders, retry, cancel, undo                                   | present (`uploadState.tsx`, `manager.ts`); cancel of a queued upload now covered by a browser check               |
| image resize, alignment, alt text, caption, aspect ratio                   | present (`ImageView.tsx`)                                                                                         |
| Mermaid source, safe rendering, readable parse errors                      | present (`DiagramView.tsx`, section 7)                                                                            |
| find for readers, find/replace for editors                                 | present (`FindBar.tsx`, `findReplace.ts`)                                                                         |
| collaboration-aware undo/redo                                              | present (y-tiptap undo; toolbar state reads its stacks)                                                           |
| Unicode, emoji, mixed Hindi/English, IME, multi-line paste                 | present (checks `hindi-emoji`, IME on Chromium only, paste pipeline)                                              |

## 18. Page settings, page surface and ruler (enterprise phase 3, 2026-11-12)

**State.** Page settings are shared document state in the same Y.Doc as the text: the top-level `Y.Map`
named `page` (`Y_PAGE_FIELD`, `packages/contracts/src/versions.ts`), flat keys `size`, `orientation`,
`marginTop|Right|Bottom|Left` (millimetres), `unit`, `background`, `headerSpacing`, `footerSpacing`. An empty
map means defaults. They therefore sync live, persist through the durable log, are part of snapshots, merge
after offline work and are refused from read-only connections by the server like any other update.
`DOCUMENT_SCHEMA_VERSION` is unchanged: older clients ignore the map and never write it.

**Model and helpers**: `packages/contracts/src/page.ts` (zod + pure functions, DOM-free). Every read goes
through `normalizePageSettings(raw)`: unknown names and wrong types become the default, numbers are clamped
(margins 0-100 mm, spacing 0-50 mm) and rounded to 0.1 mm, and the text area keeps at least 50 mm in both
directions (opposite margins shrink together). `background` is one of `default | white | cream | gray`, never
CSS text. Also `pageDimensionsMm`, `mmToPx` (96 dpi), `formatMeasurement`, `parseMeasurement` ("25.4", "2.5 cm",
`1"`), `snapMm` (1 mm, or 1/16 in), `marginProblem`, `maxMarginMm`, `pageRuleCss`.

**Editor package**: `src/page/store.ts` (`setPageSettings(ydoc, patch, origin)` writes only changed keys in
one transaction; `resetPageSettings`; `createPageSettingsStore`), `usePageSettings`, `css.ts` (custom
properties), `react/PageRuler.tsx`, `react/PageSetupDialog.tsx`, toolbar button "Page setup".
`DocumentEditor` gained `layout?: 'page' | 'reading'` (default `page`; `variant="panel"` is always `reading`),
`pageSetupOpen` / `onPageSetupOpenChange`.

**Undo.** The Collaboration extension's `Y.UndoManager` tracks the XML fragment. The editor adds the page map
with `undoManager.addToScope(...)` and writes page changes with the sync plugin's key as the transaction origin,
which that manager already tracks. A margin change is therefore one undo step in the same personal stack as
typing (Ctrl+Z in the document undoes the margin if it was the last thing the person did), and never reverts a
collaborator's change. `stopCapturing()` runs before and after each page write so it is never merged into the
typing next to it. Ctrl+Z / Ctrl+Shift+Z on a focused ruler marker call the same manager.

**Page surface.** In the `page` layout `.rd-editor__page` is a sheet: width = paper width, padding = margins,
border and shadow, centred, aspect ratio of the paper (so a short document is still a sheet; it grows with the
text), page colour. It is **one continuous sheet: there is no pagination** (page breaks appear only when
printing). Narrow containers: the sheet becomes `100%` wide and each margin is `min(real margin, its share of
the paper width)`, a percentage padding that resolves against the sheet's own width, so margins shrink in
proportion and the text reflows at its normal size. This was chosen over CSS `zoom` / `transform: scale`
because those change the coordinate space of `getBoundingClientRect`, `coordsAtPos` and `posAtCoords`
differently per engine, and ProseMirror's caret, selection and drag geometry depend on them; the fluid sheet
transforms nothing. Verified at 320 px in Chromium, Firefox and WebKit: no horizontal scroll, and 42 sampled
positions map from `coordsAtPos` back to themselves through `posAtCoords`. Named paper colours other than
`default` set `data-theme="light"` on the sheet so ink stays readable, and diagram previews are drawn light.
The per-user reading width (`display.readingWidth`) applies to the `reading` layout only (the compact panel and
the web reading mode); in the page layout the document's page decides the width. Font scale still applies.

**Ruler.** Shown above the page to people who can edit (hidden for readers, in the reading layout and when
printing). Ticks follow the preferred unit (mm: millimetre ticks, labels in cm; inches: 1/16 ticks, labels per
inch). Two markers, `role="slider"` with `aria-valuenow` (mm), `aria-valuemin`, `aria-valuemax` (largest value
that keeps 50 mm of text) and `aria-valuetext` in the preferred unit. Pointer events with capture; snapping;
tooltip with the exact value; the drag only previews locally and writes once on release. Keys: Left / Right move
the marker on screen (so Right shrinks the right margin), Up / Down raise / lower the margin, Shift = ten steps,
Home / End = smallest / largest, Escape cancels a drag. **Not implemented: first-line and hanging indent
markers.** The schema's block `indent` attribute is a whole-block level, not a length; per-paragraph indent
lengths need a new attribute and therefore a schema version.

**Print / export.** `GET /api/documents/:id/export?format=json` returns the document with a `pageSettings`
member (normalised; optional in the contract, `ExportPageSettingsField`). The print view
(`apps/web/src/features/document/printPage.ts`) sizes the sheet from it and inserts `@page { size; margin }`
through `CSSStyleSheet.insertRule` on an empty `<style>` element (the site's CSP currently allows inline
styles; the CSSOM route would work without that). Markdown and plain text are unchanged. `reencodeFresh` and
`encodeInitialState` (restore, duplicate) copy the settings into the new Yjs history
(`pageSettingsFromState` in `apps/server/src/documents/ydoc.ts`).

**Commands and results (this host).** `pnpm exec vitest run --project editor --project contracts --project web`;
new files `contracts/test/page.test.ts` (17 tests) and `editor/test/page-settings.test.ts` (9 tests); server
`test/integration/page-settings.test.ts` (3 tests; run it under the integration lock, see docs/testing.md).
Browser checks added to `demo/e2e.mjs`: `page-surface`, `ruler-drag`, `ruler-keyboard`, `page-undo`,
`page-setup-dialog`, `page-viewer-cannot-write`, `page-hostile-values`, `page-fit-320`, `page-reading-layout`.
The two-pane checks need a wide viewport (the harness puts the panes side by side); they set one.

**Not done / limits.** No pagination or page breaks on screen; no headers or footers (`headerSpacing` and
`footerSpacing` are stored and validated but nothing renders them); no indent markers (see above); only A4 and
Letter (no Legal, A3, custom sizes); the web print preview ignores the paper colour (paper is white).

Full browser run on 2026-11-12 with the page work in: Chromium 156 46 passed / 1 failed, Firefox 157 44 passed / 1
failed / 2 skipped, WebKit 27.2 44 passed / 1 failed / 2 skipped. The one failure in each engine is
`upload-states` ("Failure, then retry"): it injects one failed upload and expects the "failed" placeholder, but
the upload manager now retries automatically (phase 1 work), so the placeholder never shows. That check needs
updating by whoever owns the upload retry change; it is not caused by the page work. All nine page checks pass
in all three engines.
