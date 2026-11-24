import type { Command } from '@relay/types';
import type { DeviceOverview } from './graphql';

/** How long to wait for a device to confirm before telling the user it may be offline. */
export const CONFIRM_TIMEOUT_MS = 5000;

/** A command the broker accepted but the device hasn't confirmed yet. */
export interface PendingCommand {
  commandId: string;
  deviceId: string;
  command: Command;
  /** Epoch ms when the API accepted it. */
  sentAt: number;
}

export type CommandOutcome = 'pending' | 'confirmed' | 'timeout';

/**
 * Has the device confirmed this command? Confirmation is matched by commandId, not by state,
 * so "turn on" while already on is confirmed by the device's answer and not instantly assumed.
 */
export function commandOutcome(
  pending: PendingCommand,
  device: DeviceOverview | undefined,
  now: number,
): CommandOutcome {
  if (device?.state?.commandId === pending.commandId) return 'confirmed';
  return now - pending.sentAt > CONFIRM_TIMEOUT_MS ? 'timeout' : 'pending';
}

export interface Resolution {
  /** Still-pending commands, by deviceId. The same object as the input when nothing changed. */
  pending: Record<string, PendingCommand>;
  confirmed: PendingCommand[];
  timedOut: PendingCommand[];
}

/** Settle every pending command against the latest device list. Pure. */
export function resolvePending(
  pending: Record<string, PendingCommand>,
  devices: DeviceOverview[],
  now: number,
): Resolution {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const remaining: Record<string, PendingCommand> = {};
  const confirmed: PendingCommand[] = [];
  const timedOut: PendingCommand[] = [];

  for (const p of Object.values(pending)) {
    const outcome = commandOutcome(p, byId.get(p.deviceId), now);
    if (outcome === 'pending') remaining[p.deviceId] = p;
    else if (outcome === 'confirmed') confirmed.push(p);
    else timedOut.push(p);
  }

  const changed = confirmed.length > 0 || timedOut.length > 0;
  return { pending: changed ? remaining : pending, confirmed, timedOut };
}

/** What to show for an actuator's state. */
export function stateLabel(device: DeviceOverview): 'ON' | 'OFF' | 'Unknown' {
  if (!device.state) return 'Unknown';
  return device.state.value === 'on' ? 'ON' : 'OFF';
}
