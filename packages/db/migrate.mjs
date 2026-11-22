#!/usr/bin/env node
/**
 * Zero-config migration runner for Relay.
 *
 *   node migrate.mjs           apply any pending migrations
 *   node migrate.mjs --seed    apply migrations, then run seed.sql
 *
 * Reads DATABASE_URL from the environment, falling back to the repo-root .env.
 * Each migration runs in its own transaction and is recorded in
 * schema_migrations, so re-running is safe (already-applied files are skipped).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, 'migrations');

/** DATABASE_URL from env, or a minimal parse of the repo-root .env. */
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = join(here, '..', '..', '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, '');
    }
  }
  return null;
}

const url = databaseUrl();
if (!url) {
  console.error('✗ DATABASE_URL is not set (checked env and repo-root .env).');
  process.exit(1);
}

const seed = process.argv.includes('--seed');
const client = new pg.Client({ connectionString: url });

async function main() {
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const applied = new Set(
    (await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`· skip ${file} (already applied)`);
      continue;
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`› applying ${file}…`);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      count += 1;
      console.log(`✓ applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${err.message}`);
    }
  }
  console.log(count ? `✓ ${count} migration(s) applied.` : '✓ database already up to date.');

  if (seed) {
    const seedPath = join(here, 'seed.sql');
    if (existsSync(seedPath)) {
      console.log('› seeding…');
      await client.query(readFileSync(seedPath, 'utf8'));
      console.log('✓ seed applied');
    } else {
      console.log('· no seed.sql found, skipping seed');
    }
  }
}

main()
  .catch((err) => {
    console.error(`✗ ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => client.end());
