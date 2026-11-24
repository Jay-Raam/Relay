'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { isActuator, type Command, type Metric, type SessionUser } from '@relay/types';
import {
  CONFIRM_TIMEOUT_MS,
  resolvePending,
  stateLabel,
  type PendingCommand,
} from '../lib/commands';
import {
  AuthRequiredError,
  fetchOverview,
  sendCommand,
  type DeviceOverview,
  type Overview,
} from '../lib/graphql';
import { subscribeToReadings } from '../lib/live';
import { formatValue, METRIC_INFO } from '../lib/metrics';
import { applyReading, HISTORY_POINTS, mergeSnapshot } from '../lib/merge';
import { nextPollDelay, transportLabel, type PushHealth, type Transport } from '../lib/polling';
import { feedStatus, type FeedStatus } from '../lib/status';

const STATUS_LABEL: Record<FeedStatus, string> = {
  live: 'Live',
  stale: 'Stale',
  'no-data': 'No data',
};

const TRANSPORT_LABEL: Record<Transport, string> = {
  push: 'Live (push)',
  polling: 'Polling',
  connecting: 'Connecting…',
};

interface Props {
  metric: Metric;
  apiUrl: string;
  user: SessionUser;
  onSignOut: () => void;
  /** The API no longer accepts the session (expired, or the account was removed). */
  onSessionExpired: () => void;
}

const EMPTY: Overview = { devices: [], history: [] };

