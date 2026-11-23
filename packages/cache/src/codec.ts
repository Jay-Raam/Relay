import { isMetric, type Metric, type Reading } from '@relay/types';

/** Redis key holding the newest reading for one device + metric. */
export function latestKey(deviceId: string, metric: Metric): string {
  return `relay:latest:${metric}:${deviceId}`;
}

/** Pub/sub channel the worker publishes every stored reading on. */
export const READINGS_CHANNEL = 'relay:readings';

/** How long a "latest" value lives in Redis (a quiet device keeps its last value a day). */
export const LATEST_TTL_SECONDS = 24 * 60 * 60;

export function encodeReading(reading: Reading): string {
  return JSON.stringify(reading);
}

/** Parse + validate a reading from Redis. Returns null for anything malformed. */
export function decodeReading(raw: string | null | undefined): Reading | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const r = value as Record<string, unknown>;
  if (
    typeof r.deviceId !== 'string' ||
    typeof r.metric !== 'string' ||
    !isMetric(r.metric) ||
    typeof r.value !== 'number' ||
    !Number.isFinite(r.value) ||
    typeof r.ts !== 'string'
  ) {
    return null;
  }
  return { deviceId: r.deviceId, metric: r.metric, value: r.value, ts: r.ts };
}
