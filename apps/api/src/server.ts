import { createYoga } from 'graphql-yoga';
import type { Cache } from '@relay/cache';
import type { ReadingBus } from './bus';
import { createLoaders } from './loaders';
import type { TelemetryRepo } from './repo';
import { buildSchema, type GraphQLContext } from './schema';

export interface ServerDeps {
  repo: TelemetryRepo;
  cache: Cache;
  bus: ReadingBus;
  webOrigin: string;
}

/** Build the Yoga app. Pure construction — no listening, so tests can call .fetch(). */
export function buildYoga({ repo, cache, bus, webOrigin }: ServerDeps) {
  return createYoga<object, GraphQLContext>({
    schema: buildSchema(repo, bus),
    // A fresh set of loaders per operation: batching + memoisation never leak between requests.
    context: () => ({ loaders: createLoaders(repo, cache) }),
    graphqlEndpoint: '/graphql',
    // Yoga serves GET /health (200 "OK") out of the box.
    healthCheckEndpoint: '/health',
    cors: { origin: webOrigin, methods: ['GET', 'POST', 'OPTIONS'] },
    logging: false,
  });
}
