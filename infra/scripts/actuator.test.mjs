import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COMMAND_MAX_AGE_MS, createActuator } from './actuator.mjs';

const NOW = Date.parse('2026-01-01T12:00:00.000Z');
const ID = '3f6c1d1e-8a54-4a0f-9b0b-2f2d3a7c9e11';
const msg = (over = {}) =>
  JSON.stringify({ commandId: ID, command: 'on', ts: new Date(NOW).toISOString(), ...over });

describe('actuator', () => {
  it('starts off and reports it', () => {
    const a = createActuator('dev-004', () => NOW);
    assert.equal(a.state, 'off');
    assert.deepEqual(a.report(), { state: 'off', ts: new Date(NOW).toISOString() });
  });

  it('applies a fresh command and echoes its commandId so the API can confirm it', () => {
    const a = createActuator('dev-004', () => NOW);
    const r = a.handleCommand(msg());
    assert.equal(r.accepted, true);
    assert.equal(r.report.state, 'on');
    assert.equal(r.report.commandId, ID);
    assert.equal(a.state, 'on');
  });

  it('still confirms "on" when already on (same state, new commandId)', () => {
    const a = createActuator('dev-004', () => NOW);
    a.handleCommand(msg());
    const r = a.handleCommand(msg({ commandId: 'second' }));
    assert.equal(r.accepted, true);
    assert.equal(r.report.commandId, 'second');
  });

  it('refuses a stale command and stays put', () => {
    const a = createActuator('dev-004', () => NOW);
    const old = new Date(NOW - COMMAND_MAX_AGE_MS - 1).toISOString();
    const r = a.handleCommand(msg({ ts: old }));
    assert.equal(r.accepted, false);
    assert.match(r.reason, /stale/);
    assert.equal(a.state, 'off');
  });

  it('refuses a command stamped too far in the future', () => {
    const a = createActuator('dev-004', () => NOW);
    const future = new Date(NOW + COMMAND_MAX_AGE_MS + 1).toISOString();
    assert.equal(a.handleCommand(msg({ ts: future })).accepted, false);
  });

  it('accepts a command exactly at the age limit', () => {
    const a = createActuator('dev-004', () => NOW);
    const edge = new Date(NOW - COMMAND_MAX_AGE_MS).toISOString();
    assert.equal(a.handleCommand(msg({ ts: edge })).accepted, true);
  });

  it('refuses a redelivered command older than one it already applied', () => {
    const a = createActuator('dev-004', () => NOW);
    const earlier = new Date(NOW - 5000).toISOString();
    a.handleCommand(msg({ command: 'off', ts: new Date(NOW).toISOString() }));
    const r = a.handleCommand(msg({ command: 'on', ts: earlier, commandId: 'late' }));
    assert.equal(r.accepted, false);
    assert.equal(a.state, 'off');
  });

  for (const [name, raw] of [
    ['not JSON', '{oops'],
    ['no commandId', msg({ commandId: undefined })],
    ['unknown command', msg({ command: 'explode' })],
    ['bad ts', msg({ ts: 'yesterday' })],
    ['null payload', 'null'],
  ]) {
    it(`refuses ${name}`, () => {
      const a = createActuator('dev-004', () => NOW);
      assert.equal(a.handleCommand(raw).accepted, false);
      assert.equal(a.state, 'off');
    });
  }
});
