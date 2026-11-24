import type { SessionUser } from '@relay/types';
import { isRole } from '@relay/types';
import { TelemetryError, type FetchOptions } from './graphql';

/** The auth endpoints live next to /graphql: http://host:4000/graphql -> http://host:4000/auth */
export function authBase(apiUrl: string): string {
  return apiUrl.replace(/\/graphql\/?$/, '') + '/auth';
}

/** Wrong email or password, too many attempts, or anything else the sign-in form should show. */
export class LoginError extends TelemetryError {}

function parseUser(value: unknown): SessionUser | null {
  const u = (value as { user?: Record<string, unknown> } | null)?.user;
  if (!u) return null;
  const { id, email, role } = u;
  if (typeof id !== 'string' || typeof email !== 'string') return null;
  if (typeof role !== 'string' || !isRole(role)) return null;
  return { id, email, role };
}

async function request(url: string, init: RequestInit, options: FetchOptions): Promise<Response> {
  const doFetch = options.fetchImpl ?? fetch;
  try {
    return await doFetch(url, {
      ...init,
      signal: options.signal,
      cache: 'no-store',
      credentials: 'include',
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new TelemetryError('Cannot reach the API');
  }
}

/** The signed-in account, or null when there is no valid session. Throws only if the API is down. */
export async function fetchSession(
  apiUrl: string,
  options: FetchOptions = {},
): Promise<SessionUser | null> {
  const res = await request(`${authBase(apiUrl)}/me`, { method: 'GET' }, options);
  if (res.status === 401) return null;
  if (!res.ok) throw new TelemetryError(`API responded with ${res.status}`);
  return parseUser(await res.json().catch(() => null));
}

/** Sign in. Resolves to the account; throws LoginError with a message safe to show. */
export async function login(
  apiUrl: string,
  email: string,
  password: string,
  options: FetchOptions = {},
): Promise<SessionUser> {
  const res = await request(
    `${authBase(apiUrl)}/login`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    },
    options,
  );
  const body: unknown = await res.json().catch(() => null);
  if (res.ok) {
    const user = parseUser(body);
    if (user) return user;
    throw new LoginError('API returned an invalid response');
  }
  if (res.status === 429) {
    const wait = Number(res.headers.get('retry-after'));
    const minutes = Number.isFinite(wait) && wait > 0 ? Math.ceil(wait / 60) : null;
    throw new LoginError(
      minutes
        ? `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
        : 'Too many failed attempts. Try again later.',
    );
  }
  const message = (body as { errors?: { message?: string }[] } | null)?.errors?.[0]?.message;
  throw new LoginError(
    res.status === 401 || res.status === 400
      ? (message ?? 'Invalid email or password')
      : `API responded with ${res.status}`,
  );
}

/** End the session. Best effort: the UI signs out even if the API can't be reached. */
export async function logout(apiUrl: string, options: FetchOptions = {}): Promise<void> {
  try {
    await request(`${authBase(apiUrl)}/logout`, { method: 'POST' }, options);
  } catch {
    // The cookie simply expires on its own.
  }
}
