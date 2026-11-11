/**
 * Password hashing with Argon2id through Node's built-in `crypto.argon2`
 * (no native add-on). Hashes are stored in the PHC string format so the
 * parameters travel with the hash and can be raised later.
 */
import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { errors } from '../errors';

export interface Argon2Params {
  /** Memory in KiB. */
  memory: number;
  passes: number;
  parallelism: number;
}

/** OWASP-recommended class of parameters: 64 MiB, 3 passes, 1 lane. */
export const CURRENT_PARAMS: Argon2Params = { memory: 65_536, passes: 3, parallelism: 1 };

const SALT_BYTES = 16;
const TAG_BYTES = 32;
const ARGON2_VERSION = 19;

// Upper bounds for parameters read back from storage, so a tampered hash
// string cannot make a login allocate gigabytes or spin for minutes.
const MAX_MEMORY_KIB = 1_048_576;
const MAX_PASSES = 16;
const MAX_PARALLELISM = 8;

// Each hash needs `memory` KiB; bound how many run at once and how many wait.
const MAX_CONCURRENT = 4;
const MAX_WAITING = 64;
let running = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) {
    if (waiting.length >= MAX_WAITING) throw errors.serverBusy();
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    running += 1;
  }
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }
}

function derive(password: string, salt: Buffer, params: Argon2Params, tagLength: number) {
  return new Promise<Buffer>((resolve, reject) => {
    argon2(
      'argon2id',
      {
        message: Buffer.from(password.normalize('NFKC'), 'utf8'),
        nonce: salt,
        parallelism: params.parallelism,
        tagLength,
        memory: params.memory,
        passes: params.passes,
      },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

const b64 = (buffer: Buffer) => buffer.toString('base64').replace(/=+$/, '');

export function encodeHash(params: Argon2Params, salt: Buffer, tag: Buffer): string {
  return `$argon2id$v=${ARGON2_VERSION}$m=${params.memory},t=${params.passes},p=${params.parallelism}$${b64(salt)}$${b64(tag)}`;
}

export interface ParsedHash {
  params: Argon2Params;
  salt: Buffer;
  tag: Buffer;
}

export function parseHash(encoded: string): ParsedHash | null {
  const match =
    /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(
      encoded,
    );
  if (!match) return null;
  const [, version, memory, passes, parallelism, salt, tag] = match;
  if (Number(version) !== ARGON2_VERSION || !salt || !tag) return null;
  const params: Argon2Params = {
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
  };
  if (
    params.memory < 8 ||
    params.memory > MAX_MEMORY_KIB ||
    params.passes < 1 ||
    params.passes > MAX_PASSES ||
    params.parallelism < 1 ||
    params.parallelism > MAX_PARALLELISM
  ) {
    return null;
  }
  const saltBytes = Buffer.from(salt, 'base64');
  const tagBytes = Buffer.from(tag, 'base64');
  if (saltBytes.length < 8 || tagBytes.length < 16 || tagBytes.length > 64) return null;
  return { params, salt: saltBytes, tag: tagBytes };
}

export async function hashPassword(
  password: string,
  params: Argon2Params = CURRENT_PARAMS,
): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const tag = await withSlot(() => derive(password, salt, params, TAG_BYTES));
  return encodeHash(params, salt, tag);
}

/** Constant-time verification. Returns false for malformed stored hashes. */
export async function verifyPassword(encoded: string, password: string): Promise<boolean> {
  const parsed = parseHash(encoded);
  if (!parsed) {
    await dummyVerify(password);
    return false;
  }
  const tag = await withSlot(() => derive(password, parsed.salt, parsed.params, parsed.tag.length));
  return tag.length === parsed.tag.length && timingSafeEqual(tag, parsed.tag);
}

const DUMMY_SALT = randomBytes(SALT_BYTES);

/**
 * Spends the same work as a real verification. Called when the account does
 * not exist so response time does not reveal which emails are registered.
 */
export async function dummyVerify(password: string): Promise<void> {
  await withSlot(() => derive(password, DUMMY_SALT, CURRENT_PARAMS, TAG_BYTES));
}

/** True when the stored hash uses weaker parameters than the current ones. */
export function needsRehash(encoded: string): boolean {
  const parsed = parseHash(encoded);
  if (!parsed) return true;
  return (
    parsed.params.memory < CURRENT_PARAMS.memory ||
    parsed.params.passes < CURRENT_PARAMS.passes ||
    parsed.tag.length < TAG_BYTES
  );
}
