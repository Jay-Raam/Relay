import pg from 'pg';
import {
  ACTUATOR_TYPES,
  isCommand,
  isRole,
  type Command,
  type Device,
  type DeviceState,
  type DeviceType,
  type Metric,
  type Reading,
  type SessionUser,
} from '@relay/types';
import type { HistoryQuery } from './validate';

/** A device plus the last state it reported (null for sensors / before its first report). */
export type DeviceRecord = Device & { state: DeviceState | null };

/** A command just written to the audit log, not yet delivered. */
export interface CommandRecord {
  id: string;
}

/** An account as stored, including the password hash. Never sent to a client. */
export interface UserRecord extends SessionUser {
  passwordHash: string;
}

/** Everything the API needs from storage. Swappable so tests need no database. */
export interface TelemetryRepo {
  devices(): Promise<DeviceRecord[]>;
  /**
   * Log a command for a device. Returns null when the device doesn't exist or is not an
   * actuator (a sensor cannot be commanded) — nothing is written in that case.
   */
  insertCommand(deviceId: string, command: Command, userId: string): Promise<CommandRecord | null>;
  /** Sign-in lookup. `email` must already be lower-cased. */
  userByEmail(email: string): Promise<UserRecord | null>;
  /** The account behind a session, or null if it no longer exists. */
  userById(id: string): Promise<SessionUser | null>;
  recordLogin(id: string): Promise<void>;
  /** The command could not be delivered to the broker. */
  markCommandFailed(commandId: string): Promise<void>;
  latest(deviceId: string, metric: Metric): Promise<Reading | null>;
  /** Newest reading per device, in ONE query (devices with no data are absent). */
  latestMany(deviceIds: string[], metric: Metric): Promise<Reading[]>;
  history(query: HistoryQuery): Promise<Reading[]>;
  close(): Promise<void>;
}

interface Row {
  device_id: string;
  ts: Date;
  metric: Metric;
  value: number;
}

interface DeviceRow {
  id: string;
  name: string;
  type: string;
  location: string | null;
  state: string | null;
  command_id: string | null;
  state_ts: Date | null;
}

interface UserRow {
  id: string;
  email: string;
  role: string;
  password_hash: string;
}

function toState(row: DeviceRow): DeviceState | null {
  if (!row.state || !isCommand(row.state) || !row.state_ts) return null;
  return { value: row.state, ts: row.state_ts.toISOString(), commandId: row.command_id };
}

function toReading(row: Row): Reading {
  return {
    deviceId: row.device_id,
    metric: row.metric,
    value: row.value,
    ts: row.ts.toISOString(),
  };
}

export function createPgRepo(connectionString: string): TelemetryRepo {
  const pool = new pg.Pool({ connectionString });

  return {
    async devices() {
      const { rows } = await pool.query<DeviceRow>(
        `SELECT d.id, d.name, d.type, d.location,
                s.state, s.command_id, s.ts AS state_ts
           FROM devices d
           LEFT JOIN device_state s ON s.device_id = d.id
          ORDER BY d.id`,
      );
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type as DeviceType,
        location: r.location,
        state: toState(r),
      }));
    },

    async insertCommand(deviceId, command, userId) {
      // The WHERE makes "unknown device" and "not an actuator" the same, safe, no-op.
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO device_commands (device_id, command, user_id)
         SELECT id, $2, $4 FROM devices WHERE id = $1 AND type = ANY($3::text[])
         RETURNING id`,
        [deviceId, command, ACTUATOR_TYPES, userId],
      );
      const row = rows[0];
      return row ? { id: row.id } : null;
    },

    async userByEmail(email) {
      const { rows } = await pool.query<UserRow>(
        `SELECT id, email, role, password_hash FROM users WHERE email = $1`,
        [email],
      );
      const row = rows[0];
      return row && isRole(row.role)
        ? { id: row.id, email: row.email, role: row.role, passwordHash: row.password_hash }
        : null;
    },

    async userById(id) {
      const { rows } = await pool.query<UserRow>(
        `SELECT id, email, role, password_hash FROM users WHERE id = $1`,
        [id],
      );
      const row = rows[0];
      return row && isRole(row.role) ? { id: row.id, email: row.email, role: row.role } : null;
    },

    async recordLogin(id) {
      await pool.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [id]);
    },

    async markCommandFailed(commandId) {
      await pool.query(
        `UPDATE device_commands SET status = 'failed' WHERE id = $1 AND status = 'sent'`,
        [commandId],
      );
    },

    async latest(deviceId, metric) {
      const { rows } = await pool.query<Row>(
        `SELECT device_id, ts, metric, value
           FROM telemetry
          WHERE device_id = $1 AND metric = $2
          ORDER BY ts DESC
          LIMIT 1`,
        [deviceId, metric],
      );
      const row = rows[0];
      return row ? toReading(row) : null;
    },

    async latestMany(deviceIds, metric) {
      if (deviceIds.length === 0) return [];
      // One index probe per device (LATERAL + LIMIT 1) rather than scanning every
      // chunk; uses the (device_id, metric, ts DESC) index.
      const { rows } = await pool.query<Row>(
        `SELECT t.device_id, t.ts, t.metric, t.value
           FROM unnest($2::text[]) AS d(id)
          CROSS JOIN LATERAL (
                SELECT device_id, ts, metric, value
                  FROM telemetry
                 WHERE device_id = d.id AND metric = $1
                 ORDER BY ts DESC
                 LIMIT 1
          ) t`,
        [metric, deviceIds],
      );
      return rows.map(toReading);
    },

    async history({ deviceId, metric, from, to, limit }) {
      // Newest `limit` rows in the window, returned oldest-first for charting.
      const { rows } = await pool.query<Row>(
        `SELECT device_id, ts, metric, value FROM (
           SELECT device_id, ts, metric, value
             FROM telemetry
            WHERE device_id = $1 AND metric = $2 AND ts >= $3 AND ts <= $4
            ORDER BY ts DESC
            LIMIT $5
         ) recent
         ORDER BY ts ASC`,
        [deviceId, metric, from, to, limit],
      );
      return rows.map(toReading);
    },

    close: () => pool.end(),
  };
}
