-- Demo devices so the dashboard shows something with zero hardware.
-- Safe to re-run: existing devices are left untouched.
INSERT INTO devices (id, name, type, location) VALUES
  ('dev-001', 'Line 3 Temperature Sensor', 'sensor', 'Plant A'),
  ('dev-002', 'Cold Room Sensor', 'sensor', 'Plant A'),
  ('dev-003', 'Boiler Sensor', 'sensor', 'Plant B'),
  ('dev-004', 'Irrigation Pump', 'pump', 'Field 1'),
  ('dev-005', 'Main Valve', 'valve', 'Field 1')
ON CONFLICT (id) DO NOTHING;
