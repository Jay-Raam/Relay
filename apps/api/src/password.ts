import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password hashing with scrypt from node:crypto: memory-hard, and nothing to compile (no native
 * addon to break on Windows). The stored form carries its own parameters, so they can be raised
 * later while old hashes keep verifying:  scrypt$N$r$p$<salt b64>$<hash b64>
 */
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;

function derive(
  password: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
  keyLen: number,
): Promise<Buffer> {
  // scrypt needs ~128 * N * r bytes; Node's default cap is exactly 32 MiB, so give headroom.
  const options: ScryptOptions = { N: n, r, p, maxmem: 128 * n * r * 2 };
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLen, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await derive(password, salt, N, R, P, KEY_LEN);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** True only for the right password. A malformed stored hash is simply "no match". */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (![n, r, p].every((v) => Number.isInteger(v) && v > 0)) return false;
  // Refuse absurd parameters from a tampered row rather than allocating gigabytes.
  if (n > 2 ** 20 || r > 32 || p > 16) return false;

  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  if (expected.length === 0 || salt.length === 0) return false;
  try {
    const actual = await derive(password, salt, n, r, p, expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | undefined;

/**
 * A valid hash nobody knows the password to. Verifying against it when the email is unknown
 * makes "no such user" cost the same time as "wrong password", so response time doesn't reveal
 * which emails have accounts.
 */
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(24).toString('base64'));
  return dummy;
}

/** Why a new password is not acceptable, or null if it is fine. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters`;
  }
  return null;
}
