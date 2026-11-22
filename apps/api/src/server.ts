import { createYoga } from 'graphql-yoga';
import type { TelemetryRepo } from './repo';
import { buildSchema } from './schema';

/** Build the Yoga app. Pure construction — no listening, so tests can call .fetch(). */
export function buildYoga(repo: TelemetryRepo, webOrigin: string) {
  return createYoga({
    schema: buildSchema(repo),
    graphqlEndpoint: '/graphql',
    // Yoga serves GET /health (200 "OK") out of the box.
    healthCheckEndpoint: '/health',
    cors: { origin: webOrigin, methods: ['GET', 'POST', 'OPTIONS'] },
    logging: false,
  });
}
