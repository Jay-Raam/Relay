import { isCommand, isMetric, type Command, type Metric } from '@relay/types';

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 1000;
/** When `from` is omitted, history looks back this far from `to`. */
export const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

/** A user-facing input problem (becomes a clean GraphQL error, not a 500). */
export class InputError extends Error {}

export interface HistoryArgs {
  deviceId: string;
  metric: string;
  from?: string | null;
  to?: string | null;
  limit?: number | null;
}

export interface HistoryQuery {
  deviceId: string;
  metric: Metric;
  from: string;
  to: string;
  limit: number;
}

export function parseMetric(metric: string): Metric {
  if (!isMetric(metric)) throw new InputError(`unknown metric: ${metric}`);
  return metric;
}

function parseDate(label: string, value: string): Date {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new InputError(`${label} is not a valid ISO-8601 date: ${value}`);
  return new Date(ms);
}

/** Validate + normalise `history` arguments. `now` is injectable for tests. */
export function validateHistory(args: HistoryArgs, now: Date = new Date()): HistoryQuery {
  const metric = parseMetric(args.metric);
  const to = args.to ? parseDate('to', args.to) : now;
  const from = args.from
    ? parseDate('from', args.from)
    : new Date(to.getTime() - DEFAULT_WINDOW_MS);
  if (from.getTime() > to.getTime()) throw new InputError('from must not be after to');

  const requested = args.limit ?? DEFAULT_LIMIT;
  const limit = Math.min(Math.max(Math.trunc(requested), 1), MAX_LIMIT);

  return {
    deviceId: args.deviceId,
    metric,
    from: from.toISOString(),
    to: to.toISOString(),
    limit,
  };
}

export function parseCommand(command: string): Command {
  if (!isCommand(command)) throw new InputError(`unknown command: ${command}`);
  return command;
}
