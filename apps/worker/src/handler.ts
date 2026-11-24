import { z } from 'zod';
import { isCommand, isMetric, type Command, type Metric, type Reading } from '@relay/types';

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

/** State topics look like devices/{deviceId}/state. */
const STATE_TOPIC_RE = /^devices\/([^/]+)\/state$/;

/** Which kind of device message a topic carries, or null if we don't handle it. */
export function topicKind(topic: string): 'telemetry' | 'state' | null {
  if (TOPIC_RE.test(topic)) return 'telemetry';
  if (STATE_TOPIC_RE.test(topic)) return 'state';
  return null;
}

/** Shape of a state payload on the wire (deviceId comes from the topic). */
const statePayloadSchema = z.object({
  state: z.string(),
  commandId: z.string().uuid().optional(),
  ts: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), 'ts is not a valid timestamp')
    .optional(),
});

/** An actuator reporting its state, optionally confirming one command. */
export interface StateUpdate {
  deviceId: string;
  state: Command;
  /** The command this confirms, or null for an unprompted report (e.g. on boot). */
  commandId: string | null;
  ts: string;
}

export type ParseStateResult = { ok: true; update: StateUpdate } | { ok: false; error: string };

/** Pure parse + validate of one state message, same contract as parseTelemetry. */
export function parseState(topic: string, payload: string | Buffer): ParseStateResult {
  const match = topic.match(STATE_TOPIC_RE);
  if (!match || !match[1]) return { ok: false, error: `unexpected topic: ${topic}` };
  const deviceId = match[1];

  let json: unknown;
  try {
    json = JSON.parse(payload.toString());
  } catch {
    return { ok: false, error: 'payload is not valid JSON' };
  }

  const parsed = statePayloadSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  const state = parsed.data.state;
  if (!isCommand(state)) return { ok: false, error: `unknown state: ${state}` };

  return {
    ok: true,
    update: {
      deviceId,
      state,
      commandId: parsed.data.commandId ?? null,
      ts: parsed.data.ts ?? new Date().toISOString(),
    },
  };
}
