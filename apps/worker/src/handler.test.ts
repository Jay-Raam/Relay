import { describe, it, expect } from 'vitest';
import { parseTelemetry } from './handler';

const TOPIC = 'devices/dev-001/telemetry';

describe('parseTelemetry', () => {
  it('parses a valid message and takes deviceId from the topic', () => {
    const result = parseTelemetry(
      TOPIC,
      JSON.stringify({ metric: 'temperature', value: 22.5, ts: '2026-11-22T10:00:00.000Z' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reading).toEqual({
        deviceId: 'dev-001',
        metric: 'temperature',
        value: 22.5,
        ts: '2026-11-22T10:00:00.000Z',
      });
    }
  });

  it('defaults ts to now when the payload omits it', () => {
    const result = parseTelemetry(TOPIC, JSON.stringify({ metric: 'flow', value: 3 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(typeof result.reading.ts).toBe('string');
  });

  it('rejects an unknown metric', () => {
    const result = parseTelemetry(TOPIC, JSON.stringify({ metric: 'pressure', value: 1 }));
    expect(result).toEqual({ ok: false, error: 'unknown metric: pressure' });
  });

  it('rejects a non-numeric value', () => {
    const result = parseTelemetry(TOPIC, JSON.stringify({ metric: 'temperature', value: 'hot' }));
    expect(result.ok).toBe(false);
  });

  it('rejects a malformed topic', () => {
    const result = parseTelemetry(
      'garbage/topic',
      JSON.stringify({ metric: 'temperature', value: 1 }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a non-JSON payload', () => {
    const result = parseTelemetry(TOPIC, 'not json');
    expect(result).toEqual({ ok: false, error: 'payload is not valid JSON' });
  });
});
