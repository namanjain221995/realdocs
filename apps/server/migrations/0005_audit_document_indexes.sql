-- Indexes for "administrative events about one document" (the events column of the version
-- history, src/history/service.ts listDocumentEvents). Without them the query walks the whole
-- audit log of the workspace, newest first, until it has found enough rows about the document:
-- its cost grew with the size of the workspace's audit log, not with the document's own events
-- (measured: 11.7 ms mean per call with about 70,000 audit rows; docs/REALDOCS_LOAD_TEST_REPORT.md).
-- Additive: no column, constraint or row changes.

CREATE INDEX audit_events_target_idx
  ON audit_events (workspace_id, target_id, at DESC)
  WHERE target_id IS NOT NULL;

CREATE INDEX audit_events_document_idx
  ON audit_events (workspace_id, (details ->> 'documentId'), at DESC)
  WHERE details ? 'documentId';
