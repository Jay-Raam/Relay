import { describe, expect, it } from 'vitest';
import { COMMAND_MAX_AGE_MS, type CommandMessage } from '@relay/types';
import { CommandDeliveryError, createCommandPublisher, type CommandClient } from './commands';

const MESSAGE: CommandMessage = {
  commandId: '3f6c1d1e-8a54-4a0f-9b0b-2f2d3a7c9e11',
  command: 'on',
  ts: '2026-01-01T12:00:00.000Z',
};

interface Published {
  topic: string;
  payload: string;
  opts: unknown;
}

function fakeClient(overrides: Partial<CommandClient> = {}): {
  client: CommandClient;
  published: Published[];
  ended: boolean[];
} {
  const published: Published[] = [];
  const ended: boolean[] = [];
  const client = {
    connected: true,
    publishAsync: async (topic: string, payload: string, opts: unknown) => {
      published.push({ topic, payload, opts });
      return undefined;
    },
    endAsync: async (force?: boolean) => {
      ended.push(Boolean(force));
    },
    ...overrides,
  } as unknown as CommandClient;
  return { client, published, ended };
}

describe('createCommandPublisher', () => {
  it('publishes the message as JSON to the device command topic at QoS 1', async () => {
    const { client, published } = fakeClient();
    await createCommandPublisher(client).publish('dev-004', MESSAGE);
    expect(published).toHaveLength(1);
    expect(published[0]?.topic).toBe('devices/dev-004/commands');
    expect(JSON.parse(published[0]?.payload ?? '{}')).toEqual(MESSAGE);
    expect(published[0]?.opts).toEqual({ qos: 1 });
  });

  it('refuses to queue a command while the broker connection is down', async () => {
    const { client, published } = fakeClient({ connected: false });
    await expect(createCommandPublisher(client).publish('dev-004', MESSAGE)).rejects.toThrow(
      CommandDeliveryError,
    );
    expect(published).toHaveLength(0);
  });

  it('gives up if the broker does not acknowledge in time', async () => {
    const { client } = fakeClient({
      publishAsync: () => new Promise(() => {}) as never, // never settles
    });
    await expect(createCommandPublisher(client, 20).publish('dev-004', MESSAGE)).rejects.toThrow(
      'did not respond in time',
    );
  });

  it('wraps a broker error in a CommandDeliveryError', async () => {
    const { client } = fakeClient({
      publishAsync: async () => {
        throw new Error('Not authorized');
      },
    });
    const err = await createCommandPublisher(client)
      .publish('dev-004', MESSAGE)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CommandDeliveryError);
    expect((err as Error).message).toBe('Not authorized');
  });

  it('closes the connection with force', async () => {
    const { client, ended } = fakeClient();
    await createCommandPublisher(client).close();
    expect(ended).toEqual([true]);
  });
});

describe('command freshness contract', () => {
  it('is long enough to survive a slow network but short enough to avoid surprises', () => {
    expect(COMMAND_MAX_AGE_MS).toBeGreaterThanOrEqual(10_000);
    expect(COMMAND_MAX_AGE_MS).toBeLessThanOrEqual(60_000);
  });
});
