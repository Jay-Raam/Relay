import { beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from './auth';
import { createReadingBus } from './bus';
import { hashPassword } from './password';
import { createFailureLimiter } from './ratelimit';
import type { TelemetryRepo } from './repo';
import { buildYoga } from './server';
import {
  cookieFor,
  fakeCache,
  fakePublisher,
  fakeRepo,
  OPERATOR,
  PASSWORD,
  PUMP_ID,
  TEST_SESSION,
  VIEWER,
} from './testing';

const WEB = 'http://localhost:3000';

let passwordHash = '';
beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

/** A repo whose only sign-in account is OPERATOR, with the known test password. */
function repoWithAccounts(overrides: Partial<TelemetryRepo> = {}) {
  return fakeRepo({
    userByEmail: async (email) => (email === OPERATOR.email ? { ...OPERATOR, passwordHash } : null),
    ...overrides,
  });
}

function setup(repo: TelemetryRepo, limiters?: Parameters<typeof createAuth>[0]['limiters']) {
  const publisher = fakePublisher();
  const auth = createAuth({ repo, session: TEST_SESSION, webOrigin: WEB, limiters });
  const yoga = buildYoga({
    repo,
    cache: fakeCache(),
    bus: createReadingBus(),
    webOrigin: WEB,
    session: TEST_SESSION,
    commands: publisher,
    auth,
  });
  return { yoga, publisher };
}

type Yoga = ReturnType<typeof setup>['yoga'];

function post(yoga: Yoga, path: string, body: unknown, headers: Record<string, string> = {}) {
  return yoga.fetch(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const login = (yoga: Yoga, email: string, password: string, headers?: Record<string, string>) =>
  post(yoga, '/auth/login', { email, password }, headers);

/** The `name=value` part of a Set-Cookie header, ready to send back as Cookie. */
function cookieFrom(res: Response): string {
  const header = res.headers.get('set-cookie') ?? '';
  return header.split(';')[0] ?? '';
}

describe('POST /auth/login', () => {
  it('signs in with the right password and sets an HttpOnly session cookie', async () => {
    const { repo, calls } = repoWithAccounts();
    const { yoga } = setup(repo);
    const res = await login(yoga, OPERATOR.email, PASSWORD);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: OPERATOR });
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('relay_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(calls.logins).toEqual([OPERATOR.id]);
  });

  it('never returns the password hash', async () => {
    const { repo } = repoWithAccounts();
    const res = await login(setup(repo).yoga, OPERATOR.email, PASSWORD);
    const text = await res.text();
    expect(text).not.toContain('scrypt$');
    expect(text).not.toContain('passwordHash');
  });

  it('ignores case and surrounding spaces in the email', async () => {
    const { repo } = repoWithAccounts();
    const res = await login(setup(repo).yoga, `  ${OPERATOR.email.toUpperCase()} `, PASSWORD);
    expect(res.status).toBe(200);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const { repo } = repoWithAccounts();
    const { yoga } = setup(repo);
    const wrong = await login(yoga, OPERATOR.email, 'not the password');
    const unknown = await login(yoga, 'nobody@example.com', PASSWORD);

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect(wrong.headers.get('set-cookie')).toBeNull();
    expect(unknown.headers.get('set-cookie')).toBeNull();
  });

  it('rejects a malformed body with 400', async () => {
    const { repo } = repoWithAccounts();
    const { yoga } = setup(repo);
    for (const body of [
      'not json',
      '{}',
      '{"email":"a@b.c"}',
      '{"email":1,"password":2}',
      'null',
    ]) {
      const res = await post(yoga, '/auth/login', body);
      expect(res.status).toBe(400);
    }
    const huge = await post(
      yoga,
      '/auth/login',
      `{"email":"a@b.c","password":"${'x'.repeat(20_000)}"}`,
    );
    expect(huge.status).toBe(400);
  });
});

describe('login rate limiting', () => {
  it('blocks an email after 5 failures, even for the correct password', async () => {
    const { repo } = repoWithAccounts();
    const { yoga } = setup(repo);
    for (let i = 0; i < 5; i++) {
      expect((await login(yoga, OPERATOR.email, 'wrong password!')).status).toBe(401);
    }
    const blocked = await login(yoga, OPERATOR.email, PASSWORD);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(blocked.headers.get('set-cookie')).toBeNull();
    // Another account is unaffected.
    expect((await login(yoga, 'other@example.com', 'x')).status).toBe(401);
  });

  it('a successful sign-in clears the email counter', async () => {
    const { repo } = repoWithAccounts();
    const { yoga } = setup(repo);
    for (let i = 0; i < 4; i++) await login(yoga, OPERATOR.email, 'wrong password!');
    expect((await login(yoga, OPERATOR.email, PASSWORD)).status).toBe(200);
    for (let i = 0; i < 4; i++) {
      expect((await login(yoga, OPERATOR.email, 'wrong password!')).status).toBe(401);
    }
  });

  it('also limits by client address, so guessing across many emails is stopped', async () => {
    const { repo } = repoWithAccounts();
    const { yoga } = setup(repo, {
      byEmail: createFailureLimiter({ max: 5, windowMs: 60_000 }),
      byIp: createFailureLimiter({ max: 3, windowMs: 60_000 }),
    });
    for (let i = 0; i < 3; i++) {
      expect((await login(yoga, `user${i}@example.com`, 'x')).status).toBe(401);
    }
    expect((await login(yoga, 'user9@example.com', 'x')).status).toBe(429);
  });
});

describe('GET /auth/me and POST /auth/logout', () => {
  it('returns the account for a valid session', async () => {
    const { repo } = repoWithAccounts();
    const { yoga } = setup(repo);
    const signedIn = await login(yoga, OPERATOR.email, PASSWORD);
    const me = await yoga.fetch('http://localhost/auth/me', {
      headers: { cookie: cookieFrom(signedIn) },
    });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ user: OPERATOR });
  });

  it('is 401 without a cookie, with a forged cookie, or when the account is gone', async () => {
    const { repo } = repoWithAccounts();
    const { yoga } = setup(repo);
    const me = (cookie?: string) =>
      yoga.fetch('http://localhost/auth/me', { headers: cookie ? { cookie } : {} });

    expect((await me()).status).toBe(401);
    expect(
      (await me('relay_session=v1.eyJ1aWQiOiJ1LW9wZXJhdG9yIiwiZXhwIjo5OTk5OTk5OTk5fQ.AAAA')).status,
    ).toBe(401);
    expect((await me('relay_session=garbage')).status).toBe(401);

    const gone = setup(fakeRepo({ userById: async () => null }).repo).yoga;
    const res = await gone.fetch('http://localhost/auth/me', {
      headers: { cookie: cookieFor(OPERATOR) },
    });
    expect(res.status).toBe(401);
  });

  it('logout clears the cookie', async () => {
    const { repo } = repoWithAccounts();
    const res = await post(setup(repo).yoga, '/auth/logout', {});
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('answers 404 for unknown /auth paths', async () => {
    const { repo } = repoWithAccounts();
    const res = await setup(repo).yoga.fetch('http://localhost/auth/nope');
    expect(res.status).toBe(404);
  });
});

describe('the GraphQL API requires a session', () => {
  const DEVICES_QUERY = '{ devices { id } }';
  const COMMAND = (id = PUMP_ID) =>
    `mutation { sendCommand(deviceId: "${id}", command: "on") { id status } }`;

  function gql(yoga: Yoga, query: string, cookie?: string, headers: Record<string, string> = {}) {
    return post(yoga, '/graphql', { query }, { ...(cookie ? { cookie } : {}), ...headers });
  }

  it('rejects every operation without a cookie, with HTTP 401', async () => {
    const { repo } = fakeRepo();
    const { yoga } = setup(repo);
    for (const query of [
      DEVICES_QUERY,
      '{ latest(deviceId: "dev-001", metric: "temperature") { value } }',
      '{ history(deviceId: "dev-001", metric: "temperature") { value } }',
      COMMAND(),
    ]) {
      const res = await gql(yoga, query);
      expect(res.status).toBe(401);
      const body = (await res.json()) as {
        data?: unknown;
        errors: { extensions: { code: string } }[];
      };
      expect(body.errors[0]?.extensions.code).toBe('UNAUTHENTICATED');
    }
  });

  it('does not touch the database or the broker for an unauthenticated command', async () => {
    const { repo, calls } = fakeRepo();
    const { yoga, publisher } = setup(repo);
    await gql(yoga, COMMAND());
    expect(calls.commands).toEqual([]);
    expect(publisher.sent).toEqual([]);
  });

  it('rejects a garbage or forged cookie', async () => {
    const { repo } = fakeRepo();
    const { yoga } = setup(repo);
    expect((await gql(yoga, DEVICES_QUERY, 'relay_session=nonsense')).status).toBe(401);
  });

  it('lets a viewer read', async () => {
    const { repo } = fakeRepo();
    const res = await gql(setup(repo).yoga, DEVICES_QUERY, cookieFor(VIEWER));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { devices: unknown[] } };
    expect(body.data.devices.length).toBeGreaterThan(0);
  });

  it('refuses a viewer sending a command, with HTTP 403, and nothing is logged or sent', async () => {
    const { repo, calls } = fakeRepo();
    const { yoga, publisher } = setup(repo);
    const res = await gql(yoga, COMMAND(), cookieFor(VIEWER));
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      errors: { message: string; extensions: { code: string } }[];
    };
    expect(body.errors[0]?.extensions.code).toBe('FORBIDDEN');
    expect(body.errors[0]?.message).toMatch(/view-only/);
    expect(calls.commands).toEqual([]);
    expect(publisher.sent).toEqual([]);
  });

  it('lets an operator send a command and records who sent it', async () => {
    const { repo, calls } = fakeRepo();
    const { yoga, publisher } = setup(repo);
    const res = await gql(yoga, COMMAND(), cookieFor(OPERATOR));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { sendCommand: { status: string } } };
    expect(body.data.sendCommand.status).toBe('sent');
    expect(calls.commands).toEqual([{ deviceId: PUMP_ID, command: 'on', userId: OPERATOR.id }]);
    expect(publisher.sent).toHaveLength(1);
  });

  it('refuses a subscription without a session', async () => {
    const { repo } = fakeRepo();
    const { yoga } = setup(repo);
    const query = 'subscription { readingAdded(metric: "temperature") { value } }';
    const res = await yoga.fetch(`http://localhost/graphql?query=${encodeURIComponent(query)}`, {
      headers: { accept: 'text/event-stream' },
    });
    const text = await res.text();
    expect(text).toContain('UNAUTHENTICATED');
    expect(text).not.toContain('"value"');
  });

  it('keeps /health open for uptime checks', async () => {
    const { repo } = fakeRepo();
    const res = await setup(repo).yoga.fetch('http://localhost/health');
    expect(res.status).toBe(200);
  });
});

