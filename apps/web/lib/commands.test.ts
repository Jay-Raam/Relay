import { describe, expect, it } from 'vitest';
import {
  CONFIRM_TIMEOUT_MS,
  commandOutcome,
  resolvePending,
  stateLabel,
  type PendingCommand,
} from './commands';
import type { DeviceOverview } from './graphql';

const SENT_AT = 1_000_000;
const pending = (over: Partial<PendingCommand> = {}): PendingCommand => ({
  commandId: 'c-1',
  deviceId: 'dev-004',
  command: 'on',
  sentAt: SENT_AT,
  ...over,
});
const pump = (state: DeviceOverview['state']): DeviceOverview => ({
  id: 'dev-004',
  name: 'Pump',
  type: 'pump',
  location: null,
  latest: null,
  state,
});
const on = (commandId: string | null) => ({ value: 'on' as const, ts: 't', commandId });

describe('commandOutcome', () => {
  it('is pending until the device answers with this commandId', () => {
    expect(commandOutcome(pending(), pump(null), SENT_AT + 100)).toBe('pending');
    expect(commandOutcome(pending(), pump(on('older-command')), SENT_AT + 100)).toBe('pending');
  });

  it('is confirmed when the device state carries the commandId', () => {
    expect(commandOutcome(pending(), pump(on('c-1')), SENT_AT + 100)).toBe('confirmed');
  });

  it('is NOT confirmed just because the device is already in the requested state', () => {
    // pump was already on; "on" again must wait for its own confirmation
    expect(commandOutcome(pending(), pump(on(null)), SENT_AT + 100)).toBe('pending');
  });

  it('times out after the confirmation window, but not before', () => {
    expect(commandOutcome(pending(), pump(null), SENT_AT + CONFIRM_TIMEOUT_MS)).toBe('pending');
    expect(commandOutcome(pending(), pump(null), SENT_AT + CONFIRM_TIMEOUT_MS + 1)).toBe('timeout');
  });

  it('prefers confirmation over timeout when both are true', () => {
    expect(commandOutcome(pending(), pump(on('c-1')), SENT_AT + 60_000)).toBe('confirmed');
  });

  it('times out when the device has vanished from the list', () => {
    expect(commandOutcome(pending(), undefined, SENT_AT + CONFIRM_TIMEOUT_MS + 1)).toBe('timeout');
  });
});

describe('resolvePending', () => {
  it('returns the same object when nothing changed', () => {
    const input = { 'dev-004': pending() };
    const r = resolvePending(input, [pump(null)], SENT_AT + 100);
    expect(r.pending).toBe(input);
    expect(r.confirmed).toEqual([]);
    expect(r.timedOut).toEqual([]);
  });

  it('drops confirmed and timed-out commands and reports them', () => {
    const input = {
      'dev-004': pending(),
      'dev-005': pending({ deviceId: 'dev-005', commandId: 'c-2' }),
    };
    const valve: DeviceOverview = { ...pump(null), id: 'dev-005', type: 'valve' };
    const r = resolvePending(input, [pump(on('c-1')), valve], SENT_AT + CONFIRM_TIMEOUT_MS + 1);
    expect(r.pending).toEqual({});
    expect(r.confirmed.map((p) => p.commandId)).toEqual(['c-1']);
    expect(r.timedOut.map((p) => p.commandId)).toEqual(['c-2']);
  });

  it('keeps the still-waiting ones', () => {
    const input = {
      'dev-004': pending(),
      'dev-005': pending({ deviceId: 'dev-005', commandId: 'c-2' }),
    };
    const valve: DeviceOverview = { ...pump(null), id: 'dev-005', type: 'valve' };
    const r = resolvePending(input, [pump(on('c-1')), valve], SENT_AT + 100);
    expect(Object.keys(r.pending)).toEqual(['dev-005']);
  });
});

describe('stateLabel', () => {
  it('labels on, off and unknown', () => {
    expect(stateLabel(pump(on('x')))).toBe('ON');
    expect(stateLabel(pump({ value: 'off', ts: 't', commandId: null }))).toBe('OFF');
    expect(stateLabel(pump(null))).toBe('Unknown');
  });
});
