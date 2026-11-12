/**
 * Environment configuration. Everything is validated once at start-up; a bad
 * value stops the process with a message that names the variable. Secrets are
 * never included in error messages or in `describeConfig`.
 */
import { hostname } from 'node:os';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  DEFAULT_LIMITS,
  DESKTOP_APP_ORIGIN,
  DOCUMENT_SCHEMA_VERSION,
  TTL,
  type Limits,
} from '@realtimedocs/contracts';
import { projectRoot } from './util/paths';

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

export interface ServerLimits extends Limits {
  /** SVG files are parsed completely, so they get a much smaller budget than raster images. */
  maxSvgBytes: number;
}

export interface RateLimitConfig {
  /** Failed sign-ins per IP address per 5 minutes. */
  loginPerIp: number;
  /** Failed sign-ins per email address per 15 minutes. */
  loginPerEmail: number;
  /** Failed share-link exchanges per IP address per 5 minutes. */
  shareExchangePerIp: number;
  /** Failed share-link exchanges per grant per 5 minutes. */
  shareExchangePerGrant: number;
  /** Failed invitation lookups/accepts per IP address per 10 minutes. */
  invitePerIp: number;
  /** Sign-up attempts per IP address per 10 minutes. */
  signupPerIp: number;
  /** Sign-up attempts per email address per hour. */
  signupPerEmail: number;
  /** Failed desktop handoff redemptions per IP address per 5 minutes. */
  desktopRedeemPerIp: number;
  /** Collaboration tickets per principal per minute. */
  collabTicketPerMinute: number;
  /** Uploads per principal per minute. */
  uploadPerMinute: number;
  /** WebSocket upgrades per IP address per minute. */
  wsUpgradePerMinute: number;
  /** All API requests per IP address per minute. */
  apiPerMinute: number;
  /** Requests per service API key per minute. */
  apiKeyPerMinute: number;
  /** Release artifact downloads (GET) per IP address per 10 minutes. */
  downloadPerIp: number;
}

export interface Config {
  nodeEnv: 'development' | 'production' | 'test';
  databaseUrl: string;
  host: string;
  port: number;
  publicOrigin: string;
  /** Origins that may use cookie sessions (always includes `publicOrigin`). */
  webOrigins: string[];
  /** Origins of packaged desktop renderers: bearer tokens only, never cookies. */
  desktopOrigins: string[];
  sessionSecret: string;
  cookieSecure: boolean;
  assetDir: string;
  trustProxy: boolean | number;
  webDistDir: string | null;
  /** Directory the desktop app downloads are served from, or null when none is configured. */
  downloadDir: string | null;
  /**
   * Coordination between several server instances (docs/scaling.md). `redisUrl`
   * null: this server runs alone and nothing below is used.
   */
  cluster: {
    redisUrl: string | null;
    /** Address other instances reach this one at (private network). */
    internalUrl: string;
    leaseTtlMs: number;
  };
  /** Bearer token for `GET /metrics`; null disables the endpoint. */
  metricsToken: string | null;
  /** Time between "not ready" and closing connections on shutdown, for a load balancer to notice. */
  shutdownDrainMs: number;
  /** True when anyone may create a (member) account without an invitation. */
  allowSignup: boolean;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  autoMigrate: boolean;
  minClientSchemaVersion: number;
  sessions: {
    userTtlSeconds: number;
    userIdleSeconds: number;
    shareTtlSeconds: number;
    shareIdleSeconds: number;
    desktopTtlSeconds: number;
    desktopIdleSeconds: number;
  };
  limits: ServerLimits;
  retention: {
    trashDays: number;
    assetGraceDays: number;
    pendingUploadHours: number;
    preRestoreSnapshotDays: number;
    auditDays: number;
    sessionDays: number;
    /** Days of version history kept; 0 keeps everything. */
    historyDays: number;
    /** 0 disables the in-process cleanup timer (run `cleanup` from cron instead). */
    cleanupIntervalMinutes: number;
  };
  collab: {
    maxConnections: number;
    /** Uncommitted update bytes one document may hold before it stops accepting edits. */
    maxQueueBytes: number;
    /** Lifetime of a collaboration ticket (the response tells clients when it expires). */
    ticketTtlMs: number;
    /** Inbound frames one socket may send in a burst before the sustained rate applies. */
    frameBurst: number;
    /** Sustained inbound frames per second per socket. */
    framesPerSecond: number;
    pingIntervalMs: number;
    idleTimeoutMs: number;
    sweepIntervalMs: number;
    /** Committed log rows after which the next store hook compacts the log. */
    compactAfterUpdates: number;
  };
  history: {
    /** Record an attributed, append-only history of every committed change. */
    enabled: boolean;
    /** History rows after which a compaction also stores a complete checkpoint. */
    checkpointEvery: number;
    /** Days history is kept; 0 keeps everything. */
    retentionDays: number;
  };
  webhooks: {
    /** How often the delivery worker looks for due deliveries. 0 disables the worker. */
    pollMs: number;
    /** Seconds to wait after the 1st, 2nd, … failed attempt; one more failure after the last is `dead`. */
    retryScheduleSeconds: number[];
    /** Seconds before an unanswered delivery attempt is abandoned. */
    timeoutMs: number;
  };
  db: {
    poolMax: number;
    statementTimeoutMs: number;
    lockTimeoutMs: number;
    connectTimeoutMs: number;
  };
  rateLimits: RateLimitConfig;
}

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

