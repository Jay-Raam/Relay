import type { Cache } from '@relay/cache';
import type { CommandMessage, Metric, Reading, SessionUser } from '@relay/types';
import type { CommandPublisher } from './commands';
import type { SessionConfig } from './auth';
import type { DeviceRecord, TelemetryRepo } from './repo';
import { COOKIE_NAME, createSessionToken } from './session';
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

/** Test accounts. The password for both is PASSWORD (hashed lazily by the tests that need it). */
export const OPERATOR: SessionUser = {
  id: 'u-operator',
  email: 'op@example.com',
  role: 'operator',
};
export const VIEWER: SessionUser = { id: 'u-viewer', email: 'view@example.com', role: 'viewer' };
export const PASSWORD = 'correct horse battery';

export const TEST_SESSION: SessionConfig = {
  secret: 'test-secret-test-secret-test-secret-0123',
  ttlSeconds: 3600,
  cookie: { secure: false, sameSite: 'lax' },
};

/** A Cookie header carrying a valid session for `user`. */
export function cookieFor(user: SessionUser): string {
  return `${COOKIE_NAME}=${createSessionToken(user.id, TEST_SESSION.secret, TEST_SESSION.ttlSeconds)}`;
}

export interface RepoCalls {
  history: HistoryQuery[];
  latestMany: { deviceIds: string[]; metric: Metric }[];
  latest: number;
  commands: { deviceId: string; command: string; userId: string }[];
  logins: string[];
  failed: string[];
}

export function fakeRepo(overrides: Partial<TelemetryRepo> = {}): {
  repo: TelemetryRepo;
  calls: RepoCalls;
} {
  const calls: RepoCalls = {
    history: [],
    latestMany: [],
    latest: 0,
    commands: [],
    failed: [],
    logins: [],
  };
  const repo: TelemetryRepo = {
    devices: async () => DEVICES,
    insertCommand: async (deviceId, command, userId) => {
      if (deviceId !== PUMP_ID) return null; // unknown device or a sensor
      calls.commands.push({ deviceId, command, userId });
      return { id: COMMAND_ID };
    },
    userByEmail: async () => null,
    userById: async (id) => [OPERATOR, VIEWER].find((u) => u.id === id) ?? null,
    recordLogin: async (id) => {
      calls.logins.push(id);
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
