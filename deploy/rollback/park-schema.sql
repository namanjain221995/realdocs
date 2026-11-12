-- Lets an OLDER server version start on a database that a newer version has
-- migrated (docs/upgrade-and-rollback.md).
--
-- A server refuses to start when the database records a migration it does not
-- know. The migrations of the enterprise upgrade (0002–0004) only ADD tables,
-- nullable columns and wider CHECK constraints, all of which an older server
-- ignores. So nothing is dropped here: the records of the newer migrations are
-- moved aside ("parked"), the older server starts, and every row written by
-- the newer version stays where it is.
--
-- Usage (replace 1 with the schema version of the server you roll back to):
--   psql -v keep=1 -f deploy/rollback/park-schema.sql
--
-- To go forward again run unpark-schema.sql BEFORE starting the newer server;
-- otherwise it would try to apply the parked migrations a second time and stop.
\set ON_ERROR_STOP on
BEGIN;
CREATE TABLE IF NOT EXISTS schema_migrations_parked (LIKE schema_migrations INCLUDING ALL);
WITH moved AS (
  DELETE FROM schema_migrations WHERE version > :keep RETURNING *
)
INSERT INTO schema_migrations_parked SELECT * FROM moved;
SELECT 'active' AS state, version, name FROM schema_migrations
UNION ALL
SELECT 'parked', version, name FROM schema_migrations_parked
ORDER BY 2;
COMMIT;
