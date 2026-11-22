-- Relay — 001 initial schema
-- Two kinds of data: slow-changing relational (devices) and append-only
-- time-series (telemetry). Telemetry lives in a TimescaleDB hypertable.

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS devices (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL,            -- pump | valve | sensor
  location   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telemetry (
  device_id TEXT NOT NULL REFERENCES devices (id),
  ts        TIMESTAMPTZ NOT NULL,
  metric    TEXT NOT NULL,             -- temperature | humidity | moisture | flow
  value     DOUBLE PRECISION NOT NULL
);

-- Partition telemetry by time so old chunks prune/compress independently.
SELECT create_hypertable(
  'telemetry',
  'ts',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists => TRUE
);

-- The shape of every history + latest-value query.
CREATE INDEX IF NOT EXISTS telemetry_device_metric_ts_idx
  ON telemetry (device_id, metric, ts DESC);
