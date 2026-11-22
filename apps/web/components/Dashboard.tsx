'use client';

import { useEffect, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Metric } from '@relay/types';
import { fetchTelemetry, type TelemetrySnapshot } from '../lib/graphql';
import { formatValue, METRIC_INFO } from '../lib/metrics';
import { feedStatus, type FeedStatus } from '../lib/status';

const POLL_MS = 2000;
const HISTORY_POINTS = 60;

const STATUS_LABEL: Record<FeedStatus, string> = {
  live: 'Live',
  stale: 'Stale — no new data',
  'no-data': 'Waiting for data',
};

interface Props {
  deviceId: string;
  metric: Metric;
  apiUrl: string;
}

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function Dashboard({ deviceId, metric, apiUrl }: Props) {
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    // Sequential polling: the next request is scheduled only after this one finishes,
    // so a slow API never causes overlapping requests. Skipped while the tab is hidden.
    async function tick(): Promise<void> {
      if (!document.hidden) {
        try {
          const next = await fetchTelemetry(
            apiUrl,
            { deviceId, metric, limit: HISTORY_POINTS },
            { signal: controller.signal },
          );
          if (!cancelled) {
            setSnapshot(next);
            setError(null);
          }
        } catch (err) {
          const aborted = err instanceof DOMException && err.name === 'AbortError';
          if (!cancelled && !aborted) {
            setError(err instanceof Error ? err.message : 'Unknown error');
          }
        }
        if (!cancelled) setNow(Date.now());
      }
      if (!cancelled) timer = setTimeout(() => void tick(), POLL_MS);
    }

    void tick();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [apiUrl, deviceId, metric]);

  const info = METRIC_INFO[metric];
  const latest = snapshot?.latest ?? null;
  const status: FeedStatus = now === null ? 'no-data' : feedStatus(latest?.ts, now);
  const points = (snapshot?.history ?? []).map((p) => ({ t: Date.parse(p.ts), value: p.value }));

  return (
    <main className="page">
      <header className="header">
        <div>
          <div className="brand">Relay</div>
          <div className="sub">Device {deviceId}</div>
        </div>
        <div className="pill" data-status={status}>
          <span className="dot" />
          {STATUS_LABEL[status]}
        </div>
      </header>

      {error ? (
        <div className="banner" role="alert">
          {error}. Showing the last data received; retrying every {POLL_MS / 1000}s.
        </div>
      ) : null}

      <section className="card">
        <h2>{info.label} — now</h2>
        <div className="value">{latest ? formatValue(latest.value, metric) : '—'}</div>
        <div className="updated">
          {latest ? `Updated ${timeLabel(Date.parse(latest.ts))}` : 'No readings yet'}
        </div>
      </section>

      <section className="card">
        <h2>
          {info.label} — last {HISTORY_POINTS} readings
        </h2>
        <div className="chart">
          {points.length === 0 ? (
            <div className="empty">
              No data yet. Start the mock publisher and worker to see the chart fill in.
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
    </main>
  );
}
