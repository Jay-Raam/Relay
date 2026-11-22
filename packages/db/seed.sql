-- One demo device so the dashboard shows something with zero hardware.
INSERT INTO devices (id, name, type, location)
VALUES ('dev-001', 'Line 3 Temperature Sensor', 'sensor', 'Plant A')
ON CONFLICT (id) DO NOTHING;
