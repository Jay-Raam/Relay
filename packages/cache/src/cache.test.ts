import { afterEach, describe, expect, it } from 'vitest';
import type { Reading } from '@relay/types';
import { createCache, type Cache } from './cache';

const READING: Reading = {
  deviceId: 'dev-001',
  metric: 'temperature',
  value: 22.5,
  ts: '2026-01-01T12:00:00.000Z',
};

const open: Cache[] = [];
function track(cache: Cache): Cache {
  open.push(cache);
  return cache;
}
afterEach(async () => {
  await Promise.all(open.splice(0).map((c) => c.close()));
});

describe('createCache without Redis', () => {
  it('is a harmless no-op when no URL is configured', async () => {
    const cache = createCache(undefined);
    expect(cache.enabled).toBe(false);
    await cache.recordReading(READING);
    expect((await cache.getLatestMany(['dev-001'], 'temperature')).size).toBe(0);
    const unsubscribe = await cache.subscribeReadings(() => {});
    await unsubscribe();
  });

  it('degrades gracefully (no throw, no hang) when Redis is unreachable', async () => {
    const messages: string[] = [];
    // Port 1 is closed: connections are refused immediately.
    const cache = track(createCache('redis://127.0.0.1:1', { log: (m) => messages.push(m) }));
    expect(cache.enabled).toBe(true);

    await expect(cache.recordReading(READING)).resolves.toBeUndefined();
    const found = await cache.getLatestMany(['dev-001'], 'temperature');
    expect(found.size).toBe(0);
  }, 10_000);
});

// Real-Redis behaviour. Skipped unless REDIS_TEST_URL is set (CI has no Redis).
describe.skipIf(!process.env.REDIS_TEST_URL)('createCache with a real Redis', () => {
  const url = process.env.REDIS_TEST_URL;

  it('stores the latest reading and reads many back in one call', async () => {
    const cache = track(createCache(url));
    await cache.recordReading(READING);
    await cache.recordReading({ ...READING, deviceId: 'dev-002', value: 30 });

    const found = await cache.getLatestMany(['dev-001', 'dev-002', 'dev-missing'], 'temperature');
    expect(found.get('dev-001')).toEqual(READING);
    expect(found.get('dev-002')?.value).toBe(30);
    expect(found.has('dev-missing')).toBe(false);
  });

  it('keeps only the newest reading per device', async () => {
    const cache = track(createCache(url));
    await cache.recordReading({ ...READING, deviceId: 'dev-new', value: 1 });
    await cache.recordReading({ ...READING, deviceId: 'dev-new', value: 2 });
    const found = await cache.getLatestMany(['dev-new'], 'temperature');
    expect(found.get('dev-new')?.value).toBe(2);
  });

  it('delivers recorded readings to subscribers (pub/sub)', async () => {
    const publisher = track(createCache(url));
    const subscriber = track(createCache(url));
    const received: Reading[] = [];
    await subscriber.subscribeReadings((r) => received.push(r));

    // Give the subscription a moment to register before publishing.
    await new Promise((resolve) => setTimeout(resolve, 200));
    await publisher.recordReading({ ...READING, deviceId: 'dev-pubsub', value: 42 });
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(received.map((r) => r.value)).toContain(42);
  });
});
