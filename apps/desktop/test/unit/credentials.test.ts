import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CredentialStore,
  type EncryptionAdapter,
  type StoredSession,
} from '../../src/main/credential-store';

const SERVER = 'https://docs.example.com';
const TOKEN = 'desktop-token-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function session(overrides: Partial<StoredSession> = {}): StoredSession {
  return {
    version: 1,
    serverOrigin: SERVER,
    documentId: '3f2b8c1e-9a4d-4c7b-8e21-5d6f7a8b9c0d',
    token: TOKEN,
    title: 'Launch notes',
    role: 'viewer',
    expiresAt: null,
    accountId: null,
    via: 'share_link',
    savedAt: '2026-11-10T10:00:00.000Z',
    ...overrides,
  };
}

/** Reversible stand-in for OS encryption: the blob never contains the plaintext bytes. */
function fakeEncryption(
  options: { available?: boolean; backend?: string | null; failEncrypt?: boolean } = {},
): EncryptionAdapter {
  const key = 0x5a;
  return {
    availability: () =>
      Promise.resolve({
        available: options.available ?? true,
        backend: options.backend ?? null,
        detail: options.available === false ? 'No secret store.' : 'Encrypted with the test store.',
      }),
    encrypt: (plain) => {
      if (options.failEncrypt) return Promise.reject(new Error('keychain locked'));
      return Promise.resolve(
        Buffer.from(Buffer.from(`v1:${plain}`, 'utf8').map((byte) => byte ^ key)),
      );
    },
    decrypt: (data) => {
      const text = Buffer.from(data.map((byte) => byte ^ key)).toString('utf8');
      if (!text.startsWith('v1:')) return Promise.reject(new Error('not ours'));
      return Promise.resolve(text.slice(3));
    },
  };
}

