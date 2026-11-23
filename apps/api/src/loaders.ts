import DataLoader from 'dataloader';
import type { Cache } from '@relay/cache';
import type { Metric, Reading } from '@relay/types';
import type { TelemetryRepo } from './repo';

export interface LatestKey {
  deviceId: string;
  metric: Metric;
}

export type LatestLoader = DataLoader<LatestKey, Reading | null, string>;

const keyOf = (k: LatestKey): string => `${k.metric}|${k.deviceId}`;

/**
 * Batches every `latest` lookup made while resolving ONE request. Listing N devices
 * costs one Redis MGET, plus at most one SQL query for the devices Redis didn't have —
 * not N round trips. Create one per request (it also memoises within the request).
 */
export function createLatestLoader(repo: TelemetryRepo, cache: Cache): LatestLoader {
  return new DataLoader<LatestKey, Reading | null, string>(
    async (keys) => {
      const byMetric = new Map<Metric, Set<string>>();
      for (const { deviceId, metric } of keys) {
        const ids = byMetric.get(metric) ?? new Set<string>();
        ids.add(deviceId);
        byMetric.set(metric, ids);
      }

      const found = new Map<string, Reading>();
      await Promise.all(
        [...byMetric].map(async ([metric, idSet]) => {
          const ids = [...idSet];
          const cached = await cache.getLatestMany(ids, metric);
          for (const [id, reading] of cached) found.set(keyOf({ deviceId: id, metric }), reading);

          const missing = ids.filter((id) => !cached.has(id));
          if (missing.length > 0) {
            for (const reading of await repo.latestMany(missing, metric)) {
              found.set(keyOf({ deviceId: reading.deviceId, metric }), reading);
            }
          }
        }),
      );

      return keys.map((k) => found.get(keyOf(k)) ?? null);
    },
    { cacheKeyFn: keyOf },
  );
}

export interface Loaders {
  latest: LatestLoader;
}

export function createLoaders(repo: TelemetryRepo, cache: Cache): Loaders {
  return { latest: createLatestLoader(repo, cache) };
}
