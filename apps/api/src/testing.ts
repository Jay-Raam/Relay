import type { Cache } from '@relay/cache';
import type { CommandMessage, Metric, Reading } from '@relay/types';
import type { CommandPublisher } from './commands';
import type { DeviceRecord, TelemetryRepo } from './repo';
import type { HistoryQuery } from './validate';

/** Shared fakes for tests: no database, no Redis. */
export const READING: Reading = {
  deviceId: 'dev-001',
  metric: 'temperature',
  value: 24.5,
  ts: '2026-01-01T12:00:00.000Z',
};

export const DEVICES: DeviceRecord[] = [
  { id: 'dev-001', name: 'Sensor 1', type: 'sensor', location: 'Plant A', state: null },
  { id: 'dev-002', name: 'Sensor 2', type: 'sensor', location: null, state: null },
  { id: 'dev-003', name: 'Sensor 3', type: 'sensor', location: 'Plant B', state: null },
];

/** The only device the fake repo will accept commands for (an actuator). */
export const PUMP_ID = 'dev-004';
export const COMMAND_ID = '3f6c1d1e-8a54-4a0f-9b0b-2f2d3a7c9e11';

export interface RepoCalls {
  history: HistoryQuery[];
  latestMany: { deviceIds: string[]; metric: Metric }[];
  latest: number;
  commands: { deviceId: string; command: string }[];
  failed: string[];
}

export function fakeRepo(overrides: Partial<TelemetryRepo> = {}): {
  repo: TelemetryRepo;
  calls: RepoCalls;
} {
  const calls: RepoCalls = { history: [], latestMany: [], latest: 0, commands: [], failed: [] };
  const repo: TelemetryRepo = {
    devices: async () => DEVICES,
    insertCommand: async (deviceId, command) => {
      if (deviceId !== PUMP_ID) return null; // unknown device or a sensor
      calls.commands.push({ deviceId, command });
      return { id: COMMAND_ID };
    },
    markCommandFailed: async (id) => {
      calls.failed.push(id);
    },
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

export interface FakePublisher extends CommandPublisher {
  sent: { deviceId: string; message: CommandMessage }[];
}

/** A publisher that records what it was asked to send, or fails like a dead broker. */
export function fakePublisher(fail = false): FakePublisher {
  const sent: FakePublisher['sent'] = [];
  return {
    sent,
    publish: async (deviceId, message) => {
      if (fail) throw new Error('broker is not connected');
      sent.push({ deviceId, message });
    },
    close: async () => {},
  };
}
