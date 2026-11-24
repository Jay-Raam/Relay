import { describe, expect, it } from 'vitest';
import type { Reading } from '@relay/types';
import { createReadingBus } from './bus';
import { buildYoga } from './server';
import type { TelemetryRepo } from './repo';
import type { CommandPublisher } from './commands';
import {
  COMMAND_ID,
  DEVICES,
  fakeCache,
  fakePublisher,
  fakeRepo,
  PUMP_ID,
  READING,
  type FakeCache,
} from './testing';

interface GqlResponse {
  data?: Record<string, unknown> | null;
  errors?: { message: string; extensions?: { code?: string } }[];
}

function app(repo: TelemetryRepo, cache: FakeCache = fakeCache(), commands?: CommandPublisher) {
  const bus = createReadingBus();
  const yoga = buildYoga({ repo, cache, bus, webOrigin: 'http://localhost:3000', commands });
  return { yoga, bus };
}

async function gql(
  repo: TelemetryRepo,
  query: string,
  cache?: FakeCache,
  commands?: CommandPublisher,
): Promise<GqlResponse> {
  const res = await app(repo, cache, commands).yoga.fetch('http://localhost/graphql', {
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
    const { repo } = fakeRepo({ latestMany: async () => [] });
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

describe('devices', () => {
  it('lists devices with their fields', async () => {
    const { repo } = fakeRepo();
    const res = await gql(repo, '{ devices { id name type location } }');
    expect(res.errors).toBeUndefined();
    const devices = res.data?.devices as { id: string; location: string | null }[];
    expect(devices.map((d) => d.id)).toEqual(['dev-001', 'dev-002', 'dev-003']);
    expect(devices[1]?.location).toBeNull();
  });

  it('serves every device latest from ONE batched database query (DataLoader)', async () => {
    const { repo, calls } = fakeRepo();
    const res = await gql(
      repo,
      '{ devices { id latest(metric: "temperature") { deviceId value } } }',
      fakeCache([]), // empty cache: everything must come from the DB
    );
    expect(res.errors).toBeUndefined();
    const devices = res.data?.devices as { id: string; latest: { deviceId: string } | null }[];
    expect(devices.map((d) => d.latest?.deviceId)).toEqual(['dev-001', 'dev-002', 'dev-003']);
    expect(calls.latestMany).toHaveLength(1); // 3 devices, 1 query — not 3
    expect(calls.latestMany[0]?.deviceIds).toEqual(['dev-001', 'dev-002', 'dev-003']);
  });

  it('answers from the cache and skips the database when Redis has every device', async () => {
    const { repo, calls } = fakeRepo();
    const cached: Reading[] = ['dev-001', 'dev-002', 'dev-003'].map((deviceId, i) => ({
      ...READING,
      deviceId,
      value: 100 + i,
    }));
    const cache = fakeCache(cached);
    const res = await gql(
      repo,
      '{ devices { id latest(metric: "temperature") { value } } }',
      cache,
    );
    const devices = res.data?.devices as { latest: { value: number } }[];
    expect(devices.map((d) => d.latest.value)).toEqual([100, 101, 102]);
    expect(cache.calls.getLatestMany).toHaveLength(1); // one MGET for all devices
    expect(calls.latestMany).toHaveLength(0); // database never touched
  });

  it('only asks the database for the devices the cache is missing', async () => {
    const { repo, calls } = fakeRepo();
    const cache = fakeCache([{ ...READING, deviceId: 'dev-002', value: 99 }]);
    const res = await gql(
      repo,
      '{ devices { id latest(metric: "temperature") { value } } }',
      cache,
    );
    expect(res.errors).toBeUndefined();
    expect(calls.latestMany).toHaveLength(1);
    expect(calls.latestMany[0]?.deviceIds).toEqual(['dev-001', 'dev-003']);
  });

  it('rejects an unknown metric on Device.latest', async () => {
    const { repo } = fakeRepo();
    const res = await gql(repo, '{ devices { latest(metric: "pressure") { value } } }');
    expect(res.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
  });
});

describe('Device.state', () => {
  it('returns the last reported state of an actuator and null for a sensor', async () => {
    const { repo } = fakeRepo({
      devices: async () => [
        ...DEVICES.slice(0, 1),
        {
          id: PUMP_ID,
          name: 'Pump',
          type: 'pump',
          location: null,
          state: { value: 'on', ts: '2026-01-01T12:00:00.000Z', commandId: COMMAND_ID },
        },
      ],
    });
    const res = await gql(repo, '{ devices { id state { value ts commandId } } }');
    expect(res.errors).toBeUndefined();
    const devices = res.data?.devices as { id: string; state: unknown }[];
    expect(devices[0]?.state).toBeNull();
    expect(devices[1]?.state).toEqual({
      value: 'on',
      ts: '2026-01-01T12:00:00.000Z',
      commandId: COMMAND_ID,
    });
  });
});

describe('sendCommand', () => {
  const MUTATION = (device: string, command: string) =>
    `mutation { sendCommand(deviceId: "${device}", command: "${command}") { id deviceId command status } }`;

  it('logs the command, publishes it with the same id, and reports it sent', async () => {
    const { repo, calls } = fakeRepo();
    const publisher = fakePublisher();
    const res = await gql(repo, MUTATION(PUMP_ID, 'on'), undefined, publisher);

    expect(res.errors).toBeUndefined();
    expect(res.data?.sendCommand).toEqual({
      id: COMMAND_ID,
      deviceId: PUMP_ID,
      command: 'on',
      status: 'sent',
    });
    expect(calls.commands).toEqual([{ deviceId: PUMP_ID, command: 'on' }]);
    expect(publisher.sent).toHaveLength(1);
    expect(publisher.sent[0]?.deviceId).toBe(PUMP_ID);
    // the id is what the device echoes back to confirm
    expect(publisher.sent[0]?.message).toMatchObject({ commandId: COMMAND_ID, command: 'on' });
    expect(Number.isNaN(Date.parse(publisher.sent[0]?.message.ts ?? ''))).toBe(false);
  });

  it('rejects an unknown command before touching the database or the broker', async () => {
    const { repo, calls } = fakeRepo();
    const publisher = fakePublisher();
    const res = await gql(repo, MUTATION(PUMP_ID, 'explode'), undefined, publisher);
    expect(res.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
    expect(res.errors?.[0]?.message).toBe('unknown command: explode');
    expect(calls.commands).toHaveLength(0);
    expect(publisher.sent).toHaveLength(0);
  });

  it('rejects a sensor or unknown device and sends nothing', async () => {
    const { repo } = fakeRepo();
    const publisher = fakePublisher();
    const res = await gql(repo, MUTATION('dev-001', 'on'), undefined, publisher);
    expect(res.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
    expect(res.errors?.[0]?.message).toContain('cannot be commanded');
    expect(publisher.sent).toHaveLength(0);
  });

  it('marks the command failed and reports SERVICE_UNAVAILABLE when the broker is down', async () => {
    const { repo, calls } = fakeRepo();
    const res = await gql(repo, MUTATION(PUMP_ID, 'on'), undefined, fakePublisher(true));
    expect(res.errors?.[0]?.extensions?.code).toBe('SERVICE_UNAVAILABLE');
    expect(res.errors?.[0]?.message).toContain('command was not sent');
    expect(calls.failed).toEqual([COMMAND_ID]);
  });

  it('still reports the broker problem if marking the command failed also fails', async () => {
    const { repo } = fakeRepo({
      markCommandFailed: async () => {
        throw new Error('db down');
      },
    });
    const res = await gql(repo, MUTATION(PUMP_ID, 'on'), undefined, fakePublisher(true));
    expect(res.errors?.[0]?.extensions?.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('says commands are not configured, and logs nothing, when there is no broker', async () => {
    const { repo, calls } = fakeRepo();
    const res = await gql(repo, MUTATION(PUMP_ID, 'on'));
    expect(res.errors?.[0]?.extensions?.code).toBe('SERVICE_UNAVAILABLE');
    expect(res.errors?.[0]?.message).toContain('not configured');
    expect(calls.commands).toHaveLength(0);
  });
});

describe('readingAdded subscription (SSE)', () => {
  async function readUntil(
    body: ReadableStream<Uint8Array>,
    predicate: (text: string) => boolean,
    ms = 3000,
  ): Promise<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const deadline = Date.now() + ms;
    try {
      while (Date.now() < deadline) {
        const chunk = await Promise.race([
          reader.read(),
          new Promise<{ done: true; value: undefined }>((resolve) =>
            setTimeout(() => resolve({ done: true, value: undefined }), deadline - Date.now()),
          ),
        ]);
        if (chunk.done) break;
        text += decoder.decode(chunk.value, { stream: true });
        if (predicate(text)) break;
      }
    } finally {
      await reader.cancel();
    }
    return text;
  }

  it('pushes new readings of the subscribed metric and ignores other metrics', async () => {
    const { repo } = fakeRepo();
    const { yoga, bus } = app(repo);
    const query = 'subscription { readingAdded(metric: "temperature") { deviceId metric value } }';
    const res = await yoga.fetch(`http://localhost/graphql?query=${encodeURIComponent(query)}`, {
      headers: { accept: 'text/event-stream' },
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.body).not.toBeNull();

    // Publish once the subscription is live: first an unrelated metric, then a match.
    setTimeout(() => {
      bus.publish('reading', { ...READING, metric: 'humidity', value: 55 });
      bus.publish('reading', { ...READING, deviceId: 'dev-002', value: 31.5 });
    }, 100);

    const text = await readUntil(res.body as ReadableStream<Uint8Array>, (t) => t.includes('31.5'));
    expect(text).toContain('"deviceId":"dev-002"');
    expect(text).toContain('31.5');
    expect(text).not.toContain('"value":55');
  });
});

describe('health', () => {
  it('serves GET /health', async () => {
    const { repo } = fakeRepo();
    const res = await app(repo).yoga.fetch('http://localhost/health');
    expect(res.status).toBe(200);
  });
});
