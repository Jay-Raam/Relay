#!/usr/bin/env node
/**
 * Mock telemetry publisher — lets you run and demo the full pipeline with zero
 * hardware. Publishes a wandering "temperature" reading to the MQTT broker on
 * the topic devices/{deviceId}/telemetry for each device, at QoS 1, every INTERVAL_MS.
 *
 *   node mock-publisher.mjs
 *
 * It also simulates actuators (a pump and a valve): it listens on devices/{id}/commands, applies
 * on/off, and answers on devices/{id}/state with the commandId so the dashboard can confirm.
 *
 * Env (read from the repo-root .env, real env vars win): MQTT_URL, MQTT_USERNAME, MQTT_PASSWORD,
 *      DEVICE_IDS (sensors, default dev-001,dev-002,dev-003),
 *      ACTUATOR_IDS (default dev-004,dev-005), INTERVAL_MS (default 2000).
 */
import mqtt from 'mqtt';
import { createActuator } from './actuator.mjs';

// Load the repo-root .env (Node >= 20.12). Existing env vars are not overridden.
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  // no .env — fall back to real env vars / defaults
}

const url = process.env.MQTT_URL || 'mqtt://localhost:1883';
// DEVICE_IDS is a comma-separated list (DEVICE_ID, a single id, still works).
const deviceIds = (process.env.DEVICE_IDS || process.env.DEVICE_ID || 'dev-001,dev-002,dev-003')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
const actuatorIds = (process.env.ACTUATOR_IDS ?? 'dev-004,dev-005')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
const intervalMs = Number(process.env.INTERVAL_MS || 2000);
/** Pretend the hardware takes a moment to switch. */
const SWITCH_DELAY_MS = 300;

const actuators = new Map(actuatorIds.map((id) => [id, createActuator(id)]));

const client = mqtt.connect(url, {
  username: process.env.MQTT_USERNAME || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
});

/** A wandering temperature: each device gets its own baseline and phase so the lines differ. */
function temperatureFor(index) {
  const base = 22 + index * 6 + Math.sin(Date.now() / 60000 + index) * 3;
  return Number((base + (Math.random() - 0.5)).toFixed(2));
}

let started = false;

function publishState(deviceId, report) {
  const topic = `devices/${deviceId}/state`;
  const payload = JSON.stringify(report);
  client.publish(topic, payload, { qos: 1 });
  console.log(`→ ${topic} ${payload}`);
}

client.on('connect', () => {
  console.log(`mock-publisher connected to ${url}`);

  if (actuators.size > 0) {
    client.subscribe('devices/+/commands', { qos: 1 });
    console.log(`simulating actuators ${actuatorIds.join(', ')} (listening for commands)`);
    // Report the boot state so the dashboard shows OFF rather than "unknown".
    for (const [id, actuator] of actuators) publishState(id, actuator.report());
  }

  // 'connect' fires again after every reconnect; only start the publishing loop once.
  if (started) return;
  started = true;
  console.log(`publishing for ${deviceIds.join(', ')} every ${intervalMs}ms (Ctrl+C to stop)`);

  setInterval(() => {
    deviceIds.forEach((deviceId, index) => {
      const topic = `devices/${deviceId}/telemetry`;
      const payload = JSON.stringify({
        metric: 'temperature',
        value: temperatureFor(index),
        ts: new Date().toISOString(),
      });
      client.publish(topic, payload, { qos: 1 });
      console.log(`→ ${topic} ${payload}`);
    });
  }, intervalMs);
});

client.on('message', (topic, payload) => {
  const match = topic.match(/^devices\/([^/]+)\/commands$/);
  const actuator = match ? actuators.get(match[1]) : undefined;
  if (!actuator) return; // a command for some other device
  const result = actuator.handleCommand(payload);
  if (!result.accepted) {
    console.warn(`✗ ${actuator.deviceId} ignored command: ${result.reason}`);
    return;
  }
  console.log(`✓ ${actuator.deviceId} -> ${result.report.state}`);
  setTimeout(() => publishState(actuator.deviceId, result.report), SWITCH_DELAY_MS);
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
