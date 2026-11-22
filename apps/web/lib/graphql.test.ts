import { describe, expect, it } from 'vitest';
import { fetchTelemetry, TelemetryError } from './graphql';

const PARAMS = { deviceId: 'dev-001', metric: 'temperature' } as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('fetchTelemetry', () => {
  it('returns latest and history from a good response', async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        data: {
          latest: { value: 22.5, ts: '2026-01-01T12:00:00.000Z' },
          history: [{ value: 22.4, ts: '2026-01-01T11:59:58.000Z' }],
        },
      })) as typeof fetch;

    const snap = await fetchTelemetry('http://api/graphql', PARAMS, { fetchImpl });
    expect(snap.latest?.value).toBe(22.5);
    expect(snap.history).toHaveLength(1);
  });

  it('sends the variables and defaults the limit to 60', async () => {
    let sent: { variables?: Record<string, unknown> } = {};
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)) as typeof sent;
      return jsonResponse({ data: { latest: null, history: [] } });
    }) as typeof fetch;

    await fetchTelemetry('http://api/graphql', PARAMS, { fetchImpl });
    expect(sent.variables).toEqual({ deviceId: 'dev-001', metric: 'temperature', limit: 60 });
  });

  it('returns null latest and empty history when there is no data yet', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ data: { latest: null, history: [] } })) as typeof fetch;
    const snap = await fetchTelemetry('http://api/graphql', PARAMS, { fetchImpl });
    expect(snap).toEqual({ latest: null, history: [] });
  });

  it('surfaces a GraphQL error message', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ errors: [{ message: 'unknown metric: pressure' }] })) as typeof fetch;
    await expect(fetchTelemetry('http://api/graphql', PARAMS, { fetchImpl })).rejects.toThrow(
      'unknown metric: pressure',
    );
  });

  it('turns a network failure into a friendly TelemetryError', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    await expect(fetchTelemetry('http://api/graphql', PARAMS, { fetchImpl })).rejects.toThrow(
      TelemetryError,
    );
  });

  it('reports a non-200 status', async () => {
    const fetchImpl = (async () => jsonResponse({}, 500)) as typeof fetch;
    await expect(fetchTelemetry('http://api/graphql', PARAMS, { fetchImpl })).rejects.toThrow(
      'API responded with 500',
    );
  });
});
