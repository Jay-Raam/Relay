import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Load the repo-root .env into process.env (without overriding real env vars). */
function loadDotEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = join(here, '..', '..', '..', '.env'); // apps/api/src -> repo root
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    const key = match?.[1];
    const rawValue = match?.[2];
    if (key !== undefined && rawValue !== undefined && process.env[key] === undefined) {
      process.env[key] = rawValue.replace(/^["']|["']$/g, '');
    }
  }
}

loadDotEnv();

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
});

// Validate env on boot — a missing/bad var crashes at startup, not at 2am.
export const config = schema.parse(process.env);
