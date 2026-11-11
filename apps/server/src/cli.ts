/**
 * Operator commands:
 *
 *   migrate                       apply pending database migrations
 *   bootstrap-admin               create the first administrator (one time only)
 *       --email <address> --name <display name>
 *       [--password-stdin | --generate]   (default: hidden prompt on a terminal)
 *       [--workspace-name <name>]
 *   reset-password                set a new password for an existing, active account
 *       --email <address>
 *       [--password-stdin | --generate]   (default: hidden prompt on a terminal)
 *   seed-sample [--owner-email <address>] [--force]
 *                                 create the sample document with its demo image
 *   cleanup                       run the retention rules once
 */
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { parseArgs } from 'node:util';
import { DEFAULT_LIMITS } from '@realtimedocs/contracts';
import { SAMPLE_DOCUMENT_TITLE, buildSampleDocument } from '@realtimedocs/editor/schema';
import pino from 'pino';
import { z } from 'zod';
import { storeUpload } from './assets/service';
import { SYSTEM_ACTOR, writeAudit } from './audit';
import { hashPassword } from './auth/password';
import { revokeUserSessions } from './auth/sessions';
import { newId } from './auth/tokens';
import {
  createFoundation,
  ensureSchema,
  loadConfigOrExit,
  loadWorkspace,
  openStorage,
  type Foundation,
} from './bootstrap';
import { runCleanup } from './cleanup';
import { insertDocument } from './documents/store';
import { serverResource } from './util/paths';

class CliError extends Error {}

const out = (line: string) => process.stdout.write(`${line}\n`);

function promptLine(question: string): Promise<string> {
  process.stderr.write(question);
  return new Promise((resolve) => {
    let buffer = '';
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      process.stdin.off('data', onData);
      process.stdin.pause();
      resolve(buffer.slice(0, newline).replace(/\r$/, '').trim());
    };
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

/** Reads a line from the terminal without echoing it. */
function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  process.stderr.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write('\n');
    };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString('utf8')) {
        const code = character.codePointAt(0) ?? 0;
        if (code === 0x0d || code === 0x0a) {
          finish();
          resolve(value);
          return;
        }
        if (code === 0x03 || code === 0x04) {
          finish();
          reject(new CliError('Cancelled.'));
          return;
        }
        if (code === 0x7f || code === 0x08) {
          value = [...value].slice(0, -1).join('');
        } else if (code >= 0x20) {
          value += character;
        }
      }
    };
    stdin.on('data', onData);
  });
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks)
    .toString('utf8')
    .replace(/\r?\n$/, '');
}

/**
 * The new password of an account: generated on request, read from stdin for
 * scripts, otherwise typed twice at a hidden prompt. There is no default.
 */
async function obtainPassword(flags: {
  'password-stdin'?: boolean;
  generate?: boolean;
}): Promise<{ password: string; generated: boolean }> {
  if (flags['password-stdin'] && flags.generate) {
    throw new CliError('Use either --password-stdin or --generate, not both.');
  }
  let password: string;
  if (flags.generate) {
    return { password: randomBytes(18).toString('base64url'), generated: true };
  } else if (flags['password-stdin']) {
    password = await readStdin();
  } else if (process.stdin.isTTY) {
    password = await promptHidden(
      `Password (at least ${DEFAULT_LIMITS.passwordMinLength} characters): `,
    );
    if ((await promptHidden('Repeat password: ')) !== password) {
      throw new CliError('The passwords do not match.');
    }
  } else {
    // There is deliberately no default password.
    throw new CliError(
      'No password given. Run this in a terminal, or use --password-stdin or --generate.',
    );
  }
  if (
    password.length < DEFAULT_LIMITS.passwordMinLength ||
    password.length > DEFAULT_LIMITS.passwordMaxLength
  ) {
    throw new CliError(
      `The password must have ${DEFAULT_LIMITS.passwordMinLength} to ${DEFAULT_LIMITS.passwordMaxLength} characters.`,
    );
  }
  return { password, generated: false };
}

async function migrate(foundation: Foundation): Promise<void> {
  const applied = await ensureSchema(foundation, { forceMigrate: true });
  out(
    applied.length > 0
      ? `Applied ${applied.length} migration(s): ${applied.join(', ')}`
      : 'The database schema is up to date.',
  );
}

