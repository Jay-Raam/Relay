import type { Cache } from '@relay/cache';
import type { Device, Metric, Reading } from '@relay/types';
import type { TelemetryRepo } from './repo';
import type { HistoryQuery } from './validate';

/** Shared fakes for tests: no database, no Redis. */
export const READING: Reading = {
  deviceId: 'dev-001',
  metric: 'temperature',
  value: 24.5,
  ts: '2026-01-01T12:00:00.000Z',
};

export const DEVICES: Device[] = [
  { id: 'dev-001', name: 'Sensor 1', type: 'sensor', location: 'Plant A' },
  { id: 'dev-002', name: 'Sensor 2', type: 'sensor', location: null },
  { id: 'dev-003', name: 'Sensor 3', type: 'sensor', location: 'Plant B' },
];

export interface RepoCalls {
  history: HistoryQuery[];
  latestMany: { deviceIds: string[]; metric: Metric }[];
  latest: number;
}

export function fakeRepo(overrides: Partial<TelemetryRepo> = {}): {
  repo: TelemetryRepo;
  calls: RepoCalls;
} {
  const calls: RepoCalls = { history: [], latestMany: [], latest: 0 };
  const repo: TelemetryRepo = {
    devices: async () => DEVICES,
    latest: async () => {
      calls.latest += 1;
      return READING;
    },
    latestMany: async (deviceIds, metric) => {
      calls.latestMany.push({ deviceIds, metric });
      return deviceIds.map((deviceId) => ({ ...READING, deviceId, metric }));
    },
    history: async (q) => {
      calls.history.push(q);
      return [READING];
    },
    close: async () => {},
    ...overrides,
  };
  return { repo, calls };
}

export interface FakeCache extends Cache {
  calls: { getLatestMany: { deviceIds: string[]; metric: Metric }[] };
}

/** A cache holding `entries` (keyed by deviceId) for the temperature metric. */
export function fakeCache(entries: Reading[] = [], enabled = true): FakeCache {
  const calls: FakeCache['calls'] = { getLatestMany: [] };
  const byDevice = new Map(entries.map((r) => [r.deviceId, r]));
  return {
    enabled,
    calls,
    recordReading: async () => {},
    getLatestMany: async (deviceIds, metric) => {
      calls.getLatestMany.push({ deviceIds, metric });
      const found = new Map<string, Reading>();
      for (const id of deviceIds) {
        const r = byDevice.get(id);
        if (r && r.metric === metric) found.set(id, r);
      }
      return found;
    },
    subscribeReadings: async () => async () => {},
    close: async () => {},
  };
}