describe('credential store', () => {
  let directory: string;
  let filePath: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rd-cred-'));
    filePath = path.join(directory, 'session.bin');
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  const exists = () =>
    fs.stat(filePath).then(
      () => true,
      () => false,
    );

  it('persists only an encrypted blob when OS encryption is available', async () => {
    const store = new CredentialStore({ filePath, encryption: fakeEncryption() });
    expect(await store.init()).toMatchObject({ mode: 'os_encrypted' });
    await store.set(session());
    expect(store.getToken()).toBe(TOKEN);
    const blob = await fs.readFile(filePath);
    expect(blob.includes(Buffer.from(TOKEN))).toBe(false);
    expect(blob.includes(Buffer.from('docs.example.com'))).toBe(false);
    expect(await fs.readdir(directory)).toEqual(['session.bin']);
  });

  it('restores the session for the configured server', async () => {
    const first = new CredentialStore({ filePath, encryption: fakeEncryption() });
    await first.init();
    await first.set(
      session({
        accountId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        via: 'handoff',
        role: 'editor',
      }),
    );

    const second = new CredentialStore({ filePath, encryption: fakeEncryption() });
    await second.init();
    expect(second.getToken()).toBeNull();
    const outcome = await second.restore(SERVER);
    expect(outcome.status).toBe('restored');
    expect(second.getSession()).toMatchObject({ token: TOKEN, role: 'editor', via: 'handoff' });
  });

  it('keeps the session in memory only when OS encryption is unavailable, and says so', async () => {
    const store = new CredentialStore({
      filePath,
      encryption: fakeEncryption({ available: false, backend: 'basic_text' }),
    });
    expect(await store.init()).toEqual({
      mode: 'memory_only',
      backend: 'basic_text',
      detail: 'No secret store.',
    });
    await store.set(session());
    expect(store.getToken()).toBe(TOKEN);
    expect(await exists()).toBe(false);
    expect(await store.restore(SERVER)).toEqual({ status: 'none' });
  });

  it('removes a stale blob when encryption is no longer available', async () => {
    await fs.writeFile(filePath, 'left over from an earlier run');
    const store = new CredentialStore({
      filePath,
      encryption: fakeEncryption({ available: false }),
    });
    await store.init();
    expect(await exists()).toBe(false);
  });

  it('falls back to memory, honestly, when the write to secure storage fails', async () => {
    const store = new CredentialStore({
      filePath,
      encryption: fakeEncryption({ failEncrypt: true }),
    });
    await store.init();
    await store.set(session());
    expect(store.getToken()).toBe(TOKEN);
    expect(await exists()).toBe(false);
    expect(store.getStorageInfo().mode).toBe('memory_only');
    expect(store.getStorageInfo().detail).toContain('memory');
  });

  it('survives an availability check that throws', async () => {
    const store = new CredentialStore({
      filePath,
      encryption: {
        ...fakeEncryption(),
        availability: () => Promise.reject(new Error('dbus down')),
      },
    });
    expect((await store.init()).mode).toBe('memory_only');
  });

  it.each([
    ['a blob that does not decrypt', Buffer.from('garbage-not-encrypted'), 'undecryptable'],
    ['an empty blob', Buffer.alloc(0), 'invalid'],
    ['an oversized blob', Buffer.alloc(200 * 1024, 1), 'invalid'],
  ])('discards %s and deletes it', async (_name, blob, reason) => {
    await fs.writeFile(filePath, blob);
    const store = new CredentialStore({ filePath, encryption: fakeEncryption() });
    await store.init();
    expect(await store.restore(SERVER)).toEqual({ status: 'discarded', reason });
    expect(store.getToken()).toBeNull();
    expect(await exists()).toBe(false);
  });

  it.each([
    ['not JSON', 'hello'],
    ['a different shape', JSON.stringify({ token: TOKEN })],
    ['extra fields', JSON.stringify({ ...session(), admin: true })],
    [
      'a non-origin server',
      JSON.stringify({ ...session(), serverOrigin: 'https://docs.example.com/path' }),
    ],
    [
      'an injected server',
      JSON.stringify({ ...session(), serverOrigin: 'https://docs.example.com;script-src-elem' }),
    ],
    ['a bad document id', JSON.stringify({ ...session(), documentId: '../etc/passwd' })],
    ['an unknown role', JSON.stringify({ ...session(), role: 'owner' })],
    ['a short token', JSON.stringify({ ...session(), token: 'abc' })],
  ])('discards decrypted content that is %s', async (_name, plain) => {
    const encryption = fakeEncryption();
    await fs.writeFile(filePath, await encryption.encrypt(plain));
    const store = new CredentialStore({ filePath, encryption });
    await store.init();
    expect(await store.restore(SERVER)).toEqual({ status: 'discarded', reason: 'invalid' });
    expect(await exists()).toBe(false);
  });

  it('never restores a session that belongs to another server', async () => {
    const first = new CredentialStore({ filePath, encryption: fakeEncryption() });
    await first.init();
    await first.set(session());
    for (const configured of [
      'https://other.example',
      'https://docs.example.com:8443',
      'http://docs.example.com',
      null,
    ]) {
      await first.set(session());
      const next = new CredentialStore({ filePath, encryption: fakeEncryption() });
      await next.init();
      expect(await next.restore(configured)).toEqual({
        status: 'discarded',
        reason: 'other_server',
      });
      expect(next.getToken()).toBeNull();
      expect(await exists()).toBe(false);
    }
  });

  it('discards an expired session', async () => {
    const first = new CredentialStore({ filePath, encryption: fakeEncryption() });
    await first.init();
    await first.set(session({ expiresAt: '2026-11-10T12:00:00.000Z' }));
    const late = new CredentialStore({
      filePath,
      encryption: fakeEncryption(),
      now: () => Date.parse('2026-11-10T12:00:01.000Z'),
    });
    await late.init();
    expect(await late.restore(SERVER)).toEqual({ status: 'discarded', reason: 'expired' });
    expect(await exists()).toBe(false);
  });

  it('forgets everything on clear', async () => {
    const store = new CredentialStore({ filePath, encryption: fakeEncryption() });
    await store.init();
    await store.set(session());
    await store.clear();
    expect(store.getSession()).toBeNull();
    expect(store.getToken()).toBeNull();
    expect(await exists()).toBe(false);
  });

  it('refuses to hold a malformed session', async () => {
    const store = new CredentialStore({ filePath, encryption: fakeEncryption() });
    await store.init();
    await expect(
      store.set({ ...session(), serverOrigin: 'javascript:alert(1)' }),
    ).rejects.toThrow();
    expect(store.getToken()).toBeNull();
  });
});
