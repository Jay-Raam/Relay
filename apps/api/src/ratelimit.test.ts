import { describe, expect, it } from 'vitest';
import { createFailureLimiter } from './ratelimit';

function limiter(max = 3, windowMs = 60_000) {
  const clock = { t: 1_000_000 };
  return { clock, l: createFailureLimiter({ max, windowMs, now: () => clock.t }) };
}

describe('createFailureLimiter', () => {
  it('allows attempts until `max` failures, then blocks with a retry time', () => {
    const { l } = limiter(3);
    for (let i = 0; i < 2; i++) {
      expect(l.retryAfter('a')).toBe(0);
      l.fail('a');
    }
    expect(l.retryAfter('a')).toBe(0);
    l.fail('a');
    expect(l.retryAfter('a')).toBeGreaterThan(0);
  });

  it('unblocks once the oldest failure leaves the window', () => {
    const { l, clock } = limiter(2, 60_000);
    l.fail('a');
    clock.t += 10_000;
    l.fail('a');
    expect(l.retryAfter('a')).toBe(50);
    clock.t += 50_000;
    expect(l.retryAfter('a')).toBe(0);
  });

  it('tracks keys independently and reset() clears one', () => {
    const { l } = limiter(1);
    l.fail('a');
    expect(l.retryAfter('a')).toBeGreaterThan(0);
    expect(l.retryAfter('b')).toBe(0);
    l.reset('a');
    expect(l.retryAfter('a')).toBe(0);
  });

  it('does not grow without bound under a flood of distinct keys', () => {
    const { l } = limiter(1);
    for (let i = 0; i < 12_000; i++) l.fail(`k${i}`);
    expect(l.retryAfter('k0')).toBe(0); // oldest were evicted
    expect(l.retryAfter('k11999')).toBeGreaterThan(0);
  });
});
