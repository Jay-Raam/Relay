import type { Reading } from '@relay/types';
import type { DeviceOverview, Overview, Point } from './graphql';

/** Chart window: how many points of the selected device we keep. */
export const HISTORY_POINTS = 60;

function newer(a: string, b: string): boolean {
  return Date.parse(a) > Date.parse(b);
}

/**
 * Apply one pushed reading. Pure: returns the same object when nothing changed, so React
 * can skip a re-render. Readings for devices we don't know yet are ignored — the next
 * poll brings the new device in.
 */
export function applyReading(
  state: Overview,
  reading: Reading,
  selectedId: string | null,
  limit: number = HISTORY_POINTS,
): Overview {
  const point: Point = { value: reading.value, ts: reading.ts };
  let changed = false;

  const devices = state.devices.map((d): DeviceOverview => {
    if (d.id !== reading.deviceId) return d;
    if (d.latest && !newer(point.ts, d.latest.ts)) return d; // out-of-order / duplicate
    changed = true;
    return { ...d, latest: point };
  });

  let history = state.history;
  if (reading.deviceId === selectedId) {
    const last = history[history.length - 1];
    if (!last || newer(point.ts, last.ts)) {
      history = [...history, point].slice(-limit);
      changed = true;
    }
  }

  return changed ? { devices, history } : state;
}

/**
 * Fold a freshly polled snapshot into what the screen already shows. A push can arrive
 * while a poll is in flight; the poll's answer may then be a moment older, and must not
 * make a value jump backwards.
 */
export function mergeSnapshot(
  prev: Overview,
  next: Overview,
  limit: number = HISTORY_POINTS,
): Overview {
  const prevById = new Map(prev.devices.map((d) => [d.id, d]));
  const devices = next.devices.map((d): DeviceOverview => {
    const old = prevById.get(d.id)?.latest;
    return old && (!d.latest || newer(old.ts, d.latest.ts)) ? { ...d, latest: old } : d;
  });

  const lastNext = next.history[next.history.length - 1];
  const extra = prev.history.filter((p) => !lastNext || newer(p.ts, lastNext.ts));
  return { devices, history: [...next.history, ...extra].slice(-limit) };
}
