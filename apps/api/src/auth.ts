import { createGraphQLError, type Plugin } from 'graphql-yoga';
import { z } from 'zod';
import type { SessionUser } from '@relay/types';
import { dummyHash, verifyPassword, MAX_PASSWORD_LENGTH } from './password';
import { createFailureLimiter, type FailureLimiter } from './ratelimit';
import type { TelemetryRepo } from './repo';
import {
  clearedCookie,
  COOKIE_NAME,
  createSessionToken,
  readCookie,
  sessionCookie,
  verifySessionToken,
  type CookieOptions,
} from './session';

export interface SessionConfig {
  secret: string;
  ttlSeconds: number;
  cookie: CookieOptions;
}

export interface AuthDeps {
  repo: TelemetryRepo;
  session: SessionConfig;
  /** The one browser origin allowed to call the API with credentials. */
  webOrigin: string;
  /** Overridable in tests. Defaults: 5 failures per email and 20 per IP in 15 minutes. */
  limiters?: { byEmail: FailureLimiter; byIp: FailureLimiter };
}

export interface Auth {
  /** The account behind the request's session cookie, or null. */
  userFrom(request: Request): Promise<SessionUser | null>;
  /** Serves /auth/*, and blocks cross-origin state-changing requests to the API. */
  plugin: Plugin;
}

const WINDOW_MS = 15 * 60_000;
const MAX_BODY_BYTES = 10_000;

const loginBody = z.object({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

/** Same text whether the email exists or not, so the response doesn't reveal which do. */
const BAD_CREDENTIALS = 'Invalid email or password';

/** Error body in the shape the dashboard already parses for GraphQL errors. */
function errorBody(message: string, code: string) {
  return { errors: [{ message, extensions: { code } }] };
}

/** Thrown from resolvers when there is no valid session. Yoga turns `http.status` into the status. */
export function unauthenticated(): never {
  throw createGraphQLError('Sign in required', {
    extensions: { code: 'UNAUTHENTICATED', http: { status: 401 } },
  });
}

export function forbidden(message: string): never {
  throw createGraphQLError(message, {
    extensions: { code: 'FORBIDDEN', http: { status: 403 } },
  });
}

export function createAuth({ repo, session, webOrigin, limiters }: AuthDeps): Auth {
  const byEmail = limiters?.byEmail ?? createFailureLimiter({ max: 5, windowMs: WINDOW_MS });
  const byIp = limiters?.byIp ?? createFailureLimiter({ max: 20, windowMs: WINDOW_MS });

  async function userFrom(request: Request): Promise<SessionUser | null> {
    const token = readCookie(request.headers.get('cookie'), COOKIE_NAME);
    if (!token) return null;
    const userId = verifySessionToken(token, session.secret);
    return userId ? repo.userById(userId) : null;
  }

  const plugin: Plugin = {
    async onRequest({ request, url, endResponse, fetchAPI, serverContext }) {
      const path = url.pathname;
      const isAuth = path === '/auth' || path.startsWith('/auth/');
      const isApi = isAuth || path === '/graphql';
      if (!isApi) return;

      const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
        new fetchAPI.Response(JSON.stringify(body), {
          status,
          headers: {
            'content-type': 'application/json',
            'cache-control': 'no-store',
            'access-control-allow-origin': webOrigin,
            'access-control-allow-credentials': 'true',
            vary: 'Origin',
            ...extra,
          },
        });

      const method = request.method.toUpperCase();

      // CSRF defence in depth: a browser always sends Origin on a cross-site POST. SameSite
      // cookies already stop most of it; this also covers deployments using SameSite=None.
      // A request with no Origin (curl, server to server) carries no browser's cookies.
      if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
        const origin = request.headers.get('origin');
        if (origin !== null && origin !== webOrigin) {
          endResponse(json(403, errorBody('Origin not allowed', 'FORBIDDEN')));
          return;
        }
      }

      if (!isAuth) return; // /graphql continues to Yoga (its own CORS handling applies)

      if (method === 'OPTIONS') {
        endResponse(
          new fetchAPI.Response(null, {
            status: 204,
            headers: {
              'access-control-allow-origin': webOrigin,
              'access-control-allow-credentials': 'true',
              'access-control-allow-methods': 'GET, POST, OPTIONS',
              'access-control-allow-headers': 'content-type',
              'access-control-max-age': '600',
              vary: 'Origin',
            },
          }),
        );
        return;
      }

      if (path === '/auth/me' && method === 'GET') {
        const user = await userFrom(request);
        endResponse(
          user ? json(200, { user }) : json(401, errorBody('Sign in required', 'UNAUTHENTICATED')),
        );
        return;
      }

      if (path === '/auth/logout' && method === 'POST') {
        endResponse(json(200, { ok: true }, { 'set-cookie': clearedCookie(session.cookie) }));
        return;
      }

      if (path === '/auth/login' && method === 'POST') {
        const ip =
          (serverContext as { req?: { socket?: { remoteAddress?: string } } }).req?.socket
            ?.remoteAddress ?? 'unknown';
        endResponse(await login(request, ip, json));
        return;
      }

      endResponse(json(404, errorBody('Not found', 'NOT_FOUND')));
    },
  };

  async function login(
    request: Request,
    ip: string,
    json: (status: number, body: unknown, extra?: Record<string, string>) => Response,
  ): Promise<Response> {
    const text = await request.text();
    let parsed: z.SafeParseReturnType<unknown, z.infer<typeof loginBody>>;
    try {
      parsed =
        text.length > MAX_BODY_BYTES
          ? loginBody.safeParse(undefined)
          : loginBody.safeParse(JSON.parse(text));
    } catch {
      parsed = loginBody.safeParse(undefined);
    }
    if (!parsed.success) {
      return json(400, errorBody('Email and password are required', 'BAD_USER_INPUT'));
    }
    const email = parsed.data.email.toLowerCase();

    const wait = Math.max(byEmail.retryAfter(email), byIp.retryAfter(ip));
    if (wait > 0) {
      return json(
        429,
        errorBody('Too many failed sign-in attempts. Try again later.', 'RATE_LIMITED'),
        { 'retry-after': String(wait) },
      );
    }

    const user = await repo.userByEmail(email);
    // Always verify something, so an unknown email takes as long as a wrong password.
    const ok = await verifyPassword(
      parsed.data.password,
      user?.passwordHash ?? (await dummyHash()),
    );
    if (!user || !ok) {
      byEmail.fail(email);
      byIp.fail(ip);
      return json(401, errorBody(BAD_CREDENTIALS, 'UNAUTHENTICATED'));
    }

    byEmail.reset(email);
    // Not worth failing a correct sign-in over a bookkeeping write.
    await repo.recordLogin(user.id).catch(() => undefined);

    const token = createSessionToken(user.id, session.secret, session.ttlSeconds);
    return json(
      200,
      { user: { id: user.id, email: user.email, role: user.role } satisfies SessionUser },
      { 'set-cookie': sessionCookie(token, session.ttlSeconds, session.cookie) },
    );
  }

  return { userFrom, plugin };
}
