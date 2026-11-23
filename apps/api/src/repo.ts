import pg from 'pg';
import type { Device, DeviceType, Metric, Reading } from '@relay/types';
import type { HistoryQuery } from './validate';

/** Everything the API needs from storage. Swappable so tests need no database. */
export interface TelemetryRepo {
  devices(): Promise<Device[]>;
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
        'SELECT id, name, type, location FROM devices ORDER BY id',
      );
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type as DeviceType,
        location: r.location,
      }));
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
