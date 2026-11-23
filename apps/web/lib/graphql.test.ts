import { describe, expect, it } from 'vitest';
import { fetchOverview, TelemetryError } from './graphql';

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
