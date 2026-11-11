-- RealtimeDocs schema, version 1 (see docs/architecture.md §2).
-- Every workspace-owned row carries workspace_id and every query filters by it.

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE workspaces (
  id          uuid PRIMARY KEY,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One workspace per deployment. It is created here so that the bootstrap
-- command and the server always find exactly one tenant.
INSERT INTO workspaces (id, name) VALUES (gen_random_uuid(), 'RealtimeDocs');

CREATE TABLE users (
  id             uuid PRIMARY KEY,
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  email          citext NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  display_name   text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  password_hash  text NOT NULL,
  role           text NOT NULL CHECK (role IN ('admin', 'member')),
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, email),
  UNIQUE (workspace_id, id)
);

CREATE TABLE documents (
  id                  uuid PRIMARY KEY,
  workspace_id        uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  title               text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'trashed')),
  generation          integer NOT NULL DEFAULT 1 CHECK (generation >= 1),
  schema_version      integer NOT NULL CHECK (schema_version >= 1),
  -- Last committed update sequence of the current generation.
  head_seq            bigint NOT NULL DEFAULT 0 CHECK (head_seq >= 0),
  created_by          uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  content_updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at         timestamptz,
  trashed_at          timestamptz,
  UNIQUE (workspace_id, id)
);
CREATE INDEX documents_workspace_status_idx ON documents (workspace_id, status, updated_at DESC);
CREATE INDEX documents_trashed_idx ON documents (trashed_at) WHERE status = 'trashed';

