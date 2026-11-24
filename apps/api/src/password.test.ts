import { describe, expect, it } from 'vitest';
import { dummyHash, hashPassword, passwordProblem, verifyPassword } from './password';

describe('hashPassword / verifyPassword', () => {
  it('accepts the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('correct horse batterz', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('never stores the password and salts each hash', async () => {
    const a = await hashPassword('same password here');
    const b = await hashPassword('same password here');
    expect(a).not.toContain('same password here');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$')).toBe(true);
  });

  it('treats a malformed or tampered stored hash as no match', async () => {
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', 'plaintext')).toBe(false);
    expect(await verifyPassword('x', 'bcrypt$1$2$3$4$5')).toBe(false);
    // Absurd cost parameters are refused instead of allocating gigabytes.
    expect(await verifyPassword('x', 'scrypt$1073741824$8$1$c2FsdA==$aGFzaA==')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$abc$8$1$c2FsdA==$aGFzaA==')).toBe(false);
  });

  it('keeps verifying hashes made with other parameters (they are stored with the hash)', async () => {
    const { scryptSync } = await import('node:crypto');
    const salt = Buffer.from('0123456789abcdef');
    const key = scryptSync('older password', salt, 32, { N: 1024, r: 8, p: 1 });
    const stored = `scrypt$1024$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
    expect(await verifyPassword('older password', stored)).toBe(true);
    expect(await verifyPassword('other password', stored)).toBe(false);
  });
});

describe('dummyHash', () => {
  it('is a real hash that no password matches, and is made once', async () => {
    const a = await dummyHash();
    expect(await dummyHash()).toBe(a);
    expect(await verifyPassword('anything', a)).toBe(false);
  });
});

describe('passwordProblem', () => {
  it('requires a sensible length', () => {
    expect(passwordProblem('short')).toMatch(/at least 10/);
    expect(passwordProblem('x'.repeat(201))).toMatch(/at most 200/);
    expect(passwordProblem('long enough password')).toBeNull();
  });
});
