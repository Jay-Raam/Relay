import pg from 'pg';
import type { Metric, Reading } from '@relay/types';
import type { HistoryQuery } from './validate';

/** Everything the API needs from storage. Swappable so tests need no database. */
export interface TelemetryRepo {
  latest(deviceId: string, metric: Metric): Promise<Reading | null>;
  history(query: HistoryQuery): Promise<Reading[]>;
  close(): Promise<void>;
}

interface Row {
  device_id: string;
  ts: Date;
  metric: Metric;
  value: number;
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
