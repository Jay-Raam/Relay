import { describe, expect, it } from 'vitest';
import type { Reading } from '@relay/types';
import { parseLiveEvent, subscribeToReadings, type LiveState } from './live';

const GOOD = {
  data: {
    readingAdded: {
      deviceId: 'dev-001',
      metric: 'temperature',
      value: 24.5,
      ts: '2026-01-01T12:00:00Z',
    },
  },
};

describe('parseLiveEvent', () => {
  it('parses a valid reading', () => {
    expect(parseLiveEvent(JSON.stringify(GOOD))).toEqual(GOOD.data.readingAdded);
  });

  it.each([
    ['not json', '{oops'],
    ['no data', JSON.stringify({})],
    ['null payload', JSON.stringify({ data: { readingAdded: null } })],
    [
      'unknown metric',
      JSON.stringify({ data: { readingAdded: { ...GOOD.data.readingAdded, metric: 'pressure' } } }),
    ],
    [
      'string value',
      JSON.stringify({ data: { readingAdded: { ...GOOD.data.readingAdded, value: '24' } } }),
    ],
    [
      'bad timestamp',
      JSON.stringify({ data: { readingAdded: { ...GOOD.data.readingAdded, ts: 'yesterday' } } }),
    ],
  ])('rejects %s', (_name, raw) => {
    expect(parseLiveEvent(raw)).toBeNull();
  });
});

/** Minimal EventSource stand-in that lets a test fire events by hand. */
class FakeEventSource {
  static last: FakeEventSource | undefined;
  closed = false;
  private handlers = new Map<string, ((e: unknown) => void)[]>();
  constructor(public url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data?: string) {
    for (const fn of this.handlers.get(type) ?? []) fn({ data });
  }
}

function setup() {
  const readings: Reading[] = [];
  const states: LiveState[] = [];
  const stop = subscribeToReadings('http://api/graphql', 'temperature', {
    onReading: (r) => readings.push(r),
    onState: (s) => states.push(s),
    eventSourceImpl: FakeEventSource as unknown as typeof EventSource,
  });
  const es = FakeEventSource.last as FakeEventSource;
  return { readings, states, stop, es };
}

describe('subscribeToReadings', () => {
  it('opens a GET with the subscription query and metric variable', () => {
    const { es } = setup();
    const url = new URL(es.url);
    expect(url.origin + url.pathname).toBe('http://api/graphql');
    expect(url.searchParams.get('query')).toContain('readingAdded');
    expect(JSON.parse(url.searchParams.get('variables') ?? '{}')).toEqual({
      metric: 'temperature',
    });
  });

  it('reports connecting -> open -> error', () => {
    const { states, es } = setup();
    es.emit('open');
    es.emit('error');
    expect(states).toEqual(['connecting', 'open', 'error']);
  });

  it('delivers valid next events and silently drops junk', () => {
    const { readings, es } = setup();
    es.emit('next', JSON.stringify(GOOD));
    es.emit('next', 'garbage');
    es.emit(
      'next',
      JSON.stringify({ data: { readingAdded: { ...GOOD.data.readingAdded, metric: 'humidity' } } }),
    );
    expect(readings).toHaveLength(1);
    expect(readings[0]?.value).toBe(24.5);
  });

  it('closes the stream when stopped', () => {
    const { stop, es } = setup();
    stop();
    expect(es.closed).toBe(true);
  });

  it('reports an error (and does not throw) when EventSource is unavailable', () => {
    const states: LiveState[] = [];
    const stop = subscribeToReadings('http://api/graphql', 'temperature', {
      onReading: () => {},
      onState: (s) => states.push(s),
      eventSourceImpl: undefined,
    });
    // jsdom/node has no global EventSource in vitest's node env
    expect(states.at(-1)).toBe('error');
    expect(() => stop()).not.toThrow();
  });
});