function int(name: string, fallback: number, min: number, max: number) {
  return z
    .string()
    .trim()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === '') return fallback;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        ctx.addIssue({
          code: 'custom',
          message: `${name} must be an integer between ${min} and ${max}`,
        });
        return z.NEVER;
      }
      return parsed;
    });
}

function bool(name: string, fallback: boolean) {
  return z
    .string()
    .trim()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === '') return fallback;
      const lower = value.toLowerCase();
      if (['1', 'true', 'yes', 'on'].includes(lower)) return true;
      if (['0', 'false', 'no', 'off'].includes(lower)) return false;
      ctx.addIssue({ code: 'custom', message: `${name} must be true or false` });
      return z.NEVER;
    });
}

/** Parses an http(s) origin or a custom-scheme app origin such as `app://realtimedocs`. */
export function parseOrigin(value: string, allowCustomScheme: boolean): string | null {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '' && url.pathname !== '/') return null;
  if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin;
  if (!allowCustomScheme) return null;
  if (!/^[a-z][a-z0-9+.-]*:$/.test(url.protocol) || !url.host) return null;
  // `URL.origin` is "null" for non-special schemes; rebuild it the way browsers send it.
  return `${url.protocol}//${url.host}`;
}

function originList(name: string, allowCustomScheme: boolean, fallback: string[]) {
  return z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value.trim() === '') return fallback;
      const origins: string[] = [];
      for (const part of value.split(',')) {
        if (part.trim() === '') continue;
        const origin = parseOrigin(part, allowCustomScheme);
        if (!origin) {
          ctx.addIssue({
            code: 'custom',
            message: `${name} contains an invalid origin (expected scheme://host[:port] without a path)`,
          });
          return z.NEVER;
        }
        origins.push(origin);
      }
      return [...new Set(origins)];
    });
}

