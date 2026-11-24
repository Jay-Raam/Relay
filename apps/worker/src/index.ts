import mqtt from 'mqtt';
import { createCache } from '@relay/cache';
import { config } from './config';
import { parseState, parseTelemetry, topicKind } from './handler';
import { applyDeviceState, insertTelemetry, closeDb } from './db';

const TOPICS = ['devices/+/telemetry', 'devices/+/state'];

const cache = createCache(config.REDIS_URL || undefined);

// Hosted brokers (HiveMQ Cloud) need TLS + credentials; empty values mean anonymous.
const client = mqtt.connect(config.MQTT_URL, {
  username: config.MQTT_USERNAME || undefined,
  password: config.MQTT_PASSWORD || undefined,
});

client.on('connect', () => {
  console.log(`worker connected to ${config.MQTT_URL}`);
  client.subscribe(TOPICS, { qos: 1 }, (err) => {
    if (err) console.error(`subscribe failed: ${err.message}`);
    else console.log(`subscribed to ${TOPICS.join(', ')}`);
  });
});

function handleTelemetry(topic: string, payload: Buffer): void {
  const result = parseTelemetry(topic, payload);
  if (!result.ok) {
    // One bad payload must never crash the worker — drop and move on.
    console.warn(`dropped message on ${topic}: ${result.error}`);
    return;
  }
  const reading = result.reading;
  insertTelemetry(reading)
    .then(async () => {
      console.log(`✓ ${reading.deviceId} ${reading.metric}=${reading.value}`);
      // After the durable write: refresh the latest-value cache and notify live viewers.
      // Never throws — a Redis problem must not affect ingestion.
      await cache.recordReading(reading);
    })
    .catch((err: Error) => console.error(`insert failed: ${err.message}`));
}

function handleState(topic: string, payload: Buffer): void {
  const result = parseState(topic, payload);
  if (!result.ok) {
    console.warn(`dropped message on ${topic}: ${result.error}`);
    return;
  }
  const update = result.update;
  applyDeviceState(update)
    .then((known) => {
      if (!known) console.warn(`dropped state for unknown device ${update.deviceId}`);
      else
        console.log(
          `✓ ${update.deviceId} state=${update.state}${update.commandId ? ' (confirms command)' : ''}`,
        );
    })
    .catch((err: Error) => console.error(`state update failed: ${err.message}`));
}

client.on('message', (topic, payload) => {
  const kind = topicKind(topic);
  if (kind === 'telemetry') handleTelemetry(topic, payload);
  else if (kind === 'state') handleState(topic, payload);
  else console.warn(`dropped message on unexpected topic ${topic}`);
});

client.on('error', (err) => console.error(`mqtt error: ${err.message}`));

// Graceful shutdown: stop the broker connection and drain the DB pool.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\nshutting down…');
    client.end(true);
    void Promise.all([closeDb(), cache.close()]).finally(() => process.exit(0));
  });
}
