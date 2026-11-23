import type { Metric } from '@relay/types';

export interface Point {
  value: number;
  ts: string;
}

export interface DeviceOverview {
  id: string;
  name: string;
  type: string;
  location: string | null;
  /** Newest reading of the dashboard metric, or null if the device has none yet. */
  latest: Point | null;
}

export interface Overview {
  devices: DeviceOverview[];
  /** History of the selected device, oldest first. Empty when no device is selected. */
  history: Point[];
}

export interface OverviewParams {
  metric: Metric;
  /** Device whose history to chart. Null = skip the history part of the query. */
  deviceId: string | null;
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
  query Overview($metric: String!, $deviceId: String!, $limit: Int!, $withHistory: Boolean!) {
    devices {
      id
      name
      type
      location
      latest(metric: $metric) {
        value
        ts
      }
    }
    history(deviceId: $deviceId, metric: $metric, limit: $limit) @include(if: $withHistory) {
      value
      ts
    }
  }
`;

interface GraphQLResponse {
  data?: { devices?: DeviceOverview[] | null; history?: Point[] | null } | null;
  errors?: { message: string }[];
}

/** One round trip: every device with its newest reading, plus the selected device's history. */
export async function fetchOverview(
  url: string,
  params: OverviewParams,
  options: FetchOptions = {},
): Promise<Overview> {
  const doFetch = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: QUERY,
        variables: {
          metric: params.metric,
          deviceId: params.deviceId ?? '',
          limit: params.limit ?? 60,
          withHistory: params.deviceId !== null,
        },
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

  return {
    devices: (body.data.devices ?? []).map((d) => ({ ...d, latest: d.latest ?? null })),
    history: body.data.history ?? [],
  };
}
