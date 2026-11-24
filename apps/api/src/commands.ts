import mqtt, { type MqttClient } from 'mqtt';
import { commandTopic, type CommandMessage } from '@relay/types';

/** Sends a command to a device. Swappable so tests need no broker. */
export interface CommandPublisher {
  publish(deviceId: string, message: CommandMessage): Promise<void>;
  close(): Promise<void>;
}

/** The command could not be handed to the broker (not connected, timed out, or refused). */
export class CommandDeliveryError extends Error {}

/** How long to wait for the broker to acknowledge a command before giving up. */
export const PUBLISH_TIMEOUT_MS = 3000;

/** The slice of an MQTT client we use, so tests can pass a fake. */
export type CommandClient = Pick<MqttClient, 'connected' | 'publishAsync' | 'endAsync'>;

/** Reject if `promise` doesn't settle in time. The timer never outlives the call. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new CommandDeliveryError('broker did not respond in time')),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Publishes commands at QoS 1 and waits for the broker's acknowledgement.
 *
 * It refuses outright when the broker connection is down instead of letting the client queue
 * the message: a queued "pump on" delivered minutes later would be a surprise. Devices also
 * drop commands older than COMMAND_MAX_AGE_MS as a second line of defence.
 */
export function createCommandPublisher(
  client: CommandClient,
  timeoutMs: number = PUBLISH_TIMEOUT_MS,
): CommandPublisher {
  return {
    async publish(deviceId, message) {
      if (!client.connected) throw new CommandDeliveryError('MQTT broker is not connected');
      try {
        await withTimeout(
          client.publishAsync(commandTopic(deviceId), JSON.stringify(message), { qos: 1 }),
          timeoutMs,
        );
      } catch (err) {
        if (err instanceof CommandDeliveryError) throw err;
        throw new CommandDeliveryError(err instanceof Error ? err.message : 'publish failed');
      }
    },
    async close() {
      await client.endAsync(true);
    },
  };
}

export interface MqttOptions {
  url: string;
  username?: string;
  password?: string;
}

/** Connect to the broker (hosted brokers need TLS + credentials) and wrap it as a publisher. */
export function createMqttCommandPublisher(options: MqttOptions): CommandPublisher {
  const client = mqtt.connect(options.url, {
    username: options.username || undefined,
    password: options.password || undefined,
  });
  client.on('connect', () => console.log(`api connected to MQTT broker ${options.url}`));
  client.on('error', (err) => console.error(`api mqtt error: ${err.message}`));
  return createCommandPublisher(client);
}
