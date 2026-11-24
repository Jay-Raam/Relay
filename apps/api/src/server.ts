import { createYoga } from 'graphql-yoga';
import type { Cache } from '@relay/cache';
import { createAuth, type Auth, type SessionConfig } from './auth';
import type { ReadingBus } from './bus';
import type { CommandPublisher } from './commands';
import { createLoaders } from './loaders';
import type { TelemetryRepo } from './repo';
import { buildSchema, type GraphQLContext } from './schema';

export interface ServerDeps {
  repo: TelemetryRepo;
  cache: Cache;
  bus: ReadingBus;
  webOrigin: string;
  session: SessionConfig;
  /** Overridable in tests (e.g. to share rate-limit state or read it). */
  auth?: Auth;
  /** Absent when no MQTT broker is configured; sendCommand then reports "not configured". */
  commands?: CommandPublisher;
}

/** Build the Yoga app. Pure construction — no listening, so tests can call .fetch(). */
export function buildYoga({ repo, cache, bus, webOrigin, session, commands, auth }: ServerDeps) {
  const authn = auth ?? createAuth({ repo, session, webOrigin });
  return createYoga<object, GraphQLContext>({
    schema: buildSchema(repo, bus, commands),
    plugins: [authn.plugin],
    // A fresh set of loaders per operation: batching + memoisation never leak between requests.
    // The session is resolved once here; resolvers decide what each role may do.
    context: async ({ request }) => ({
      loaders: createLoaders(repo, cache),
      user: await authn.userFrom(request),
    }),
    graphqlEndpoint: '/graphql',
    // Yoga serves GET /health (200 "OK") out of the box.
    healthCheckEndpoint: '/health',
    // Credentials are needed for the session cookie; the origin must then be one exact value.
    cors: {
      origin: webOrigin,
      credentials: true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['content-type'],
    },
    logging: false,
  });
}
