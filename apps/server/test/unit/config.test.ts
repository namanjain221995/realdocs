import { DEFAULT_LIMITS } from '@realtimedocs/contracts';
import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  allowedOrigins,
  describeConfig,
  loadConfig,
  parseOrigin,
} from '../../src/config';

const SECRET = 'k3J9s8Hq2LmNp4Rt6VwXy1Zb5Cd7Ef0G-test-only';
const base = {
  DATABASE_URL: 'postgres://rd:s3cret-db-password@db.internal:5432/realtimedocs',
  SESSION_SECRET: SECRET,
};

function problems(env: Record<string, string | undefined>): string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  return [];
}

describe('loadConfig', () => {
  it('applies the documented defaults', () => {
    const config = loadConfig(base);
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(4310);
    expect(config.publicOrigin).toBe('http://127.0.0.1:4310');
    expect(config.webOrigins).toEqual(['http://127.0.0.1:4310']);
    expect(config.desktopOrigins).toEqual(['app://realtimedocs']);
    expect(config.cookieSecure).toBe(false);
    expect(config.trustProxy).toBe(false);
    expect(config.autoMigrate).toBe(true);
    expect(config.logLevel).toBe('info');
    expect(config.minClientSchemaVersion).toBe(1);
    expect(config.limits).toMatchObject({ ...DEFAULT_LIMITS, maxSvgBytes: 1024 * 1024 });
    expect(config.retention).toMatchObject({
      trashDays: 30,
      assetGraceDays: 30,
      pendingUploadHours: 24,
      preRestoreSnapshotDays: 90,
    });
    // Collaboration frame budget: fast typing and programmatic edits must fit.
    expect(config.collab).toMatchObject({ frameBurst: 1500, framesPerSecond: 300 });
    expect(config.collab.ticketTtlMs).toBe(60_000);
    expect(config.sessions.userTtlSeconds).toBe(14 * 86_400);
    expect(config.sessions.userIdleSeconds).toBe(3 * 86_400);
    expect(config.assetDir.endsWith('data/assets')).toBe(true);
  });

  it('derives Secure cookies and HTTPS behaviour from the public origin', () => {
    const config = loadConfig({
      ...base,
      PUBLIC_ORIGIN: 'https://docs.example.com/',
      ALLOWED_ORIGINS: 'https://docs.example.com, https://alt.example.com:8443',
      DESKTOP_ORIGINS: 'app://realtimedocs,app://staging',
    });
    expect(config.publicOrigin).toBe('https://docs.example.com');
    expect(config.cookieSecure).toBe(true);
    expect(config.webOrigins).toEqual(['https://docs.example.com', 'https://alt.example.com:8443']);
    expect([...allowedOrigins(config)]).toEqual([
      'https://docs.example.com',
      'https://alt.example.com:8443',
      'app://realtimedocs',
      'app://staging',
    ]);
    expect(
      loadConfig({ ...base, PUBLIC_ORIGIN: 'https://x.example', COOKIE_SECURE: 'false' })
        .cookieSecure,
    ).toBe(false);
    expect(loadConfig({ ...base, COOKIE_SECURE: 'true' }).cookieSecure).toBe(true);
  });

  it('parses overrides', () => {
    const config = loadConfig({
      ...base,
      RD_HOST: '0.0.0.0',
      RD_PORT: '4410',
      TRUST_PROXY: '2',
      AUTO_MIGRATE: 'false',
      LOG_LEVEL: 'debug',
      LIMIT_MAX_IMAGE_BYTES: '2097152',
      LIMIT_DOCUMENT_ASSET_QUOTA_BYTES: '1048576',
      SESSION_TTL_SECONDS: '3600',
      SESSION_IDLE_TTL_SECONDS: '600',
      TRASH_RETENTION_DAYS: '7',
      CLEANUP_INTERVAL_MINUTES: '0',
      COLLAB_MAX_QUEUE_BYTES: '65536',
      COLLAB_FRAME_BURST: '4000',
      COLLAB_FRAMES_PER_SECOND: '1000',
      COLLAB_TICKET_TTL_SECONDS: '5',
      RATE_LOGIN_PER_EMAIL: '3',
      ASSET_DIR: '/var/lib/realtimedocs/assets',
    });
    expect(config).toMatchObject({
      host: '0.0.0.0',
      port: 4410,
      publicOrigin: 'http://127.0.0.1:4410',
      trustProxy: 2,
      autoMigrate: false,
      logLevel: 'debug',
      assetDir: '/var/lib/realtimedocs/assets',
    });
    expect(config.limits.maxImageBytes).toBe(2_097_152);
    expect(config.limits.documentAssetQuotaBytes).toBe(1_048_576);
    expect(config.sessions.userTtlSeconds).toBe(3600);
    expect(config.retention.trashDays).toBe(7);
    expect(config.retention.cleanupIntervalMinutes).toBe(0);
    expect(config.collab.maxQueueBytes).toBe(65_536);
    expect(config.collab).toMatchObject({
      frameBurst: 4000,
      framesPerSecond: 1000,
      ticketTtlMs: 5_000,
    });
    expect(config.rateLimits.loginPerEmail).toBe(3);
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(loadConfig({ ...base, TRUST_PROXY: '0' }).trustProxy).toBe(false);
  });

  it('fails fast with a message that names the variable', () => {
    expect(problems({ SESSION_SECRET: SECRET }).join('\n')).toMatch(/DATABASE_URL is required/);
    expect(problems({ ...base, DATABASE_URL: 'mysql://x/y' }).join('\n')).toMatch(/DATABASE_URL/);
    expect(problems({ DATABASE_URL: base.DATABASE_URL }).join('\n')).toMatch(
      /SESSION_SECRET is required/,
    );
    expect(problems({ ...base, SESSION_SECRET: 'too-short' }).join('\n')).toMatch(
      /SESSION_SECRET must be at least 32 characters/,
    );
    expect(problems({ ...base, SESSION_SECRET: 'a'.repeat(40) }).join('\n')).toMatch(
      /too repetitive/,
    );
    expect(problems({ ...base, RD_PORT: '70000' }).join('\n')).toMatch(
      /RD_PORT must be an integer/,
    );
    expect(problems({ ...base, RD_PORT: 'http' }).join('\n')).toMatch(/RD_PORT/);
    expect(problems({ ...base, AUTO_MIGRATE: 'maybe' }).join('\n')).toMatch(
      /AUTO_MIGRATE must be true or false/,
    );
    expect(problems({ ...base, PUBLIC_ORIGIN: 'docs.example.com' }).join('\n')).toMatch(
      /PUBLIC_ORIGIN/,
    );
    expect(problems({ ...base, PUBLIC_ORIGIN: 'https://docs.example.com/app' }).join('\n')).toMatch(
      /PUBLIC_ORIGIN/,
    );
    expect(problems({ ...base, ALLOWED_ORIGINS: 'https://ok.example,*' }).join('\n')).toMatch(
      /ALLOWED_ORIGINS/,
    );
    expect(problems({ ...base, ALLOWED_ORIGINS: 'app://custom' }).join('\n')).toMatch(
      /ALLOWED_ORIGINS/,
    );
    expect(problems({ ...base, TRUST_PROXY: 'sometimes' }).join('\n')).toMatch(/TRUST_PROXY/);
    expect(problems({ ...base, COLLAB_FRAMES_PER_SECOND: '0' }).join('\n')).toMatch(
      /COLLAB_FRAMES_PER_SECOND must be an integer/,
    );
    // A ticket may be shorter-lived than the contract's 60 seconds, never longer.
    expect(problems({ ...base, COLLAB_TICKET_TTL_SECONDS: '600' }).join('\n')).toMatch(
      /COLLAB_TICKET_TTL_SECONDS/,
    );
    expect(problems({ ...base, LOG_LEVEL: 'verbose' }).join('\n')).toMatch(/LOG_LEVEL/);
    expect(
      problems({ ...base, SESSION_TTL_SECONDS: '600', SESSION_IDLE_TTL_SECONDS: '3600' }).join(
        '\n',
      ),
    ).toMatch(/SESSION_IDLE_TTL_SECONDS must not exceed/);
  });

  it('reports every problem at once', () => {
    const found = problems({ RD_PORT: '-1', LOG_LEVEL: 'loud' });
    expect(found.length).toBeGreaterThanOrEqual(4);
  });

  it('never puts secrets into error messages or the start-up summary', () => {
    const errors = problems({ ...base, SESSION_SECRET: 'short-secret-value', RD_PORT: 'x' }).join(
      '\n',
    );
    expect(errors).not.toContain('short-secret-value');
    expect(errors).not.toContain('s3cret-db-password');
    const summary = JSON.stringify(describeConfig(loadConfig(base)));
    expect(summary).not.toContain(SECRET);
    expect(summary).not.toContain('s3cret-db-password');
    expect(summary).toContain('db.internal:5432/realtimedocs');
  });
});

describe('parseOrigin', () => {
  it('accepts web origins and normalises them', () => {
    expect(parseOrigin('https://Docs.Example.com:443/', false)).toBe('https://docs.example.com');
    expect(parseOrigin('http://localhost:4311', false)).toBe('http://localhost:4311');
  });

  it('accepts custom-scheme app origins only where allowed', () => {
    expect(parseOrigin('app://realtimedocs', true)).toBe('app://realtimedocs');
    expect(parseOrigin('app://realtimedocs', false)).toBeNull();
  });

  it('rejects anything that is not a bare origin', () => {
    for (const value of [
      '',
      '*',
      'null',
      'https://user:pw@example.com',
      'https://example.com/path',
      'https://example.com?x=1',
      'https://example.com#frag',
      'javascript:alert(1)',
      'file:///etc/passwd',
    ]) {
      expect(parseOrigin(value, true), value).toBeNull();
    }
  });
});
