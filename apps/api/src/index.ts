import { createServer } from 'node:http';
import { createCache } from '@relay/cache';
import { createReadingBus } from './bus';
import { config } from './config';
import { createPgRepo } from './repo';
import { buildYoga } from './server';

const repo = createPgRepo(config.DATABASE_URL);
const cache = createCache(config.REDIS_URL || undefined);
const bus = createReadingBus();

// Bridge: readings the worker publishes to Redis -> in-process bus -> SSE subscribers.
// Without Redis there is nothing to bridge; clients then fall back to polling.
if (cache.enabled) {
  await cache.subscribeReadings((reading) => bus.publish('reading', reading));
}

const yoga = buildYoga({ repo, cache, bus, webOrigin: config.WEB_ORIGIN });
const server = createServer(yoga);

server.listen(config.PORT, () => {
  const mode = cache.enabled ? 'redis cache + live push' : 'no redis (db reads, polling)';
  console.log(`api ready: http://localhost:${config.PORT}/graphql  (${mode}; health: /health)`);
});

// Graceful shutdown: stop accepting requests, then drain the DB pool and Redis.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\nshutting down…');
    server.close(() => {
      void Promise.all([repo.close(), cache.close()]).finally(() => process.exit(0));
    });
    // SSE connections never end on their own; don't wait for them.
    server.closeAllConnections();
  });
}