const L = DEFAULT_LIMITS;
const DAY = 24 * 60 * 60;
const MIB = 1024 * 1024;

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).optional().default('development'),
  DATABASE_URL: z
    .string({ error: 'DATABASE_URL is required (postgres://user:password@host:port/database)' })
    .trim()
    .regex(/^postgres(ql)?:\/\/\S+$/, 'DATABASE_URL must be a postgres:// connection URL'),
  RD_HOST: z.string().trim().min(1).optional().default('127.0.0.1'),
  RD_PORT: int('RD_PORT', 4310, 1, 65535),
  PUBLIC_ORIGIN: z.string().trim().optional(),
  ALLOWED_ORIGINS: originList('ALLOWED_ORIGINS', false, []),
  DESKTOP_ORIGINS: originList('DESKTOP_ORIGINS', true, [DESKTOP_APP_ORIGIN]),
  SESSION_SECRET: z
    .string({ error: 'SESSION_SECRET is required (run `pnpm setup:env` to generate one)' })
    .min(32, 'SESSION_SECRET must be at least 32 characters long'),
  COOKIE_SECURE: z.enum(['auto', 'true', 'false']).optional().default('auto'),
  ASSET_DIR: z.string().trim().min(1).optional().default('data/assets'),
  TRUST_PROXY: z
    .string()
    .trim()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === '') return false;
      const lower = value.toLowerCase();
      if (lower === 'true') return true;
      if (lower === 'false') return false;
      const hops = Number(lower);
      if (Number.isInteger(hops) && hops >= 0 && hops <= 16) return hops === 0 ? false : hops;
      ctx.addIssue({
        code: 'custom',
        message: 'TRUST_PROXY must be true, false or the number of trusted proxy hops',
      });
      return z.NEVER;
    }),
  WEB_DIST_DIR: z.string().trim().optional(),
  DOWNLOAD_DIR: z.string().trim().optional(),
  REDIS_URL: z
    .string()
    .trim()
    .regex(/^rediss?:\/\//, 'REDIS_URL must start with redis:// or rediss://')
    .optional()
    .or(z.literal('')),
  CLUSTER_INTERNAL_URL: z
    .string()
    .trim()
    .regex(
      /^https?:\/\/[^/]+$/,
      'CLUSTER_INTERNAL_URL must be an origin such as http://server-1:4310',
    )
    .optional()
    .or(z.literal('')),
  CLUSTER_LEASE_TTL_SECONDS: int('CLUSTER_LEASE_TTL_SECONDS', 10, 3, 300),
  METRICS_TOKEN: z
    .string()
    .trim()
    .min(24, 'METRICS_TOKEN must be at least 24 characters')
    .optional()
    .or(z.literal('')),
  SHUTDOWN_DRAIN_SECONDS: int('SHUTDOWN_DRAIN_SECONDS', 0, 0, 120),
  ALLOW_SIGNUP: bool('ALLOW_SIGNUP', false),
  LOG_LEVEL: z.enum(LOG_LEVELS).optional().default('info'),
  AUTO_MIGRATE: bool('AUTO_MIGRATE', true),
  MIN_CLIENT_SCHEMA_VERSION: int('MIN_CLIENT_SCHEMA_VERSION', 1, 1, DOCUMENT_SCHEMA_VERSION),

  SESSION_TTL_SECONDS: int('SESSION_TTL_SECONDS', 14 * DAY, 60, 366 * DAY),
  SESSION_IDLE_TTL_SECONDS: int('SESSION_IDLE_TTL_SECONDS', 3 * DAY, 30, 366 * DAY),
  SHARE_SESSION_TTL_SECONDS: int('SHARE_SESSION_TTL_SECONDS', 7 * DAY, 60, 366 * DAY),
  SHARE_SESSION_IDLE_TTL_SECONDS: int('SHARE_SESSION_IDLE_TTL_SECONDS', DAY, 30, 366 * DAY),
  DESKTOP_SESSION_TTL_SECONDS: int('DESKTOP_SESSION_TTL_SECONDS', 30 * DAY, 60, 366 * DAY),
  DESKTOP_SESSION_IDLE_TTL_SECONDS: int(
    'DESKTOP_SESSION_IDLE_TTL_SECONDS',
    14 * DAY,
    30,
    366 * DAY,
  ),

  LIMIT_MAX_IMAGE_BYTES: int('LIMIT_MAX_IMAGE_BYTES', L.maxImageBytes, 1024, 512 * MIB),
  LIMIT_MAX_ATTACHMENT_BYTES: int(
    'LIMIT_MAX_ATTACHMENT_BYTES',
    L.maxAttachmentBytes,
    1024,
    2048 * MIB,
  ),
  LIMIT_MAX_SVG_BYTES: int('LIMIT_MAX_SVG_BYTES', MIB, 1024, 16 * MIB),
  LIMIT_MAX_IMAGE_PIXELS: int('LIMIT_MAX_IMAGE_PIXELS', L.maxImagePixels, 1, 1_000_000_000),
  LIMIT_MAX_IMAGE_DIMENSION: int('LIMIT_MAX_IMAGE_DIMENSION', L.maxImageDimension, 1, 100_000),
  LIMIT_DOCUMENT_ASSET_QUOTA_BYTES: int(
    'LIMIT_DOCUMENT_ASSET_QUOTA_BYTES',
    L.documentAssetQuotaBytes,
    1024,
    1024 * 1024 * MIB,
  ),
  LIMIT_MAX_DOCUMENT_STATE_BYTES: int(
    'LIMIT_MAX_DOCUMENT_STATE_BYTES',
    L.maxDocumentStateBytes,
    64 * 1024,
    512 * MIB,
  ),
  LIMIT_MAX_COLLAB_MESSAGE_BYTES: int(
    'LIMIT_MAX_COLLAB_MESSAGE_BYTES',
    L.maxCollabMessageBytes,
    16 * 1024,
    64 * MIB,
  ),
  LIMIT_MAX_JSON_BODY_BYTES: int('LIMIT_MAX_JSON_BODY_BYTES', L.maxJsonBodyBytes, 1024, 16 * MIB),

  TRASH_RETENTION_DAYS: int('TRASH_RETENTION_DAYS', 30, 1, 3650),
  ASSET_GRACE_DAYS: int('ASSET_GRACE_DAYS', 30, 1, 3650),
  PENDING_UPLOAD_HOURS: int('PENDING_UPLOAD_HOURS', 24, 1, 24 * 365),
  PRE_RESTORE_SNAPSHOT_RETENTION_DAYS: int('PRE_RESTORE_SNAPSHOT_RETENTION_DAYS', 90, 1, 3650),
  AUDIT_RETENTION_DAYS: int('AUDIT_RETENTION_DAYS', 365, 1, 3650),
  SESSION_RETENTION_DAYS: int('SESSION_RETENTION_DAYS', 30, 1, 3650),
  CLEANUP_INTERVAL_MINUTES: int('CLEANUP_INTERVAL_MINUTES', 360, 0, 7 * 24 * 60),

  COLLAB_MAX_CONNECTIONS: int('COLLAB_MAX_CONNECTIONS', 1000, 1, 100_000),
  COLLAB_MAX_QUEUE_BYTES: int('COLLAB_MAX_QUEUE_BYTES', 16 * MIB, 1024, 1024 * MIB),
  COLLAB_TICKET_TTL_SECONDS: int(
    'COLLAB_TICKET_TTL_SECONDS',
    TTL.collabTicketMs / 1000,
    1,
    TTL.collabTicketMs / 1000,
  ),
  COLLAB_FRAME_BURST: int('COLLAB_FRAME_BURST', 1500, 10, 1_000_000),
  COLLAB_FRAMES_PER_SECOND: int('COLLAB_FRAMES_PER_SECOND', 300, 1, 100_000),
  COLLAB_PING_INTERVAL_SECONDS: int('COLLAB_PING_INTERVAL_SECONDS', 15, 1, 300),
  COLLAB_IDLE_TIMEOUT_SECONDS: int('COLLAB_IDLE_TIMEOUT_SECONDS', 45, 5, 3600),
  COLLAB_SWEEP_INTERVAL_SECONDS: int('COLLAB_SWEEP_INTERVAL_SECONDS', 30, 1, 3600),
  COLLAB_COMPACT_AFTER_UPDATES: int('COLLAB_COMPACT_AFTER_UPDATES', 200, 1, 1_000_000),

  HISTORY_ENABLED: bool('HISTORY_ENABLED', true),
  HISTORY_CHECKPOINT_EVERY: int('HISTORY_CHECKPOINT_EVERY', 500, 1, 1_000_000),
  HISTORY_RETENTION_DAYS: int('HISTORY_RETENTION_DAYS', 0, 0, 36_500),

  WEBHOOK_POLL_MS: int('WEBHOOK_POLL_MS', 2_000, 0, 3_600_000),
  WEBHOOK_TIMEOUT_MS: int('WEBHOOK_TIMEOUT_MS', 10_000, 100, 120_000),
  WEBHOOK_RETRY_SCHEDULE_SECONDS: z
    .string()
    .trim()
    .optional()
    .transform((value, ctx) => {
      const text = value === undefined || value === '' ? '60,300,1800,7200,21600,86400' : value;
      const parts = text.split(',').map((part) => Number(part.trim()));
      if (parts.length === 0 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 604_800)) {
        ctx.addIssue({
          code: 'custom',
          message:
            'WEBHOOK_RETRY_SCHEDULE_SECONDS must be comma-separated whole seconds (0 to 604800)',
        });
        return z.NEVER;
      }
      return parts;
    }),

  DB_POOL_MAX: int('DB_POOL_MAX', 10, 2, 200),
  DB_STATEMENT_TIMEOUT_MS: int('DB_STATEMENT_TIMEOUT_MS', 15_000, 100, 600_000),
  DB_LOCK_TIMEOUT_MS: int('DB_LOCK_TIMEOUT_MS', 5_000, 100, 600_000),
  DB_CONNECT_TIMEOUT_MS: int('DB_CONNECT_TIMEOUT_MS', 5_000, 100, 600_000),

  RATE_LOGIN_PER_IP: int('RATE_LOGIN_PER_IP', 20, 1, 1_000_000),
  RATE_LOGIN_PER_EMAIL: int('RATE_LOGIN_PER_EMAIL', 8, 1, 1_000_000),
  RATE_SHARE_EXCHANGE_PER_IP: int('RATE_SHARE_EXCHANGE_PER_IP', 30, 1, 1_000_000),
  RATE_SHARE_EXCHANGE_PER_GRANT: int('RATE_SHARE_EXCHANGE_PER_GRANT', 20, 1, 1_000_000),
  RATE_INVITE_PER_IP: int('RATE_INVITE_PER_IP', 20, 1, 1_000_000),
  RATE_SIGNUP_PER_IP: int('RATE_SIGNUP_PER_IP', 10, 1, 1_000_000),
  RATE_SIGNUP_PER_EMAIL: int('RATE_SIGNUP_PER_EMAIL', 3, 1, 1_000_000),
  RATE_DESKTOP_REDEEM_PER_IP: int('RATE_DESKTOP_REDEEM_PER_IP', 20, 1, 1_000_000),
  RATE_COLLAB_TICKET_PER_MINUTE: int('RATE_COLLAB_TICKET_PER_MINUTE', 120, 1, 1_000_000),
  RATE_UPLOAD_PER_MINUTE: int('RATE_UPLOAD_PER_MINUTE', 240, 1, 1_000_000),
  RATE_WS_UPGRADE_PER_MINUTE: int('RATE_WS_UPGRADE_PER_MINUTE', 120, 1, 1_000_000),
  RATE_API_PER_MINUTE: int('RATE_API_PER_MINUTE', 1200, 1, 10_000_000),
  RATE_API_KEY_PER_MINUTE: int('RATE_API_KEY_PER_MINUTE', 600, 1, 10_000_000),
  RATE_DOWNLOAD_PER_IP: int('RATE_DOWNLOAD_PER_IP', 60, 1, 1_000_000),
});

