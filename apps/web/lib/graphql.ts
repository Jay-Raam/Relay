import type { Command, DeviceState, Metric } from '@relay/types';

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
  /** Last state an actuator (pump / valve) reported; null for sensors and before its first report. */
  state: DeviceState | null;
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

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: { message: string }[];
}

/** POST one GraphQL operation and return its data, or throw a TelemetryError. */
async function post<T>(
  url: string,
  query: string,
  variables: Record<string, unknown>,
  options: FetchOptions,
): Promise<T> {
  const doFetch = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: options.signal,
      cache: 'no-store',
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new TelemetryError('Cannot reach the API');
  }

  if (!res.ok) throw new TelemetryError(`API responded with ${res.status}`);

  let body: GraphQLResponse<T>;
  try {
    body = (await res.json()) as GraphQLResponse<T>;
  } catch {
    throw new TelemetryError('API returned an invalid response');
  }

  const firstError = body.errors?.[0];
  if (firstError) throw new TelemetryError(firstError.message);
  if (!body.data) throw new TelemetryError('API returned no data');
  return body.data;
}

const OVERVIEW_QUERY = /* GraphQL */ `
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
      state {
        value
        ts
        commandId
      }
    }
    history(deviceId: $deviceId, metric: $metric, limit: $limit) @include(if: $withHistory) {
      value
      ts
    }
  }
`;

interface OverviewData {
  devices?: (Omit<DeviceOverview, 'latest' | 'state'> & {
    latest?: Point | null;
    state?: DeviceState | null;
  })[];
  history?: Point[] | null;
}

/** One round trip: every device with its newest reading, plus the selected device's history. */
export async function fetchOverview(
  url: string,
  params: OverviewParams,
  options: FetchOptions = {},
): Promise<Overview> {
  const data = await post<OverviewData>(
    url,
    OVERVIEW_QUERY,
    {
      metric: params.metric,
      deviceId: params.deviceId ?? '',
      limit: params.limit ?? 60,
      withHistory: params.deviceId !== null,
    },
    options,
  );

  return {
    devices: (data.devices ?? []).map((d) => ({
      ...d,
      latest: d.latest ?? null,
      state: d.state ?? null,
    })),
    history: data.history ?? [],
  };
}

const SEND_COMMAND_MUTATION = /* GraphQL */ `
  mutation SendCommand($deviceId: String!, $command: String!) {
    sendCommand(deviceId: $deviceId, command: $command) {
      id
      deviceId
      command
      status
    }
  }
`;

export interface CommandSent {
  /** Matches Device.state.commandId once the device has acted on the command. */
  id: string;
  deviceId: string;
  command: Command;
  status: string;
}

/** Ask the API to send on/off to a pump or valve. Resolves once the broker accepted it. */
export async function sendCommand(
  url: string,
  deviceId: string,
  command: Command,
  options: FetchOptions = {},
): Promise<CommandSent> {
  const data = await post<{ sendCommand: CommandSent }>(
    url,
    SEND_COMMAND_MUTATION,
    { deviceId, command },
    options,
  );
  return data.sendCommand;
}
