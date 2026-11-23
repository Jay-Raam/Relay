-- Demo devices so the dashboard shows something with zero hardware.
-- Safe to re-run: existing devices are left untouched.
INSERT INTO devices (id, name, type, location) VALUES
  ('dev-001', 'Line 3 Temperature Sensor', 'sensor', 'Plant A'),
  ('dev-002', 'Cold Room Sensor', 'sensor', 'Plant A'),
  ('dev-003', 'Boiler Sensor', 'sensor', 'Plant B')
ON CONFLICT (id) DO NOTHING;