describe('cross-origin protection', () => {
  const EVIL = 'https://evil.example';

  it('rejects a state-changing request from another origin, even with a valid cookie', async () => {
    const { repo, calls } = fakeRepo();
    const { yoga, publisher } = setup(repo);
    const res = await post(
      yoga,
      '/graphql',
      { query: `mutation { sendCommand(deviceId: "${PUMP_ID}", command: "on") { id } }` },
      { cookie: cookieFor(OPERATOR), origin: EVIL },
    );
    expect(res.status).toBe(403);
    expect(calls.commands).toEqual([]);
    expect(publisher.sent).toEqual([]);
  });

  it('rejects a login from another origin', async () => {
    const { repo } = repoWithAccounts();
    const res = await login(setup(repo).yoga, OPERATOR.email, PASSWORD, { origin: EVIL });
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('allows the configured web origin, and requests with no Origin header', async () => {
    const { repo } = repoWithAccounts();
    const { yoga } = setup(repo);
    expect((await login(yoga, OPERATOR.email, PASSWORD, { origin: WEB })).status).toBe(200);
    expect((await login(yoga, OPERATOR.email, PASSWORD)).status).toBe(200);
  });

  it('answers the login preflight, allowing credentials from the web origin only', async () => {
    const { repo } = repoWithAccounts();
    const res = await setup(repo).yoga.fetch('http://localhost/auth/login', {
      method: 'OPTIONS',
      headers: {
        origin: WEB,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(WEB);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('allows credentials on GraphQL responses to the web origin', async () => {
    const { repo } = fakeRepo();
    const res = await setup(repo).yoga.fetch('http://localhost/graphql', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: WEB,
        cookie: cookieFor(VIEWER),
      },
      body: JSON.stringify({ query: '{ devices { id } }' }),
    });
    expect(res.headers.get('access-control-allow-origin')).toBe(WEB);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });
});
