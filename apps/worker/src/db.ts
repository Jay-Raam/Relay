import pg from 'pg';
import type { Reading } from '@relay/types';
import { config } from './config';
import type { StateUpdate } from './handler';

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

/** Postgres error code for a foreign-key violation (state from a device we don't know). */
const FOREIGN_KEY_VIOLATION = '23503';

/**
 * Record an actuator's reported state and, if it confirms a command, mark that command
 * confirmed. Returns false (and writes nothing) for a device that isn't in the devices table.
 * An older report never overwrites a newer one.
 */
export async function applyDeviceState(update: StateUpdate): Promise<boolean> {
  try {
    await pool.query(
      `INSERT INTO device_state (device_id, state, command_id, ts)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (device_id) DO UPDATE
         SET state = EXCLUDED.state, command_id = EXCLUDED.command_id, ts = EXCLUDED.ts
       WHERE device_state.ts <= EXCLUDED.ts`,
      [update.deviceId, update.state, update.commandId, update.ts],
    );
  } catch (err) {
    if ((err as { code?: string }).code === FOREIGN_KEY_VIOLATION) return false;
    throw err;
  }

  if (update.commandId) {
    await pool.query(
      `UPDATE device_commands
          SET status = 'confirmed', confirmed_at = now()
        WHERE id = $1 AND device_id = $2 AND status = 'sent'`,
      [update.commandId, update.deviceId],
    );
  }
  return true;
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
