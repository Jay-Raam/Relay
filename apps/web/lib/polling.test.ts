import { describe, expect, it } from 'vitest';
import {
  FAST_POLL_MS,
  PENDING_POLL_MS,
  nextPollDelay,
  PUSH_FRESH_MS,
  pushIsHealthy,
  SLOW_POLL_MS,
  transportLabel,
} from './polling';

const NOW = 1_000_000;

describe('push health & poll cadence', () => {
  it('is healthy only when open AND a recent event arrived', () => {
    expect(pushIsHealthy({ open: true, lastEventAt: NOW - 1000 }, NOW)).toBe(true);
    expect(pushIsHealthy({ open: true, lastEventAt: NOW - PUSH_FRESH_MS }, NOW)).toBe(true);
    expect(pushIsHealthy({ open: true, lastEventAt: NOW - PUSH_FRESH_MS - 1 }, NOW)).toBe(false);
    expect(pushIsHealthy({ open: true, lastEventAt: null }, NOW)).toBe(false);
    expect(pushIsHealthy({ open: false, lastEventAt: NOW - 1000 }, NOW)).toBe(false);
  });

  it('polls slowly with healthy push, quickly otherwise', () => {
    expect(nextPollDelay({ open: true, lastEventAt: NOW }, NOW)).toBe(SLOW_POLL_MS);
    expect(nextPollDelay({ open: false, lastEventAt: null }, NOW)).toBe(FAST_POLL_MS);
    // stream open but silent (e.g. worker down): fall back to fast polling
    expect(nextPollDelay({ open: true, lastEventAt: NOW - 60_000 }, NOW)).toBe(FAST_POLL_MS);
  });

  it('polls fast while a command awaits confirmation, even with healthy push', () => {
    expect(nextPollDelay({ open: true, lastEventAt: NOW }, NOW, true)).toBe(PENDING_POLL_MS);
    expect(nextPollDelay({ open: false, lastEventAt: null }, NOW, true)).toBe(PENDING_POLL_MS);
    expect(nextPollDelay({ open: true, lastEventAt: NOW }, NOW, false)).toBe(SLOW_POLL_MS);
  });

  it('labels the transport', () => {
    const healthy = { open: true, lastEventAt: NOW };
    const closed = { open: false, lastEventAt: null };
    expect(transportLabel(healthy, false, NOW)).toBe('push');
    expect(transportLabel(closed, true, NOW)).toBe('connecting');
    expect(transportLabel(closed, false, NOW)).toBe('polling');
  });
});
