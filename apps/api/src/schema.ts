import { createGraphQLError, createSchema, filter, pipe } from 'graphql-yoga';
import type { CommandMessage, Device, Reading } from '@relay/types';
import type { ReadingBus } from './bus';
import type { CommandPublisher } from './commands';
import type { Loaders } from './loaders';
import type { TelemetryRepo } from './repo';
import {
  InputError,
  parseCommand,
  parseMetric,
  validateHistory,
  type HistoryArgs,
} from './validate';

export interface GraphQLContext {
  loaders: Loaders;
}

const typeDefs = /* GraphQL */ `
  """
  One telemetry sample. ts is an ISO-8601 UTC timestamp.
  """
  type Reading {
    deviceId: String!
    metric: String!
    value: Float!
    ts: String!
  }

  """
  The last state an actuator reported. commandId is the command that state confirms, if any.
  """
  type DeviceState {
    value: String!
    ts: String!
    commandId: ID
  }

  type Device {
    id: ID!
    name: String!
    type: String!
    location: String
    "Last reported state; null for sensors and for actuators that haven't reported yet."
    state: DeviceState
    "Newest reading for this device + metric (served from Redis when available)."
    latest(metric: String!): Reading
  }

  type Query {
    "Every device, ordered by id."
    devices: [Device!]!

    "Newest reading for a device + metric, or null if there is none yet."
    latest(deviceId: String!, metric: String!): Reading

    "Readings in [from, to], oldest first. Defaults: last 15 minutes, limit 100 (max 1000)."
    history(deviceId: String!, metric: String!, from: String, to: String, limit: Int): [Reading!]!
  }

  type CommandResult {
    "Use this to recognise the confirmation: Device.state.commandId equals it once the device acted."
    id: ID!
    deviceId: String!
    command: String!
    status: String!
  }

  type Mutation {
    "Send on/off to a pump or valve. Returns once the broker has accepted it, not once the device acted."
    sendCommand(deviceId: String!, command: String!): CommandResult!
  }

  type Subscription {
    "Pushed once per stored reading of this metric, from any device."
    readingAdded(metric: String!): Reading!
  }
`;

/** Turn our own validation errors into clean, client-visible GraphQL errors. */
function rethrow(err: unknown): never {
  if (err instanceof InputError) {
    // createGraphQLError uses Yoga's own graphql instance (avoids a dual CJS/ESM copy).
    throw createGraphQLError(err.message, { extensions: { code: 'BAD_USER_INPUT' } });
  }
  throw err;
}

async function guard<T>(fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    return rethrow(err);
  }
}

function unavailable(message: string): never {
  throw createGraphQLError(message, { extensions: { code: 'SERVICE_UNAVAILABLE' } });
}

export function buildSchema(repo: TelemetryRepo, bus: ReadingBus, commands?: CommandPublisher) {
  return createSchema<GraphQLContext>({
    typeDefs,
    resolvers: {
      Query: {
        devices: () => repo.devices(),
        latest: (_: unknown, args: { deviceId: string; metric: string }, ctx: GraphQLContext) =>
          guard(() =>
            ctx.loaders.latest.load({ deviceId: args.deviceId, metric: parseMetric(args.metric) }),
          ),
        history: (_: unknown, args: HistoryArgs) =>
          guard(() => repo.history(validateHistory(args))),
      },
      Mutation: {
        sendCommand: (_: unknown, args: { deviceId: string; command: string }) =>
          guard(async () => {
            const command = parseCommand(args.command);
            if (!commands) return unavailable('Commands are not configured on this server');

            const record = await repo.insertCommand(args.deviceId, command);
            if (!record) {
              throw new InputError(`device not found or cannot be commanded: ${args.deviceId}`);
            }

            const message: CommandMessage = {
              commandId: record.id,
              command,
              ts: new Date().toISOString(),
            };
            try {
              await commands.publish(args.deviceId, message);
            } catch (err) {
              console.warn(
                `command ${record.id} to ${args.deviceId} not sent: ${err instanceof Error ? err.message : err}`,
              );
              // Keep the audit trail honest; never let a logging failure hide the real error.
              await repo.markCommandFailed(record.id).catch(() => undefined);
              return unavailable('Could not reach the device broker; the command was not sent');
            }
            return { id: record.id, deviceId: args.deviceId, command, status: 'sent' };
          }),
      },
      Device: {
        latest: (device: Device, args: { metric: string }, ctx: GraphQLContext) =>
          guard(() =>
            ctx.loaders.latest.load({ deviceId: device.id, metric: parseMetric(args.metric) }),
          ),
      },
      Subscription: {
        readingAdded: {
          subscribe: (_: unknown, args: { metric: string }) => {
            const metric = (() => {
              try {
                return parseMetric(args.metric);
              } catch (err) {
                return rethrow(err);
              }
            })();
            return pipe(
              bus.subscribe('reading'),
              filter((reading: Reading) => reading.metric === metric),
            );
          },
          resolve: (reading: Reading) => reading,
        },
      },
    },
  });
}
