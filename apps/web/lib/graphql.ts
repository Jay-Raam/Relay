import type { Metric } from '@relay/types';

export interface Point {
  value: number;
  ts: string;
}

export interface TelemetrySnapshot {
  latest: Point | null;
  history: Point[];
}

export interface TelemetryParams {
  deviceId: string;
  metric: Metric;
  /** How many recent points to chart (the API caps this at 1000). */
  limit?: number;
}

export interface FetchOptions {
  signal?: AbortSignal;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/** Anything that goes wrong talking to the API, with a message safe to show in the UI. */
export class TelemetryError extends Error {}

const QUERY = /* GraphQL */ `
  query Telemetry($deviceId: String!, $metric: String!, $limit: Int!) {
    latest(deviceId: $deviceId, metric: $metric) {
      value
      ts
    }
    history(deviceId: $deviceId, metric: $metric, limit: $limit) {
      value
      ts
    }
  }
`;

interface GraphQLResponse {
  data?: TelemetrySnapshot | null;
  errors?: { message: string }[];
}

/** One round trip: the newest reading plus recent history, oldest first. */
export async function fetchTelemetry(
  url: string,
  params: TelemetryParams,
  options: FetchOptions = {},
): Promise<TelemetrySnapshot> {
  const doFetch = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: QUERY,
        variables: { deviceId: params.deviceId, metric: params.metric, limit: params.limit ?? 60 },
      }),
      signal: options.signal,
      cache: 'no-store',
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new TelemetryError('Cannot reach the API');
  }

  if (!res.ok) throw new TelemetryError(`API responded with ${res.status}`);

  let body: GraphQLResponse;
  try {
    body = (await res.json()) as GraphQLResponse;
  } catch {
    throw new TelemetryError('API returned an invalid response');
  }

  const firstError = body.errors?.[0];
  if (firstError) throw new TelemetryError(firstError.message);
  if (!body.data) throw new TelemetryError('API returned no data');

  return { latest: body.data.latest ?? null, history: body.data.history ?? [] };
}
