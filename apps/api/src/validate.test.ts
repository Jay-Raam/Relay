import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMIT,
  DEFAULT_WINDOW_MS,
  InputError,
  MAX_LIMIT,
  validateHistory,
} from './validate';

const NOW = new Date('2026-01-01T12:00:00.000Z');

describe('validateHistory', () => {
  it('applies defaults: last 15 minutes, limit 100', () => {
    const q = validateHistory({ deviceId: 'dev-001', metric: 'temperature' }, NOW);
    expect(q.to).toBe(NOW.toISOString());
    expect(q.from).toBe(new Date(NOW.getTime() - DEFAULT_WINDOW_MS).toISOString());
    expect(q.limit).toBe(DEFAULT_LIMIT);
  });

  it('clamps limit to 1..MAX_LIMIT', () => {
    const base = { deviceId: 'dev-001', metric: 'temperature' };
    expect(validateHistory({ ...base, limit: 999999 }, NOW).limit).toBe(MAX_LIMIT);
    expect(validateHistory({ ...base, limit: 0 }, NOW).limit).toBe(1);
    expect(validateHistory({ ...base, limit: -5 }, NOW).limit).toBe(1);
  });

  it('rejects an unknown metric', () => {
    expect(() => validateHistory({ deviceId: 'd', metric: 'pressure' }, NOW)).toThrow(InputError);
  });

  it('rejects an invalid date', () => {
    expect(() =>
      validateHistory({ deviceId: 'd', metric: 'temperature', from: 'yesterday-ish' }, NOW),
    ).toThrow(/valid ISO-8601/);
  });

  it('rejects from after to', () => {
    expect(() =>
      validateHistory(
        {
          deviceId: 'd',
          metric: 'temperature',
          from: '2026-01-02T00:00:00Z',
          to: '2026-01-01T00:00:00Z',
        },
        NOW,
      ),
    ).toThrow(/from must not be after to/);
  });
});
