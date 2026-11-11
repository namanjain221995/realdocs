# Backup and restore

RealtimeDocs keeps its data in two places: a PostgreSQL database and a folder of uploaded files.
Two scripts, `scripts/backup.sh` and `scripts/restore.sh`, copy both out and put them back. This
page tells you how to use them and what they leave out. All commands are run from the repository
root, on the machine that runs Docker.

## What a backup contains

Each run writes a new directory `backups/<project>-<UTC timestamp>/`, for example
`backups/realtimedocs-20261111T093000Z/`. The directory is readable by its owner only.

| File            | Content                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| `database.dump` | The whole database (`pg_dump`, custom format), taken first as one consistent snapshot                                |
| `assets.tar.gz` | Every file in the `rd_assets` volume (uploaded images and attachments)                                               |
| `SHA256SUMS`    | Checksums of the two files above                                                                                     |
| `manifest.json` | Time, project name, schema version, PostgreSQL version, number of ready asset rows and of asset files in the archive |

Read this before you rely on it:

- **A backup contains password hashes and the full content of every document**, in readable form.
  Treat it like the live database. Store it encrypted and access-controlled, and do not leave it
  on a shared disk, in a synced folder or in version control.
- **It does not contain your environment file** (`.env` or `deploy/.env.production`), so it also
  holds none of your secrets. Keep a copy of your configuration separately, in a secret store.
  A restore does not need the original secrets: the target's `SESSION_SECRET` and
  `POSTGRES_PASSWORD` may differ from the source's.
- **It does not contain `rd_downloads`**, the volume of packaged desktop downloads. Those files can
  be built again.
- The database is dumped first and the files are archived afterwards. Uploaded files do not change
  once stored, so every file that the dump refers to is in the archive. If the archive holds fewer
  files than the database lists, the script prints a warning.

## Take a backup

The services may keep running during a backup. The database container of the project must be up.

For the default Compose project (named `realtimedocs`, configuration in `.env`):

```sh
scripts/backup.sh
```

For a project with another name or another environment file, say so:

```sh
scripts/backup.sh --project <compose project> --env-file <env file>
```

Options:

| Option                  | Meaning                                      | Default        |
| ----------------------- | -------------------------------------------- | -------------- |
| `--project`, `-p` `<n>` | Name of the Docker Compose project           | `realtimedocs` |
| `--env-file` `<file>`   | Environment file of that project             | `.env`         |
| `--out`, `-o` `<dir>`   | Directory in which the backup directory goes | `backups/`     |
| `--help`, `-h`          | Print the usage text                         |                |

The deployment in `deploy/` keeps its settings in `deploy/.env.production`, so its backup command
is:

```sh
scripts/backup.sh --env-file deploy/.env.production
```

(See [deploy/README.md](../deploy/README.md).) The last line the script prints is the path of the
backup directory. Do not run the retention job (`realtimedocs cleanup`) while a backup is running:
a file it deletes between the dump and the archive would be missing from that backup. The server
also runs that job by itself on a timer (`CLEANUP_INTERVAL_MINUTES`, default every six hours), so
choose a time when you do not expect it, or set the timer to 0 while you copy.

Then copy the directory off the machine. A backup on the same disk does not survive a disk
failure.

## Verify the checksums

`restore.sh` checks them itself before touching anything. To check a backup you have copied
somewhere else, on Linux:

```sh
cd backups/<backup directory> && sha256sum --check SHA256SUMS
```

On macOS use `shasum -a 256 --check SHA256SUMS` instead. Both files must report `OK`. If either
reports `FAILED`, do not use that backup.

## Restore into an empty target

Restoring **replaces** the target's database and its uploaded files with the contents of the
backup. The target can be an empty new project, or an existing one if you use `--force`.

```sh
scripts/restore.sh backups/<backup directory>
```

For a target with another project name or environment file:

```sh
scripts/restore.sh backups/<backup directory> --project <target project> --env-file <env file>
```

Options: `--project`, `-p` (default `realtimedocs`), `--env-file` (default `.env`), `--force`,
`--help`, `-h`.

The script, in this order:

