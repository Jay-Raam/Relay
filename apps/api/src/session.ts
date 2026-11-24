import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stateless signed session token:  v1.<payload b64url>.<hmac-sha256 b64url>
 * The payload is only {uid, exp}. The account itself (role, existence) is looked up on every
 * request, so disabling an account or changing its role takes effect immediately, and nothing
 * sensitive sits inside the cookie.
 */
export const COOKIE_NAME = 'relay_session';

interface Payload {
  /** User id. */
  uid: string;
  /** Expiry, epoch seconds. */
  exp: number;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function sign(data: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}

export function createSessionToken(
  userId: string,
  secret: string,
  ttlSeconds: number,
  nowMs: number = Date.now(),
): string {
  const payload: Payload = { uid: userId, exp: Math.floor(nowMs / 1000) + ttlSeconds };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const data = `v1.${body}`;
  return `${data}.${b64url(sign(data, secret))}`;
}

/** The user id inside a valid, unexpired token, or null for anything else. */
export function verifySessionToken(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): string | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const [version, body, sig] = parts as [string, string, string];

  const expected = sign(`${version}.${body}`, secret);
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const { uid, exp } = (payload ?? {}) as Partial<Payload>;
  if (typeof uid !== 'string' || uid === '' || typeof exp !== 'number') return null;
  if (exp * 1000 <= nowMs) return null;
  return uid;
}

export interface CookieOptions {
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
}

/** Set-Cookie value for a session. HttpOnly keeps the token out of reach of page scripts. */
export function sessionCookie(token: string, ttlSeconds: number, opts: CookieOptions): string {
  return cookieString(token, ttlSeconds, opts);
}

/** Set-Cookie value that removes the session cookie. */
export function clearedCookie(opts: CookieOptions): string {
  return cookieString('', 0, opts);
}

function cookieString(value: string, maxAgeSeconds: number, opts: CookieOptions): string {
  const sameSite = opts.sameSite[0]?.toUpperCase() + opts.sameSite.slice(1);
  const parts = [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite}`,
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

/** Read one cookie from a Cookie request header. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}
