-- Relay — 002 device commands
-- Actuators (pumps, valves) report their last state, and every command sent to
-- one is logged so there is an audit trail and a way to confirm delivery.

-- Last state each actuator reported (one row per device).
CREATE TABLE IF NOT EXISTS device_state (
  device_id  TEXT PRIMARY KEY REFERENCES devices (id),
  state      TEXT NOT NULL,            -- on | off
  command_id UUID,                     -- the command this state confirms, if any
  ts         TIMESTAMPTZ NOT NULL
);

-- One row per command sent.
CREATE TABLE IF NOT EXISTS device_commands (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id    TEXT NOT NULL REFERENCES devices (id),
  command      TEXT NOT NULL,          -- on | off
  status       TEXT NOT NULL DEFAULT 'sent',  -- sent | confirmed | failed
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS device_commands_device_created_idx
  ON device_commands (device_id, created_at DESC);
