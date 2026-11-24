/** Poll often when push isn't delivering; just resync occasionally when it is. */
export const FAST_POLL_MS = 2000;
export const SLOW_POLL_MS = 30_000;
/** While a command awaits its confirmation, check quickly so the UI reacts promptly. */
export const PENDING_POLL_MS = 500;
/** Push counts as healthy if the last event arrived within this window. */
export const PUSH_FRESH_MS = 10_000;

export interface PushHealth {
  /** The SSE stream is currently open. */
  open: boolean;
  /** Epoch ms of the last pushed reading, or null if none yet. */
  lastEventAt: number | null;
}

/** Is live push actually delivering data right now? */
export function pushIsHealthy(h: PushHealth, now: number): boolean {
  return h.open && h.lastEventAt !== null && now - h.lastEventAt <= PUSH_FRESH_MS;
}

export function nextPollDelay(h: PushHealth, now: number, hasPendingCommand = false): number {
  // Command confirmations arrive via the database, not the push stream, so poll fast.
  if (hasPendingCommand) return PENDING_POLL_MS;
  return pushIsHealthy(h, now) ? SLOW_POLL_MS : FAST_POLL_MS;
}

export type Transport = 'push' | 'polling' | 'connecting';

/** What to tell the user about how data is arriving. */
export function transportLabel(h: PushHealth, connecting: boolean, now: number): Transport {
  if (pushIsHealthy(h, now)) return 'push';
  return connecting ? 'connecting' : 'polling';
}
