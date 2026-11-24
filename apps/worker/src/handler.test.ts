import { describe, it, expect } from 'vitest';
import { parseState, parseTelemetry, topicKind } from './handler';

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

describe('topicKind', () => {
  it('classifies telemetry and state topics, and rejects the rest', () => {
    expect(topicKind('devices/dev-001/telemetry')).toBe('telemetry');
    expect(topicKind('devices/dev-004/state')).toBe('state');
    expect(topicKind('devices/dev-004/commands')).toBeNull(); // the worker never reads commands
    expect(topicKind('other/dev-001/telemetry')).toBeNull();
  });
});

describe('parseState', () => {
  const ID = '3f6c1d1e-8a54-4a0f-9b0b-2f2d3a7c9e11';

  it('parses a state that confirms a command', () => {
    const r = parseState(
      'devices/dev-004/state',
      JSON.stringify({ state: 'on', commandId: ID, ts: '2026-01-01T12:00:00.000Z' }),
    );
    expect(r).toEqual({
      ok: true,
      update: { deviceId: 'dev-004', state: 'on', commandId: ID, ts: '2026-01-01T12:00:00.000Z' },
    });
  });

  it('accepts an unprompted report (no commandId) and fills in the time', () => {
    const r = parseState('devices/dev-004/state', JSON.stringify({ state: 'off' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.update.commandId).toBeNull();
      expect(Number.isNaN(Date.parse(r.update.ts))).toBe(false);
    }
  });

  it.each([
    ['wrong topic', 'devices/dev-004/telemetry', JSON.stringify({ state: 'on' })],
    ['not JSON', 'devices/dev-004/state', '{oops'],
    ['unknown state', 'devices/dev-004/state', JSON.stringify({ state: 'exploding' })],
    ['missing state', 'devices/dev-004/state', JSON.stringify({})],
    ['bad commandId', 'devices/dev-004/state', JSON.stringify({ state: 'on', commandId: '123' })],
    ['bad timestamp', 'devices/dev-004/state', JSON.stringify({ state: 'on', ts: 'yesterday' })],
  ])('rejects %s', (_name, topic, payload) => {
    expect(parseState(topic, payload).ok).toBe(false);
  });
});
