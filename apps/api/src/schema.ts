import { createGraphQLError, createSchema } from 'graphql-yoga';
import type { TelemetryRepo } from './repo';
import { InputError, parseMetric, validateHistory, type HistoryArgs } from './validate';

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

  type Query {
    "Newest reading for a device + metric, or null if there is none yet."
    latest(deviceId: String!, metric: String!): Reading

    "Readings in [from, to], oldest first. Defaults: last 15 minutes, limit 100 (max 1000)."
    history(deviceId: String!, metric: String!, from: String, to: String, limit: Int): [Reading!]!
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

export function buildSchema(repo: TelemetryRepo) {
  return createSchema({
    typeDefs,
    resolvers: {
      Query: {
        latest: async (_: unknown, args: { deviceId: string; metric: string }) => {
          try {
            return await repo.latest(args.deviceId, parseMetric(args.metric));
          } catch (err) {
            return rethrow(err);
          }
        },
        history: async (_: unknown, args: HistoryArgs) => {
          try {
            return await repo.history(validateHistory(args));
          } catch (err) {
            return rethrow(err);
          }
        },
      },
    },
  });
}
