import { z } from 'zod';
import { isMetric, type Metric, type Reading } from '@relay/types';

/** Telemetry topics look like devices/{deviceId}/telemetry. */
const TOPIC_RE = /^devices\/([^/]+)\/telemetry$/;

/** Shape of a telemetry payload on the wire (deviceId comes from the topic). */
const payloadSchema = z.object({
  metric: z.string(),
  value: z.number().finite(),
  ts: z.string().optional(),
});

export type ParseResult = { ok: true; reading: Reading } | { ok: false; error: string };

/**
 * Pure, side-effect-free parse + validate of one MQTT message into a Reading.
 * Kept separate from the broker/DB so it is trivially unit-testable.
 */
export function parseTelemetry(topic: string, payload: string | Buffer): ParseResult {
  const match = topic.match(TOPIC_RE);
  if (!match || !match[1]) return { ok: false, error: `unexpected topic: ${topic}` };
  const deviceId = match[1];

  let json: unknown;
  try {
    json = JSON.parse(payload.toString());
  } catch {
    return { ok: false, error: 'payload is not valid JSON' };
  }

  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  const metric = parsed.data.metric;
  if (!isMetric(metric)) {
    return { ok: false, error: `unknown metric: ${metric}` };
  }
  const narrowed: Metric = metric;

  return {
    ok: true,
    reading: {
      deviceId,
      metric: narrowed,
      value: parsed.data.value,
      ts: parsed.data.ts ?? new Date().toISOString(),
    },
  };
}
