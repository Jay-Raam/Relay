import { describe, expect, it } from 'vitest';
import type { Overview } from './graphql';
import { applyReading, mergeSnapshot } from './merge';

const t = (s: number) => new Date(Date.UTC(2026, 0, 1, 12, 0, s)).toISOString();
const dev = (id: string, latest: { value: number; ts: string } | null) => ({
  id,
  name: id,
  type: 'sensor',
  location: null,
  latest,
});
const reading = (deviceId: string, value: number, s: number) => ({
  deviceId,
  metric: 'temperature' as const,
  value,
  ts: t(s),
});

const base: Overview = {
  devices: [dev('a', { value: 20, ts: t(10) }), dev('b', null)],
  history: [
    { value: 19, ts: t(8) },
    { value: 20, ts: t(10) },
  ],
};

describe('applyReading', () => {
  it('updates the device latest and appends to the selected device history', () => {
    const next = applyReading(base, reading('a', 21, 12), 'a');
    expect(next.devices[0]?.latest?.value).toBe(21);
    expect(next.history.map((p) => p.value)).toEqual([19, 20, 21]);
  });

  it('updates latest but not history for a device that is not selected', () => {
    const next = applyReading(base, reading('b', 5, 12), 'a');
    expect(next.devices[1]?.latest?.value).toBe(5);
    expect(next.history).toBe(base.history);
  });

  it('ignores out-of-order and duplicate readings (same object back)', () => {
    expect(applyReading(base, reading('a', 99, 5), 'a')).toBe(base);
    expect(applyReading(base, reading('a', 99, 10), 'a')).toBe(base);
  });

  it('ignores devices it does not know', () => {
    expect(applyReading(base, reading('zzz', 1, 12), null)).toBe(base);
  });

  it('caps history to the limit, dropping the oldest', () => {
    const next = applyReading(base, reading('a', 21, 12), 'a', 2);
    expect(next.history.map((p) => p.value)).toEqual([20, 21]);
  });

  it('does not mutate its input', () => {
    const copy = structuredClone(base);
    applyReading(base, reading('a', 21, 12), 'a');
    expect(base).toEqual(copy);
  });
});

describe('mergeSnapshot', () => {
  it('takes the polled snapshot when it is newer', () => {
    const next: Overview = {
      devices: [dev('a', { value: 30, ts: t(20) }), dev('b', { value: 1, ts: t(20) })],
      history: [{ value: 30, ts: t(20) }],
    };
    expect(mergeSnapshot(base, next)).toEqual(next);
  });

  it('never lets a slightly older poll roll a pushed value backwards', () => {
    const pushed = applyReading(base, reading('a', 25, 15), 'a');
    const stalePoll: Overview = {
      devices: [dev('a', { value: 20, ts: t(10) }), dev('b', null)],
      history: base.history,
    };
    const merged = mergeSnapshot(pushed, stalePoll);
    expect(merged.devices[0]?.latest?.value).toBe(25);
    expect(merged.history.map((p) => p.value)).toEqual([19, 20, 25]);
  });

  it('keeps a pushed value when the poll has none for that device yet', () => {
    const pushed = applyReading(base, reading('b', 7, 15), null);
    const merged = mergeSnapshot(pushed, base);
    expect(merged.devices[1]?.latest?.value).toBe(7);
  });

  it('adds newly created devices and drops removed ones', () => {
    const next: Overview = { devices: [dev('c', null)], history: [] };
    expect(mergeSnapshot(base, next).devices.map((d) => d.id)).toEqual(['c']);
  });
});
