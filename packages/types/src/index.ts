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
