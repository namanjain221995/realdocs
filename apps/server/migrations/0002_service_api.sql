-- Service API (docs/session-integration.md): API keys, interview sessions with role-scoped
-- participants, idempotency records and webhooks. Additive only: new tables, new nullable
-- columns and one widened CHECK constraint. Nothing is dropped or rewritten.

-- Audit events written by API keys have their own actor kind.
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_actor_kind_check;
ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_actor_kind_check
  CHECK (actor_kind IN ('user', 'guest', 'system', 'service'));

CREATE TABLE api_keys (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  -- "rdk_<8 characters>": public, shown in lists and logs, used to look the key up.
  key_prefix    text NOT NULL UNIQUE CHECK (key_prefix ~ '^rdk_[A-Za-z0-9]{8}$'),
  -- SHA-256 of the complete key. The key itself is shown once and never stored.
  secret_hash   bytea NOT NULL CHECK (octet_length(secret_hash) = 32),
  scopes        text[] NOT NULL CHECK (cardinality(scopes) >= 1),
  allowed_cidrs text[],
  expires_at    timestamptz,
  last_used_at  timestamptz,
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  rotated_from  uuid REFERENCES api_keys (id) ON DELETE SET NULL
);
CREATE INDEX api_keys_workspace_idx ON api_keys (workspace_id, created_at DESC);

CREATE TABLE interview_sessions (
  id                 uuid PRIMARY KEY,
  workspace_id       uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  document_id        uuid NOT NULL UNIQUE REFERENCES documents (id) ON DELETE CASCADE,
  status             text NOT NULL DEFAULT 'scheduled'
                       CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'archived')),
  company_name       text NOT NULL CHECK (char_length(company_name) BETWEEN 1 AND 120),
  round_number       integer NOT NULL CHECK (round_number >= 1),
  round_name         text CHECK (round_name IS NULL OR char_length(round_name) <= 120),
  scheduled_at       timestamptz NOT NULL,
  timezone           text NOT NULL,
  expires_at         timestamptz NOT NULL,
  permissions        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Caller-supplied string pairs, including the external interview id.
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_title    text NOT NULL,
  created_by_key_id  uuid REFERENCES api_keys (id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  -- Set once, by the first document edit (idempotency of the document.first_edited event).
  first_edited_at    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  started_at         timestamptz,
  completed_at       timestamptz,
  cancelled_at       timestamptz,
  archived_at        timestamptz
);
CREATE INDEX interview_sessions_list_idx ON interview_sessions (workspace_id, created_at DESC, id DESC);
CREATE INDEX interview_sessions_status_idx ON interview_sessions (workspace_id, status, scheduled_at);

CREATE TABLE interview_participants (
  id              uuid PRIMARY KEY,
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  session_id      uuid NOT NULL REFERENCES interview_sessions (id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('candidate', 'interviewer')),
  name            text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  email           citext NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  -- The current access link. Older (rotated) links stay on share_grants, revoked.
  share_grant_id  uuid REFERENCES share_grants (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  removed_at      timestamptz,
  first_joined_at timestamptz,
  last_joined_at  timestamptz
);
CREATE INDEX interview_participants_session_idx ON interview_participants (session_id, created_at);
CREATE INDEX interview_participants_email_idx ON interview_participants (workspace_id, email);
CREATE INDEX interview_participants_grant_idx ON interview_participants (share_grant_id)
  WHERE share_grant_id IS NOT NULL;

-- A share grant created for an interview participant points back at it.
ALTER TABLE share_grants
  ADD COLUMN participant_id uuid REFERENCES interview_participants (id) ON DELETE SET NULL;
CREATE INDEX share_grants_participant_idx ON share_grants (participant_id)
  WHERE participant_id IS NOT NULL;

CREATE TABLE idempotency_keys (
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  api_key_id    uuid NOT NULL REFERENCES api_keys (id) ON DELETE CASCADE,
  key           text NOT NULL CHECK (char_length(key) BETWEEN 1 AND 128),
  request_hash  text NOT NULL,
  -- NULL while the first request is still running. The response holds access URLs, so it is
  -- stored encrypted ({"enc": "v1:..."}), never as readable JSON.
  response      jsonb,
  status_code   integer,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (api_key_id, key)
);
CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at);

CREATE TABLE webhook_endpoints (
  id                 uuid PRIMARY KEY,
  workspace_id       uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  url                text NOT NULL CHECK (char_length(url) <= 2048),
  -- Signing secret, AES-256-GCM encrypted with a key derived from SESSION_SECRET.
  secret             text NOT NULL,
  events             text[] NOT NULL CHECK (cardinality(events) >= 1),
  enabled            boolean NOT NULL DEFAULT true,
  created_by_key_id  uuid REFERENCES api_keys (id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  disabled_at        timestamptz
);
CREATE INDEX webhook_endpoints_workspace_idx ON webhook_endpoints (workspace_id, created_at DESC);

CREATE TABLE webhook_deliveries (
  id               uuid PRIMARY KEY,
  workspace_id     uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  endpoint_id      uuid NOT NULL REFERENCES webhook_endpoints (id) ON DELETE CASCADE,
  event_id         uuid NOT NULL,
  event_type       text NOT NULL,
  -- Never document content or access secrets.
  payload          jsonb NOT NULL,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'delivered', 'failed', 'dead')),
  attempts         integer NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  last_status_code integer,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  delivered_at     timestamptz
);
CREATE INDEX webhook_deliveries_due_idx ON webhook_deliveries (next_attempt_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX webhook_deliveries_endpoint_idx ON webhook_deliveries (endpoint_id, created_at DESC, id DESC);
