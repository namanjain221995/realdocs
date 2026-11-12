-- Undoes park-schema.sql: puts the parked migration records back, so that the
-- newer server version finds its schema and starts (docs/upgrade-and-rollback.md).
--
--   psql -f deploy/rollback/unpark-schema.sql
--
-- Edits made while the older version was running are in the documents but not
-- in the version history. The newer server notices that when it next opens such
-- a document and records a new starting state ("History starts here").
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO schema_migrations
SELECT * FROM schema_migrations_parked
ON CONFLICT (version) DO NOTHING;
DROP TABLE schema_migrations_parked;
SELECT 'active' AS state, version, name FROM schema_migrations ORDER BY 2;
COMMIT;