1. Checks that the directory holds `database.dump`, `assets.tar.gz` and `SHA256SUMS`, and verifies
   the checksums. A damaged backup is rejected here, before anything is touched, even with
   `--force`.
2. Starts the target's database.
3. Counts the accounts in the target. **If there is at least one, it stops, changes nothing and
   tells you so**, unless you gave `--force`. The check exists so that restoring into the wrong
   project, or into a live system, cannot overwrite real data by accident. A running server of
   that project keeps running when the restore is refused.
4. Creates the target's server container and volume if needed, and stops the server.
5. Drops and recreates the database, then loads `database.dump`.
6. Empties the asset volume and unpacks `assets.tar.gz` into it.
7. Starts the server and prints how many documents and files were restored.

`--force` means "replace what is there". Use it only when you have checked the project name and
want that project's data gone.

A restore brings back the state of the moment of the backup. That includes access: a share link
that was revoked later, or a person who was removed later, has access again. Review the sharing
settings afterwards. Links that were handed out contain the address of the original system; they
work only if the restored system answers at that address.

## Rehearse a restore beside a live system

A restore into a second Compose project, with its own environment file and ports, does not touch
the running one. This is also the way to check that a backup is usable. Pick two free ports.

1. Create a separate environment file with new secrets and its own ports:

   ```sh
   node scripts/init-env.mjs --file "$HOME/rd-rehearsal.env" --port 4320 --db-port 54320
   ```

2. Restore into a project with a different name:

   ```sh
   scripts/restore.sh backups/<backup directory> --project realtimedocs-rehearsal --env-file "$HOME/rd-rehearsal.env"
   ```

3. Look at the result on the server at `http://127.0.0.1:4320`. For a server you reach over SSH,
   forward that port as described in [deployment.md](deployment.md).

4. When you are done, remove the rehearsal project and its volumes:

   ```sh
   RD_COMPOSE_ENV_FILE="$HOME/rd-rehearsal.env" docker compose --project-name realtimedocs-rehearsal --env-file "$HOME/rd-rehearsal.env" down --volumes
   ```

   Check the project name before you press Enter. `down --volumes` deletes the data of the project
   it names. Then delete `$HOME/rd-rehearsal.env`, which holds generated secrets.

The same sequence exists as an automated test, `pnpm test:backup-restore`, described in section 9
of [notes/server.md](notes/server.md). It uses two throw-away Compose projects. It filled one deployment with accounts, documents, an uploaded image and attachment, a snapshot
and a share link, backed it up, destroyed it, restored into a second one with different secrets,
and compared the result: accounts could sign in with their original passwords, documents and
exports were identical, asset files were byte-identical, snapshots, memberships, the share link
and the audit trail were present, and a new edit was saved. It also checked that a second restore
without `--force` was refused with the running server untouched, and that a backup with one byte
appended to `assets.tar.gz` was rejected by the checksum step. It ran on Linux only. The test
needs Docker and is not part of a plain `pnpm test`.

## What is not covered

- **No scheduling.** Nothing runs backups for you. Run the command by hand or from cron.
- **No rotation.** Old backups are never deleted. Decide how many to keep.
- **No encryption.** The files are plain. Encrypt them yourself before they leave the machine, or
  keep them on an encrypted disk.
- **No point-in-time recovery.** Each run is a complete dump. You can go back to the moment of a
  backup, not to a moment between two backups. For single documents, the snapshots inside the
  product are a separate, finer tool.
- **No copy to another machine.** That is your job too.
- **No configuration or secrets.** See above.
- The scripts are bash scripts. They were run on Linux only, not on macOS or Windows.
- A restore into a real production system has not been rehearsed on the `deploy/` deployment.

## Never run `docker compose down -v` on a live project

`docker compose down -v` (and `down --volumes`) deletes the project's named volumes: `rd_pgdata`,
which holds the database, `rd_assets`, which holds the uploaded files, and `rd_downloads`. With
those gone, the data exists only in your backups. Use `docker compose stop`, or
`docker compose down` without `-v`, to stop a live project. Use the `--volumes` form only on a
throw-away project, such as the rehearsal above, after reading its project name twice.
