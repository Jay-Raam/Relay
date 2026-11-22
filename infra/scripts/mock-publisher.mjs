#!/usr/bin/env node
/**
 * Mock telemetry publisher — lets you run and demo the full pipeline with zero
 * hardware. Publishes a wandering "temperature" reading to the MQTT broker on
 * the topic devices/{deviceId}/telemetry, at QoS 1, every INTERVAL_MS.
 *
 *   node mock-publisher.mjs
 *
 * Env: MQTT_URL (default mqtt://localhost:1883), DEVICE_ID (default dev-001),
 *      INTERVAL_MS (default 2000).
 */
import mqtt from 'mqtt';

const url = process.env.MQTT_URL || 'mqtt://localhost:1883';
const deviceId = process.env.DEVICE_ID || 'dev-001';
const intervalMs = Number(process.env.INTERVAL_MS || 2000);
const topic = `devices/${deviceId}/telemetry`;

const client = mqtt.connect(url);

client.on('connect', () => {
  console.log(`mock-publisher connected to ${url}`);
  console.log(`publishing to ${topic} every ${intervalMs}ms (Ctrl+C to stop)`);

  setInterval(() => {
    // Temperature wandering around 22°C with a slow swing plus a little noise.
    const base = 22 + Math.sin(Date.now() / 60000) * 3;
    const value = Number((base + (Math.random() - 0.5)).toFixed(2));
    const payload = JSON.stringify({
      metric: 'temperature',
      value,
      ts: new Date().toISOString(),
    });
    client.publish(topic, payload, { qos: 1 });
    console.log(`→ ${topic} ${payload}`);
  }, intervalMs);
});

client.on('error', (err) => {
  console.error(`mqtt error: ${err.message}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\nstopping…');
    client.end(true, () => process.exit(0));
  });
}
