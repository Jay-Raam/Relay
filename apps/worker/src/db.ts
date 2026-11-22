import pg from 'pg';
import type { Reading } from '@relay/types';
import { config } from './config';

const pool = new pg.Pool({ connectionString: config.DATABASE_URL });

/** Insert one reading into the telemetry hypertable. */
export async function insertTelemetry(reading: Reading): Promise<void> {
  await pool.query('INSERT INTO telemetry (device_id, ts, metric, value) VALUES ($1, $2, $3, $4)', [
    reading.deviceId,
    reading.ts,
    reading.metric,
    reading.value,
  ]);
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