async function bootstrapAdmin(foundation: Foundation, argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      'password-stdin': { type: 'boolean', default: false },
      generate: { type: 'boolean', default: false },
      'workspace-name': { type: 'string' },
    },
    strict: true,
  });
  if (values['password-stdin'] && values.generate) {
    throw new CliError('Use either --password-stdin or --generate, not both.');
  }
  const { db } = foundation;
  await ensureSchema(foundation);
  const workspace = await loadWorkspace(db);

  const existing = await db.query('SELECT 1 FROM users LIMIT 1');
  if ((existing.rowCount ?? 0) > 0) {
    throw new CliError(
      'An account already exists. bootstrap:admin only creates the first administrator; add further accounts with invitations.',
    );
  }

  const interactive = process.stdin.isTTY === true && !values['password-stdin'];
  const emailInput = values.email ?? (interactive ? await promptLine('Administrator email: ') : '');
  const nameInput = values.name ?? (interactive ? await promptLine('Display name: ') : '');
  const email = z.email().max(DEFAULT_LIMITS.emailMaxLength).safeParse(emailInput.trim());
  if (!email.success) throw new CliError('A valid --email is required.');
  const name = nameInput.trim();
  if (name.length < 1 || name.length > DEFAULT_LIMITS.displayNameMaxLength) {
    throw new CliError(
      `--name is required (1 to ${DEFAULT_LIMITS.displayNameMaxLength} characters).`,
    );
  }

  const { password, generated } = await obtainPassword(values);
  const passwordHash = await hashPassword(password);
  const workspaceName = values['workspace-name']?.trim();
  await db.tx(async (tx) => {
    // Serialises concurrent bootstrap attempts; the check is repeated under the lock.
    await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('rd-bootstrap-admin', 0))`);
    const taken = await tx.query('SELECT 1 FROM users LIMIT 1');
    if ((taken.rowCount ?? 0) > 0) throw new CliError('An account already exists.');
    const id = newId();
    await tx.query(
      `INSERT INTO users (id, workspace_id, email, display_name, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, 'admin')`,
      [id, workspace.id, email.data.toLowerCase(), name, passwordHash],
    );
    if (workspaceName) {
      await tx.query('UPDATE workspaces SET name = $1 WHERE id = $2', [
        workspaceName.slice(0, 120),
        workspace.id,
      ]);
    }
    await writeAudit(tx, {
      workspaceId: workspace.id,
      actor: SYSTEM_ACTOR,
      action: 'bootstrap.admin_created',
      targetType: 'user',
      targetId: id,
    });
  });

  out(`Administrator ${email.data.toLowerCase()} created.`);
  if (generated) {
    out('Generated password (shown once, store it in a password manager):');
    out(password);
  }
}

/**
 * Operator recovery for a forgotten password. Sets a new password, ends every
 * session of the account and records the event. The server notices the ended
 * sessions at its next periodic check and closes their live connections.
 */
async function resetPassword(foundation: Foundation, argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      email: { type: 'string' },
      'password-stdin': { type: 'boolean', default: false },
      generate: { type: 'boolean', default: false },
    },
    strict: true,
  });
  if (values['password-stdin'] && values.generate) {
    throw new CliError('Use either --password-stdin or --generate, not both.');
  }
  const email = z
    .email()
    .max(DEFAULT_LIMITS.emailMaxLength)
    .safeParse((values.email ?? '').trim());
  if (!email.success) throw new CliError('A valid --email is required.');
  const { db } = foundation;
  await ensureSchema(foundation);
  const workspace = await loadWorkspace(db);

  const found = await db.query<{ id: string; status: string }>(
    'SELECT id, status FROM users WHERE workspace_id = $1 AND email = $2::citext',
    [workspace.id, email.data],
  );
  const user = found.rows[0];
  // Checked before any password is asked for or generated.
  if (!user) throw new CliError(`No account with the email address ${email.data} exists.`);
  if (user.status !== 'active') {
    throw new CliError(
      `The account ${email.data} is disabled. An administrator has to enable it before its password can be reset.`,
    );
  }

  const { password, generated } = await obtainPassword(values);
  const passwordHash = await hashPassword(password);
  const ended = await db.tx(async (tx) => {
    const updated = await tx.query(
      `UPDATE users SET password_hash = $1, updated_at = now()
        WHERE id = $2 AND workspace_id = $3 AND status = 'active'`,
      [passwordHash, user.id, workspace.id],
    );
    if ((updated.rowCount ?? 0) !== 1) {
      throw new CliError(
        'The account changed while its password was being reset; nothing was done.',
      );
    }
    // Whoever knew the old password, or holds a session opened with it, is signed out.
    const sessions = await revokeUserSessions(tx, user.id, 'password_reset');
    await writeAudit(tx, {
      workspaceId: workspace.id,
      actor: SYSTEM_ACTOR,
      action: 'auth.password_reset',
      targetType: 'user',
      targetId: user.id,
      details: { by: 'operator_cli', sessionsEnded: sessions.length },
    });
    return sessions.length;
  });

  out(`Password of ${email.data} was reset. ${ended} session(s) were ended.`);
  if (generated) {
    out('Generated password (shown once, store it in a password manager):');
    out(password);
  }
}

async function seedSample(foundation: Foundation, argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: { 'owner-email': { type: 'string' }, force: { type: 'boolean', default: false } },
    strict: true,
  });
  const { db, config } = foundation;
  await ensureSchema(foundation);
  const workspace = await loadWorkspace(db);
  const storage = await openStorage(config);

  const owner = await db.query<{ id: string; displayName: string }>(
    `SELECT id, display_name AS "displayName" FROM users
      WHERE workspace_id = $1 AND role = 'admin' AND status = 'active'
        AND ($2::text IS NULL OR email = $2::citext)
      ORDER BY created_at LIMIT 1`,
    [workspace.id, values['owner-email'] ?? null],
  );
  const admin = owner.rows[0];
  if (!admin) {
    throw new CliError('No administrator found. Create one first with `pnpm bootstrap:admin`.');
  }
  if (!values.force) {
    const present = await db.query(
      `SELECT 1 FROM documents WHERE workspace_id = $1 AND title = $2 AND status <> 'trashed'`,
      [workspace.id, SAMPLE_DOCUMENT_TITLE],
    );
    if ((present.rowCount ?? 0) > 0) {
      out('The sample document already exists (use --force to create another copy).');
      return;
    }
  }

  // The demo image ships with the server; nothing is downloaded.
  const imageAssetId = newId();
  const document = await db.tx(async (tx) => {
    const row = await insertDocument(tx, {
      workspaceId: workspace.id,
      title: SAMPLE_DOCUMENT_TITLE,
      createdBy: admin.id,
      content: buildSampleDocument({ imageAssetId }),
    });
    await writeAudit(tx, {
      workspaceId: workspace.id,
      actor: SYSTEM_ACTOR,
      action: 'document.sample_seeded',
      targetType: 'document',
      targetId: row.id,
    });
    return row;
  });
  // Same validation pipeline as a user upload.
  await storeUpload(
    { db, storage, limits: config.limits },
    {
      workspaceId: workspace.id,
      documentId: document.id,
      rawFilename: 'realtimedocs-demo.png',
      stream: createReadStream(serverResource('assets/realtimedocs-demo.png')),
      uploadedBy: admin.id,
      assetId: imageAssetId,
    },
  );
  out(`Sample document created: ${config.publicOrigin}/d/${document.id}`);
}

async function cleanup(foundation: Foundation): Promise<void> {
  const { db, config, logger } = foundation;
  await ensureSchema(foundation);
  const workspace = await loadWorkspace(db);
  const storage = await openStorage(config);
  const report = await runCleanup({
    db,
    storage,
    retention: config.retention,
    workspaceId: workspace.id,
    logger,
  });
  out(JSON.stringify(report, null, 2));
  if (report.skipped) out('Another cleanup run is in progress; nothing was done.');
}

const USAGE = `Usage: <command> [options]

  migrate
  bootstrap-admin --email <address> --name <name> [--password-stdin | --generate]
  reset-password --email <address> [--password-stdin | --generate]
  seed-sample [--owner-email <address>] [--force]
  cleanup`;

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') {
    out(USAGE);
    return command ? 0 : 64;
  }
  const commands: Record<string, (foundation: Foundation, argv: string[]) => Promise<void>> = {
    migrate,
    'bootstrap-admin': bootstrapAdmin,
    'reset-password': resetPassword,
    'seed-sample': seedSample,
    cleanup,
  };
  const run = commands[command];
  if (!run) {
    process.stderr.write(`Unknown command "${command}".\n\n${USAGE}\n`);
    return 64;
  }

  const config = loadConfigOrExit();
  // Operator output goes to stdout. The JSON log goes to stderr and is limited
  // to warnings and errors unless LOG_LEVEL says otherwise.
  const foundation = createFoundation(
    { ...config, logLevel: process.env.LOG_LEVEL ? config.logLevel : 'warn' },
    `realtimedocs-cli-${command}`,
    pino.destination({ fd: 2, sync: true }),
  );
  try {
    await run(foundation, rest);
    return 0;
  } catch (error) {
    if (error instanceof CliError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    const code = (error as { code?: string }).code;
    if (
      code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' ||
      code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE'
    ) {
      process.stderr.write(`${(error as Error).message}\n\n${USAGE}\n`);
      return 64;
    }
    process.stderr.write(`Command failed: ${(error as Error).message}\n`);
    return 1;
  } finally {
    await foundation.db.close().catch(() => undefined);
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exit(1);
  },
);
