/**
 * @relay/types — the single source of truth for the core domain types.
 *
 * The same `Reading` type flows from the database query → GraphQL resolver →
 * React component, so a schema change surfaces as a compile error, not a runtime
 * bug. Keep this package free of runtime dependencies.
 */

/** Telemetry metrics Relay understands in Phase 1. Extend as devices grow. */
export const METRICS = ['temperature', 'humidity', 'moisture', 'flow'] as const;

/** A single supported metric name. */
export type Metric = (typeof METRICS)[number];

/** One telemetry sample from a device. `ts` is an ISO-8601 timestamp (UTC). */
export interface Reading {
  deviceId: string;
  metric: Metric;
  value: number;
  ts: string;
}

/** Device kinds in the fleet. */
export type DeviceType = 'pump' | 'valve' | 'sensor';

/** A device in the fleet (slow-changing relational data). */
export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  location: string | null;
}

/** Runtime guard: is `value` one of the known metrics? Used by the worker to
 *  drop/flag unknown metrics before they reach the database. */
export function isMetric(value: string): value is Metric {
  return (METRICS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Commands (Phase 3): dashboard -> API -> MQTT -> device, confirmed by a state
// message coming back the other way.
//
//   API    publishes  devices/{id}/commands   { commandId, command, ts }
//   device publishes  devices/{id}/state      { state, commandId?, ts? }
//
// The commandId ties a confirmation to the exact command that caused it, so
// "turn on" while already on is still confirmed correctly.
// ---------------------------------------------------------------------------

/** Commands an actuator (pump / valve) accepts. */
export const COMMANDS = ['on', 'off'] as const;

/** A single supported command. */
export type Command = (typeof COMMANDS)[number];

/** Runtime guard: is `value` a known command? */
export function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value);
}

/** Device types that can be commanded (sensors only report). */
export const ACTUATOR_TYPES: readonly DeviceType[] = ['pump', 'valve'];

/** Can a device of this type be commanded? */
export function isActuator(type: string): boolean {
  return (ACTUATOR_TYPES as readonly string[]).includes(type);
}

/** The last state an actuator reported. `commandId` is the command it confirms, if any. */
export interface DeviceState {
  value: Command;
  ts: string;
  commandId: string | null;
}

/** What the API publishes to a device. A device must ignore stale ones (see COMMAND_MAX_AGE_MS). */
export interface CommandMessage {
  commandId: string;
  command: Command;
  /** ISO-8601 UTC time the command was issued. */
  ts: string;
}

/** A command older than this must not be executed: a late-delivered "pump on" is dangerous. */
export const COMMAND_MAX_AGE_MS = 30_000;

/** MQTT topic the API publishes commands to for one device. */
export function commandTopic(deviceId: string): string {
  return `devices/${deviceId}/commands`;
}

/** MQTT topic a device reports its state on. */
export function stateTopic(deviceId: string): string {
  return `devices/${deviceId}/state`;
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/**
 * What an account may do. `viewer` can read everything; `operator` can also command devices.
 */
export const ROLES = ['viewer', 'operator'] as const;

/** A single account role. */
export type Role = (typeof ROLES)[number];

/** Runtime guard: is `value` a known role? */
export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** The signed-in account, as the API and the dashboard see it (never includes the password). */
export interface SessionUser {
  id: string;
  email: string;
  role: Role;
}
