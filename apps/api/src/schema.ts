import { createGraphQLError, createSchema, filter, pipe } from 'graphql-yoga';
import type { Device, Reading } from '@relay/types';
import type { ReadingBus } from './bus';
import type { Loaders } from './loaders';
import type { TelemetryRepo } from './repo';
import { InputError, parseMetric, validateHistory, type HistoryArgs } from './validate';

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

  type Device {
    id: ID!
    name: String!
    type: String!
    location: String
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

export function buildSchema(repo: TelemetryRepo, bus: ReadingBus) {
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
