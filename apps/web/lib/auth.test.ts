import { describe, expect, it } from 'vitest';
import { authBase, fetchSession, login, LoginError, logout } from './auth';

const API = 'http://localhost:4000/graphql';
const USER = { id: 'u1', email: 'op@example.com', role: 'operator' };

function reply(status: number, body: unknown, headers: Record<string, string> = {}): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    })) as unknown as typeof fetch;
}

describe('authBase', () => {
  it('maps the GraphQL URL to the auth URL', () => {
    expect(authBase('http://localhost:4000/graphql')).toBe('http://localhost:4000/auth');
    expect(authBase('https://api.example.com/graphql/')).toBe('https://api.example.com/auth');
  });
});

describe('fetchSession', () => {
  it('returns the account for a valid session', async () => {
    expect(await fetchSession(API, { fetchImpl: reply(200, { user: USER }) })).toEqual(USER);
  });

  it('returns null when signed out', async () => {
    expect(await fetchSession(API, { fetchImpl: reply(401, { errors: [] }) })).toBeNull();
  });

  it('ignores an account with an unknown role', async () => {
    const bad = { user: { ...USER, role: 'root' } };
    expect(await fetchSession(API, { fetchImpl: reply(200, bad) })).toBeNull();
  });

  it('throws a readable error when the API is unreachable or broken', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(fetchSession(API, { fetchImpl: down })).rejects.toThrow('Cannot reach the API');
    await expect(fetchSession(API, { fetchImpl: reply(500, {}) })).rejects.toThrow('500');
  });

  it('sends the cookie (credentials: include) to /auth/me', async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const spy = (async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ user: USER }), { status: 200 });
    }) as unknown as typeof fetch;
    await fetchSession(API, { fetchImpl: spy });
    expect(seen?.url).toBe('http://localhost:4000/auth/me');
    expect(seen?.init?.credentials).toBe('include');
  });
});

describe('login', () => {
  it('posts the credentials and returns the account', async () => {
    let body = '';
    const spy = (async (_url: string, init?: RequestInit) => {
      body = String(init?.body);
      return new Response(JSON.stringify({ user: USER }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await login(API, 'op@example.com', 'pw', { fetchImpl: spy })).toEqual(USER);
    expect(JSON.parse(body)).toEqual({ email: 'op@example.com', password: 'pw' });
  });

  it('shows the API message for wrong credentials', async () => {
    const f = reply(401, { errors: [{ message: 'Invalid email or password' }] });
    await expect(login(API, 'a@b.c', 'x', { fetchImpl: f })).rejects.toThrow(LoginError);
    await expect(login(API, 'a@b.c', 'x', { fetchImpl: f })).rejects.toThrow(
      'Invalid email or password',
    );
  });

  it('turns a 429 into a wait time in minutes', async () => {
    const f = reply(429, { errors: [{ message: 'x' }] }, { 'retry-after': '600' });
    await expect(login(API, 'a@b.c', 'x', { fetchImpl: f })).rejects.toThrow('10 minutes');
    const one = reply(429, {}, { 'retry-after': '30' });
    await expect(login(API, 'a@b.c', 'x', { fetchImpl: one })).rejects.toThrow('1 minute.');
  });

  it('does not accept a success response without a valid account', async () => {
    await expect(login(API, 'a@b.c', 'x', { fetchImpl: reply(200, {}) })).rejects.toThrow(
      LoginError,
    );
  });
});

describe('logout', () => {
  it('posts to /auth/logout and never throws', async () => {
    let url = '';
    const spy = (async (u: string) => {
      url = u;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await logout(API, { fetchImpl: spy });
    expect(url).toBe('http://localhost:4000/auth/logout');

    const down = (async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    await expect(logout(API, { fetchImpl: down })).resolves.toBeUndefined();
  });
});
