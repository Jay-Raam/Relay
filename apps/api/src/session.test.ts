import { describe, expect, it } from 'vitest';
import {
  clearedCookie,
  COOKIE_NAME,
  createSessionToken,
  readCookie,
  sessionCookie,
  verifySessionToken,
} from './session';

const SECRET = 'a-test-secret-that-is-long-enough-0123456789';
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

describe('session tokens', () => {
  it('round-trips the user id', () => {
    const token = createSessionToken('user-1', SECRET, 3600, NOW);
    expect(verifySessionToken(token, SECRET, NOW + 1000)).toBe('user-1');
  });

  it('expires', () => {
    const token = createSessionToken('user-1', SECRET, 3600, NOW);
    expect(verifySessionToken(token, SECRET, NOW + 3599_000)).toBe('user-1');
    expect(verifySessionToken(token, SECRET, NOW + 3600_000)).toBeNull();
  });

  it('rejects a token signed with another secret', () => {
    const token = createSessionToken('user-1', 'another-secret-another-secret-another!', 3600, NOW);
    expect(verifySessionToken(token, SECRET, NOW)).toBeNull();
  });

  it('rejects a tampered payload (cannot swap in another user id)', () => {
    const token = createSessionToken('user-1', SECRET, 3600, NOW);
    const [v, , sig] = token.split('.') as [string, string, string];
    const forged = Buffer.from(
      JSON.stringify({ uid: 'admin', exp: Math.floor(NOW / 1000) + 99999 }),
    ).toString('base64url');
    expect(verifySessionToken(`${v}.${forged}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it('rejects junk without throwing', () => {
    for (const junk of ['', 'abc', 'v1.x.y', 'v2.a.b', 'v1..', '....', 'v1.e30.AAAA']) {
      expect(verifySessionToken(junk, SECRET, NOW)).toBeNull();
    }
  });
});

describe('cookies', () => {
  it('sets HttpOnly, Path, SameSite and Max-Age; Secure only when asked', () => {
    const plain = sessionCookie('tok', 60, { secure: false, sameSite: 'lax' });
    expect(plain).toBe(`${COOKIE_NAME}=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=60`);
    const secure = sessionCookie('tok', 60, { secure: true, sameSite: 'none' });
    expect(secure).toContain('SameSite=None');
    expect(secure).toContain('Secure');
  });

  it('clears the cookie with Max-Age=0', () => {
    expect(clearedCookie({ secure: false, sameSite: 'lax' })).toContain('Max-Age=0');
  });

  it('reads one cookie out of a header', () => {
    expect(readCookie(`a=1; ${COOKIE_NAME}=tok; b=2`, COOKIE_NAME)).toBe('tok');
    expect(readCookie('a=1', COOKIE_NAME)).toBeNull();
    expect(readCookie(null, COOKIE_NAME)).toBeNull();
    expect(readCookie('relay_session_other=x', COOKIE_NAME)).toBeNull();
  });
});
