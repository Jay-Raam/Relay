import { describe, expect, it } from 'vitest';
import { createLatestLoader } from './loaders';
import { fakeCache, fakeRepo, READING } from './testing';

describe('createLatestLoader', () => {
  it('batches loads made in the same tick into one repo call', async () => {
    const { repo, calls } = fakeRepo();
    const loader = createLatestLoader(repo, fakeCache([]));
    const results = await Promise.all([
      loader.load({ deviceId: 'dev-001', metric: 'temperature' }),
      loader.load({ deviceId: 'dev-002', metric: 'temperature' }),
      loader.load({ deviceId: 'dev-003', metric: 'temperature' }),
    ]);
    expect(results.map((r) => r?.deviceId)).toEqual(['dev-001', 'dev-002', 'dev-003']);
    expect(calls.latestMany).toHaveLength(1);
  });

  it('keeps result order and returns null for devices with no data', async () => {
    const { repo } = fakeRepo({
      latestMany: async (ids, metric) =>
        ids.filter((id) => id !== 'dev-002').map((deviceId) => ({ ...READING, deviceId, metric })),
    });
    const loader = createLatestLoader(repo, fakeCache([]));
    const results = await Promise.all([
      loader.load({ deviceId: 'dev-001', metric: 'temperature' }),
      loader.load({ deviceId: 'dev-002', metric: 'temperature' }),
    ]);
    expect(results[0]?.deviceId).toBe('dev-001');
    expect(results[1]).toBeNull();
  });

  it('memoises repeat loads of the same device within one loader', async () => {
    const { repo, calls } = fakeRepo();
    const loader = createLatestLoader(repo, fakeCache([]));
    await loader.load({ deviceId: 'dev-001', metric: 'temperature' });
    await loader.load({ deviceId: 'dev-001', metric: 'temperature' });
    expect(calls.latestMany).toHaveLength(1);
  });

  it('treats the same device under different metrics separately', async () => {
    const { repo, calls } = fakeRepo();
    const loader = createLatestLoader(repo, fakeCache([]));
    await Promise.all([
      loader.load({ deviceId: 'dev-001', metric: 'temperature' }),
      loader.load({ deviceId: 'dev-001', metric: 'humidity' }),
    ]);
    expect(calls.latestMany.map((c) => c.metric).sort()).toEqual(['humidity', 'temperature']);
  });

  it('falls back to the database when the cache is disabled', async () => {
    const { repo, calls } = fakeRepo();
    const loader = createLatestLoader(repo, fakeCache([], false));
    const r = await loader.load({ deviceId: 'dev-001', metric: 'temperature' });
    expect(r?.deviceId).toBe('dev-001');
    expect(calls.latestMany).toHaveLength(1);
  });
});
