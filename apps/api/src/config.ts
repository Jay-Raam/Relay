import { z } from 'zod';
import { loadDotEnv } from './env';

loadDotEnv();

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  // Optional: without Redis, `latest` reads the database and live push is off (clients poll).
  REDIS_URL: z.string().optional(),
  // Optional: without an MQTT broker the API still serves data; sendCommand reports "not configured".
  MQTT_URL: z.string().optional(),
  MQTT_USERNAME: z.string().optional(),
  MQTT_PASSWORD: z.string().optional(),
  // Signs session cookies. Required, no default: a guessable default would let anyone forge a
  // session. Generate one: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .positive()
    .max(24 * 30)
    .default(12),
  // Defaults to true when WEB_ORIGIN is https. Needed for cookies over plain http on localhost: false.
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  // Use `none` only when the web app and API are on different sites (it requires https).
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
});

// Validate env on boot — a missing/bad var crashes at startup, not at 2am.
export const config = schema.parse(process.env);
