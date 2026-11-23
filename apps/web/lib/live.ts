import { isMetric, type Metric, type Reading } from '@relay/types';

export type LiveState = 'connecting' | 'open' | 'error';

export interface LiveOptions {
  onReading: (reading: Reading) => void;
  onState?: (state: LiveState) => void;
  /** Injectable for tests; defaults to the browser's EventSource. */
  eventSourceImpl?: typeof EventSource;
}

const SUBSCRIPTION = /* GraphQL */ `
  subscription Live($metric: String!) {
    readingAdded(metric: $metric) {
      deviceId
      metric
      value
      ts
    }
  }
`;

/** Pull a Reading out of one SSE `next` payload, or null if it is not one. */
export function parseLiveEvent(raw: string): Reading | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const r = (parsed as { data?: { readingAdded?: Record<string, unknown> } } | null)?.data
    ?.readingAdded;
  if (!r) return null;
  const { deviceId, metric, value, ts } = r;
  if (
    typeof deviceId !== 'string' ||
    typeof metric !== 'string' ||
    !isMetric(metric) ||
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    typeof ts !== 'string' ||
    Number.isNaN(Date.parse(ts))
  ) {
    return null;
  }
  return { deviceId, metric, value, ts };
}

/**
 * Subscribe to new readings of `metric` over GraphQL-over-SSE (a plain GET that
 * EventSource can open). The browser reconnects by itself after a drop; we just report
 * the state. Returns a function that closes the stream.
 */
export function subscribeToReadings(
  apiUrl: string,
  metric: Metric,
  { onReading, onState, eventSourceImpl }: LiveOptions,
): () => void {
  const Impl = eventSourceImpl ?? globalThis.EventSource;
  if (!Impl) {
    onState?.('error');
    return () => {};
  }

  const url = `${apiUrl}?query=${encodeURIComponent(SUBSCRIPTION)}&variables=${encodeURIComponent(
    JSON.stringify({ metric }),
  )}`;
  onState?.('connecting');
  const source = new Impl(url);

  source.addEventListener('open', () => onState?.('open'));
  source.addEventListener('error', () => onState?.('error'));
  source.addEventListener('next', (event) => {
    const reading = parseLiveEvent((event as MessageEvent<string>).data);
    if (reading && reading.metric === metric) onReading(reading);
  });

  return () => source.close();
}
