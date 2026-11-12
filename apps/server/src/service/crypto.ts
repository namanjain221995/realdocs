/**
 * Encryption at rest for the few values that must be read back: webhook
 * signing secrets and stored idempotent responses. AES-256-GCM with a key
 * derived (HKDF-SHA256) from SESSION_SECRET, one derived key per purpose, so a
 * value encrypted for one purpose cannot be decrypted as another.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

export type SecretPurpose = 'webhook-secret' | 'idempotent-response';

const keyCache = new Map<string, Buffer>();

function keyFor(secret: string, purpose: SecretPurpose): Buffer {
  const cacheKey = `${purpose}:${secret}`;
  let key = keyCache.get(cacheKey);
  if (!key) {
    key = Buffer.from(
      hkdfSync(
        'sha256',
        Buffer.from(secret, 'utf8'),
        Buffer.alloc(0),
        `realtimedocs/${purpose}/v1`,
        32,
      ),
    );
    keyCache.set(cacheKey, key);
  }
  return key;
}

/** `v1:<iv>.<tag>.<ciphertext>` (base64url). The purpose is bound as additional authenticated data. */
export function encryptSecret(secret: string, purpose: SecretPurpose, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret, purpose), iv);
  cipher.setAAD(Buffer.from(purpose));
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}.${tag.toString('base64url')}.${data.toString('base64url')}`;
}

export function decryptSecret(secret: string, purpose: SecretPurpose, encoded: string): string {
  const match = /^v1:([\w-]+)\.([\w-]+)\.([\w-]*)$/.exec(encoded);
  if (!match) throw new Error('unsupported ciphertext format');
  const [, iv, tag, data] = match as unknown as [string, string, string, string];
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyFor(secret, purpose),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
