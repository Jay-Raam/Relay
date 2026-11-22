import { describe, expect, it } from 'vitest';
import type { Reading } from '@relay/types';
import type { TelemetryRepo } from './repo';
import type { HistoryQuery } from './validate';
import { buildYoga } from './server';

const READING: Reading = {
  deviceId: 'dev-001',
  metric: 'temperature',
  value: 24.5,
  ts: '2026-01-01T12:00:00.000Z',
};

interface Calls {
  history: HistoryQuery[];
}

function fakeRepo(overrides: Partial<TelemetryRepo> = {}): { repo: TelemetryRepo; calls: Calls } {
  const calls: Calls = { history: [] };
  const repo: TelemetryRepo = {
    latest: async () => READING,
    history: async (q) => {
      calls.history.push(q);
      return [READING];
    },
    close: async () => {},
    ...overrides,
  };
  return { repo, calls };
}

interface GqlResponse {
  data?: Record<string, unknown> | null;
  errors?: { message: string; extensions?: { code?: string } }[];
}

async function gql(repo: TelemetryRepo, query: string): Promise<GqlResponse> {
  const yoga = buildYoga(repo, 'http://localhost:3000');
  const res = await yoga.fetch('http://localhost/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  return (await res.json()) as GqlResponse;
}

describe('latest', () => {
  it('returns the newest reading', async () => {
    const { repo } = fakeRepo();
    const res = await gql(
      repo,
      '{ latest(deviceId: "dev-001", metric: "temperature") { deviceId metric value ts } }',
    );
    expect(res.errors).toBeUndefined();
    expect(res.data?.latest).toEqual(READING);
  });

  it('returns null when there is no data yet', async () => {
    const { repo } = fakeRepo({ latest: async () => null });
    const res = await gql(repo, '{ latest(deviceId: "x", metric: "temperature") { value } }');
    expect(res.errors).toBeUndefined();
    expect(res.data?.latest).toBeNull();
  });

  it('gives a clean BAD_USER_INPUT error for an unknown metric', async () => {
    const { repo } = fakeRepo();
    const res = await gql(repo, '{ latest(deviceId: "x", metric: "pressure") { value } }');
    expect(res.errors?.[0]?.message).toBe('unknown metric: pressure');
    expect(res.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
  });
});

describe('history', () => {
  it('returns readings and passes a normalised query to the repo', async () => {
    const { repo, calls } = fakeRepo();
    const res = await gql(
      repo,
      '{ history(deviceId: "dev-001", metric: "temperature", limit: 5000) { value ts } }',
    );
    expect(res.errors).toBeUndefined();
    expect(res.data?.history).toEqual([{ value: READING.value, ts: READING.ts }]);
    expect(calls.history[0]?.limit).toBe(1000);
    expect(calls.history[0]?.metric).toBe('temperature');
  });

  it('rejects from after to without touching the database', async () => {
    const { repo, calls } = fakeRepo();
    const res = await gql(
      repo,
      '{ history(deviceId: "d", metric: "temperature", from: "2026-02-01T00:00:00Z", to: "2026-01-01T00:00:00Z") { ts } }',
    );
    expect(res.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
    expect(calls.history).toHaveLength(0);
  });
});

describe('health', () => {
  it('serves GET /health', async () => {
    const { repo } = fakeRepo();
    const res = await buildYoga(repo, 'http://localhost:3000').fetch('http://localhost/health');
    expect(res.status).toBe(200);
  });
});
