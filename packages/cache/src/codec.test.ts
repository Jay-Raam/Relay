import { describe, expect, it } from 'vitest';
import type { Reading } from '@relay/types';
import { decodeReading, encodeReading, latestKey } from './codec';

const READING: Reading = {
  deviceId: 'dev-001',
  metric: 'temperature',
  value: 22.5,
  ts: '2026-01-01T12:00:00.000Z',
};

describe('codec', () => {
  it('round-trips a reading', () => {
    expect(decodeReading(encodeReading(READING))).toEqual(READING);
  });

  it('builds a stable, namespaced key', () => {
    expect(latestKey('dev-001', 'temperature')).toBe('relay:latest:temperature:dev-001');
  });

  it('returns null for missing or malformed values', () => {
    expect(decodeReading(null)).toBeNull();
    expect(decodeReading('')).toBeNull();
    expect(decodeReading('not json')).toBeNull();
    expect(decodeReading('123')).toBeNull();
    expect(decodeReading('null')).toBeNull();
  });

  it('rejects wrong shapes, unknown metrics and non-finite values', () => {
    expect(decodeReading(JSON.stringify({ ...READING, metric: 'pressure' }))).toBeNull();
    expect(decodeReading(JSON.stringify({ ...READING, value: 'hot' }))).toBeNull();
    expect(decodeReading(JSON.stringify({ ...READING, value: null }))).toBeNull();
    expect(decodeReading(JSON.stringify({ deviceId: 'x' }))).toBeNull();
  });
});
