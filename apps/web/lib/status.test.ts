import { describe, expect, it } from 'vitest';
import { feedStatus, STALE_AFTER_MS } from './status';

const NOW = Date.parse('2026-01-01T12:00:00.000Z');

describe('feedStatus', () => {
  it('is no-data when there is no reading', () => {
    expect(feedStatus(null, NOW)).toBe('no-data');
    expect(feedStatus(undefined, NOW)).toBe('no-data');
  });

  it('is live for a recent reading', () => {
    expect(feedStatus('2026-01-01T11:59:58.000Z', NOW)).toBe('live');
  });

  it('is live right at the threshold and stale just past it', () => {
    const atLimit = new Date(NOW - STALE_AFTER_MS).toISOString();
    const pastLimit = new Date(NOW - STALE_AFTER_MS - 1).toISOString();
    expect(feedStatus(atLimit, NOW)).toBe('live');
    expect(feedStatus(pastLimit, NOW)).toBe('stale');
  });

  it('treats an unparseable timestamp as stale', () => {
    expect(feedStatus('not-a-date', NOW)).toBe('stale');
  });
});
