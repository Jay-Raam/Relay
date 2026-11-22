import mqtt from 'mqtt';
import { config } from './config';
import { parseTelemetry } from './handler';
import { insertTelemetry, closeDb } from './db';

const TOPIC = 'devices/+/telemetry';

// Hosted brokers (HiveMQ Cloud) need TLS + credentials; empty values mean anonymous.
const client = mqtt.connect(config.MQTT_URL, {
  username: config.MQTT_USERNAME || undefined,
  password: config.MQTT_PASSWORD || undefined,
});

client.on('connect', () => {
  console.log(`worker connected to ${config.MQTT_URL}`);
  client.subscribe(TOPIC, { qos: 1 }, (err) => {
    if (err) console.error(`subscribe failed: ${err.message}`);
    else console.log(`subscribed to ${TOPIC}`);
  });
});

client.on('message', (topic, payload) => {
  const result = parseTelemetry(topic, payload);
  if (!result.ok) {
    // One bad payload must never crash the worker — drop and move on.
    console.warn(`dropped message on ${topic}: ${result.error}`);
    return;
  }
  insertTelemetry(result.reading)
    .then(() => {
      const r = result.reading;
      console.log(`✓ ${r.deviceId} ${r.metric}=${r.value}`);
    })
    .catch((err: Error) => console.error(`insert failed: ${err.message}`));
});

client.on('error', (err) => console.error(`mqtt error: ${err.message}`));

// Graceful shutdown: stop the broker connection and drain the DB pool.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\nshutting down…');
    client.end(true);
    void closeDb().finally(() => process.exit(0));
  });
}
