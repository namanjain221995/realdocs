-- Attributed, append-only document history (docs/version-history.md).
--
-- Additive only. `doc_updates` and `doc_states` keep their meaning (the
-- compacted working log of the current generation); nothing in them or in
-- `snapshots` is changed or removed.
--
-- `doc_history` receives one row per actor per committed batch, written in the
-- same statement that commits the batch to `doc_updates`, plus `checkpoint`
-- rows holding a complete state. Any retained revision can therefore be
-- rebuilt from the latest checkpoint at or before it and the rows after it.

-- Constant default: a catalogue-only change, no table rewrite.
ALTER TABLE documents ADD COLUMN history_seq bigint NOT NULL DEFAULT 0;

CREATE TABLE doc_history (
  document_id        uuid        NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  -- Monotonic per document across generations, assigned by the server.
  hseq               bigint      NOT NULL,
  workspace_id       uuid        NOT NULL REFERENCES workspaces (id),
  generation         integer     NOT NULL,
  -- `doc_updates.seq` of the commit this row belongs to (head_seq for checkpoints).
  seq                bigint      NOT NULL,
  kind               text        NOT NULL CHECK (kind IN ('update', 'checkpoint')),
  operation_type     text        NOT NULL,
  -- Who: set by the server from the authenticated connection, never by the client.
  -- No foreign keys: history must stay writable and readable whatever happens to
  -- the account, link or session it names.
  actor_kind         text        NOT NULL CHECK (actor_kind IN ('user', 'guest', 'service', 'system')),
  actor_user_id      uuid,
  actor_grant_id     uuid,
  actor_name         text        NOT NULL,
  participant_role   text,
  session_id         uuid,
  connection_id      text,
  client_id          bigint,
  transaction_id     uuid        NOT NULL,
  -- When: server clocks only. `client_occurred_at` is informational and untrusted.
  server_received_at  timestamptz NOT NULL,
  server_committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  client_occurred_at  timestamptz,
  content_size_delta integer     NOT NULL DEFAULT 0,
  -- Counts and kinds of changes. Never document text.
  summary            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Assets this row added to the document (every asset in the state for checkpoints).
  attachment_ids     uuid[]      NOT NULL DEFAULT '{}',
  schema_version     integer     NOT NULL,
  "update"           bytea       NOT NULL,
  PRIMARY KEY (document_id, hseq)
);

-- Timeline filters ("who", "when") within one document.
CREATE INDEX doc_history_actor_idx ON doc_history (document_id, actor_user_id, hseq DESC)
  WHERE actor_user_id IS NOT NULL;
-- Latest checkpoint at or before a revision.
CREATE INDEX doc_history_checkpoint_idx ON doc_history (document_id, generation, hseq DESC)
  WHERE kind = 'checkpoint';
-- Retention sweep by age.
CREATE INDEX doc_history_committed_idx ON doc_history (workspace_id, server_committed_at);