const TIMEOUT_MESSAGE = `No confirmation from the device after ${CONFIRM_TIMEOUT_MS / 1000}s. It may be offline.`;

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function Dashboard({ metric, apiUrl, user, onSignOut, onSessionExpired }: Props) {
  const [overview, setOverview] = useState<Overview>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [sseConnecting, setSseConnecting] = useState(true);
  // Commands: accepted by the broker but not yet confirmed by the device, per device.
  const [pending, setPending] = useState<Record<string, PendingCommand>>({});
  // Devices whose command request is currently in flight to the API.
  const [sending, setSending] = useState<Record<string, boolean>>({});
  const [commandErrors, setCommandErrors] = useState<Record<string, string>>({});
  // Bumped after a command is accepted: restarts the poll loop for an immediate refresh.
  const [pollNonce, setPollNonce] = useState(0);

  // Push health lives in a ref: the poll loop reads it without re-running effects.
  const health = useRef<PushHealth>({ open: false, lastEventAt: null });
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const expiredRef = useRef(onSessionExpired);
  expiredRef.current = onSessionExpired;

  // A 1s ticker keeps "Live/Stale" and the transport label honest even when no data arrives.
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Live push: patch state in place as readings arrive.
  useEffect(() => {
    const stop = subscribeToReadings(apiUrl, metric, {
      onReading: (reading) => {
        health.current.lastEventAt = Date.now();
        setOverview((prev) => applyReading(prev, reading, selectedRef.current));
      },
      onState: (state) => {
        health.current.open = state === 'open';
        setSseConnecting(state === 'connecting');
      },
    });
    return () => {
      stop();
      health.current = { open: false, lastEventAt: null };
    };
  }, [apiUrl, metric]);

  // Polling: the source of truth on load and for resync, and the fallback when push is down.
  // Sequential (next request scheduled after this one ends); paused while the tab is hidden.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    async function tick(): Promise<void> {
      if (!document.hidden) {
        try {
          const next = await fetchOverview(
            apiUrl,
            { metric, deviceId: selectedId, limit: HISTORY_POINTS },
            { signal: controller.signal },
          );
          if (!cancelled) {
            setOverview((prev) => mergeSnapshot(prev, next));
            setLoaded(true);
            setError(null);
            // First load: select the first sensor (actuators have no chart). Changing
            // selectedId restarts this effect.
            const firstSensor = next.devices.find((d) => !isActuator(d.type));
            if (selectedRef.current === null && firstSensor) setSelectedId(firstSensor.id);
          }
        } catch (err) {
          const aborted = err instanceof DOMException && err.name === 'AbortError';
          if (!cancelled && !aborted) {
            if (err instanceof AuthRequiredError) {
              // No point polling a session that is gone: hand back to the sign-in form.
              cancelled = true;
              expiredRef.current();
              return;
            }
            setError(err instanceof Error ? err.message : 'Unknown error');
          }
        }
      }
      if (!cancelled) {
        // Poll fast while a command awaits its confirmation (it arrives via the database).
        const waiting = Object.keys(pendingRef.current).length > 0;
        timer = setTimeout(() => void tick(), nextPollDelay(health.current, Date.now(), waiting));
      }
    }

    void tick();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [apiUrl, metric, selectedId, pollNonce]);

  // Settle pending commands whenever fresh data arrives: confirmed ones just disappear (the
  // new state is already on screen); the ones the device never answered turn into an error.
  useEffect(() => {
    if (Object.keys(pendingRef.current).length === 0) return;
    const result = resolvePending(pendingRef.current, overview.devices, Date.now());
    if (result.pending === pendingRef.current) return;
    setPending(result.pending);
    if (result.timedOut.length > 0) {
      setCommandErrors((prev) => ({
        ...prev,
        ...Object.fromEntries(result.timedOut.map((p) => [p.deviceId, TIMEOUT_MESSAGE])),
      }));
    }
  }, [overview, now]);

  const issueCommand = useCallback(
    async (device: DeviceOverview, command: Command) => {
      setCommandErrors(({ [device.id]: _cleared, ...rest }) => rest);
      setSending((prev) => ({ ...prev, [device.id]: true }));
      try {
        const sent = await sendCommand(apiUrl, device.id, command);
        setPending((prev) => ({
          ...prev,
          [device.id]: {
            commandId: sent.id,
            deviceId: device.id,
            command,
            sentAt: Date.now(),
          },
        }));
        setPollNonce((n) => n + 1);
      } catch (err) {
        if (err instanceof AuthRequiredError) {
          expiredRef.current();
          return;
        }
        const message = err instanceof Error ? err.message : 'Command failed';
        setCommandErrors((prev) => ({ ...prev, [device.id]: message }));
      } finally {
        setSending((prev) => ({ ...prev, [device.id]: false }));
      }
    },
    [apiUrl],
  );

  const select = useCallback((id: string) => {
    if (id === selectedRef.current) return;
    // Clear the old device's chart right away; the poll restarts for the new device.
    setOverview((o) => ({ ...o, history: [] }));
    setSelectedId(id);
  }, []);

  const info = METRIC_INFO[metric];
  const clock = now ?? 0;
  const transport =
    now === null ? 'connecting' : transportLabel(health.current, sseConnecting, clock);
  const selected = overview.devices.find((d) => d.id === selectedId) ?? null;
  const canCommand = user.role === 'operator';
  const points = overview.history.map((p) => ({ t: Date.parse(p.ts), value: p.value }));

  return (
    <main className="page">
      <header className="header">
        <div>
          <div className="brand">Relay</div>
          <div className="sub">
            {overview.devices.length > 0
              ? `${overview.devices.length} devices · ${info.label}`
              : info.label}
          </div>
        </div>
        <div className="header-right">
          <div className="pill" data-transport={transport}>
            <span className="dot" />
            {TRANSPORT_LABEL[transport]}
          </div>
          <div className="account">
            <span className="account-email">{user.email}</span>
            <span className="role-tag" data-role={user.role}>
              {user.role}
            </span>
            <button type="button" className="btn link" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      {error ? (
        <div className="banner" role="alert">
          {error}. Showing the last data received; retrying.
        </div>
      ) : null}

      {loaded && overview.devices.length === 0 ? (
        <section className="card">
          <div className="empty">
            No devices yet. Run <code>pnpm --filter @relay/db migrate:seed</code> to add demo
            devices.
          </div>
        </section>
      ) : null}

      <section className="devices" aria-label="Devices">
        {overview.devices.map((d) => {
          if (isActuator(d.type)) {
            const waiting = Boolean(pending[d.id]) || Boolean(sending[d.id]);
            const error = commandErrors[d.id];
            const label = stateLabel(d);
            return (
              <div key={d.id} className="device actuator" data-state={label.toLowerCase()}>
                <span className="device-top">
                  <span className="device-name">{d.name}</span>
                  <span className="type-tag">{d.type}</span>
                </span>
                <span className="device-value">{waiting ? '…' : label}</span>
                <span className="device-meta">
                  {d.id}
                  {d.location ? ` · ${d.location}` : ''}
                  {d.state && !waiting ? ` · changed ${timeLabel(Date.parse(d.state.ts))}` : ''}
                  {waiting ? ' · waiting for the device…' : ''}
                </span>
                {canCommand ? (
                  <span className="controls">
                    <button
                      type="button"
                      className="btn"
                      aria-pressed={d.state?.value === 'on'}
                      disabled={waiting}
                      onClick={() => void issueCommand(d, 'on')}
                    >
                      Turn on
                    </button>
                    <button
                      type="button"
                      className="btn"
                      aria-pressed={d.state?.value === 'off'}
                      disabled={waiting}
                      onClick={() => void issueCommand(d, 'off')}
                    >
                      Turn off
                    </button>
                  </span>
                ) : (
                  <span className="view-only">View only</span>
                )}
                {error ? (
                  <span className="command-error" role="alert">
                    {error}
                  </span>
                ) : null}
              </div>
            );
          }

          const status: FeedStatus = now === null ? 'no-data' : feedStatus(d.latest?.ts, clock);
          return (
            <button
              key={d.id}
              type="button"
              className="device"
              data-selected={d.id === selectedId}
              data-status={status}
              aria-pressed={d.id === selectedId}
              onClick={() => select(d.id)}
            >
              <span className="device-top">
                <span className="device-name">{d.name}</span>
                <span className="status" data-status={status}>
                  <span className="dot" />
                  {STATUS_LABEL[status]}
                </span>
              </span>
              <span className="device-value">
                {d.latest ? formatValue(d.latest.value, metric) : '—'}
              </span>
              <span className="device-meta">
                {d.id}
                {d.location ? ` · ${d.location}` : ''}
              </span>
            </button>
          );
        })}
      </section>

      {selected ? (
        <section className="card">
          <h2>
            {selected.name} — {info.label}, last {HISTORY_POINTS} readings
          </h2>
          <div className="chart">
            {points.length === 0 ? (
              <div className="empty">
                No data yet for this device. Start the mock publisher and worker to see the chart
                fill in.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={points} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="#223047" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="t"
                    type="number"
                    scale="time"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={timeLabel}
                    stroke="#8b9bb4"
                    fontSize={12}
                  />
                  <YAxis
                    domain={['auto', 'auto']}
                    tickFormatter={(v: number) => v.toFixed(1)}
                    stroke="#8b9bb4"
                    fontSize={12}
                    width={48}
                  />
                  <Tooltip
                    labelFormatter={(label) => timeLabel(Number(label))}
                    formatter={(value) => [formatValue(Number(value), metric), info.label]}
                    contentStyle={{ background: '#131a26', border: '1px solid #223047' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#38bdf8"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>
      ) : null}
    </main>
  );
}
