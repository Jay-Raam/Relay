import { createServer } from 'node:http';
import { config } from './config';
import { createPgRepo } from './repo';
import { buildYoga } from './server';

const repo = createPgRepo(config.DATABASE_URL);
const yoga = buildYoga(repo, config.WEB_ORIGIN);
const server = createServer(yoga);

server.listen(config.PORT, () => {
  console.log(`api ready: http://localhost:${config.PORT}/graphql  (health: /health)`);
});

// Graceful shutdown: stop accepting requests, then drain the DB pool.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\nshutting down…');
    server.close(() => {
      void repo.close().finally(() => process.exit(0));
    });
  });
}
