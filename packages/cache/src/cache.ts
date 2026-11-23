import { Redis } from 'ioredis';
import type { Metric, Reading } from '@relay/types';
import {
  decodeReading,
  encodeReading,
  latestKey,
  LATEST_TTL_SECONDS,
  READINGS_CHANNEL,
} from './codec';

/**
 * Redis is an optimisation, never a dependency: every method here swallows Redis
 * failures (and logs them) so a Redis outage degrades to "read the database" /
 * "poll instead of push" rather than taking the API or worker down.
 */
export interface Cache {
  /** False when no REDIS_URL was given — all methods are then cheap no-ops. */
  readonly enabled: boolean;
  /** Worker: remember the newest reading and announce it to live subscribers. */
  recordReading(reading: Reading): Promise<void>;
  /** API: newest cached reading per device (devices with no cached value are absent). */
  getLatestMany(deviceIds: string[], metric: Metric): Promise<Map<string, Reading>>;
  /** API: be called for every reading any worker records. Returns an unsubscribe fn. */
  subscribeReadings(onReading: (reading: Reading) => void): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

export interface CacheOptions {
  log?: (message: string) => void;
}

/**
 * With the offline queue off, commands sent while the first connection is still being
 * established would fail instantly. Wait briefly (startup only) for 'ready'; once the
 * connection has failed or dropped, fail immediately so a Redis outage costs nothing.
 */
function whenReady(client: Redis, timeoutMs = 2000): Promise<void> {
  if (client.status === 'ready') return Promise.resolve();
  if (client.status !== 'connecting' && client.status !== 'connect') {
    return Promise.reject(new Error(`redis is ${client.status}`));
  }
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      client.off('ready', onReady);
      client.off('close', onClose);
    };
    const onReady = (): void => {
      cleanup();
      resolve();
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error('redis connection closed'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('redis not ready in time'));
    }, timeoutMs);
    client.once('ready', onReady);
    client.once('close', onClose);
  });
}

const NOOP: Cache = {
  enabled: false,
  recordReading: async () => {},
  getLatestMany: async () => new Map(),
  subscribeReadings: async () => async () => {},
  close: async () => {},
};

export function createCache(url: string | undefined, options: CacheOptions = {}): Cache {
  if (!url) return NOOP;

  const log = options.log ?? ((m: string) => console.warn(`[cache] ${m}`));

  // Command connection: fail fast instead of queueing commands while Redis is down —
  // a hung Redis call must never hang an API request. The subscriber connection is the
  // opposite: it queues its SUBSCRIBE until connected and re-subscribes after every
  // reconnect, because nothing user-facing waits on it.
  const connect = (failFast: boolean): Redis => {
    const client = new Redis(url, {
      enableOfflineQueue: !failFast,
      maxRetriesPerRequest: failFast ? 1 : null,
      connectTimeout: 5000,
      retryStrategy: (attempt) => Math.min(attempt * 500, 5000),
    });
    let lastLogged = 0;
    client.on('error', (err: Error) => {
      // Throttle: a down Redis would otherwise log on every reconnect attempt.
      const now = Date.now();
      if (now - lastLogged > 30_000) {
        lastLogged = now;
        log(`redis error: ${err.message}`);
      }
    });
    return client;
  };

  const client = connect(true);
  const subscribers = new Set<Redis>();

  return {
    enabled: true,

    async recordReading(reading) {
      try {
        const payload = encodeReading(reading);
        await whenReady(client);
        await client
          .multi()
          .set(latestKey(reading.deviceId, reading.metric), payload, 'EX', LATEST_TTL_SECONDS)
          .publish(READINGS_CHANNEL, payload)
          .exec();
      } catch (err) {
        log(`recordReading failed: ${(err as Error).message}`);
      }
    },

    async getLatestMany(deviceIds, metric) {
      const found = new Map<string, Reading>();
      if (deviceIds.length === 0) return found;
      try {
        await whenReady(client);
        const values = await client.mget(deviceIds.map((id) => latestKey(id, metric)));
        values.forEach((raw, i) => {
          const reading = decodeReading(raw);
          const id = deviceIds[i];
          if (reading && id !== undefined) found.set(id, reading);
        });
      } catch (err) {
        log(`getLatestMany failed, falling back to the database: ${(err as Error).message}`);
      }
      return found;
    },

    async subscribeReadings(onReading) {
      // A connection in subscriber mode can't run other commands, so it gets its own.
      const sub = connect(false);
      subscribers.add(sub);
      sub.on('message', (_channel: string, message: string) => {
        const reading = decodeReading(message);
        if (reading) onReading(reading);
      });
      try {
        await sub.subscribe(READINGS_CHANNEL);
      } catch (err) {
        log(
          `subscribe failed (live push disabled, polling still works): ${(err as Error).message}`,
        );
      }
      return async () => {
        subscribers.delete(sub);
        sub.disconnect();
      };
    },

    async close() {
      for (const sub of subscribers) sub.disconnect();
      subscribers.clear();
      client.disconnect();
    },
  };
}