function resolveDir(value: string): string {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(projectRoot(), value);
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => {
        const name = issue.path.join('.');
        // Custom messages already name the variable; zod's own messages do not.
        return issue.message.includes(name) || name === ''
          ? issue.message
          : `${name}: ${issue.message}`;
      }),
    );
  }
  const e = parsed.data;
  const problems: string[] = [];

  const publicOrigin = parseOrigin(e.PUBLIC_ORIGIN ?? `http://127.0.0.1:${e.RD_PORT}`, false);
  if (!publicOrigin) {
    problems.push(
      'PUBLIC_ORIGIN must be an http(s) origin without a path, e.g. https://docs.example.com',
    );
  }
  if (e.SESSION_IDLE_TTL_SECONDS > e.SESSION_TTL_SECONDS) {
    problems.push('SESSION_IDLE_TTL_SECONDS must not exceed SESSION_TTL_SECONDS');
  }
  if (e.LIMIT_MAX_SVG_BYTES > e.LIMIT_MAX_IMAGE_BYTES) {
    problems.push('LIMIT_MAX_SVG_BYTES must not exceed LIMIT_MAX_IMAGE_BYTES');
  }
  if (new Set(e.SESSION_SECRET).size < 8) {
    problems.push('SESSION_SECRET is too repetitive; generate one with `pnpm setup:env`');
  }
  if (problems.length > 0 || !publicOrigin) throw new ConfigError(problems);

  // The built web app is served only when it is really there (API-only images
  // and development with the Vite server run without it).
  const webCandidate =
    e.WEB_DIST_DIR !== undefined && e.WEB_DIST_DIR !== ''
      ? resolveDir(e.WEB_DIST_DIR)
      : path.resolve(projectRoot(), 'apps/web/dist');
  const webDistDir = existsSync(path.join(webCandidate, 'index.html')) ? webCandidate : null;

  return {
    nodeEnv: e.NODE_ENV,
    databaseUrl: e.DATABASE_URL,
    host: e.RD_HOST,
    port: e.RD_PORT,
    publicOrigin,
    webOrigins: [...new Set([publicOrigin, ...e.ALLOWED_ORIGINS])],
    desktopOrigins: e.DESKTOP_ORIGINS,
    sessionSecret: e.SESSION_SECRET,
    cookieSecure:
      e.COOKIE_SECURE === 'auto' ? publicOrigin.startsWith('https://') : e.COOKIE_SECURE === 'true',
    assetDir: resolveDir(e.ASSET_DIR),
    trustProxy: e.TRUST_PROXY,
    webDistDir,
    downloadDir:
      e.DOWNLOAD_DIR !== undefined && e.DOWNLOAD_DIR !== '' ? resolveDir(e.DOWNLOAD_DIR) : null,
    cluster: {
      redisUrl: e.REDIS_URL ? e.REDIS_URL : null,
      internalUrl: e.CLUSTER_INTERNAL_URL
        ? e.CLUSTER_INTERNAL_URL
        : `http://${hostname()}:${e.RD_PORT}`,
      leaseTtlMs: e.CLUSTER_LEASE_TTL_SECONDS * 1000,
    },
    metricsToken: e.METRICS_TOKEN ? e.METRICS_TOKEN : null,
    shutdownDrainMs: e.SHUTDOWN_DRAIN_SECONDS * 1000,
    allowSignup: e.ALLOW_SIGNUP,
    logLevel: e.LOG_LEVEL,
    autoMigrate: e.AUTO_MIGRATE,
    minClientSchemaVersion: e.MIN_CLIENT_SCHEMA_VERSION,
    sessions: {
      userTtlSeconds: e.SESSION_TTL_SECONDS,
      userIdleSeconds: e.SESSION_IDLE_TTL_SECONDS,
      shareTtlSeconds: e.SHARE_SESSION_TTL_SECONDS,
      shareIdleSeconds: e.SHARE_SESSION_IDLE_TTL_SECONDS,
      desktopTtlSeconds: e.DESKTOP_SESSION_TTL_SECONDS,
      desktopIdleSeconds: e.DESKTOP_SESSION_IDLE_TTL_SECONDS,
    },
    limits: {
      ...DEFAULT_LIMITS,
      maxImageBytes: e.LIMIT_MAX_IMAGE_BYTES,
      maxAttachmentBytes: e.LIMIT_MAX_ATTACHMENT_BYTES,
      maxSvgBytes: e.LIMIT_MAX_SVG_BYTES,
      maxImagePixels: e.LIMIT_MAX_IMAGE_PIXELS,
      maxImageDimension: e.LIMIT_MAX_IMAGE_DIMENSION,
      documentAssetQuotaBytes: e.LIMIT_DOCUMENT_ASSET_QUOTA_BYTES,
      maxDocumentStateBytes: e.LIMIT_MAX_DOCUMENT_STATE_BYTES,
      maxCollabMessageBytes: e.LIMIT_MAX_COLLAB_MESSAGE_BYTES,
      maxJsonBodyBytes: e.LIMIT_MAX_JSON_BODY_BYTES,
    },
    retention: {
      trashDays: e.TRASH_RETENTION_DAYS,
      assetGraceDays: e.ASSET_GRACE_DAYS,
      pendingUploadHours: e.PENDING_UPLOAD_HOURS,
      preRestoreSnapshotDays: e.PRE_RESTORE_SNAPSHOT_RETENTION_DAYS,
      auditDays: e.AUDIT_RETENTION_DAYS,
      sessionDays: e.SESSION_RETENTION_DAYS,
      historyDays: e.HISTORY_RETENTION_DAYS,
      cleanupIntervalMinutes: e.CLEANUP_INTERVAL_MINUTES,
    },
    collab: {
      maxConnections: e.COLLAB_MAX_CONNECTIONS,
      maxQueueBytes: e.COLLAB_MAX_QUEUE_BYTES,
      ticketTtlMs: e.COLLAB_TICKET_TTL_SECONDS * 1000,
      frameBurst: e.COLLAB_FRAME_BURST,
      framesPerSecond: e.COLLAB_FRAMES_PER_SECOND,
      pingIntervalMs: e.COLLAB_PING_INTERVAL_SECONDS * 1000,
      idleTimeoutMs: e.COLLAB_IDLE_TIMEOUT_SECONDS * 1000,
      sweepIntervalMs: e.COLLAB_SWEEP_INTERVAL_SECONDS * 1000,
      compactAfterUpdates: e.COLLAB_COMPACT_AFTER_UPDATES,
    },
    history: {
      enabled: e.HISTORY_ENABLED,
      checkpointEvery: e.HISTORY_CHECKPOINT_EVERY,
      retentionDays: e.HISTORY_RETENTION_DAYS,
    },
    webhooks: {
      pollMs: e.WEBHOOK_POLL_MS,
      retryScheduleSeconds: e.WEBHOOK_RETRY_SCHEDULE_SECONDS,
      timeoutMs: e.WEBHOOK_TIMEOUT_MS,
    },
    db: {
      poolMax: e.DB_POOL_MAX,
      statementTimeoutMs: e.DB_STATEMENT_TIMEOUT_MS,
      lockTimeoutMs: e.DB_LOCK_TIMEOUT_MS,
      connectTimeoutMs: e.DB_CONNECT_TIMEOUT_MS,
    },
    rateLimits: {
      loginPerIp: e.RATE_LOGIN_PER_IP,
      loginPerEmail: e.RATE_LOGIN_PER_EMAIL,
      shareExchangePerIp: e.RATE_SHARE_EXCHANGE_PER_IP,
      shareExchangePerGrant: e.RATE_SHARE_EXCHANGE_PER_GRANT,
      invitePerIp: e.RATE_INVITE_PER_IP,
      signupPerIp: e.RATE_SIGNUP_PER_IP,
      signupPerEmail: e.RATE_SIGNUP_PER_EMAIL,
      desktopRedeemPerIp: e.RATE_DESKTOP_REDEEM_PER_IP,
      collabTicketPerMinute: e.RATE_COLLAB_TICKET_PER_MINUTE,
      uploadPerMinute: e.RATE_UPLOAD_PER_MINUTE,
      wsUpgradePerMinute: e.RATE_WS_UPGRADE_PER_MINUTE,
      apiPerMinute: e.RATE_API_PER_MINUTE,
      apiKeyPerMinute: e.RATE_API_KEY_PER_MINUTE,
      downloadPerIp: e.RATE_DOWNLOAD_PER_IP,
    },
  };
}

/** Start-up summary that is safe to log: no secrets, no database credentials. */
export function describeConfig(config: Config): Record<string, unknown> {
  let database = 'unparseable';
  try {
    const url = new URL(config.databaseUrl);
    database = `${url.hostname}:${url.port || '5432'}${url.pathname}`;
  } catch {
    // Keep the placeholder; the URL was validated but may use an exotic form.
  }
  return {
    nodeEnv: config.nodeEnv,
    listen: `${config.host}:${config.port}`,
    publicOrigin: config.publicOrigin,
    webOrigins: config.webOrigins,
    desktopOrigins: config.desktopOrigins,
    cookieSecure: config.cookieSecure,
    trustProxy: config.trustProxy,
    database,
    assetDir: config.assetDir,
    webDistDir: config.webDistDir,
    autoMigrate: config.autoMigrate,
    logLevel: config.logLevel,
  };
}

/** Every origin that may open the collaboration WebSocket or call unsafe API methods. */
export function allowedOrigins(config: Config): Set<string> {
  return new Set([...config.webOrigins, ...config.desktopOrigins]);
}
