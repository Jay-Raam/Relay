/**
 * A simulated pump / valve: the decision logic, kept free of MQTT so it can be unit-tested.
 *
 * A real controller must be at least this careful, because a command is a physical action:
 *   - drop commands that are too old (a "pump on" delivered minutes late is a surprise),
 *   - drop commands from before the one it already applied (out-of-order redelivery),
 *   - drop anything malformed.
 */

// Keep in sync with COMMAND_MAX_AGE_MS in packages/types (this file is plain JS, so no import).
export const COMMAND_MAX_AGE_MS = 30_000;

const COMMANDS = ['on', 'off'];

/**
 * @param {string} deviceId
 * @param {() => number} [now] epoch ms; injectable for tests
 */
export function createActuator(deviceId, now = Date.now) {
  let state = 'off';
  let lastAppliedTs = -Infinity;

  return {
    deviceId,

    get state() {
      return state;
    },

    /** An unprompted report of the current state (sent on boot). */
    report() {
      return { state, ts: new Date(now()).toISOString() };
    },

    /**
     * Handle one raw command payload.
     * @param {string | Buffer} raw
     * @returns {{ accepted: true, report: { state: string, commandId: string, ts: string } }
     *   | { accepted: false, reason: string }}
     */
    handleCommand(raw) {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return { accepted: false, reason: 'not valid JSON' };
      }

      const { commandId, command, ts } = message ?? {};
      if (typeof commandId !== 'string' || commandId === '') {
        return { accepted: false, reason: 'missing commandId' };
      }
      if (!COMMANDS.includes(command)) {
        return { accepted: false, reason: `unknown command: ${command}` };
      }
      const issuedAt = typeof ts === 'string' ? Date.parse(ts) : NaN;
      if (Number.isNaN(issuedAt)) return { accepted: false, reason: 'invalid ts' };

      // Too old, or so far in the future that the clocks cannot be trusted.
      if (Math.abs(now() - issuedAt) > COMMAND_MAX_AGE_MS) {
        return { accepted: false, reason: 'stale command (check clocks)' };
      }
      if (issuedAt < lastAppliedTs) {
        return { accepted: false, reason: 'older than the last applied command' };
      }

      state = command;
      lastAppliedTs = issuedAt;
      return {
        accepted: true,
        report: { state, commandId, ts: new Date(now()).toISOString() },
      };
    },
  };
}
