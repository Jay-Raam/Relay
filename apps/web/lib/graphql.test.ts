import { describe, expect, it } from 'vitest';
import { AuthRequiredError, fetchOverview, sendCommand, TelemetryError } from './graphql';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const DEVICE = { id: 'dev-001', name: 'Sensor', type: 'sensor', location: 'Plant A' };

describe('fetchOverview', () => {
  it('returns devices with their latest reading plus history', async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        data: {
          devices: [
            { ...DEVICE, latest: { value: 22.5, ts: '2026-01-01T12:00:00.000Z' } },
            { ...DEVICE, id: 'dev-002', latest: null },
          ],
          history: [{ value: 22.4, ts: '2026-01-01T11:59:58.000Z' }],
        },
      })) as typeof fetch;

    const o = await fetchOverview(
      'http://api/graphql',
      { metric: 'temperature', deviceId: 'dev-001' },
      { fetchImpl },
    );
    expect(o.devices).toHaveLength(2);
    expect(o.devices[0]?.latest?.value).toBe(22.5);
    expect(o.devices[1]?.latest).toBeNull();
    expect(o.history).toHaveLength(1);
  });

  it('asks for history only when a device is selected, and defaults the limit to 60', async () => {
    const sent: { variables: Record<string, unknown> }[] = [];
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)) as (typeof sent)[number]);
      return jsonResponse({ data: { devices: [], history: null } });
    }) as typeof fetch;

    await fetchOverview(
      'http://api/graphql',
      { metric: 'temperature', deviceId: null },
      { fetchImpl },
    );
    await fetchOverview(
      'http://api/graphql',
      { metric: 'temperature', deviceId: 'dev-001' },
      { fetchImpl },
    );
    expect(sent[0]?.variables).toMatchObject({ withHistory: false, limit: 60 });
    expect(sent[1]?.variables).toMatchObject({
      withHistory: true,
      deviceId: 'dev-001',
      metric: 'temperature',
    });
  });

  it('treats a missing history as empty (device not selected)', async () => {
    const fetchImpl = (async () => jsonResponse({ data: { devices: [] } })) as typeof fetch;
    const o = await fetchOverview(
      'http://api/graphql',
      { metric: 'temperature', deviceId: null },
      { fetchImpl },
    );
    expect(o).toEqual({ devices: [], history: [] });
  });

  it('throws a TelemetryError with the GraphQL message', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ errors: [{ message: 'unknown metric: pressure' }] })) as typeof fetch;
    await expect(
      fetchOverview('http://api/graphql', { metric: 'temperature', deviceId: null }, { fetchImpl }),
    ).rejects.toThrow('unknown metric: pressure');
  });

  it('throws a friendly error when the API is unreachable', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    await expect(
      fetchOverview('http://api/graphql', { metric: 'temperature', deviceId: null }, { fetchImpl }),
    ).rejects.toThrow(new TelemetryError('Cannot reach the API'));
  });

  it('throws on a non-2xx status and on a non-JSON body', async () => {
    const bad = (async () => new Response('nope', { status: 502 })) as typeof fetch;
    await expect(
      fetchOverview(
        'http://api/graphql',
        { metric: 'temperature', deviceId: null },
        { fetchImpl: bad },
      ),
    ).rejects.toThrow('API responded with 502');

    const notJson = (async () => new Response('<html>', { status: 200 })) as typeof fetch;
    await expect(
      fetchOverview(
        'http://api/graphql',
        { metric: 'temperature', deviceId: null },
        { fetchImpl: notJson },
      ),
    ).rejects.toThrow('invalid response');
  });

  it('rethrows aborts untouched so callers can ignore them', async () => {
    const fetchImpl = (async () => {
      throw new DOMException('aborted', 'AbortError');
    }) as typeof fetch;
    await expect(
      fetchOverview('http://api/graphql', { metric: 'temperature', deviceId: null }, { fetchImpl }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('fetchOverview actuator state', () => {
  it('returns an actuator state and null for a device without one', async () => {
    const state = { value: 'on', ts: '2026-01-01T12:00:00.000Z', commandId: 'c-1' };
    const fetchImpl = (async () =>
      jsonResponse({
        data: {
          devices: [
            { ...DEVICE, id: 'dev-004', type: 'pump', latest: null, state },
            { ...DEVICE, latest: null },
          ],
        },
      })) as typeof fetch;
    const o = await fetchOverview(
      'http://api/graphql',
      { metric: 'temperature', deviceId: null },
      { fetchImpl },
    );
    expect(o.devices[0]?.state).toEqual(state);
    expect(o.devices[1]?.state).toBeNull();
  });
});

describe('sendCommand', () => {
  const SENT = { id: 'c-1', deviceId: 'dev-004', command: 'on', status: 'sent' };

  it('sends the mutation with the device and command, and returns the result', async () => {
    let sent: { query: string; variables: Record<string, unknown> } | undefined;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)) as typeof sent;
      return jsonResponse({ data: { sendCommand: SENT } });
    }) as typeof fetch;

    const result = await sendCommand('http://api/graphql', 'dev-004', 'on', { fetchImpl });
    expect(result).toEqual(SENT);
    expect(sent?.query).toContain('sendCommand');
    expect(sent?.variables).toEqual({ deviceId: 'dev-004', command: 'on' });
  });

  it('surfaces the API error message (e.g. broker unreachable)', async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        errors: [{ message: 'Could not reach the device broker; the command was not sent' }],
      })) as typeof fetch;
    await expect(sendCommand('http://api/graphql', 'dev-004', 'on', { fetchImpl })).rejects.toThrow(
      'command was not sent',
    );
  });

  it('throws a friendly error when the API is unreachable', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    await expect(
      sendCommand('http://api/graphql', 'dev-004', 'off', { fetchImpl }),
    ).rejects.toThrow('Cannot reach the API');
  });
});

describe('authentication', () => {
  const params = { metric: 'temperature', deviceId: null } as const;

  it('sends the session cookie with every request', async () => {
    let init: RequestInit | undefined;
    const fetchImpl = (async (_url: unknown, i?: RequestInit) => {
      init = i;
      return jsonResponse({ data: { devices: [] } });
    }) as typeof fetch;
    await fetchOverview('http://api/graphql', params, { fetchImpl });
    expect(init?.credentials).toBe('include');
  });

  it('throws AuthRequiredError on HTTP 401', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ errors: [{ message: 'Sign in required' }] }, 401)) as typeof fetch;
    await expect(fetchOverview('http://api/graphql', params, { fetchImpl })).rejects.toThrow(
      AuthRequiredError,
    );
  });

  it('throws AuthRequiredError on an UNAUTHENTICATED GraphQL error', async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        data: null,
        errors: [{ message: 'Sign in required', extensions: { code: 'UNAUTHENTICATED' } }],
      })) as typeof fetch;
    await expect(sendCommand('http://api/graphql', 'dev-004', 'on', { fetchImpl })).rejects.toThrow(
      AuthRequiredError,
    );
  });

  it('shows the API message when a viewer is refused (FORBIDDEN is not a sign-out)', async () => {
    const fetchImpl = (async () =>
      jsonResponse(
        {
          data: null,
          errors: [
            {
              message: 'Your account is view-only and cannot send commands',
              extensions: { code: 'FORBIDDEN' },
            },
          ],
        },
        403,
      )) as typeof fetch;
    const err = await sendCommand('http://api/graphql', 'dev-004', 'on', { fetchImpl }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(TelemetryError);
    expect(err).not.toBeInstanceOf(AuthRequiredError);
    expect((err as Error).message).toBe('Your account is view-only and cannot send commands');
  });
});