CREATE TABLE document_members (
  document_id   uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  role          text NOT NULL CHECK (role IN ('viewer', 'editor')),
  granted_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  granted_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, user_id),
  -- Both sides of a membership must live in the membership's workspace.
  FOREIGN KEY (workspace_id, document_id) REFERENCES documents (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, user_id) REFERENCES users (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX document_members_user_idx ON document_members (user_id);

CREATE TABLE share_grants (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  document_id   uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  role          text NOT NULL CHECK (role IN ('viewer', 'editor')),
  -- SHA-256 of the 32-byte capability secret. The secret itself is never stored.
  secret_hash   bytea NOT NULL CHECK (octet_length(secret_hash) = 32),
  label         text NOT NULL DEFAULT '' CHECK (char_length(label) <= 80),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz,
  revoked_at    timestamptz,
  rotated_from  uuid REFERENCES share_grants (id) ON DELETE SET NULL,
  last_used_at  timestamptz,
  FOREIGN KEY (workspace_id, document_id) REFERENCES documents (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX share_grants_document_idx ON share_grants (document_id, created_at DESC);

CREATE TABLE sessions (
  id                 uuid PRIMARY KEY,
  workspace_id       uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  -- user: browser account session; share: guest of one share grant;
  -- desktop: document-scoped companion session (bearer token).
  kind               text NOT NULL CHECK (kind IN ('user', 'share', 'desktop')),
  -- SHA-256 of the 32-byte session token. The token itself is never stored.
  token_hash         bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  user_id            uuid REFERENCES users (id) ON DELETE CASCADE,
  share_grant_id     uuid REFERENCES share_grants (id) ON DELETE CASCADE,
  document_id        uuid REFERENCES documents (id) ON DELETE CASCADE,
  parent_session_id  uuid REFERENCES sessions (id) ON DELETE CASCADE,
  -- Server-generated display name of a share-link guest.
  guest_name         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  -- Absolute expiry. Idle expiry is last_seen_at + the configured idle TTL.
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  revoked_reason     text,
  CHECK (
    (kind = 'user' AND user_id IS NOT NULL AND share_grant_id IS NULL AND document_id IS NULL)
    OR (kind = 'share' AND user_id IS NULL AND share_grant_id IS NOT NULL AND document_id IS NOT NULL)
    OR (kind = 'desktop' AND document_id IS NOT NULL
        AND ((user_id IS NOT NULL AND share_grant_id IS NULL)
          OR (user_id IS NULL AND share_grant_id IS NOT NULL)))
  )
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX sessions_grant_idx ON sessions (share_grant_id) WHERE share_grant_id IS NOT NULL;
CREATE INDEX sessions_parent_idx ON sessions (parent_session_id) WHERE parent_session_id IS NOT NULL;
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE invitations (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  secret_hash   bytea NOT NULL CHECK (octet_length(secret_hash) = 32),
  email         citext,
  role          text NOT NULL CHECK (role IN ('admin', 'member')),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  accepted_at   timestamptz,
  accepted_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  revoked_at    timestamptz
);
CREATE INDEX invitations_workspace_idx ON invitations (workspace_id, created_at DESC);

-- Compacted Yjs state per (document, generation). The state contains every
-- update with seq <= upto_seq of that generation.
CREATE TABLE doc_states (
  document_id   uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  generation    integer NOT NULL CHECK (generation >= 1),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  state         bytea NOT NULL,
  upto_seq      bigint NOT NULL DEFAULT 0 CHECK (upto_seq >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, generation)
);

-- Append-only Yjs update log. seq is gap-free and monotonic per generation.
CREATE TABLE doc_updates (
  document_id   uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  generation    integer NOT NULL CHECK (generation >= 1),
  seq           bigint NOT NULL CHECK (seq >= 1),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  "update"      bytea NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, generation, seq)
);

CREATE TABLE snapshots (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  document_id   uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  kind          text NOT NULL CHECK (kind IN ('named', 'pre_restore')),
  -- Generation the snapshot was taken from.
  generation    integer NOT NULL CHECK (generation >= 1),
  -- Full Yjs state (Y.encodeStateAsUpdate) at snapshot time.
  state         bytea NOT NULL,
  size_bytes    integer NOT NULL CHECK (size_bytes >= 0),
  -- Asset ids referenced by the snapshot; keeps those assets from being cleaned up.
  asset_ids     uuid[] NOT NULL DEFAULT '{}',
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX snapshots_document_idx ON snapshots (document_id, created_at DESC);

CREATE TABLE assets (
  id                  uuid PRIMARY KEY,
  workspace_id        uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  document_id         uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind IN ('image', 'attachment')),
  -- Randomized key inside the private asset volume. Never derived from user input.
  storage_key         text NOT NULL UNIQUE,
  name                text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
  mime                text NOT NULL,
  size_bytes          bigint NOT NULL CHECK (size_bytes >= 0),
  width               integer,
  height              integer,
  sha256              bytea NOT NULL CHECK (octet_length(sha256) = 32),
  -- pending: bytes are being moved into place; ready: servable.
  status              text NOT NULL CHECK (status IN ('pending', 'ready')),
  uploaded_by         uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- Set by the cleanup job when neither the live document nor any snapshot references the asset.
  unreferenced_since  timestamptz
);
CREATE INDEX assets_document_idx ON assets (document_id, status);

-- Files whose database row is gone (document purge, asset cleanup). The row is
-- written in the same transaction that removes the asset, so a crash between
-- the commit and the unlink cannot leak bytes on the private volume.
-- Operations that create files before their rows (duplicating a document)
-- register the keys here first with a later not_before and remove the entry
-- once the rows exist; if they crash, the cleanup job deletes the files.
CREATE TABLE asset_deletions (
  storage_key  text PRIMARY KEY,
  not_before   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE desktop_handoffs (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  -- SHA-256 of the single-use code.
  code_hash     bytea NOT NULL UNIQUE CHECK (octet_length(code_hash) = 32),
  document_id   uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  -- Session of the principal that requested the handoff.
  session_id    uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz
);
CREATE INDEX desktop_handoffs_expires_idx ON desktop_handoffs (expires_at);

-- Administrative and security events. Never document content, passwords,
-- secrets or tokens.
CREATE TABLE audit_events (
  id             uuid PRIMARY KEY,
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  at             timestamptz NOT NULL DEFAULT now(),
  actor_kind     text NOT NULL CHECK (actor_kind IN ('user', 'guest', 'system')),
  actor_user_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  actor_name     text,
  action         text NOT NULL,
  target_type    text,
  target_id      text,
  details        jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id     text
);
CREATE INDEX audit_events_workspace_at_idx ON audit_events (workspace_id, at DESC);
