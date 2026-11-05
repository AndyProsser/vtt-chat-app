import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// scrypt from Node's own crypto: no native dependency to build on a blank Ubuntu install.
// N=2^15, r=8, p=1 is the usual interactive-login cost (~64 MB, tens of milliseconds).
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 } as const;
const KEY_LENGTH = 64;
const FORMAT = 'scrypt';

/** `scrypt$N$r$p$salt$hash` — self-describing, so the cost can be raised later without a migration. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LENGTH, SCRYPT);
  return [
    FORMAT,
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [format, n, r, p, saltB64, keyB64] = stored.split('$');
  if (format !== FORMAT || !n || !r || !p || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  try {
    const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: SCRYPT.maxmem,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** A high-entropy URL-safe secret: session tokens, magic links, invite codes. */
export function generateSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Secrets are stored only as hashes, so a leaked database doesn't leak live sign-ins. SHA-256 is
 * enough here (unlike passwords): the input is already 256 bits of randomness, so there is nothing
 * to brute-force.
 */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Short, speakable invite/one-time codes for the side channel: no look-alike characters. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateCode(length = 10): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const byte of bytes) out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return out;
}

export function normaliseCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}
